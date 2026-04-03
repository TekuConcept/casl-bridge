import { ConditionTree } from '../condition/types'

// ─────────────────────────────────────────────────────────────────────────────
// PassResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The result returned by every tree pass.
 *
 * Passes **may** mutate the tree in-place, but callers **must** use
 * `result.tree` rather than assuming the input reference is still valid.
 * This design allows a future switch to immutable AST nodes with minimal
 * refactoring.
 *
 * @template TTree The root node type (defaults to `ConditionTree`).
 */
export interface PassResult<TTree = ConditionTree> {
    /**
     * The (possibly mutated) tree after the pass.
     * May be the same reference as the input — callers must not assume
     * either way.
     */
    tree: TTree
    /**
     * Issues encountered during the pass.  Non-empty when the pass
     * detected a validation failure (e.g. depth exceeded, path denied).
     * Callers inspect this array and decide whether to throw, collect, or
     * ignore based on their violation-mode policy.
     */
    issues: PassIssue[]
}

// ─────────────────────────────────────────────────────────────────────────────
// PassIssue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A structured problem reported by a pass.
 * Mirrors the shape of `FilterIssue` in `CastleGuard`, intentionally kept
 * identical so the two can be used interchangeably once the pipeline is
 * fully unified.
 */
export interface PassIssue {
    /** Machine-readable error code, e.g. `'MAX_DEPTH_EXCEEDED'`. */
    code: string
    /** Human-readable description. */
    message: string
    /** Dot-separated field path where the issue was found (if applicable). */
    path?: string
    /** The operator involved (if applicable). */
    operator?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// PassError
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structured error class for pass violations.
 *
 * Kept for backward compatibility with code that previously caught
 * pass-thrown errors.  Passes no longer throw this class internally;
 * instead, violations are reported as {@link PassIssue} entries in
 * {@link PassResult.issues}.  Public API wrappers (e.g. CaslBridge and
 * CastleGuard) re-throw a plain `Error` with the issue message when their
 * configured violation mode calls for it.
 */
export class PassError extends Error {
    constructor(
        message: string,
        /** Machine-readable code matching a `PassIssue.code` value. */
        readonly code: string,
        /** Dot-separated field path where the violation occurred (if known). */
        readonly path?: string,
    ) {
        super(message)
        this.name = 'PassError'
    }
}
