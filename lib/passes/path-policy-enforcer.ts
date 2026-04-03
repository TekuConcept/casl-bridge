import { ConditionTree, ICondition, ScopeOp } from '../condition/types'
import { ScopedCondition } from '../condition/scoped-condition'
import { LiteralCondition } from '../condition/literal-condition'
import { ViolationMode } from './depth-limiter'
import { PassResult, PassError } from './types'
import { PathPolicy } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Shared policy types and utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single path-policy rule resolved from {@link PathPolicy}.
 * `path` is the dot-separated pattern (may end with `".**"` for descendant
 * wildcard matching) and `decision` is the action to take when the rule matches.
 */
export interface NormalizedRule {
    path: string
    decision: 'allow' | 'deny'
}

/**
 * A fully-resolved internal representation of a {@link PathPolicy} where all
 * optional fields are guaranteed to be present.
 */
export interface NormalizedPolicy {
    default: 'allow' | 'deny'
    rules: NormalizedRule[]
}

/**
 * Normalises a raw {@link PathPolicy} into a fully-resolved internal form
 * with all optional fields filled in.
 */
export function normalizePolicy(policy: PathPolicy): NormalizedPolicy {
    return {
        default: policy.default ?? 'allow',
        rules: policy.rules ?? [],
    }
}

/**
 * Returns `true` if `path` is permitted by `policy`.
 * Rules are evaluated in order; the first matching rule wins.
 */
export function isAllowedByPolicy(path: string, policy: NormalizedPolicy): boolean {
    for (const rule of policy.rules) {
        if (matchesPattern(path, rule.path)) {
            return rule.decision === 'allow'
        }
    }
    return policy.default === 'allow'
}

/**
 * Returns `true` if `path` satisfies `pattern`.
 *
 * - Exact: `pattern === path`
 * - Descendant wildcard: pattern ends with `".**"` and path starts with
 *   `pattern_prefix + "."`.
 */
export function matchesPattern(path: string, pattern: string): boolean {
    if (pattern.endsWith('.**')) {
        const prefix = pattern.slice(0, -3)
        return path.startsWith(prefix + '.')
    }
    return path === pattern
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
 *  - `"throw"` (default) – throws a {@link PassError} immediately.
 *  - `"false"` – replaces the violating branch with `LiteralCondition(false)`,
 *                then simplifies the surrounding boolean context.
 *  - `"strip"` – removes the violating branch entirely.
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
     * Returns a {@link PassResult} whose `tree` field is the (possibly
     * mutated) root.  Callers **must** use `result.tree` rather than
     * assuming the input reference is still valid.
     */
    apply(tree: ConditionTree): PassResult<ConditionTree> {
        if (tree.type !== 'scoped') return { tree, issues: [] }

        const root = tree as ScopedCondition
        const result = this.enforceNode(root, [])

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

    private enforceNode(
        node: ConditionTree,
        joinPath: string[],
    ): ConditionTree | null {
        if (node.type === 'literal') return node

        if (node.type === 'primitive') {
            const col = rawColumn(node)
            if (col !== null) {
                const path = joinPath.length > 0
                    ? joinPath.join('.') + '.' + col
                    : col
                if (!isAllowedByPolicy(path, this.policy)) {
                    return this.handleViolation(path)
                }
            }
            return node
        }

        const scoped = node as ScopedCondition
        const ownCol = rawColumn(scoped)

        const nextJoinPath = scoped.join && ownCol !== null
            ? [...joinPath, ownCol]
            : joinPath

        const newConditions: ICondition[] = []
        for (const child of scoped.conditions) {
            const result = this.enforceNode(child as ConditionTree, nextJoinPath)
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

    private handleViolation(path: string): LiteralCondition | null {
        switch (this.onViolation) {
        case 'throw':
            throw new PassError(
                `Filter path "${path}" is not permitted by PathPolicy`,
                'PATH_POLICY_VIOLATION',
                path,
            )
        case 'false':
            return new LiteralCondition(false)
        case 'strip':
            return null
        }
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
