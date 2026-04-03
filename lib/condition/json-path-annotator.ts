import { ITableInfo } from '../schema'
import { ConditionTree } from './types'
import { ScopedCondition } from './scoped-condition'
import { PrimitiveCondition } from './primitive-condition'

interface JsonContext {
    /** The JSON column name on the owning entity (e.g. `'metadata'`). */
    column: string
    /** Accumulated intermediate path segments (e.g. `['library']`). */
    pathParts: string[]
    /** Alias of the table that owns the JSON column (e.g. `'__test__'`). */
    tableAlias: string
}

/**
 * Pre-pass annotator that walks a {@link ConditionTree} with TypeORM
 * metadata context and marks any path that traverses a JSON column.
 *
 * When a `ScopedCondition` with `join=true` resolves to a JSON-typed
 * column (instead of a relation), this annotator:
 *
 * 1. Sets `isJsonTraversal = true` on that scope and all nested scopes
 *    within it so the serializer knows to skip the SQL JOIN.
 * 2. Populates `jsonColumn`, `jsonPath`, and `jsonTableAlias` on every
 *    {@link PrimitiveCondition} leaf inside the JSON sub-tree so the
 *    serializer can emit the correct JSON-extraction SQL.
 *
 * Works analogously to {@link RelationIdRewriter}: it mutates the tree
 * in-place and is idempotent.
 */
export class JsonPathAnnotator {
    constructor(private readonly table: ITableInfo) {}

    /**
     * Annotates the condition tree starting from the root.
     * The tree is mutated in-place; the root itself is always preserved.
     */
    apply(tree: ConditionTree): void {
        this.annotate(tree, this.table, null)
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    private annotate(
        condition: ConditionTree,
        table: ITableInfo,
        jsonCtx: JsonContext | null,
    ): void {
        if (condition.type === 'literal') return

        if (condition.type === 'primitive') {
            if (jsonCtx) {
                const prim = condition as PrimitiveCondition
                prim.jsonColumn     = jsonCtx.column
                prim.jsonPath       = [...jsonCtx.pathParts, prim.column].join('.')
                prim.jsonTableAlias = jsonCtx.tableAlias
            }
            return
        }

        // scoped condition
        const scoped = condition as ScopedCondition

        if (!scoped.join) {
            // Non-join scope: propagate current context unchanged.
            scoped.conditions.forEach(c => this.annotate(c, table, jsonCtx))
            return
        }

        // join=true
        if (jsonCtx) {
            // Already inside a JSON traversal: extend the accumulated path.
            scoped.isJsonTraversal = true
            const newCtx: JsonContext = {
                ...jsonCtx,
                pathParts: [...jsonCtx.pathParts, scoped.column],
            }
            scoped.conditions.forEach(c => this.annotate(c, table, newCtx))
        } else {
            // Determine what this join represents.
            const col = table.getColumn(scoped.column)

            if (col?.isJsonColumn()) {
                // This scope traverses a JSON column — enter JSON mode.
                scoped.isJsonTraversal = true
                // The alias of the table that owns the JSON column is the
                // parent scope's alias (e.g. '__test__' or '__test___books').
                const tableAlias = scoped.parent
                    ? scoped.parent.alias
                    : scoped.alias
                const newCtx: JsonContext = {
                    column:     scoped.column,
                    pathParts:  [],
                    tableAlias,
                }
                scoped.conditions.forEach(c => this.annotate(c, table, newCtx))
            } else if (col?.isJoinable()) {
                // Regular relation join — recurse into the related table.
                // getRelation() is non-null for joinable columns by contract.
                const nextTable = col.getRelation()!
                scoped.conditions.forEach(c => this.annotate(c, nextTable, null))
            } else {
                // Column not found / not joinable — leave as-is.
                // The serializer will throw with an appropriate error.
                scoped.conditions.forEach(c => this.annotate(c, table, null))
            }
        }
    }
}
