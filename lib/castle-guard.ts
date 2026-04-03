import { DataSource, EntityManager } from 'typeorm'
import { SubjectType } from '@casl/ability'
import { FilterOptions, PathPolicy } from './types'
import { MongoQuery, MongoQueryObjects } from './condition'
import { TypeOrmTableInfo } from './schema'
import { ITableInfo } from './schema/types'
import {
    DepthLimiter,
    PathPolicyEnforcer,
    PassError,
    isAllowedByPolicy,
    matchesPattern,
    normalizePolicy,
} from './passes'

type FilterObject = MongoQueryObjects

/**
 * Describes a single problem found in a filter by {@link CastleGuard}.
 */
export interface FilterIssue {
    /** Machine-readable error code. */
    code: string
    /** Human-readable description of the problem. */
    message: string
    /** Dot-separated field path where the issue was found (if applicable). */
    path?: string
    /** The operator involved in the issue (if applicable). */
    operator?: string
}

/**
 * Returned by {@link CastleGuard.inspects} describing the overall result
 * of analysing a filter.
 */
export interface FilterAnalysisResult {
    /** `true` when no issues were found; `false` otherwise. */
    ok: boolean
    /** All issues found during analysis. Empty when `ok` is `true`. */
    issues: FilterIssue[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Static tables
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_OPERATORS = new Set([
    '$eq', '$ne', '$ge', '$gte', '$gt', '$le', '$lte', '$lt',
    '$is', '$isNot',
    '$in', '$nin', '$notIn',
    '$like', '$notLike', '$iLike', '$notILike',
    '$regex', '$regexp', '$notRegex', '$notRegexp', '$iRegexp', '$notIRegexp',
    '$between', '$notBetween',
    '$size',
    '$and', '$or', '$not',
])

/** Keys that can be used to pollute an object's prototype chain. */
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Safe segment pattern.
 *
 * Each dot-separated segment of a field path must match this pattern.
 * Only letters, digits (not as the first character), and underscores are
 * allowed — matching the character set accepted by {@link assertSafeJsonPath}
 * in the SQL dialect adapter.  Characters like `$`, `-`, quotes, brackets,
 * and spaces are all rejected.
 */
const SAFE_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the dot-joined path string, or `undefined` when the path is empty. */
function pathOf(segments: string[]): string | undefined {
    return segments.length > 0 ? segments.join('.') : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// CastleGuard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight, Zod-like validator for external Mongo-style filters.
 *
 * Validates the **shape and safety** of a filter object before it is passed
 * to the query-building pipeline.  It does **not** require a database
 * connection, a TypeORM manager, or a subject type.
 *
 * ### Usage
 *
 * ```ts
 * // Throws on the first problem found:
 * CastleGuard.validates(filter, filterOptions)
 *
 * // Collects all problems without throwing:
 * const result = CastleGuard.inspects(filter, filterOptions)
 * if (!result.ok) console.error(result.issues)
 * ```
 */
export class CastleGuard {
    /**
     * Validates the filter, throwing an `Error` on the first problem found.
     *
     * Validation covers:
     * - Unknown operators (hard error).
     * - Malformed operator shapes (`$and`/`$or` must be arrays, `$not` must
     *   be an object, `$in`/`$nin` must be arrays, `$between` must be a
     *   two-element array).
     * - Prototype-pollution keys (`__proto__`, `prototype`, `constructor`).
     * - Unsafe path characters and array-indexing notation (`[0]`).
     * - `maxDepth` and `pathPolicy` from `filterOptions` (same semantics as
     *   the external compilation pipeline).
     *
     * @param filter        The Mongo-style filter to validate.
     * @param filterOptions Optional policy constraints (maxDepth, pathPolicy).
     * @throws `Error` when any validation problem is found.
     */
    static validates(
        filter: FilterObject,
        filterOptions?: FilterOptions,
    ): void {
        // Safety checks (unknown operators, shapes, unsafe keys/paths).
        new GuardWalker('throw').walk(filter)
        // Depth and pathPolicy enforced via the shared AST passes (same
        // functions used by CaslBridge) so behaviour is identical.
        applyPolicyPasses(filter, filterOptions)
    }

    /**
     * Analyses the filter and returns a {@link FilterAnalysisResult} describing
     * all problems found.  Never throws (except for unexpected internal errors).
     *
     * @param filter        The Mongo-style filter to analyse.
     * @param filterOptions Optional policy constraints (maxDepth, pathPolicy).
     * @returns `{ ok: true, issues: [] }` when no problems are found;
     *          `{ ok: false, issues: [...] }` otherwise.
     */
    static inspects(
        filter: FilterObject,
        filterOptions?: FilterOptions,
    ): FilterAnalysisResult {
        // Safety checks (unknown operators, shapes, unsafe keys/paths).
        const walker = new GuardWalker('collect')
        walker.walk(filter)
        const issues: FilterIssue[] = [...walker.issues]

        // Depth and pathPolicy via the shared AST passes.
        // Each pass throws a PassError on its first violation; we catch it
        // and convert to a FilterIssue (consistent with CaslBridge behaviour
        // of stopping at the first depth/policy violation).
        if (filterOptions?.maxDepth !== undefined || filterOptions?.pathPolicy !== undefined) {
            try {
                const clone = deepCloneFilter(filter)
                const tree = new MongoQuery(clone).build('__root__')

                if (filterOptions?.maxDepth !== undefined) {
                    try {
                        new DepthLimiter(filterOptions.maxDepth, 'throw').apply(tree)
                    } catch (e) {
                        issues.push(passErrorToIssue(e, 'MAX_DEPTH_EXCEEDED'))
                    }
                }
                if (filterOptions?.pathPolicy !== undefined) {
                    try {
                        new PathPolicyEnforcer(filterOptions.pathPolicy, 'throw').apply(tree)
                    } catch (e) {
                        issues.push(passErrorToIssue(e, 'PATH_POLICY_VIOLATION'))
                    }
                }
            } catch {
                // MongoQuery.build() threw — the structural issues were already
                // captured by GuardWalker above; skip AST passes.
            }
        }

        return { ok: issues.length === 0, issues }
    }

    /**
     * Returns a sanitized copy of the filter with policy-violating branches
     * removed or replaced according to `filterOptions.onViolation`:
     *
     * - `"throw"` (default) – throws on the first violation (same as
     *   {@link validates}).
     * - `"strip"` – removes the violating branch.  If the entire filter is
     *   stripped, returns `{}` (no constraint).
     * - `"false"` – replaces the violating branch with a branch-local
     *   literal-false so that a sibling `$or` branch can still succeed.
     *   When the entire filter collapses to false the result is `{}`.
     *
     * Boolean simplification is applied after each replacement:
     * - `AND(…, false, …)` → `false`
     * - `OR(…, false, …)` → `OR(…)` (false removed)
     * - Empty `$and` / `$or` → stripped (no constraint)
     * - `NOT(false)` → stripped (no constraint)
     *
     * The input object is **never mutated**.
     * Unknown operators always throw regardless of `onViolation`.
     *
     * @param filter        The Mongo-style filter to sanitize.
     * @param filterOptions Policy constraints (maxDepth, pathPolicy, onViolation).
     * @returns A sanitized filter object.
     */
    static scrubs(
        filter: FilterObject,
        filterOptions?: FilterOptions,
    ): FilterObject {
        return new ScrubWalker(filterOptions).scrub(filter)
    }

    /**
     * Validates the filter against the schema of `subject` resolved from
     * `manager`, throwing an `Error` on the first problem found.
     *
     * Performs all checks that {@link validates} does, **plus**:
     * - Every path segment must resolve to a real column or relation on the
     *   current entity scope.
     * - Relation segments are traversable (must be joinable columns).
     * - JSON-subpath segments (after a `json` / `simple-json` column) are
     *   permitted; no further schema resolution is attempted for them.
     * - Attempting a subpath after a non-JSON, non-relation column throws.
     *
     * TypeORM metadata is resolved internally; the caller only provides
     * a `DataSource` or `EntityManager` and the subject type.
     *
     * @param manager       A TypeORM `DataSource` or `EntityManager`.
     * @param subject       The subject type whose schema is validated against.
     * @param filter        The Mongo-style filter to validate.
     * @param filterOptions Optional policy constraints (maxDepth, pathPolicy).
     * @throws `Error` when any validation problem is found.
     */
    static validatesForSubject(
        manager: DataSource | EntityManager,
        subject: SubjectType,
        filter: FilterObject,
        filterOptions?: FilterOptions,
    ): void {
        // Safety checks.
        new GuardWalker('throw').walk(filter)
        // Depth and pathPolicy via shared AST passes.
        applyPolicyPasses(filter, filterOptions)
        // Schema-aware validation.
        const tableInfo = TypeOrmTableInfo.createFrom(manager, subject)
        new SchemaWalker(tableInfo).walk(filter)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deep-clones a filter object so that MongoQuery (which mutates its input via
 * `collapseFields`) does not touch the caller's original value.
 */
function deepCloneFilter(val: any): any {
    if (val === null || val === undefined) return val
    if (val instanceof Date) return new Date(val)
    if (Array.isArray(val)) return val.map(deepCloneFilter)
    if (typeof val === 'object') {
        const result: Record<string, any> = {}
        for (const key of Object.keys(val)) {
            result[key] = deepCloneFilter((val as any)[key])
        }
        return result
    }
    return val
}

/**
 * Converts a {@link PassError} (or plain Error) thrown by a pass into a
 * {@link FilterIssue} with the appropriate code and path.
 */
function passErrorToIssue(e: unknown, fallbackCode: string): FilterIssue {
    if (e instanceof PassError) {
        return { code: e.code, message: e.message, path: e.path }
    }
    /* c8 ignore next 2 */
    return { code: fallbackCode, message: (e as Error).message }
}

/**
 * Runs DepthLimiter and PathPolicyEnforcer (the same passes used by
 * CaslBridge) on a deep clone of `filter`.  Throws on the first violation,
 * exactly as `compileExternalFilterTree` does in CaslBridge.
 */
function applyPolicyPasses(filter: FilterObject, filterOptions?: FilterOptions): void {
    if (filterOptions?.maxDepth === undefined && filterOptions?.pathPolicy === undefined) return

    const clone = deepCloneFilter(filter)
    const tree = new MongoQuery(clone).build('__root__')

    if (filterOptions?.maxDepth !== undefined) {
        new DepthLimiter(filterOptions.maxDepth, 'throw').apply(tree)
    }
    if (filterOptions?.pathPolicy !== undefined) {
        new PathPolicyEnforcer(filterOptions.pathPolicy, 'throw').apply(tree)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GuardWalker (internal)
// ─────────────────────────────────────────────────────────────────────────────

type WalkerMode = 'throw' | 'collect'

/**
 * Internal recursive walker that powers both {@link CastleGuard.validates}
 * and {@link CastleGuard.inspects}.
 *
 * Checks: unknown operators, operator shapes, prototype-pollution keys,
 * unsafe path characters, and array-indexing notation.
 * Depth and path-policy enforcement is handled separately via the shared
 * AST passes (DepthLimiter / PathPolicyEnforcer).
 */
class GuardWalker {
    readonly issues: FilterIssue[] = []

    constructor(private readonly mode: WalkerMode) {}

    walk(filter: FilterObject): void {
        this.processNode(filter, [])
    }

    // ------------------------------------------------------------------
    // Issue reporting
    // ------------------------------------------------------------------

    /**
     * In `'throw'` mode: throws immediately.
     * In `'collect'` mode: pushes the issue and continues.
     */
    private addIssue(issue: FilterIssue): void {
        if (this.mode === 'throw') throw new Error(issue.message)
        this.issues.push(issue)
    }

    // ------------------------------------------------------------------
    // Node dispatch
    // ------------------------------------------------------------------

    /**
     * Dispatch a filter node based on its runtime type.
     *
     * @param node       The current filter node.
     * @param pathPrefix Accumulated field path segments from the root.
     */
    private processNode(node: any, pathPrefix: string[]): void {
        if (node === null || node === undefined) return
        if (typeof node !== 'object') return

        if (Array.isArray(node)) {
            // Top-level array is treated as an implicit $and.
            for (const item of node) this.processNode(item, pathPrefix)
            return
        }

        const keys = Object.keys(node)
        if (keys.length === 0) return

        if (keys.every(k => k.startsWith('$'))) {
            this.processOperators(node, pathPrefix)
        } else {
            this.processFields(node, pathPrefix)
        }
    }

    // ------------------------------------------------------------------
    // Fields object  { field: value, ... }
    // ------------------------------------------------------------------

    private processFields(obj: object, pathPrefix: string[]): void {
        for (const key of Object.keys(obj)) {
            // Prototype-pollution check (highest priority).
            if (UNSAFE_KEYS.has(key)) {
                this.addIssue({
                    code: 'UNSAFE_KEY',
                    message: `Unsafe key "${key}" detected — possible prototype pollution`,
                    path: pathOf([...pathPrefix, key]),
                })
                continue
            }

            const value = (obj as any)[key]

            if (key.includes('.')) {
                // Dotted key: expand into nested structure and re-process.
                this.processSegmentedKey(key, value, pathPrefix)
                continue
            }

            // Array-indexing check.
            if (key.includes('[') || key.includes(']')) {
                this.addIssue({
                    code: 'UNSAFE_PATH',
                    message: `Array indexing is not allowed in filter paths (key: "${key}")`,
                    path: pathOf([...pathPrefix, key]),
                })
                continue
            }

            if (!SAFE_SEGMENT_RE.test(key)) {
                this.addIssue({
                    code: 'UNSAFE_PATH',
                    message: `Unsafe characters in path segment: "${key}"`,
                    path: pathOf([...pathPrefix, key]),
                })
                continue
            }

            this.processField(key, value, pathPrefix)
        }
    }

    /**
     * Handle a dotted key such as `"author.name"` or `"metadata.library.isbn"`.
     *
     * Every segment is validated against {@link SAFE_SEGMENT_RE} before
     * processing.  Malicious dot patterns (empty segments from `a..b`, `.a`,
     * `a.`) are rejected because the empty string does not match the regex.
     */
    private processSegmentedKey(key: string, value: any, pathPrefix: string[]): void {
        // Array-indexing check (before splitting).
        if (key.includes('[') || key.includes(']')) {
            this.addIssue({
                code: 'UNSAFE_PATH',
                message: `Array indexing is not allowed in filter paths (key: "${key}")`,
                path: pathOf([...pathPrefix, key]),
            })
            return
        }

        const segments = key.split('.')

        // Validate every segment up-front so errors reference the correct path.
        for (const seg of segments) {
            if (UNSAFE_KEYS.has(seg)) {
                this.addIssue({
                    code: 'UNSAFE_KEY',
                    message: `Unsafe key "${seg}" detected in path "${key}"`,
                    path: pathOf([...pathPrefix, seg]),
                })
                return
            }
            if (!SAFE_SEGMENT_RE.test(seg)) {
                this.addIssue({
                    code: 'UNSAFE_PATH',
                    message: `Unsafe characters in path segment: "${seg}"`,
                    path: pathOf([...pathPrefix, seg]),
                })
                return
            }
        }

        // Build up the join prefix from all intermediate segments, then
        // hand off the final segment to processField.  This avoids building a
        // synthetic nested object, which would misclassify $-prefixed final
        // segments (e.g. `$taxes`) as operator keys.
        let joinPrefix = [...pathPrefix]
        for (let i = 0; i < segments.length - 1; i++) {
            joinPrefix = [...joinPrefix, segments[i]]
        }
        this.processField(segments[segments.length - 1], value, joinPrefix)
    }

    // ------------------------------------------------------------------
    // Single field
    // ------------------------------------------------------------------

    /**
     * Process a single non-dotted field key and its value.
     *
     * Determines whether the field is:
     * - a primitive leaf (scalar, null, or array),
     * - a join scope (nested fields object), or
     * - an operator-condition object (e.g. `{ $gt: 5 }`).
     */
    private processField(field: string, value: any, pathPrefix: string[]): void {
        const currentPath = [...pathPrefix, field]

        if (value === undefined) return

        if (value === null || typeof value !== 'object') {
            // Primitive or null → implicit $eq / $is.
            return
        }

        if (Array.isArray(value)) {
            // Array → implicit $in.
            return
        }

        // Object value: determine if it is a query (all $ keys) or a join scope.
        const keys = Object.keys(value)
        const isQuery = keys.length === 0 || keys.every(k => k.startsWith('$'))

        if (isQuery) {
            // Operator condition on this field (e.g. `{ id: { $gt: 5 } }`).
            this.processOperators(value, currentPath)
        } else {
            // Join scope: recurse into the nested fields object.
            this.processFields(value, currentPath)
        }
    }

    // ------------------------------------------------------------------
    // Operators object  { $op: operand, ... }
    // ------------------------------------------------------------------

    private processOperators(obj: object, pathPrefix: string[]): void {
        for (const operator of Object.keys(obj)) {
            // Prototype-pollution check.
            // NOTE: UNSAFE_KEYS never start with '$', so this branch is only
            // reachable via exotic property injection (e.g. Object.defineProperty).
            // It is kept as a defence-in-depth guard; coverage is suppressed.
            /* c8 ignore next 9 */
            if (UNSAFE_KEYS.has(operator)) {
                this.addIssue({
                    code: 'UNSAFE_KEY',
                    message: `Unsafe key "${operator}" detected — possible prototype pollution`,
                    path: pathOf(pathPrefix),
                    operator,
                })
                continue
            }

            if (!KNOWN_OPERATORS.has(operator)) {
                this.addIssue({
                    code: 'UNKNOWN_OPERATOR',
                    message: `Unknown operator "${operator}"`,
                    path: pathOf(pathPrefix),
                    operator,
                })
                continue
            }

            const operand = (obj as any)[operator]
            this.validateOperand(operator, operand, pathPrefix)
        }
    }

    /**
     * Validates the operand shape for the given operator and recurses for
     * boolean operators (`$and`, `$or`, `$not`).
     */
    private validateOperand(operator: string, operand: any, pathPrefix: string[]): void {
        const path = pathOf(pathPrefix)

        switch (operator) {
        case '$and':
        case '$or':
            if (!Array.isArray(operand)) {
                this.addIssue({
                    code: 'INVALID_OPERAND',
                    message: `Operator "${operator}" requires an array operand`,
                    path,
                    operator,
                })
                return
            }
            for (const item of operand) {
                this.processNode(item, pathPrefix)
            }
            break

        case '$not':
            if (
                typeof operand !== 'object' ||
                operand === null ||
                Array.isArray(operand)
            ) {
                this.addIssue({
                    code: 'INVALID_OPERAND',
                    message: `Operator "$not" requires an object operand`,
                    path,
                    operator,
                })
                return
            }
            this.processNode(operand, pathPrefix)
            break

        case '$in':
        case '$nin':
        case '$notIn':
            if (!Array.isArray(operand)) {
                this.addIssue({
                    code: 'INVALID_OPERAND',
                    message: `Operator "${operator}" requires an array operand`,
                    path,
                    operator,
                })
            }
            break

        case '$between':
        case '$notBetween':
            if (!Array.isArray(operand) || operand.length !== 2) {
                this.addIssue({
                    code: 'INVALID_OPERAND',
                    message: `Operator "${operator}" requires an array of exactly 2 elements`,
                    path,
                    operator,
                })
            }
            break

        default:
            // Primitive operators ($eq, $ne, $gt, $like, $size, …):
            // no further operand shape validation required.
            break
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ScrubWalker (internal)
// ─────────────────────────────────────────────────────────────────────────────

/** Internal sentinel: remove this branch. */
const STRIP = Symbol('strip')
/** Internal sentinel: this branch is literal-false. */
const LITERAL_FALSE = Symbol('false')

type ScrubOutcome = any | typeof STRIP | typeof LITERAL_FALSE

/**
 * Recursive walker that implements {@link CastleGuard.scrubs}.
 *
 * Returns a deep copy of the input filter with violating branches removed
 * (`STRIP`) or replaced with literal-false (`LITERAL_FALSE`).  Boolean
 * simplification is applied bottom-up:
 *
 *   AND(…, false, …) → false     AND(empty) → STRIP
 *   OR(false/stripped, …) → OR(…)  OR(empty) → LITERAL_FALSE
 *   NOT(false) → STRIP            NOT(STRIP) → STRIP
 */
class ScrubWalker {
    private readonly maxDepth?: number
    private readonly pathPolicy?: PathPolicy
    private readonly normalizedPolicy?: ReturnType<typeof normalizePolicy>
    private readonly onViolation: 'throw' | 'strip' | 'false'

    constructor(options?: FilterOptions) {
        this.maxDepth = options?.maxDepth
        this.pathPolicy = options?.pathPolicy
        this.normalizedPolicy = options?.pathPolicy
            ? normalizePolicy(options.pathPolicy)
            : undefined
        this.onViolation = options?.onViolation ?? 'throw'
    }

    scrub(filter: FilterObject): FilterObject {
        if (filter === null || filter === undefined) return {} as FilterObject
        /* c8 ignore next */
        if (typeof filter !== 'object') return {} as FilterObject

        const result = this.processNode(filter, 0, [])
        if (result === STRIP || result === LITERAL_FALSE) return {} as FilterObject
        return result as FilterObject
    }

    // ------------------------------------------------------------------
    // Node dispatch
    // ------------------------------------------------------------------

    private processNode(node: any, depth: number, pathPrefix: string[]): ScrubOutcome {
        if (node === null || node === undefined) return {}
        if (typeof node !== 'object') return {}

        if (Array.isArray(node)) {
            return this.processImplicitAnd(node, depth, pathPrefix)
        }

        const keys = Object.keys(node)
        if (keys.length === 0) return {}

        return keys.every(k => k.startsWith('$'))
            ? this.processOperatorsObj(node, depth, pathPrefix)
            : this.processFieldsObj(node, depth, pathPrefix)
    }

    // ------------------------------------------------------------------
    // Array = implicit $and
    // ------------------------------------------------------------------

    private processImplicitAnd(arr: any[], depth: number, pathPrefix: string[]): ScrubOutcome {
        const items: any[] = []
        for (const item of arr) {
            const r = this.processNode(item, depth, pathPrefix)
            if (r === LITERAL_FALSE) return LITERAL_FALSE
            if (r !== STRIP) items.push(r)
        }
        if (items.length === 0) return STRIP
        if (items.length === 1) return items[0]
        return items
    }

    // ------------------------------------------------------------------
    // Fields object  { field: value, … }
    // ------------------------------------------------------------------

    private processFieldsObj(obj: any, depth: number, pathPrefix: string[]): ScrubOutcome {
        const result: Record<string, any> = {}

        for (const key of Object.keys(obj)) {
            // Prototype-pollution: always hard-error (regardless of onViolation).
            if (UNSAFE_KEYS.has(key)) {
                throw new Error(
                    `Unsafe key "${key}" detected — possible prototype pollution`
                )
            }

            const value = (obj as any)[key]

            if (key.includes('.')) {
                const outcome = this.processSegmentedKey(key, value, depth, pathPrefix)
                if (outcome === LITERAL_FALSE) return LITERAL_FALSE
                if (outcome !== STRIP) result[key] = outcome
                continue
            }

            // Array indexing: policy-style violation.
            if (key.includes('[') || key.includes(']')) {
                const v = this.handleViolation()
                if (v === LITERAL_FALSE) return LITERAL_FALSE
                continue
            }

            // Unsafe segment chars: policy-style violation.
            if (!SAFE_SEGMENT_RE.test(key)) {
                const v = this.handleViolation()
                if (v === LITERAL_FALSE) return LITERAL_FALSE
                continue
            }

            const fieldOutcome = this.processFieldValue(key, value, depth, pathPrefix)
            if (fieldOutcome === LITERAL_FALSE) return LITERAL_FALSE
            if (fieldOutcome !== STRIP) result[key] = fieldOutcome
        }

        return Object.keys(result).length === 0 ? STRIP : result
    }

    // ------------------------------------------------------------------
    // Dotted key  "author.name"
    // ------------------------------------------------------------------

    private processSegmentedKey(
        key: string,
        value: any,
        depth: number,
        pathPrefix: string[],
    ): ScrubOutcome {
        // Array indexing check (before splitting).
        if (key.includes('[') || key.includes(']')) {
            return this.handleViolation()
        }

        const segments = key.split('.')

        for (const seg of segments) {
            if (UNSAFE_KEYS.has(seg)) {
                throw new Error(
                    `Unsafe key "${seg}" detected in path "${key}"`
                )
            }
            if (!SAFE_SEGMENT_RE.test(seg)) {
                return this.handleViolation()
            }
        }

        // Depth check for all intermediate segments.
        let currentDepth = depth
        let joinPrefix = [...pathPrefix]
        for (let i = 0; i < segments.length - 1; i++) {
            if (this.maxDepth !== undefined && currentDepth >= this.maxDepth) {
                return this.handleViolation()
            }
            joinPrefix = [...joinPrefix, segments[i]]
            currentDepth++
        }

        // Validate the final segment as a field value.
        const lastSeg = segments[segments.length - 1]
        return this.processFieldValue(lastSeg, value, currentDepth, joinPrefix)
    }

    // ------------------------------------------------------------------
    // Single field value
    // ------------------------------------------------------------------

    /**
     * Processes the value of a single field `key` and returns the scrubbed
     * value (or a sentinel).
     */
    private processFieldValue(
        key: string,
        value: any,
        depth: number,
        pathPrefix: string[],
    ): ScrubOutcome {
        const currentPath = [...pathPrefix, key]

        if (value === undefined) return STRIP

        if (value === null || typeof value !== 'object') {
            // Primitive / null → implicit $eq → path-policy check only.
            return this.checkPathPolicy(currentPath) ?? value
        }

        if (Array.isArray(value)) {
            // Array → implicit $in → path-policy check only.
            return this.checkPathPolicy(currentPath) ?? value
        }

        const keys = Object.keys(value)
        const isQuery = keys.length === 0 || keys.every(k => k.startsWith('$'))

        if (isQuery) {
            // Operator condition: { id: { $gt: 5 } }
            const pv = this.checkPathPolicy(currentPath)
            if (pv !== null) return pv   // STRIP or LITERAL_FALSE
            return this.processOperatorsObj(value, depth, currentPath)
        }

        // Join scope: depth check before recursing.
        if (this.maxDepth !== undefined && depth >= this.maxDepth) {
            return this.handleViolation()
        }
        return this.processFieldsObj(value, depth + 1, currentPath)
    }

    // ------------------------------------------------------------------
    // Operators object  { $op: operand, … }
    // ------------------------------------------------------------------

    private processOperatorsObj(
        obj: any,
        depth: number,
        pathPrefix: string[],
    ): ScrubOutcome {
        const result: Record<string, any> = {}

        for (const operator of Object.keys(obj)) {
            /* c8 ignore next 3 */
            if (UNSAFE_KEYS.has(operator)) {
                throw new Error(`Unsafe key "${operator}" detected`)
            }

            if (!KNOWN_OPERATORS.has(operator)) {
                // Unknown operators are always hard errors.
                throw new Error(`Unknown operator "${operator}"`)
            }

            const operand = (obj as any)[operator]

            switch (operator) {
            case '$and': {
                const r = this.processAndOperands(operand, depth, pathPrefix)
                if (r === LITERAL_FALSE) return LITERAL_FALSE
                if (r !== STRIP) result['$and'] = r
                break
            }
            case '$or': {
                const r = this.processOrOperands(operand, depth, pathPrefix)
                if (r === LITERAL_FALSE) return LITERAL_FALSE
                if (r !== STRIP) result['$or'] = r
                break
            }
            case '$not': {
                const r = this.processNotOperand(operand, depth, pathPrefix)
                // processNotOperand returns STRIP or a valid value, never LITERAL_FALSE.
                /* c8 ignore next */
                if (r === LITERAL_FALSE) return LITERAL_FALSE
                if (r !== STRIP) result['$not'] = r
                break
            }
            default:
                // Known primitive operator: include as-is.
                result[operator] = operand
                break
            }
        }

        if (Object.keys(result).length === 0) return STRIP

        // Singleton simplification: { $and: [X] } → X, { $or: [X] } → X.
        // This mirrors how a single-branch boolean is semantically equivalent
        // to the branch itself.
        const resultKeys = Object.keys(result)
        if (resultKeys.length === 1) {
            const k = resultKeys[0]
            if (
                (k === '$and' || k === '$or') &&
                Array.isArray(result[k]) &&
                result[k].length === 1
            ) {
                return result[k][0]
            }
        }

        return result
    }

    // ------------------------------------------------------------------
    // Boolean operator helpers
    // ------------------------------------------------------------------

    /**
     * Processes `$and` operands.
     * - Any LITERAL_FALSE item → whole AND is LITERAL_FALSE.
     * - STRIP items are removed.
     * - Empty result → STRIP (no constraint).
     */
    private processAndOperands(operand: any, depth: number, pathPrefix: string[]): ScrubOutcome {
        /* c8 ignore next */
        const items = Array.isArray(operand) ? operand : [operand]
        const kept: any[] = []
        for (const item of items) {
            const r = this.processNode(item, depth, pathPrefix)
            if (r === LITERAL_FALSE) return LITERAL_FALSE
            if (r !== STRIP) kept.push(r)
        }
        if (kept.length === 0) return STRIP
        return kept
    }

    /**
     * Processes `$or` operands.
     * - LITERAL_FALSE and STRIP items contribute nothing to the OR and are removed.
     * - Empty result → LITERAL_FALSE (empty OR = false).
     */
    private processOrOperands(operand: any, depth: number, pathPrefix: string[]): ScrubOutcome {
        /* c8 ignore next */
        const items = Array.isArray(operand) ? operand : [operand]
        const kept: any[] = []
        for (const item of items) {
            const r = this.processNode(item, depth, pathPrefix)
            // Both false and stripped branches contribute nothing to OR.
            if (r !== STRIP && r !== LITERAL_FALSE) kept.push(r)
        }
        return kept.length === 0 ? LITERAL_FALSE : kept
    }

    /**
     * Processes `$not` operand.
     * - LITERAL_FALSE → NOT(false) = true = STRIP (no constraint).
     * - STRIP → NOT(empty) = STRIP (no constraint).
     * - Otherwise → return the processed operand.
     */
    private processNotOperand(operand: any, depth: number, pathPrefix: string[]): ScrubOutcome {
        const r = this.processNode(operand, depth, pathPrefix)
        if (r === LITERAL_FALSE || r === STRIP) return STRIP
        return r
    }

    // ------------------------------------------------------------------
    // Policy helpers
    // ------------------------------------------------------------------

    /**
     * Returns `STRIP` or `LITERAL_FALSE` when the path is denied, `null` when allowed.
     * Delegates to the shared {@link isAllowedByPolicy} utility from lib/passes.
     */
    private checkPathPolicy(path: string[]): typeof STRIP | typeof LITERAL_FALSE | null {
        if (!this.normalizedPolicy) return null
        if (!isAllowedByPolicy(path.join('.'), this.normalizedPolicy)) {
            const v = this.handleViolation()
            return v === LITERAL_FALSE ? LITERAL_FALSE : STRIP
        }
        return null
    }

    /**
     * Executes the configured `onViolation` policy.
     * - `'throw'` → throws an `Error` immediately.
     * - `'false'` → returns `LITERAL_FALSE`.
     * - `'strip'` → returns `STRIP`.
     */
    private handleViolation(message?: string): typeof STRIP | typeof LITERAL_FALSE {
        switch (this.onViolation) {
        case 'throw':
            throw new Error(message ?? 'Filter policy violation')
        case 'false':
            return LITERAL_FALSE
        case 'strip':
            return STRIP
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SchemaWalker (internal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursive walker that powers the schema-aware validation in
 * {@link CastleGuard.validatesForSubject}.
 *
 * Walks every field path and validates each segment against TypeORM entity
 * metadata:
 * - Each segment must resolve to a real column or relation.
 * - Relation segments advance the entity scope to the related entity.
 * - When a JSON column is encountered, remaining segments are treated as a
 *   JSON sub-path and schema validation stops (no further resolution needed).
 * - Attempting to use sub-path notation after a non-JSON, non-relation column
 *   throws.
 */
class SchemaWalker {
    constructor(private readonly rootTable: ITableInfo) {}

    walk(filter: FilterObject): void {
        /* c8 ignore next */
        if (!filter || typeof filter !== 'object') return
        this.processNode(filter, this.rootTable, [])
    }

    // ------------------------------------------------------------------
    // Node dispatch
    // ------------------------------------------------------------------

    private processNode(node: any, table: ITableInfo, pathPrefix: string[]): void {
        /* c8 ignore next 2 */
        if (node === null || node === undefined) return
        if (typeof node !== 'object') return

        if (Array.isArray(node)) {
            for (const item of node) this.processNode(item, table, pathPrefix)
            return
        }

        const keys = Object.keys(node)
        /* c8 ignore next */
        if (keys.length === 0) return

        if (keys.every(k => k.startsWith('$'))) {
            this.processOperators(node, table, pathPrefix)
        } else {
            this.processFields(node, table, pathPrefix)
        }
    }

    // ------------------------------------------------------------------
    // Fields object  { field: value, … }
    // ------------------------------------------------------------------

    private processFields(obj: any, table: ITableInfo, pathPrefix: string[]): void {
        for (const key of Object.keys(obj)) {
            // Safety keys were already rejected by GuardWalker; skip silently here.
            /* c8 ignore next */
            if (UNSAFE_KEYS.has(key)) continue

            const value = (obj as any)[key]

            if (key.includes('.')) {
                this.processSegmentedKey(key, value, table, pathPrefix)
                continue
            }

            // Non-safe segments were already rejected by GuardWalker.
            /* c8 ignore next 2 */
            if (!SAFE_SEGMENT_RE.test(key)) continue
            if (key.includes('[') || key.includes(']')) continue

            this.processField(key, value, table, pathPrefix)
        }
    }

    // ------------------------------------------------------------------
    // Dotted key  "author.name"
    // ------------------------------------------------------------------

    private processSegmentedKey(
        key: string,
        value: any,
        table: ITableInfo,
        pathPrefix: string[],
    ): void {
        const segments = key.split('.')

        // Validate each segment against the schema.
        let currentTable = table
        let i = 0

        while (i < segments.length - 1) {
            const seg = segments[i]
            const col = currentTable.getColumn(seg)
            if (!col) {
                throw new Error(
                    `Unknown field or relation "${[...pathPrefix, ...segments.slice(0, i + 1)].join('.')}" on entity "${currentTable.classType()}"`
                )
            }

            if (col.isJsonColumn()) {
                // Remaining segments are a JSON sub-path — valid, stop resolving.
                return
            }

            if (!col.isJoinable()) {
                throw new Error(
                    `Cannot use sub-path notation after non-relation, non-JSON column "${[...pathPrefix, ...segments.slice(0, i + 1)].join('.')}" on entity "${currentTable.classType()}"`
                )
            }

            // Relation: advance scope.
            currentTable = col.getRelation()!
            i++
        }

        // Validate the final segment.
        const lastSeg = segments[segments.length - 1]
        const lastCol = currentTable.getColumn(lastSeg)
        if (!lastCol) {
            throw new Error(
                `Unknown field "${[...pathPrefix, ...segments].join('.')}" on entity "${currentTable.classType()}"`
            )
        }
    }

    // ------------------------------------------------------------------
    // Single field
    // ------------------------------------------------------------------

    private processField(
        key: string,
        value: any,
        table: ITableInfo,
        pathPrefix: string[],
    ): void {
        const col = table.getColumn(key)
        if (!col) {
            throw new Error(
                `Unknown field or relation "${[...pathPrefix, key].join('.')}" on entity "${table.classType()}"`
            )
        }

        // Determine whether this field is being used as a join scope.
        const isJoinScope =
            value !== null &&
            value !== undefined &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value).some(k => !k.startsWith('$'))

        if (isJoinScope) {
            if (!col.isJoinable()) {
                throw new Error(
                    `"${[...pathPrefix, key].join('.')}" is not a relation and cannot be used as a join scope on entity "${table.classType()}"`
                )
            }
            const relTable = col.getRelation()!
            this.processFields(value, relTable, [...pathPrefix, key])
        }
        // For leaf fields (primitive / array / operator condition): column existence
        // is already verified above; no further schema checks needed here.
    }

    // ------------------------------------------------------------------
    // Operators object  { $op: operand, … }
    // ------------------------------------------------------------------

    private processOperators(obj: any, table: ITableInfo, pathPrefix: string[]): void {
        for (const operator of Object.keys(obj)) {
            const operand = (obj as any)[operator]

            switch (operator) {
            case '$and':
            case '$or': {
                /* c8 ignore next */
                const items = Array.isArray(operand) ? operand : [operand]
                for (const item of items) {
                    this.processNode(item, table, pathPrefix)
                }
                break
            }
            case '$not':
                this.processNode(operand, table, pathPrefix)
                break
            default:
                // Primitive operators: no schema checks needed.
                break
            }
        }
    }
}

