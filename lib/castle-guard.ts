import { FilterOptions, PathPolicy } from './types'
import { MongoQueryObjects } from './condition'

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
 *
 * Also accessible as `CaslBridge.Guard`.
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
        new GuardWalker('throw', filterOptions).walk(filter)
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
        const walker = new GuardWalker('collect', filterOptions)
        walker.walk(filter)
        return {
            ok: walker.issues.length === 0,
            issues: walker.issues,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GuardWalker (internal)
// ─────────────────────────────────────────────────────────────────────────────

type WalkerMode = 'throw' | 'collect'

/**
 * Internal recursive walker that powers both {@link CastleGuard.validates}
 * and {@link CastleGuard.inspects}.
 */
class GuardWalker {
    readonly issues: FilterIssue[] = []
    private readonly maxDepth?: number
    private readonly pathPolicy?: PathPolicy

    constructor(
        private readonly mode: WalkerMode,
        options?: FilterOptions,
    ) {
        this.maxDepth   = options?.maxDepth
        this.pathPolicy = options?.pathPolicy
    }

    walk(filter: FilterObject): void {
        this.processNode(filter, 0, [])
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
     * @param depth      Number of relation-scope hops above this node.
     * @param pathPrefix Accumulated field path segments from the root.
     */
    private processNode(node: any, depth: number, pathPrefix: string[]): void {
        if (node === null || node === undefined) return
        if (typeof node !== 'object') return

        if (Array.isArray(node)) {
            // Top-level array is treated as an implicit $and.
            for (const item of node) this.processNode(item, depth, pathPrefix)
            return
        }

        const keys = Object.keys(node)
        if (keys.length === 0) return

        if (keys.every(k => k.startsWith('$'))) {
            this.processOperators(node, depth, pathPrefix)
        } else {
            this.processFields(node, depth, pathPrefix)
        }
    }

    // ------------------------------------------------------------------
    // Fields object  { field: value, ... }
    // ------------------------------------------------------------------

    private processFields(
        obj: object,
        depth: number,
        pathPrefix: string[],
    ): void {
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
                this.processSegmentedKey(key, value, depth, pathPrefix)
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

            this.processField(key, value, depth, pathPrefix)
        }
    }

    /**
     * Handle a dotted key such as `"author.name"` or `"metadata.library.isbn"`.
     *
     * All segments except the last are treated as join hops (depth is incremented
     * for each one).  The final segment is passed to `processField` so that its
     * value is handled correctly (primitive, array, operator condition, or join
     * scope).
     *
     * Every segment is validated against {@link SAFE_SEGMENT_RE} before
     * processing.  Malicious dot patterns (empty segments from `a..b`, `.a`,
     * `a.`) are rejected because the empty string does not match the regex.
     */
    private processSegmentedKey(
        key: string,
        value: any,
        depth: number,
        pathPrefix: string[],
    ): void {
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

        // Process every intermediate segment as a join-scope hop, then hand
        // off the final segment to processField.  This avoids building a
        // synthetic nested object, which would misclassify $-prefixed final
        // segments (e.g. `$taxes`) as operator keys.
        let currentDepth = depth
        let joinPrefix   = [...pathPrefix]

        for (let i = 0; i < segments.length - 1; i++) {
            const seg = segments[i]
            if (this.maxDepth !== undefined && currentDepth >= this.maxDepth) {
                this.addIssue({
                    code: 'MAX_DEPTH_EXCEEDED',
                    message: `Filter query exceeds maximum join depth of ${this.maxDepth}`,
                    path: pathOf([...joinPrefix, seg]),
                })
                return
            }
            joinPrefix = [...joinPrefix, seg]
            currentDepth++
        }

        // The final segment is a plain field — let processField decide whether
        // it is a primitive leaf, a join scope, or an operator-condition object.
        this.processField(segments[segments.length - 1], value, currentDepth, joinPrefix)
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
    private processField(
        field: string,
        value: any,
        depth: number,
        pathPrefix: string[],
    ): void {
        const currentPath = [...pathPrefix, field]

        if (value === undefined) return

        if (value === null || typeof value !== 'object') {
            // Primitive or null → implicit $eq / $is — check path policy.
            this.checkPathPolicy(currentPath)
            return
        }

        if (Array.isArray(value)) {
            // Array → implicit $in — check path policy.
            this.checkPathPolicy(currentPath)
            return
        }

        // Object value: determine if it is a query (all $ keys) or a join scope.
        const keys = Object.keys(value)
        const isQuery = keys.length === 0 || keys.every(k => k.startsWith('$'))

        if (isQuery) {
            // Operator condition on this field (e.g. `{ id: { $gt: 5 } }`).
            // Check path policy at this field, then recurse into the operators.
            this.checkPathPolicy(currentPath)
            this.processOperators(value, depth, currentPath)
        } else {
            // Join scope: the field's value is itself a fields object.
            // Check depth limit before entering.
            if (this.maxDepth !== undefined && depth >= this.maxDepth) {
                this.addIssue({
                    code: 'MAX_DEPTH_EXCEEDED',
                    message: `Filter query exceeds maximum join depth of ${this.maxDepth}`,
                    path: pathOf(currentPath),
                })
                return
            }
            // Recurse into the join scope with depth + 1.
            this.processFields(value, depth + 1, currentPath)
        }
    }

    // ------------------------------------------------------------------
    // Path policy
    // ------------------------------------------------------------------

    private checkPathPolicy(path: string[]): void {
        if (!this.pathPolicy) return
        const pathStr = path.join('.')
        if (!this.isAllowedByPolicy(pathStr)) {
            this.addIssue({
                code: 'PATH_POLICY_VIOLATION',
                message: `Filter path "${pathStr}" is not permitted by PathPolicy`,
                path: pathStr,
            })
        }
    }

    private isAllowedByPolicy(path: string): boolean {
        const defaultDecision = this.pathPolicy!.default ?? 'allow'
        for (const rule of (this.pathPolicy!.rules ?? [])) {
            if (this.matchesPattern(path, rule.path)) {
                return rule.decision === 'allow'
            }
        }
        return defaultDecision === 'allow'
    }

    private matchesPattern(path: string, pattern: string): boolean {
        if (pattern.endsWith('.**')) {
            return path.startsWith(pattern.slice(0, -3) + '.')
        }
        return path === pattern
    }

    // ------------------------------------------------------------------
    // Operators object  { $op: operand, ... }
    // ------------------------------------------------------------------

    private processOperators(
        obj: object,
        depth: number,
        pathPrefix: string[],
    ): void {
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
            this.validateOperand(operator, operand, depth, pathPrefix)
        }
    }

    /**
     * Validates the operand shape for the given operator and recurses for
     * boolean operators (`$and`, `$or`, `$not`).
     */
    private validateOperand(
        operator: string,
        operand: any,
        depth: number,
        pathPrefix: string[],
    ): void {
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
                this.processNode(item, depth, pathPrefix)
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
            this.processNode(operand, depth, pathPrefix)
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
