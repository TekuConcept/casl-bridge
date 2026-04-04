
import { IQueryBuilder, ITableInfo } from '../../schema'
import {
    ConditionTree,
    ICondition,
    LiteralCondition,
    PrimOp,
    PrimitiveCondition,
    ScopeOp,
    ScopedCondition
} from '../../condition'
import { JsonPathAnnotator } from '../../passes'
import { SimpleSelector } from '../simple-selector'
import { SimpleUtils } from '../simple-utils'
import { DbDialect, renderJsonExtract } from '../sql-dialect-adapter'
import { ISerializer, SelectPattern } from '../types'
import { ScopeInfo } from './types'
import { Helpers } from './utils'

export class SimpleSerializer implements ISerializer {
    selector: SimpleSelector

    constructor(private readonly table: ITableInfo) {
        this.selector = new SimpleSelector(table)
    }

    serialize(query: ConditionTree, direction?: 'left' | 'inner'): IQueryBuilder {
        const builder = this.table.createQueryBuilder(query.alias, direction)
        return this.serializeWith(builder, query)
    }

    serializeWith(
        builder: IQueryBuilder,
        query: ConditionTree,
    ): IQueryBuilder {
        // Annotate JSON paths before serializing so that PrimitiveConditions
        // inside JSON column scopes carry their jsonColumn/jsonPath/jsonTableAlias.
        // The pass mutates in-place; use result.tree to stay compatible with
        // a future immutable implementation.
        query = new JsonPathAnnotator(this.table).apply(query).tree

        const rootScope: ScopeInfo = {
            shared: { counter: builder.nextParamId() },
            table: this.table,
            builder,
            where: builder.andWhere.bind(builder)
        }
        this.serializeCondition(rootScope, query)
        return builder
    }

    select(
        builder: IQueryBuilder,
        query: ICondition,
        pattern: SelectPattern
    ): IQueryBuilder {
        return this.selector.select(builder, query, pattern)
    }

    serializeCondition(
        scopeInfo: ScopeInfo,
        condition: ConditionTree
    ) {
        if (condition.type === 'literal')
            this.serializeLiteralCondition(
                scopeInfo,
                condition as LiteralCondition
            )
        else if (condition.type === 'scoped')
            this.serializeScopedCondition(
                scopeInfo,
                condition as ScopedCondition
            )
        else this.serializePrimCondition(
            scopeInfo,
            condition as PrimitiveCondition
        )
    }

    serializeLiteralCondition(
        scopeInfo: ScopeInfo,
        condition: LiteralCondition
    ) {
        // Use DB-agnostic SQL so the literals work across
        // MySQL, SQLite, and Postgres.
        scopeInfo.where(condition.value ? '(1=1)' : '(1=0)')
    }

    serializeScopedCondition(
        scopeInfo: ScopeInfo,
        condition: ScopedCondition
    ) {
        if (condition.scope === ScopeOp.NOT)
            this.serializeScopedNot(scopeInfo, condition)
        else this.serializeScopedBoolean(scopeInfo, condition)
    }

    serializeScopedNot(
        scopeInfo: ScopeInfo,
        condition: ScopedCondition
    ) {
        const brackets = scopeInfo.builder.createNotBrackets(
            nextBuilder => {
                const nextScope: ScopeInfo = {
                    shared: scopeInfo.shared,
                    table: Helpers.getNextTable(scopeInfo, condition),
                    builder: nextBuilder,
                    where: nextBuilder.andWhere.bind(nextBuilder)
                }

                condition.conditions.forEach(cond => {
                    this.serializeCondition(nextScope, cond)
                })
            }
        )
        scopeInfo.where(brackets)
    }

    serializeScopedBoolean(
        scopeInfo: ScopeInfo,
        condition: ScopedCondition
    ) {
        const brackets = scopeInfo.builder.createBrackets(
            nextBuilder => {
                const where = condition.scope === ScopeOp.AND
                    ? nextBuilder.andWhere.bind(nextBuilder)
                    : nextBuilder.orWhere.bind(nextBuilder)
                const nextScope: ScopeInfo = {
                    shared: scopeInfo.shared,
                    table: Helpers.getNextTable(scopeInfo, condition),
                    builder: nextBuilder,
                    where
                }

                condition.conditions.forEach(cond => {
                    this.serializeCondition(nextScope, cond)
                })
            }
        )
        scopeInfo.where(brackets)
    }

