import { ConditionTree } from '../condition/types'
import { FilterOptions } from '../types'
import { TypeOrmTableInfo } from '../schema'
import { PassResult, PassIssue } from './types'
import { DepthLimiter } from './depth-limiter'
import { PathPolicyEnforcer } from './path-policy-enforcer'
import { RelationIdRewriter, RelationMetaProvider, RelationIdMeta } from './relation-id-rewriter'

// ─────────────────────────────────────────────────────────────────────────────
// Context types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context passed to schema-free passes.
 *
 * Contains only the filter options (maxDepth, pathPolicy, onViolation) that
 * apply regardless of whether a TypeORM schema is present.  Used by
 * {@link CastleGuard.validates}, {@link CastleGuard.inspects}, and
 * {@link CastleGuard.scrubs}.
 */
export interface SchemaLessPassContext {
    /** Filter-level options (depth, policy, violation mode). */
    filterOptions?: FilterOptions | null
    /** Root table alias used when building the AST. */
    alias: string
}

/**
 * Context passed to schema-aware passes.
 *
 * Extends {@link SchemaLessPassContext} with the TypeORM table metadata
 * required by passes such as {@link RelationIdRewriter}.  Used by
 * {@link CaslBridge} and {@link CastleGuard.validatesForSubject}.
 */
export interface SchemaAwarePassContext extends SchemaLessPassContext {
    /** TypeORM table info for the root entity. */
    tableInfo: TypeOrmTableInfo
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single tree pass.
 *
 * - Accepts the current tree and the run context.
 * - Returns a {@link PassResult} whose `tree` field is the (possibly
 *   in-place mutated) tree.  Callers **must** use `result.tree` rather
 *   than assuming the input reference is still valid.
 * - **Must never throw** for expected validation failures; instead it
 *   reports them as {@link PassIssue} entries in `result.issues`.
 *   Only truly unexpected internal errors may throw.
 *
 * @template TCtx The context type accepted by this pass.
 */
export type PassFn<TCtx = SchemaLessPassContext> = (
    tree: ConditionTree,
    ctx: TCtx,
) => PassResult<ConditionTree>

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes a sequence of passes against a condition tree.
 *
 * Each pass receives the tree returned by the previous pass (or the
 * original tree for the first pass), accumulating any issues reported.
 * The runner never throws for pass-reported issues — callers inspect
 * the returned `issues` array and throw / return as appropriate.
 *
 * @param tree   The root condition tree to process.
 * @param ctx    Run context shared by all passes.
 * @param passes Ordered list of passes to apply.
 * @returns      The final tree and all accumulated issues.
 */
export function runPasses<TCtx>(
    tree: ConditionTree,
    ctx: TCtx,
    passes: PassFn<TCtx>[],
): PassResult<ConditionTree> {
    let current = tree
    const allIssues: PassIssue[] = []
    for (const pass of passes) {
        const result = pass(current, ctx)
        current = result.tree
        allIssues.push(...result.issues)
    }
    return { tree: current, issues: allIssues }
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual pass adapters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies {@link DepthLimiter} according to `ctx.filterOptions.maxDepth`.
 * Is a no-op when `maxDepth` is not set.
 */
export function depthLimiterPass(
    tree: ConditionTree,
    ctx: SchemaLessPassContext,
): PassResult<ConditionTree> {
    const fo = ctx.filterOptions
    if (fo?.maxDepth === undefined) return { tree, issues: [] }
    return new DepthLimiter(fo.maxDepth, fo.onViolation ?? 'throw').apply(tree)
}

/**
 * Applies {@link PathPolicyEnforcer} according to `ctx.filterOptions.pathPolicy`.
 * Is a no-op when `pathPolicy` is not set.
 */
export function pathPolicyPass(
    tree: ConditionTree,
    ctx: SchemaLessPassContext,
): PassResult<ConditionTree> {
    const fo = ctx.filterOptions
    if (fo?.pathPolicy === undefined) return { tree, issues: [] }
    return new PathPolicyEnforcer(fo.pathPolicy, fo.onViolation ?? 'throw').apply(tree)
}

/**
 * Applies {@link RelationIdRewriter} using FK metadata from `ctx.tableInfo`.
 */
export function relationIdRewriterPass(
    tree: ConditionTree,
    ctx: SchemaAwarePassContext,
): PassResult<ConditionTree> {
    const provider = buildRelationMetaProvider(ctx.tableInfo)
    return new RelationIdRewriter(provider).apply(tree)
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical pass lists
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordered list of schema-free external-filter passes.
 *
 * Used by {@link CastleGuard.validates}, {@link CastleGuard.inspects}, and
 * {@link CastleGuard.validatesForSubject} as the base validation pipeline.
 * Safe to run without any TypeORM metadata.
 */
export const schemaLessExternalPasses: PassFn<SchemaLessPassContext>[] = [
    depthLimiterPass,
    pathPolicyPass,
]

/**
 * Ordered list of schema-aware external-filter passes.
 *
 * Extends {@link schemaLessExternalPasses} with passes that require
 * TypeORM entity metadata.  Used by {@link CaslBridge} when building
 * queries and by {@link CastleGuard.validatesForSubject}.
 */
export const schemaAwareExternalPasses: PassFn<SchemaAwarePassContext>[] = [
    depthLimiterPass,
    pathPolicyPass,
    relationIdRewriterPass,
]

// ─────────────────────────────────────────────────────────────────────────────
// Relation-meta provider builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a {@link RelationMetaProvider} that resolves FK metadata from
 * TypeORM entity metadata for the given table.
 *
 * Returns `null` for:
 * - Relations not found on the entity.
 * - Inverse/non-owning sides of relations (no `joinColumns`).
 * - Many-to-many relations (join table, no direct FK on entity).
 * - Relations with missing column/referenced-column metadata.
 *
 * Extracted from `CaslBridge.makeRelationMetaProvider` so it can be shared
 * by both `CaslBridge` and the canonical pass list.
 */
export function buildRelationMetaProvider(table: TypeOrmTableInfo): RelationMetaProvider {
    return (relationProperty: string): RelationIdMeta | null => {
        const meta     = table.data.metadata
        const relation = meta.relations.find(
            r => r.propertyName === relationProperty
        )
        if (!relation) return null

        const joinCols = relation.joinColumns
        if (!joinCols || joinCols.length === 0) return null

        const fkMapping: Record<string, string> = {}
        for (const jc of joinCols) {
            /* c8 ignore next */
            if (!jc.referencedColumn) continue
            const pkProp         = jc.referencedColumn.propertyName
            const fkPropertyName = jc.propertyName
            if (pkProp && fkPropertyName && table.hasColumn(fkPropertyName)) {
                fkMapping[pkProp] = fkPropertyName
            }
        }
        if (Object.keys(fkMapping).length === 0) return null

        const targetRepo  = table.data.manager.getRepository(relation.type)
        const targetTable = new TypeOrmTableInfo(targetRepo)
        const childProvider = buildRelationMetaProvider(targetTable)

        return { fkMapping, childProvider }
    }
}
