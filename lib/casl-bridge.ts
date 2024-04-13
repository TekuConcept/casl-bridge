import { Repository, Brackets, NotBrackets } from 'typeorm'
import {
    CaslGate,
    MongoFields,
    MongoQueryObject,
    QueryContext,
    QueryState,
    ScopedCallback,
    ScopedOptions
} from './types'
import { AnyAbility, Subject } from '@casl/ability'
import { Rule } from '@casl/ability/dist/types/Rule'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'

export class CaslBridge<R = Subject> {
    constructor(
        public readonly repo: Repository<R>,
        public readonly casl: CaslGate
    ) {}

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action. Default is 'read'.
     * @param field The (optional) field to select. Default is all fields.
     * @param selectJoin Whether to select joined fields. Default is false.
     * @returns The TypeORM query builder instance.
     */
    createQuery(
        action: string = 'read',
        field?: string,
        selectJoin: boolean = false
    ) {
        /**
         * ----------------------------------------------------------
         * IMPORTANT: Extra care must be taken here!
         * 
         * Because query strings are dynamically generated,
         * they become vulnerable to SQL injection attacks.
         * 
         * To minimize the risk:
         * - Use parameterized queries whenever possible!
         * - Keep dynamic query strings as simple as possible!
         * - Use a whitelist of allowed columns! eg `isColumnKey()`
         * ----------------------------------------------------------
         */
        const table = '__table__'
        const builder = this.repo.createQueryBuilder(table)

        const mainstate: QueryState = {
            builder,
            aliasID: 0,
            column: '',
            and: true,
            where: builder.andWhere.bind(builder),
            repo: this.repo
        }

        const mongoQuery = this.rulesToQuery(
            this.casl,
            action,
            this.repo.metadata.targetName,
            field
        )

        if (!mongoQuery) {
            builder.where('1 = 0') // deny all
            return builder
        }

        const context: QueryContext = {
            parameter: 0,
            table,
            join: null,
            mongoQuery,
            builder,
            field,
            aliases: [table],
            stack: [],
            currentState: mainstate
        }

        /**
         * Setup the left-join function for this context.
         * We don't want to select if a field is already
         * selected or the user has disabled relational
         * selections.
         */
        const join = (selectJoin && !field)
                ? builder['leftJoinAndSelect']
                : builder['leftJoin']
        context.join = join.bind(builder)

        this.selectField(context, field)
        this.insertOperations(context, context.mongoQuery)

        return builder
    }

    private selectField(
        context: QueryContext,
        field?: string
    ) {
        if (!field) return

        const useRepo = context.currentState.repo
        const column = this.checkColumn(field, useRepo)
        const relative = this.repo.metadata.relations.find(
            r => r.propertyName === column
        )

        // select before left-join to deselect all other
        // fields except those related to the current field
        context.builder.select(`__table__.${column}`)

        if (relative) {
            const alias = this.createAliasFrom(context, column)
            const aliasName = this.getAliasName(context, alias)
            context.builder.leftJoinAndSelect(`__table__.${column}`, aliasName)
        }
    }

    /**
     * Taken from casl-ability extras and modified.
     * 
     * MIT License
     * Copyright (c) 2017-present Sergii Stotskyi
     */
    private rulesToQuery<T extends AnyAbility>(
        ability: T,
        action: string,
        subjectType: string,
        field?: string
    ): MongoQueryObject | null {
        const query: any = {}
        const rules = ability.rulesFor(action, subjectType, field)

        const convert = (rule: Rule<any,any>) =>
            rule.inverted ? { $not: rule.conditions } : rule.conditions

        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i]
            const op = rule.inverted ? '$and' : '$or'

