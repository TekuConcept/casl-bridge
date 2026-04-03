import { ConditionTree, ICondition, ScopeOp } from './types'
import { ScopedCondition } from './scoped-condition'
import { PrimitiveCondition } from './primitive-condition'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FK metadata for a single relation on the current entity.
 */
export interface RelationIdMeta {
    /**
     * Maps each **target PK property name** to the corresponding
     * **FK property name on the owning (base) entity**.
     *
     * Example: for `Book.author` where Author.id is the PK and
     * Book.authorId is the FK: `{ id: 'authorId' }`.
     */
    fkMapping: Record<string, string>

    /**
     * A `RelationMetaProvider` for the **target** entity, enabling
     * recursive rewriting of nested join scopes (e.g.
     * `author.publisher.id` → `author.publisherId`).
     * `null` if the target entity metadata is unavailable.
     */
    childProvider: RelationMetaProvider | null
}

/**
 * Callback that returns FK metadata for a given relation property on
 * the current entity, or `null` when:
 *
 * - The relation is not found on the entity.
 * - The entity is on the **inverse** side of the relation (no FK column).
 * - The relation goes through a join table (many-to-many).
 * - No valid join-column metadata is available.
 */
export type RelationMetaProvider = (
    relationProperty: string,
) => RelationIdMeta | null

// ─────────────────────────────────────────────────────────────────────────────
// RelationIdRewriter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traverses an **external-filter** ConditionTree and rewrites join scopes
 * that filter exclusively on PK columns of the related entity.
 *
 * ### Rewrite criterion
 * A join scope is rewritten when **all** of its direct children are
 * `PrimitiveCondition` nodes whose `column` maps to an FK property on
 * the owning (base) entity via the supplied {@link RelationMetaProvider}.
 * Scoped children (AND/OR/NOT sub-trees) prevent the rewrite for safety.
 *
 * ### Rewrite action
 * Each `primitive(pkProp, op, val)` inside the join scope is replaced by
 * `primitive(fkProp, op, val)` one level up (in the parent scope).
 * The join scope itself is removed, eliminating the SQL `LEFT JOIN`.
 *
 * If there are multiple replacement primitives and the parent uses
 * different boolean logic than the join scope, the replacements are
 * wrapped in a non-join `ScopedCondition` with the same scope-op as the
 * original join scope to preserve semantics.
 *
 * ### Safety
 * - The rewriter is purely structural; it never changes operator/operand.
 * - Only external filter trees are passed through this class.
 *   CASL ability trees bypass it entirely.
 * - When no FK metadata is available the join scope is left unchanged.
 * - Composite PK/FK is supported: only the referenced columns need to
 *   appear in `fkMapping`; unmapped columns prevent the rewrite safely.
 */
export class RelationIdRewriter {
    constructor(private readonly provider: RelationMetaProvider) {}

    /**
     * Applies the relation-ID rewrite to `tree`.
     *
     * Returns the (possibly mutated) root.  The root node itself is
     * always preserved so callers can still inspect `tree.alias` etc.
     */
    apply(tree: ConditionTree): ConditionTree {
        if (tree.type !== 'scoped') return tree
        this.rewriteScope(tree as ScopedCondition, this.provider)
        return tree
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    /**
     * Processes all children of `scope` in-place, applying the rewrite
     * wherever possible.  Uses `provider` to look up FK metadata for
     * join-scope columns at the current entity level.
     */
    private rewriteScope(
        scope: ScopedCondition,
        provider: RelationMetaProvider,
    ): void {
        // Collect (index, replacement) pairs; apply in reverse to preserve indices.
        const replacements: Array<{
            idx: number
            original: ICondition
            replacement: ICondition[]
        }> = []

        for (let i = 0; i < scope.conditions.length; i++) {
            const child = scope.conditions[i]
            if (child.type !== 'scoped') continue

            const childScoped = child as ScopedCondition

            if (childScoped.join) {
                const column = rawColumn(childScoped)
                if (column === null) continue

                const meta = provider(column)
                if (meta) {
                    // Recursively rewrite inner join scopes first (bottom-up).
                    if (meta.childProvider) {
                        this.rewriteScope(childScoped, meta.childProvider)
                    }

                    // Now try to rewrite this join scope itself.
                    if (this.canRewrite(childScoped, meta.fkMapping)) {
                        const replacement = this.buildReplacement(
                            childScoped,
                            meta.fkMapping,
                        )
                        replacements.push({ idx: i, original: child, replacement })
                    }
                }
                // No meta → leave join scope unchanged (no rewrite possible).
            } else {
                // Non-join scope: recurse with the same provider.
                this.rewriteScope(childScoped, provider)
            }
        }

        // Apply replacements in reverse order so earlier indices stay valid.
        for (let r = replacements.length - 1; r >= 0; r--) {
            const { idx, original, replacement } = replacements[r]
            scope.conditions.splice(idx, 1, ...replacement)
            for (const rep of replacement) rep.parent = scope
            original.unlink()
        }
    }

    /**
     * Returns `true` when every direct child of `joinScope` is a
     * `PrimitiveCondition` whose column is present in `fkMapping`.
     */
    private canRewrite(
        joinScope: ScopedCondition,
        fkMapping: Record<string, string>,
    ): boolean {
        if (joinScope.conditions.length === 0) return false

        for (const child of joinScope.conditions) {
            if (child.type !== 'primitive') return false
            const col = rawColumn(child)
            if (col === null) return false
            if (!(col in fkMapping)) return false
        }
        return true
    }

    /**
     * Builds the replacement node(s) for a rewritable `joinScope`.
     *
     * - Single primitive → returns `[newPrimitive]` directly.
     * - Multiple primitives → wraps them in a non-join `ScopedCondition`
     *   with the same scope-op as the original join scope, preserving
     *   boolean semantics regardless of the parent's scope-op.
     */
    private buildReplacement(
        joinScope: ScopedCondition,
        fkMapping: Record<string, string>,
    ): ICondition[] {
        const prims = joinScope.conditions.map(child => {
            const prim = child as PrimitiveCondition
            const col  = rawColumn(prim) as string
            return new PrimitiveCondition({
                column:   fkMapping[col],
                operator: prim.operator,
                operand:  prim.operand,
            })
        })

        if (prims.length === 1) return prims

        // Wrap to preserve the join scope's AND/OR/NOT logic in the parent.
        const wrapper = new ScopedCondition({ scope: joinScope.scope, join: false })
        prims.forEach(p => wrapper.push(p))
        return [wrapper]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the protected `_column` field from any `ICondition` node without
 * traversing the parent chain.
 *
 * The public `column` getter on `BaseCondition` walks up to the nearest
 * ancestor that has a column set, which is not what we need here — we want
 * the column property that was set directly on the node.  The same pattern is
 * used in `PathPolicyEnforcer` for the same reason; see `path-policy-enforcer.ts`.
 */
function rawColumn(node: ICondition): string | null {
    return (node as any)['_column'] as string | null
}
