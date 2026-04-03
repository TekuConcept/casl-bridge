import { ConditionTree, ICondition, ScopeOp } from '../condition/types'
import { ScopedCondition } from '../condition/scoped-condition'
import { LiteralCondition } from '../condition/literal-condition'
import { PrimitiveCondition } from '../condition/primitive-condition'
import { PassResult } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// TreeMerger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merges two ConditionTree roots into a single AND-combined tree, applying
 * boolean simplification (neutral-element removal) and conservative
 * structural deduplication (identical subtrees at the same level).
 *
 * ### Merge semantics
 * The children of both root `ScopedCondition`s are **flattened** into a new
 * merged root (scope = AND, same alias as `left`).  The original root nodes
 * become empty shells after the merge.
 *
 * Flattening ensures the serialised SQL structure for the merged tree is
 * equivalent to serialising both trees separately and AND-ing the results:
 *
 *   Old:  `WHERE (casl_conds) AND (filter_conds)`
 *   New:  `WHERE (casl_conds AND filter_conds)`
 *
 * (semantically identical; the bracket level changes by one).
 *
 * ### Simplification
 * After merging, boolean constants (`LiteralCondition`) are simplified:
 *
 *   AND(…, true, …)   → AND(…)   (remove neutral element)
 *   AND(…, false, …)  → false    (short-circuit)
 *   empty AND         → no constraint (empty root = no WHERE clause)
 *
 * ### Deduplication
 * Structurally identical children at the root level of the merged tree are
 * deduplicated: the second (and any further) occurrence is removed.
 * Structural equality is conservative: it compares raw column names,
 * operators, operands, scope types, join flags, and children recursively.
 * It does **not** resolve inherited aliases across different subtrees.
 *
 * ### Safety
 * - Security-critical fields (`maxDepth`, `pathPolicy`) are applied only to
 *   the external filter tree via `compileExternalFilterTree` *before* this
 *   class is called; the merger itself is policy-agnostic.
 * - No reordering of predicates is performed.
 */
export class TreeMerger {
    /**
     * Merges `left` (ability tree) and `right` (external filter tree) into a
     * single AND-combined tree.
     *
     * Both trees must be the `ScopedCondition` roots returned by
     * `MongoQuery.build()`.  Their children are moved into a new merged root;
     * the original roots become empty shells.
     *
     * Returns a {@link PassResult} whose `tree` is the merged root.  Callers
     * **must** use `result.tree` rather than assuming either input reference
     * is still valid.
     *
     * When either input tree is empty its children contribute nothing to the
     * merge (neutral element).
     */
    static merge(left: ConditionTree, right: ConditionTree): PassResult<ConditionTree> {
        if (left.type !== 'scoped' || right.type !== 'scoped') {
            return { tree: left, issues: [] }
        }

        const leftRoot  = left  as ScopedCondition
        const rightRoot = right as ScopedCondition

        const merged = new ScopedCondition({
            alias:     leftRoot.alias,
            scope:     ScopeOp.AND,
            traceName: 'merged',
        })

        const leftChildren = leftRoot.conditions.slice()
        leftRoot.conditions = []
        for (const child of leftChildren) merged.push(child)

        const rightChildren = rightRoot.conditions.slice()
        rightRoot.conditions = []
        for (const child of rightChildren) merged.push(child)

        TreeMerger.dedupe(merged)
        const result = TreeMerger.simplify(merged)

        if (result === merged) return { tree: merged, issues: [] }

        merged.clear()

        if (result === null) return { tree: merged, issues: [] }

        const literal = result as LiteralCondition
        if (!literal.value) {
            merged.push(literal)
        }
        return { tree: merged, issues: [] }
    }

    /**
     * Removes structurally identical conditions at the top level of `scope`.
     */
    static dedupe(scope: ScopedCondition): void {
        const seen: ConditionTree[] = []
        const toRemove: number[] = []

        for (let i = 0; i < scope.conditions.length; i++) {
            const child = scope.conditions[i] as ConditionTree
            if (seen.some(s => TreeMerger.nodesAreEqual(s, child))) {
                toRemove.push(i)
            } else {
                seen.push(child)
            }
        }

        for (let i = toRemove.length - 1; i >= 0; i--) {
            const idx = toRemove[i]
            const removed = scope.conditions[idx]
            scope.conditions.splice(idx, 1)
            removed.unlink()
        }
    }

    /**
     * Returns `true` if two ConditionTree nodes are structurally identical.
     */
    static nodesAreEqual(a: ConditionTree, b: ConditionTree): boolean {
        if (a.type !== b.type) return false

        if (a.type === 'literal') {
            return (a as LiteralCondition).value === (b as LiteralCondition).value
        }

        if (a.type === 'primitive') {
            const pa = a as PrimitiveCondition
            const pb = b as PrimitiveCondition
            return rawColumn(pa) === rawColumn(pb) &&
                   rawAlias(pa)  === rawAlias(pb)  &&
                   pa.operator   === pb.operator   &&
                   operandsEqual(pa.operand, pb.operand)
        }

        const sa = a as ScopedCondition
        const sb = b as ScopedCondition
        if (sa.scope !== sb.scope)                         return false
        if (sa.join  !== sb.join)                          return false
        if (rawColumn(sa) !== rawColumn(sb))               return false
        if (rawAlias(sa)  !== rawAlias(sb))                return false
        if (sa.conditions.length !== sb.conditions.length) return false

        for (let i = 0; i < sa.conditions.length; i++) {
            if (!TreeMerger.nodesAreEqual(
                sa.conditions[i] as ConditionTree,
                sb.conditions[i] as ConditionTree,
            )) return false
        }
        return true
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    private static simplify(scoped: ScopedCondition): ConditionTree | null {
        const conditions = scoped.conditions

        if (conditions.length === 0) return null

        const literals = conditions.filter(
            c => c.type === 'literal'
        ) as LiteralCondition[]

        if (literals.length === 0) return scoped

        switch (scoped.scope) {
        case ScopeOp.AND: {
            if (literals.some(l => !l.value))
                return new LiteralCondition(false)
            const andRest = conditions.filter(
                c => c.type !== 'literal' || !(c as LiteralCondition).value
            )
            conditions
                .filter(c => c.type === 'literal' && (c as LiteralCondition).value)
                .forEach((c: ICondition) => c.unlink())
            scoped.conditions = andRest
            if (andRest.length === 0) return null
            return scoped
        }
        /* c8 ignore start */
        case ScopeOp.OR: {
            if (literals.some(l => l.value))
                return new LiteralCondition(true)
            const orRest = conditions.filter(
                c => c.type !== 'literal' || (c as LiteralCondition).value
            )
            conditions
                .filter(c => c.type === 'literal' && !(c as LiteralCondition).value)
                .forEach((c: ICondition) => c.unlink())
            scoped.conditions = orRest
            if (orRest.length === 0) return new LiteralCondition(false)
            return scoped
        }
        case ScopeOp.NOT: {
            return new LiteralCondition(!literals[0].value)
        }
        /* c8 ignore stop */
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function rawColumn(node: ICondition): string | null {
    return (node as any)['_column'] as string | null
}

function rawAlias(node: ICondition): string | null {
    return (node as any)['_alias'] as string | null
}

function operandsEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (typeof a !== typeof b) return false
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false
        return a.every((v, i) => operandsEqual(v, b[i]))
    }
    if (typeof a === 'object') {
        try { return JSON.stringify(a) === JSON.stringify(b) }
        /* c8 ignore next */
        catch { return false }
    }
    return false
}
