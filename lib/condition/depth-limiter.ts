import { ConditionTree, ICondition, ScopeOp } from './types'
import { ScopedCondition } from './scoped-condition'
import { LiteralCondition } from './literal-condition'

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
 * - `"throw"` (default) – throws an Error immediately
 * - `"false"` – replaces that branch with `LiteralCondition(false)`,
 *               then simplifies the surrounding boolean context
 * - `"strip"` – removes that branch from its parent entirely, then
 *               simplifies the surrounding boolean context
 *
 * Boolean simplification rules applied after branch replacement:
 *
 *   OR (false, x)  → OR(x)        OR (true, x)   → true
 *   AND(true,  x)  → AND(x)       AND(false, x)  → false
 *   NOT(false)     → true          NOT(true)      → false
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
     * Returns the (possibly mutated) root.  The root node is always
     * preserved so callers can still call `tree.alias` without error.
     */
    apply(tree: ConditionTree): ConditionTree {
        if (tree.type !== 'scoped') return tree

        const root = tree as ScopedCondition
        const result = this.limitNode(root, 0)

        if (result === root) return root  // common path: in-place mutation

        if (result === null) {
            // Strip mode: everything stripped → empty root = no WHERE clause
            root.clear()
            return root
        }

        // Root simplified to a LiteralCondition
        const literal = result as LiteralCondition
        root.clear()
        if (!literal.value) {
            // false → make root emit (1=0)
            root.push(literal)
        }
        // true → empty root = no WHERE clause (equivalent to no filter)
        return root
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    /**
     * Recursively limits `node` at the given `depth`.
     *
     * Returns:
     *   - the same node (possibly mutated in-place) if no simplification
     *     collapsed it to a literal,
     *   - a new `LiteralCondition` if the node was collapsed,
     *   - `null` if the node should be stripped.
     */
    private limitNode(
        node: ConditionTree,
        depth: number,
    ): ConditionTree | null {
        // Non-scoped leaves are always passed through unchanged.
        if (node.type !== 'scoped') return node

        const scoped = node as ScopedCondition

        // ── Depth violation check ──────────────────────────────────────
        if (scoped.join && depth >= this.maxDepth) {
            switch (this.onViolation) {
            case 'throw':
                throw new Error(
                    `Filter query exceeds maximum join depth of ${this.maxDepth}`
                )
            case 'false':
                return new LiteralCondition(false)
            case 'strip':
                return null
            }
        }

        const nextDepth = scoped.join ? depth + 1 : depth

        // ── Recurse into children ──────────────────────────────────────
        const newConditions: ICondition[] = []
        for (const child of scoped.conditions) {
            const result = this.limitNode(child as ConditionTree, nextDepth)
            if (result !== null) {
                newConditions.push(result)
            }
            // null ⇒ stripped: do not add to newConditions

            // If the child was stripped or replaced by a new node, unlink the
            // original to break circular parent↔child references and allow GC.
            if (result !== (child as ConditionTree)) {
                child.unlink()
            }
        }
        scoped.conditions = newConditions

        // Fix parent back-references for any new nodes that were inserted.
        for (const c of newConditions) {
            c.parent = scoped
        }

        return this.simplify(scoped)
    }

    /**
     * Applies one pass of boolean simplification to `scoped` after its
     * children have been updated.
     *
     * Returns:
     *   - `scoped` (possibly mutated) if it should remain in the tree,
     *   - a new `LiteralCondition` if the scope collapsed to a constant,
     *   - `null` if the scope should be stripped (empty = no constraint).
     */
    private simplify(scoped: ScopedCondition): ConditionTree | null {
        const conditions = scoped.conditions

        if (conditions.length === 0) {
            // Empty scope: no constraint ─ treat as stripped regardless
            // of violation mode (the caller decides what "null" means at
            // the root level).
            return null
        }

        const literals = conditions.filter(
            c => c.type === 'literal'
        ) as LiteralCondition[]

        if (literals.length === 0) return scoped

        switch (scoped.scope) {
        case ScopeOp.AND: {
            // AND(…, false, …) = false
            if (literals.some(l => !l.value))
                return new LiteralCondition(false)
            // AND(…, true, …) = AND(…) – remove true literals
            const andRest = conditions.filter(
                c => c.type !== 'literal' || !(c as LiteralCondition).value
            )
            conditions
                .filter(c => c.type === 'literal' && (c as LiteralCondition).value)
                .forEach(c => c.unlink())
            scoped.conditions = andRest
            // All children were true literals → AND(true,…,true) = true = no constraint
            if (andRest.length === 0) return null
            return scoped
        }
        case ScopeOp.OR: {
            // OR(…, true, …) = true
            if (literals.some(l => l.value))
                return new LiteralCondition(true)
            // OR(…, false, …) = OR(…) – remove false literals
            const orRest = conditions.filter(
                c => c.type !== 'literal' || (c as LiteralCondition).value
            )
            conditions
                .filter(c => c.type === 'literal' && !(c as LiteralCondition).value)
                .forEach(c => c.unlink())
            scoped.conditions = orRest
            // All children were false literals → OR(false,…,false) = false
            if (orRest.length === 0) return new LiteralCondition(false)
            return scoped
        }
        case ScopeOp.NOT: {
            // NOT should wrap exactly one child in valid trees.
            // Because we only enter simplify() when literals.length > 0,
            // literals[0] is always defined here.
            return new LiteralCondition(!literals[0].value)
        }
        }
    }
}