    serializePrimCondition(
        scopeInfo: ScopeInfo,
        condition: PrimitiveCondition
    ) {
        if (condition.operator === PrimOp.EMPTY_RESULT) {
            scopeInfo.builder.andWhere('FALSE')
            return
        }

        const { where } = scopeInfo
        const { operator, operand } = condition
        const param = `param_${scopeInfo.shared.counter++}`

        // Build the SQL left-operand: either a JSON extraction expression or
        // a plain column reference.
        let path: string

        if (condition.jsonColumn != null) {
            // JSON path condition — emit dialect-specific extraction expression.
            const { jsonColumn, jsonPath, jsonTableAlias } = condition
            const jsonColInfo = scopeInfo.table.getColumn(jsonColumn)
            if (!jsonColInfo) throw new Error(
                `Column '${jsonColumn}' not found in table '${scopeInfo.table.classType()}'`
            )
            const quotedAlias = SimpleUtils.getQuotedAlias(
                scopeInfo.table, jsonTableAlias ?? condition.alias
            )
            const quotedColumn = jsonColInfo.getQuotedName()
            const columnSql = `${quotedAlias}.${quotedColumn}`
            path = renderJsonExtract(
                this.table.getDialectType() as DbDialect,
                columnSql,
                jsonPath,
            )
        } else {
            // Normal column reference.
            const { alias, column } = condition
            const columnInfo = scopeInfo.table.getColumn(column)
            if (!columnInfo) throw new Error(
                `Column '${column}' not found in table '${scopeInfo.table.classType()}'`
            )
            const quotedAlias  = SimpleUtils.getQuotedAlias(
                scopeInfo.table,
                alias
            )
            const quotedColumn = columnInfo.getQuotedName()
            path               = `${quotedAlias}.${quotedColumn}`
        }

        switch (operator) {
        case PrimOp.EQUAL:            where(`${path}  = :${param}`, { [param]: operand }); break
        case PrimOp.NOT_EQUAL:        where(`${path} != :${param}`, { [param]: operand }); break
        case PrimOp.GREATER_OR_EQUAL: where(`${path} >= :${param}`, { [param]: operand }); break
        case PrimOp.GREATER_THAN:     where(`${path}  > :${param}`, { [param]: operand }); break
        case PrimOp.LESS_OR_EQUAL:    where(`${path} <= :${param}`, { [param]: operand }); break
        case PrimOp.LESS_THAN:        where(`${path}  < :${param}`, { [param]: operand }); break
        case PrimOp.IN:               where(`${path} IN     (:...${param})`, { [param]: operand }); break
        case PrimOp.NOT_IN:           where(`${path} NOT IN (:...${param})`, { [param]: operand }); break
        case PrimOp.LIKE:             where(`${path} LIKE        :${param}`, { [param]: operand }); break
        case PrimOp.NOT_LIKE:         where(`${path} NOT LIKE    :${param}`, { [param]: operand }); break
        case PrimOp.ILIKE:            where(`${path} ILIKE       :${param}`, { [param]: operand }); break
        case PrimOp.NOT_ILIKE:        where(`${path} NOT ILIKE   :${param}`, { [param]: operand }); break
        case PrimOp.REGEX:            where(`${path} REGEXP      :${param}`, { [param]: operand }); break
        case PrimOp.NOT_REGEX:        where(`${path} NOT REGEXP  :${param}`, { [param]: operand }); break
        case PrimOp.IREGEX:           where(`${path} IREGEXP     :${param}`, { [param]: operand }); break
        case PrimOp.NOT_IREGEX:       where(`${path} NOT IREGEXP :${param}`, { [param]: operand }); break
        case PrimOp.BETWEEN:          where(`${path} BETWEEN     :a${param} AND :b${param}`, { [`a${param}`]: operand[0], [`b${param}`]: operand[1] }); break
        case PrimOp.NOT_BETWEEN:      where(`${path} NOT BETWEEN :a${param} AND :b${param}`, { [`a${param}`]: operand[0], [`b${param}`]: operand[1] }); break
        case PrimOp.SIZE:             where(`array_length(${path}, 1) = :${param}`, { [param]: operand }); break
        case PrimOp.IS:
            if (operand === null) where(`${path} IS NULL`)
            else if (operand) where(`${path} IS TRUE`)
            else where(`${path} IS FALSE`)
            break
        case PrimOp.IS_NOT:
            if (operand === null) where(`${path} IS NOT NULL`)
            else if (operand) where(`${path} IS NOT TRUE`)
            else where(`${path} IS NOT FALSE`)
            break
        default: throw new Error(`Unknown operator ${operator}`)
        }
    }
}
