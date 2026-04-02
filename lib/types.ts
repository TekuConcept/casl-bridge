import {
    AbilityBuilder,
    AbilityTuple,
    ExtractSubjectType,
    MongoAbility,
    MongoQuery,
    Subject,
    SubjectRawRule
} from '@casl/ability'
import { SelectPattern } from './serializer/types'
import { MongoQueryObjects } from './condition'

export type CaslRule = SubjectRawRule<
    string, ExtractSubjectType<Subject>, MongoQuery
>
export type CaslGate = MongoAbility<AbilityTuple, MongoQuery>
export type CaslGateBuilder = AbilityBuilder<CaslGate>

/**
 * A single path-based access rule used in a {@link PathPolicy}.
 *
 * `path` may be:
 *  - an exact dotted field path, e.g. `"author.name"`
 *  - a descendant wildcard, e.g. `"author.**"` (matches any path
 *    that starts with `"author."`)
 */
export interface PathPolicyRule {
    /** The path pattern to match against. */
    path: string
    /** Whether to allow or deny access when this rule matches. */
    decision: 'allow' | 'deny'
}

/**
 * Restricts which field paths may appear in external filters.
 * Rules are evaluated in order; the first matching rule wins.
 * If no rule matches the `default` policy applies (defaults to `"allow"`).
 *
 * Example – deny all `author.*` access:
 * ```ts
 * {
 *   default: 'allow',
 *   rules: [{ path: 'author.**', decision: 'deny' }]
 * }
 * ```
 */
export interface PathPolicy {
    /**
     * Fallback decision when no rule matches a given path.
     * Defaults to `"allow"` when omitted.
     */
    default?: 'allow' | 'deny'
    /** Ordered list of path rules. First match wins. */
    rules?: PathPolicyRule[]
}

/**
 * Options that govern how the external filter tree is built
 * and applied. All fields are optional; unset fields use the
 * current default behaviour.
 */
export interface FilterOptions {
    /**
     * Maximum number of join-scope hops (relation hops) permitted in
     * an external filter tree.  Depth is measured as the number of
     * `join = true` ScopedCondition ancestors above a node (root = 0).
     *
     * When `undefined` (the default) no depth limit is enforced and
     * existing SQL output is unchanged.
     */
    maxDepth?: number

    /**
     * How to respond when a filter branch exceeds `maxDepth` or
     * violates a `pathPolicy` rule.
     * Only relevant when `maxDepth` or `pathPolicy` is set.
     *
     * - `"throw"` (default) – throw an `Error` immediately.
     * - `"false"` – replace the violating branch with a constant-false
     *               condition, then simplify the surrounding boolean
     *               context (e.g. `OR(false, x) ⇒ x`).
     * - `"strip"` – remove the violating branch entirely.  If all
     *               branches are removed the scope emits no WHERE clause.
     */
    onViolation?: 'throw' | 'false' | 'strip'

    /**
     * Restricts which field paths may appear in external filters.
     * When `undefined` (the default) all paths are permitted and
     * existing SQL output is unchanged.
     *
     * Enforcement uses the same {@link onViolation} mode as depth limiting.
     */
    pathPolicy?: PathPolicy
}

export interface QueryOptions {
    /**
     * Table alias to use in the query.
     * Defaults to `__table__`.
     */
    table?: string,
    /**
     * The action to check against the CASL rules.
     * eg `create`, `read`, `update`, etc.
     * 
     * Defaults to `manage`.
     */
    action?: string,
    /**
     * The subject to check against the CASL rules.
     * This can be a string, class instance, or other supported type.
     */
    subject: ExtractSubjectType<Subject>,
    /**
     * An optional field to check against the CASL rules.
     */
    field?: string,
    /**
     * The select pattern to use.
     *     '-'        - select only fields in the query
     *     '*'        - select all non-relational fields
     *     '**'       - select all fields including relational fields
     *     SelectList - select specific fields
     *                  `[ 'id', 'title', ['author', [ 'id', 'name' ]] ]`
     *     object     - select specific fields using keys of an object
     *                  `{ id: 1, title: 1, author: { id: 1, name: 1 } }`
     */
    select?: SelectPattern | null,
    /**
     * Additional filters to apply to the query. Object
     * takes the form of a Mongo-style query object.
     * 
     * For example:
     * 
     * ```json
     * {
     *    "id": { "$ge": 1, "$lt": 10 },
     *    "field": "value"
     * }
     * ```
     */
    filters?: MongoQueryObjects | null,
    /**
     * Options that control how external filter conditions are
     * compiled and applied. Passed through to
     * `compileExternalFilterTree` internally.
     */
    filterOptions?: FilterOptions | null,
    /**
     * @deprecated
     * Whether to use strict validation for column names.
     * Only alpha-numeric column names matching the pattern
     * `/^[a-zA-Z_][a-zA-Z0-9_]*$/` will be allowed
     * regardless of the database schema. Default is `true`.
     */
    strict?: boolean,
}