            if (!rule.conditions) {
                if (rule.inverted) break
                else {
                    delete query[op]
                    return query
                }
            } else {
                query[op] = query[op] || []
                query[op]!.push(convert(rule))
            }
        }

        return query['$or'] ? query : null
    }

    ////////////////////////////////////////////////////////////
    // ACCESS FUNCTIONS                                       //
    ////////////////////////////////////////////////////////////

    /**
     * Checks if the given key is a valid column key.
     * This is a critical security check to prevent SQL injection.
     * This function may be overridden to provide more strict checks.
     * 
     * @param key The column key to check.
     * @returns True if the key is a valid column key, false otherwise.
     */
    protected isColumnKey(
        key: string,
        repo: Repository<any>
    ): boolean {
        // Map of columns and relations of the entity.
        const map = repo.metadata.ownColumns
        const result = map.find(k => k.propertyName === key)
        return result ? true : false
    }

    /**
     * This will throw an error if the column
     * key is invalid, otherwise return the
     * key as-is.
     * 
     * @param column The column key to check.
     * @returns The column key if valid.
     */
    private checkColumn(
        column: string,
        repo: Repository<any>
    ) {
        /* -------------------------------- *\
         *   !! THIS CHECK IS CRITICAL !!   *
        \* -------------------------------- */

        if (!column || !this.isColumnKey(column, repo))
            throw new Error(`Invalid column key ${column}`)
        return column
    }

    /**
     * IMPORTANT:
     * All alias names MUST be created with `createAliasFrom()`.
     * 
     * @param context The current query building context.
     * @param column The column name to create an alias from.
     */
    private createAliasFrom(
        context: QueryContext,
        column: string,
        repo?: Repository<any>
    ) {
        const useRepo = repo ?? context.currentState.repo
        const columnName = this.checkColumn(column, useRepo)
        const parentAlias = this.getAliasName(context)
        const aliasName = `${parentAlias}_${columnName}`
        const id = context.aliases.length

        context.aliases.push(aliasName)

        return id
    }

    private findAliasFor(
        context: QueryContext,
        column: string
    ) {
        const parentAlias = this.getAliasName(context)
        const aliasName = `${parentAlias}_${column}`
        return context.aliases.indexOf(aliasName)
    }

    /**
     * Gets the associated alias name from the alias ID.
     * 
     * @param context The current query building context.
     * @param id The associated alias ID. If not provided,
     *           the current scope's alias ID is used.
     * @returns The alias name.
     */
    private getAliasName(
        context: QueryContext,
        id?: number
    ) {
        const aid = id ?? context.currentState.aliasID
        const alias = context.aliases[aid]
        if (!alias) throw new Error(`Alias ID ${aid} not found in context`)
        return alias
    }

    /**
     * Sets the current column for the query context.
     * 
     * @param context The current query building context.
     * @param column The column name to set.
     */
    private setColumn(context: QueryContext, column: string) {
        const useRepo = context.currentState.repo
        context.currentState.column = this.checkColumn(column, useRepo)
    }

    /**
     * Gets the current column for the query context.
     * 
     * @param context The current query building context.
     * @returns The current column name.
     */
    private getColumn(context: QueryContext) {
        if (!context.currentState.column)
            throw new Error('No column set in current context')
        return context.currentState.column
    }

    /**
     * Gets the parameterization name for the current context.
     * The value is always unique and incremental. It takes the
     * form of `param_0`, `param_1`, `param_2`, etc.
     * 
     * This is necessary to help TypeORM distinguish between
     * different parameterized value inputs.
     * 
     * @param context The current query building context.
     */
    private getParamName(context: QueryContext) {
        /* - paranoya check - */
        if (!isFinite(context.parameter) || context.parameter < 0)
            throw new Error('Invalid parameter index')
        return `param_${context.parameter++}`
    }

    ////////////////////////////////////////////////////////////
    // QUERY BUILDING FUNCTIONS                               //
    ////////////////////////////////////////////////////////////

    /**
     * This will scope conditions within a bracketed query block.
     * This is useful for grouping conditions together.
     * 
     * @param context The current query building context.
     * @param callback The callback to invoke within the scope.
     * @param aliasID The alias ID to scope the query to.
     * @param and Whether the conditions should be ANDed or ORed.
     */
    private scopedInvoke(
        context: QueryContext,
        callback: ScopedCallback,
        options?: ScopedOptions,
    ) {
        const opts = Object.assign({
            aliasID: context.currentState.aliasID,
            column: context.currentState.column,
            repo: context.currentState.repo,
            and: true,
            not: false
        }, options ?? {})
        const { where } = context.currentState
        const BracketClass = opts.not ? NotBrackets : Brackets

        where(new BracketClass(qb => {
            const nextState: QueryState = {
                builder: qb,
                aliasID: opts.aliasID,
                column: opts.column,
                and: opts.and,
                where: opts.and
                    ? qb.andWhere.bind(qb)
                    : qb.orWhere.bind(qb),
                repo: opts.repo
            }

            context.stack.push(context.currentState)
            context.currentState = nextState

            callback(context, qb)

            context.currentState = context.stack.pop()
        }))
    }

    private insertFields(
        context: QueryContext,
        fields: MongoFields
    ) {
        Object.keys(fields).forEach(field => {
            const value = fields[field]
            this.insertField(context, field, value)
        })
    }

    private insertField(
        context: QueryContext,
        column: string,
        value: any,
    ) {
        this.setColumn(context, column)

        /**
         * Determine the type of operation the value represents.
         * NULL values are treated as `$is` operations.
         * Array values are treated as `$in` operations.
         * Object values are treated as nested fields.
         * All other values are treated as `$eq` operations.
         */

        if (value === null)
            this.insertOperation(context, '$is', value)
        else if (Array.isArray(value))
            this.insertOperation(context, '$in', value)
        else if (typeof value === 'object')
            this.insertObject(context, value)
        else this.insertOperation(context, '$eq', value)
    }

    private insertObject(
        context: QueryContext,
        obj: MongoFields | MongoQueryObject,
        mode: 'normal' | 'no-column' = 'normal'
    ) {
        const { aliasID, and, repo } = context.currentState
        const isQuery = Object.keys(obj).every(key => key.startsWith('$'))
        let columnInfo: ColumnMetadata = {} as any
        let columnName = ''

        if (mode === 'normal') {
            /**
             * First we need to find the associated column info.
             */

            columnName = this.getColumn(context)
            columnInfo = repo.metadata.ownColumns.find(
                c => c.propertyName === columnName
            )

            if (!columnInfo)
                throw new Error(`Column ${columnName} not found`)
            if (!columnInfo.relationMetadata && !isQuery)
                throw new Error(`Column ${columnName} has no relational data`)
        }

        /**
         * If there is no relational info for the column,
         * then let's just insert the operations or fields.
         */

        if (!columnInfo.relationMetadata) {
            if (isQuery) this.insertOperations(context, obj as MongoQueryObject)
            else this.insertFields(context, obj as MongoFields)

            return
        }

        const repoType = columnInfo.relationMetadata.type
        const nextRepo = repo.manager.getRepository(repoType)

        /**
         * Then we can perform a left-join of the column.
         * If alias is already joined, we don't need to join it again
         */

        let nextAliasID = this.findAliasFor(context, columnName)
        if (nextAliasID < 0) {
            nextAliasID = this.createAliasFrom(
                context,
                columnName,
                repo,
            )
            const nextAliasName = this.getAliasName(context, nextAliasID)
            const aliasName = this.getAliasName(context, aliasID)

            context.join(`${aliasName}.${columnName}`, nextAliasName)
        }

        /**
         * Finally, we can insert the fields into the nested context.
         */

        this.scopedInvoke(context, () => {
            if (isQuery) this.insertOperations(context, obj as MongoQueryObject)
            else this.insertFields(context, obj as MongoFields)
        }, { aliasID: nextAliasID, repo: nextRepo })
    }

    private insertOperations(
        context: QueryContext,
        query: MongoQueryObject, // NOTE: this could be a nested object
    ) {
        Object.keys(query).forEach(operator => {
            const operand = query[operator]
            this.insertOperation(context, operator, operand)
        })
    }

    private insertOperation(
        context: QueryContext,
        operator: string,
        operand: any
    ) {
        const { builder, where, repo } = context.currentState
        const aliasName = this.getAliasName(context)
        const param = this.getParamName(context)
        let columnName: string = undefined

        if (operator !== '$and' && operator !== '$or')
            columnName = this.getColumn(context)

        switch (operator) {
        case '$and':
        case '$or':
        case '$not':
            if (!operand || typeof operand !== 'object')
                throw new Error(`Invalid operand for ${operator} operation`)
            break
        }

        switch (operator) {
        case '$eq':         where(`${aliasName}.${columnName}  = :${param}`, { [param]: operand }); break
        case '$ne':         where(`${aliasName}.${columnName} != :${param}`, { [param]: operand }); break
        case '$gte':        where(`${aliasName}.${columnName} >= :${param}`, { [param]: operand }); break
        case '$gt':         where(`${aliasName}.${columnName}  > :${param}`, { [param]: operand }); break
        case '$lte':        where(`${aliasName}.${columnName} <= :${param}`, { [param]: operand }); break
        case '$lt':         where(`${aliasName}.${columnName}  < :${param}`, { [param]: operand }); break
        case '$not':
            this.scopedInvoke(context, () => {
                this.insertObject(context, operand, 'no-column')
            }, { column: columnName, not: true })
            break
        case '$is':
            if (operand === null) where(`${aliasName}.${columnName} IS NULL`)
            else if (operand) where(`${aliasName}.${columnName} IS TRUE`)
            else where(`${aliasName}.${columnName} IS FALSE`)
            break
        case '$isNot':
            if (operand === null) where(`${aliasName}.${columnName} IS NOT NULL`)
            else if (operand) where(`${aliasName}.${columnName} IS NOT TRUE`)
            else where(`${aliasName}.${columnName} IS NOT FALSE`)
            break
        case '$in':         where(`${aliasName}.${columnName} IN     (:...${param})`, { [param]: operand }); break
        case '$notIn':      where(`${aliasName}.${columnName} NOT IN (:...${param})`, { [param]: operand }); break
        case '$like':       where(`${aliasName}.${columnName} LIKE        :${param}`, { [param]: operand }); break
        case '$notLike':    where(`${aliasName}.${columnName} NOT LIKE    :${param}`, { [param]: operand }); break
        case '$iLike':      where(`${aliasName}.${columnName} ILIKE       :${param}`, { [param]: operand }); break
        case '$notILike':   where(`${aliasName}.${columnName} NOT ILIKE   :${param}`, { [param]: operand }); break
        case '$regex':      // fall-through
        case '$regexp':     where(`${aliasName}.${columnName} REGEXP      :${param}`, { [param]: operand }); break
        case '$notRegex':   // fall-through
        case '$notRegexp':  where(`${aliasName}.${columnName} NOT REGEXP  :${param}`, { [param]: operand }); break
        case '$iRegexp':    where(`${aliasName}.${columnName} IREGEXP     :${param}`, { [param]: operand }); break
        case '$notIRegexp': where(`${aliasName}.${columnName} NOT IREGEXP :${param}`, { [param]: operand }); break
        case '$between':    where(`${aliasName}.${columnName} BETWEEN     :a${param} AND :b${param}`, { [`a${param}`]: operand[0], [`b${param}`]: operand[1] }); break
        case '$notBetween': where(`${aliasName}.${columnName} NOT BETWEEN :a${param} AND :b${param}`, { [`a${param}`]: operand[0], [`b${param}`]: operand[1] }); break
        case '$and':
            this.scopedInvoke(context, () => {
                if (Array.isArray(operand)) {
                    operand.forEach(fieldGroup => {
                        this.scopedInvoke(context, () => {
                            this.insertObject(context, fieldGroup, 'no-column')
                        }, { and: true })
                    })
                } else this.insertObject(context, operand, 'no-column')
            }, { and: true })
            break
        case '$or':
            this.scopedInvoke(context, () => {
                if (Array.isArray(operand)) {
                    operand.forEach(fieldGroup => {
                        this.scopedInvoke(context, () => {
                            this.insertObject(context, fieldGroup, 'no-column')
                        }, { and: true })
                    })
                } else this.insertObject(context, operand, 'no-column')
            }, { and: false })
            break
        case '$size': where(`array_length(${aliasName}.${columnName}, 1) = :${param}`, { [param]: operand }); break
        // case '$elemMatch': break // mongodb only
        // case $nor: break // TODO?
        default: throw new Error(`Unknown operator ${operator}`)
        }
    }

    /**********************************************************\
     * Notice that for the operations, `alias`, `column`, and *
     * `param` are the _ONLY_ non-parameterized values.       *
     *                                                        *
     * `alias` is validated when createAliasFrom() is called. *
     *         After which, aliases are referenced from the   *
     *         `aliases` cache. All aliases are built from    *
     *         column names and the table alias.              *
     *                                                        *
     * `column` is validated when setColumn(), checkColumn(), *
     *          or isColumnKey() is called.                   *
     *                                                        *
     * `param` is dynamically generated and incremented with  *
     *         each call to getParamName(). This is to ensure *
     *         that each parameterized value is unique. The   *
     *         value takes the form of `param_N` eg           *
     *                                                        *
     *         `param_0`,                                     *
     *         `param_1`,                                     *
     *         `param_2`, etc.                                *
     *                                                        *
     *         with a paranoya check to ensure N is always    *
     *         numeric, finite, and positive.                 *
    \**********************************************************/
}
