import { ConditionTree, ICondition, ScopeOp } from './types'
import { ScopedCondition } from './scoped-condition'
import { LiteralCondition } from './literal-condition'
import { ViolationMode } from './depth-limiter'
import { PathPolicy } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Normalised internal representation
// ─────────────────────────────────────────────────────────────────────────────

interface NormalizedRule {
    path: string
    decision: 'allow' | 'deny'
}

interface NormalizedPolicy {
    default: 'allow' | 'deny'
    rules: NormalizedRule[]
}

function normalizePolicy(policy: PathPolicy): NormalizedPolicy {
    return {
        default: policy.default ?? 'allow',
        rules: policy.rules ?? [],
    }
}

/** Returns the raw `_column` of a condition node without traversing the parent chain. */
function rawColumn(node: ICondition): string | null {
    return (node as any)['_column'] as string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// PathPolicyEnforcer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traverses a ConditionTree built from external (non-CASL) filters
 * and enforces a {@link PathPolicy}.
 *
 * A **path** is the dot-separated chain of relation and field names that
 * leads from the query root to a given node, e.g. `"author.name"` or
 * just `"id"` for a root-level field.
 *
 * Matching rules:
 *  - Exact match: `"author.name"` matches only the path `author.name`.
 *  - Descendant wildcard: `"author.**"` matches any path that starts
 *    with `"author."` (e.g. `author.name`, `author.publisher.city`).
 *
 * Rules are evaluated in order; the first matching rule decides
 * allow/deny.  When no rule matches, the `default` policy applies
 * (defaults to `"allow"`).
 *
 * Enforcement points:
 *  - Each **primitive condition** (leaf field comparison): the full
 *    dotted path including ancestor joins is checked (e.g. `"author.name"`
 *    or `"id"` for a root-level primitive).  Primitives with a `null`
 *    column (i.e. the synthetic empty-result node) are always passed
 *    through unchanged.
 *  - Join scopes are treated as pure traversal nodes and are **not**
 *    checked against the policy.  To block an entire relation, use a
 *    descendant wildcard rule, e.g. `{ path: "author.**", decision: "deny" }`.
 *
 * When a path is denied:
 *  - `"throw"` (default) – throws an `Error` immediately.
 *  - `"false"` – replaces the violating branch with `LiteralCondition(false)`,
 *                then simplifies the surrounding boolean context.
 *  - `"strip"` – removes the violating branch entirely.
 *
 * Boolean simplification rules (identical to DepthLimiter):
 *
 *   OR (false, x)  → OR(x)        OR (true, x)   → true
 *   AND(true,  x)  → AND(x)       AND(false, x)  → false
 *   NOT(false)     → true         NOT(true)      → false
 *   empty scope    → null (no constraint, equivalent to being stripped)
 *
 * CASL ability trees are **not** passed through this class; only
 * external filter trees compiled via `compileExternalFilterTree`.
 */
export class PathPolicyEnforcer {
    private readonly policy: NormalizedPolicy

    constructor(
        policy: PathPolicy,
        private readonly onViolation: ViolationMode = 'throw',
    ) {
        this.policy = normalizePolicy(policy)
    }

    /**
     * Applies path-policy enforcement to `tree` (which must be the root
     * ScopedCondition returned by `MongoQuery.build()`).
     *
     * Returns the (possibly mutated) root.  The root node is always
     * preserved so callers can still call `tree.alias` without error.
     */
    apply(tree: ConditionTree): ConditionTree {
        if (tree.type !== 'scoped') return tree

        const root = tree as ScopedCondition
        const result = this.enforceNode(root, [])

        if (result === root) return root  // common path: in-place mutation

        if (result === null) {
            // Strip / collapse: everything removed → empty root = no WHERE clause
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
     * Recursively enforces the policy on `node` given the accumulated
     * `joinPath` (ordered list of join-scope column names above this node).
     *
     * Returns:
     *   - the same node (possibly mutated in-place) if it should remain,
     *   - a new `LiteralCondition` if the node was collapsed to a constant,
     *   - `null` if the node should be stripped.
     */
    private enforceNode(
        node: ConditionTree,
        joinPath: string[],
    ): ConditionTree | null {
        // ── Literal – always pass through (already a synthetic constant) ──
        if (node.type === 'literal') return node

        // ── Primitive leaf ────────────────────────────────────────────────
        if (node.type === 'primitive') {
            const col = rawColumn(node)
            // null column = synthetic empty-result node; skip policy check
            if (col !== null) {
                const path = joinPath.length > 0
                    ? joinPath.join('.') + '.' + col
                    : col
                if (!this.isAllowed(path)) {
                    return this.handleViolation(path)
                }
            }
            return node
        }

        // ── Scoped (AND / OR / NOT) node ──────────────────────────────────
        const scoped = node as ScopedCondition
        const ownCol = rawColumn(scoped)

        const nextJoinPath = scoped.join && ownCol !== null
            ? [...joinPath, ownCol]
            : joinPath

        // ── Recurse into children ─────────────────────────────────────────
        const newConditions: ICondition[] = []
        for (const child of scoped.conditions) {
            const result = this.enforceNode(child as ConditionTree, nextJoinPath)
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
     * Returns `true` if `path` is permitted by the policy.
     * Rules are evaluated in order; the first matching rule wins.
     */
    private isAllowed(path: string): boolean {
        for (const rule of this.policy.rules) {
            if (this.matchesPattern(path, rule.path)) {
                return rule.decision === 'allow'
            }
        }
        return this.policy.default === 'allow'
    }

    /**
     * Returns `true` if `path` satisfies `pattern`.
     *
     * - Exact: `pattern === path`
     * - Descendant wildcard: `pattern` ends with `".**"` and `path`
     *   starts with `pattern_prefix + "."`.
     */
    private matchesPattern(path: string, pattern: string): boolean {
        if (pattern.endsWith('.**')) {
            const prefix = pattern.slice(0, -3)
            return path.startsWith(prefix + '.')
        }
        return path === pattern
    }

    /**
     * Produces the appropriate replacement node for a policy violation.
     */
    private handleViolation(path: string): LiteralCondition | null {
        switch (this.onViolation) {
        case 'throw':
            throw new Error(
                `Filter path "${path}" is not permitted by PathPolicy`
            )
        case 'false':
            return new LiteralCondition(false)
        case 'strip':
            return null
        }
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
