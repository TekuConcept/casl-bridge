import { ConditionTree, ICondition, ScopeOp } from '../condition/types'
import { ScopedCondition } from '../condition/scoped-condition'
import { LiteralCondition } from '../condition/literal-condition'
import { PassResult, PassError } from './types'

export type ViolationMode = 'throw' | 'false' | 'strip'

/**
 * Traverses a ConditionTree built from external (non-CASL) filters
 * and enforces a maximum join-scope depth.
 *
 * Depth is defined as the number of `join=true` ScopedCondition
 * ancestors above a node (root = depth 0).
 *
 * - `maxDepth === 0`  ─ no relation hops are allowed
 * - `maxDepth === 1`  ─ one level of relation hops is allowed, etc.
 *
 * When a join scope is encountered at `depth >= maxDepth`:
 *
 * - `"throw"` (default) – throws a {@link PassError} immediately
 * - `"false"` – replaces that branch with `LiteralCondition(false)`,
 *               then simplifies the surrounding boolean context
 * - `"strip"` – removes that branch from its parent entirely, then
 *               simplifies the surrounding boolean context
 *
 * Boolean simplification rules applied after branch replacement:
 *
 *   OR (false, x)  → OR(x)        OR (true, x)   → true
 *   AND(true,  x)  → AND(x)       AND(false, x)  → false
 *   NOT(false)     → true         NOT(true)      → false
 *   empty scope    → null (no constraint, equivalent to being stripped)
 *
 * CASL ability trees are **not** passed through this class; only
 * external filter trees compiled via `compileExternalFilterTree`.
 */
export class DepthLimiter {
    constructor(
        private readonly maxDepth: number,
        private readonly onViolation: ViolationMode = 'throw',
    ) {}

    /**
     * Applies depth limiting to `tree` (which must be the root
     * ScopedCondition returned by `MongoQuery.build()`).
     *
     * Returns a {@link PassResult} whose `tree` field is the (possibly
     * mutated) root.  Callers **must** use `result.tree` rather than
     * assuming the input reference is still valid.
     *
     * The root node is always preserved so callers can still call
     * `result.tree.alias` without error.
     */
    apply(tree: ConditionTree): PassResult<ConditionTree> {
        if (tree.type !== 'scoped') return { tree, issues: [] }

        const root = tree as ScopedCondition
        const result = this.limitNode(root, 0, [])

        if (result === root) return { tree: root, issues: [] }

        if (result === null) {
            root.clear()
            return { tree: root, issues: [] }
        }

        const literal = result as LiteralCondition
        root.clear()
        if (!literal.value) {
            root.push(literal)
        }
        return { tree: root, issues: [] }
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    private limitNode(
        node: ConditionTree,
        depth: number,
        joinPath: string[],
    ): ConditionTree | null {
        if (node.type !== 'scoped') return node

        const scoped = node as ScopedCondition

        if (scoped.join && depth >= this.maxDepth) {
            const col  = (scoped as any)['_column'] as string | null
            /* c8 ignore next */
            const path = col ? [...joinPath, col].join('.') : joinPath.join('.') || undefined
            switch (this.onViolation) {
            case 'throw':
                throw new PassError(
                    `Filter query exceeds maximum join depth of ${this.maxDepth}`,
                    'MAX_DEPTH_EXCEEDED',
                    path,
                )
            case 'false':
                return new LiteralCondition(false)
            case 'strip':
                return null
            }
        }

        const nextDepth = scoped.join ? depth + 1 : depth
        const col       = (scoped as any)['_column'] as string | null
        const nextJoinPath = scoped.join && col ? [...joinPath, col] : joinPath

        const newConditions: ICondition[] = []
        for (const child of scoped.conditions) {
            const result = this.limitNode(child as ConditionTree, nextDepth, nextJoinPath)
            if (result !== null) {
                newConditions.push(result)
            }
            if (result !== (child as ConditionTree)) {
                child.unlink()
            }
        }
        scoped.conditions = newConditions

        for (const c of newConditions) {
            c.parent = scoped
        }

        return this.simplify(scoped)
    }

    private simplify(scoped: ScopedCondition): ConditionTree | null {
        const conditions = scoped.conditions

        if (conditions.length === 0) {
            return null
        }

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
                .forEach(c => c.unlink())
            scoped.conditions = andRest
            if (andRest.length === 0) return null
            return scoped
        }
        case ScopeOp.OR: {
            if (literals.some(l => l.value))
                return new LiteralCondition(true)
            const orRest = conditions.filter(
                c => c.type !== 'literal' || (c as LiteralCondition).value
            )
            conditions
                .filter(c => c.type === 'literal' && !(c as LiteralCondition).value)
                .forEach(c => c.unlink())
            scoped.conditions = orRest
            if (orRest.length === 0) return new LiteralCondition(false)
            return scoped
        }
        case ScopeOp.NOT: {
            return new LiteralCondition(!literals[0].value)
        }
        }
    }
}
