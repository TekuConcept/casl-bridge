import { ScopedCondition } from '@/condition'
import { ScopeInfo } from './types'
import { SimpleUtils } from '../simple-utils'

export namespace Helpers {
    export function getNextTable(
        scopeInfo: ScopeInfo,
        condition: ScopedCondition
    ) {
        if (!condition.join) return scopeInfo.table

        // JSON traversal scopes are annotated by JsonPathAnnotator; no DB join.
        if (condition.isJsonTraversal) return scopeInfo.table

        const column = scopeInfo.table.getColumn(condition.column)
        if (!column) throw new Error(
            `Column '${condition.column}' not found in ${scopeInfo.table.classType()}`
        )
        if (!column.isJoinable())
            throw new Error(`Column '${condition.column}' is not joinable`)

        // we need to join the table
        const parent = condition.parent
        if (!parent) throw new Error('Parent condition not found')

        const alias = condition.alias
        const parentAlias = parent.alias

        const quotedParentAlias =
            SimpleUtils.getQuotedAlias(scopeInfo.table, parentAlias)
        const quotedAlias =
            SimpleUtils.getQuotedAlias(scopeInfo.table, alias)

        const columnName = column.getName()
            column.getQuotedName()
        const path = `${quotedParentAlias}.${columnName}`

        scopeInfo.builder.join(path, quotedAlias)
        return column.getRelation()
    }
}
