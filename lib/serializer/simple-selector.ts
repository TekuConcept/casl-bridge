import {
    ConditionTree,
    PrimitiveCondition,
    ScopedCondition
} from '@/condition'
import { IQueryBuilder, ITableInfo } from '@/schema'
import { SelectList, SelectPattern, SelectTuple } from './types'
import { SimpleUtils } from './simple-utils'

/**
 * Part of the SimpleSerializer API.
 * It has been abstracted into a separate class
 * to allow for easier testing and to keep the
 * SimpleSerializer class clean.
 */
export class SimpleSelector {
    constructor(private readonly table: ITableInfo) {}

    select(
        builder: IQueryBuilder,
        query: ConditionTree,
        pattern: SelectPattern,
    ): IQueryBuilder {
        const selections = this.recursiveSelect(
            this.table,
            query,
            pattern
        )
        return builder.select(selections)
    }

    recursiveSelect(
        table: ITableInfo,
        query: ConditionTree,
        pattern: SelectPattern,
    ): string[] {
        let list: string[]

        if (pattern === '-')
            list = this.selectQueryPattern(table, query)
        else if (pattern === '*')
            return this.selectImmediate(table, query.alias)
        else if (pattern === '**')
            return this.selectDeep(table, query.alias)
        else if (Array.isArray(pattern))
            list = this.selectFields(
                table,
                query.alias,
                pattern as SelectList
            )
        else if (typeof pattern === 'object') {
            const nextPattern = this.convertToArrayPattern(pattern)
            list = this.recursiveSelect(table, query, nextPattern)
        }
        // if embedded table, recursive call else select columns
        else throw new Error(`Unexpected select pattern '${pattern}'`)

        // try to select at least something
        if (list.length) return list
        return this.selectImmediate(table, query.alias)
    }

    convertToArrayPattern(
        pattern: object,
        visited = new Set<object>()
    ): SelectList {
        const result: SelectList = []
        visited.add(pattern)

        // We make the assumption that the first call is a 'pure'
        // object and not an array, null, or other type. We then
        // ignore any types that are not themselves pure objects.
        const isPureObject = (obj: object) => {
            return typeof obj === 'object' &&
                !Array.isArray(obj) &&
                obj !== null
        }

        Object.keys(pattern).forEach(key => {
            const value = pattern[key]
            if (isPureObject(value)) {
                if (visited.has(value)) return
                result.push([
                    key,
                    this.convertToArrayPattern(value, visited)
                ])
            } else result.push(key)
        })

        return result
    }

    /**
     * Selects with respect to the query pattern.
     * Any fields used as part of the query will be
     * included in the result.
     */
    selectQueryPattern(
        table: ITableInfo,
        query: ConditionTree,
    ): string[] {
        const result: string[] = []

        if (query.type === 'scoped')
            result.push(...this.selectScopedCondition(
                table,
                query as ScopedCondition
            ))
        else result.push(...this.selectPrimitiveCondition(
            table,
            query as PrimitiveCondition
        ))

        return result
    }

    selectScopedCondition(
        table: ITableInfo,
        query: ScopedCondition,
    ) {
        const result = []

        let nextTable = table
        if (query.join) {
            const column = table.getColumn(query.column)
            if (!column) return [] // ignore unknown columns
            nextTable = column.getRelation()
        }

        query.conditions.forEach(condition => {
            result.push(...this.selectQueryPattern(nextTable, condition))
        })

        return result
    }

    selectPrimitiveCondition(
        table: ITableInfo,
        query: PrimitiveCondition,
    ): string[] {
        const column = table.getColumn(query.column)
        if (!column) return [] // ignore unknown columns

        const quotedAlias = SimpleUtils.getQuotedAlias(table, query.alias)
        const quotedColumn = column.getQuotedName()

        return [`${quotedAlias}.${quotedColumn}`]
    }

    /** Selects all columns except for relations. */
    selectImmediate(
        table: ITableInfo,
        alias: string,
    ): string[] {
        const result: string[] = []
        const quotedAlias = SimpleUtils.getQuotedAlias(table, alias)

        table.forEach(column => {
            if (column.isJoinable()) return
            const quotedColumn = column.getQuotedName()
            result.push(`${quotedAlias}.${quotedColumn}`)
        })

        return result
    }

    /** Selects all columns including relations. */
    selectDeep(
        table: ITableInfo,
        alias: string,
    ): string[] {
        const result: string[] = []
        const quotedAlias = SimpleUtils.getQuotedAlias(table, alias)

        table.forEach(column => {
            if (column.isJoinable()) {
                const nextTable = column.getRelation()
                const quotedColumn = column.getQuotedName()
                const nextAlias = `${alias}_${column.getName()}`
                const list = this.selectImmediate(nextTable, nextAlias)

                result.push(`${quotedAlias}.${quotedColumn}`)
                result.push(...list)
            } else {
                const quotedColumn = column.getQuotedName()
                result.push(`${quotedAlias}.${quotedColumn}`)
            }
        })

        return result
    }

    /** Selects all columns in the pattern including relations. */
    selectFields(
        table: ITableInfo,
        alias: string,
        pattern: SelectList
    ): string[] {
        const result: string[] = []

        pattern.forEach(item => {
            if (Array.isArray(item)) {
                const list = this.selectEmbeddedFields(
                    table,
                    alias,
                    item as SelectTuple
                )
                result.push(...list)
            } else {
                const entry = this.selectSimpleField(
                    table,
                    alias,
                    item as string
                )
                if (entry) result.push(entry)
            }
        })

        return result
    }

    selectEmbeddedFields(
        table: ITableInfo,
        alias: string,
        pattern: SelectTuple
    ) {
        const [relation, subPattern] = pattern
        if (typeof relation !== 'string')
            throw new Error(`Expected string, got ${typeof relation}`)
        if (!Array.isArray(subPattern))
            throw new Error(`Expected array, got ${typeof subPattern}`)

        const column = table.getColumn(relation)
        if (!column) return [] // ignore unknown columns

        // if this is a column, but it's not joinable,
        // then let's still try to select it
        if (!column.isJoinable()) {
            // NOTE: the return value will never be null
            //       because the column already exists
            return [this.selectSimpleField(table, alias, relation)]
        }

        const nextAlias = `${alias}_${relation}`
        const nextTable = column.getRelation()

        const quotedAlias = SimpleUtils.getQuotedAlias(table, alias)
        const quotedColumn = column.getQuotedName()

        const path = `${quotedAlias}.${quotedColumn}`
        return [
            path,
            ...this.selectFields(nextTable, nextAlias, subPattern)
        ]
    }

    selectSimpleField(
        table: ITableInfo,
        alias: string,
        field: string
    ): string | null {
        if (typeof field !== 'string')
            throw new Error(`Expected string, got ${typeof field}`)

        const column = table.getColumn(field)
        if (!column) return null // ignore unknown columns

        const quotedAlias = SimpleUtils.getQuotedAlias(table, alias)
        const quotedColumn = column.getQuotedName()

        return `${quotedAlias}.${quotedColumn}`
    }
}
