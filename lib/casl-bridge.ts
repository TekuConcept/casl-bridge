import {
    Repository,
    Brackets,
    NotBrackets,
    DataSource,
    EntityManager,
    SelectQueryBuilder
} from 'typeorm'
import {
    CaslGate,
    FilterObject,
    MongoFields,
    MongoQueryObject,
    QueryContext,
    QueryState,
    ScopedCallback,
    ScopedOptions,
    Selected
} from './types'
import { AnyAbility, SubjectType } from '@casl/ability'
import { Rule } from '@casl/ability/dist/types/Rule'

export class CaslBridge {
    constructor(
        public readonly manager: DataSource | EntityManager,
        public readonly casl: CaslGate
    ) {}

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param field The (optional) field to select. Default is all fields.
     * @param selectMap Whether to select fields. When `true`, all
     *     fields are selected including relations. No fields are selected
     *     when false. When an object, only the keys of the object
     *     corresponding to column names are selected with respect to
     *     their truthiness. Default is `true`.
     * 
     *     NOTE: The `field` parameter will override this setting.
     * @param filters Any additional filters to include.
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType,
        field: string,
        selectMap: Selected,
        filters: FilterObject
    ): SelectQueryBuilder<any>;

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param selectMap Whether to select fields. When `true`, all
     *     fields are selected including relations. No fields are selected
     *     when false. When an object, only the keys of the object
     *     corresponding to column names are selected with respect to
     *     their truthiness. Default is `true`.
     * 
     *     NOTE: The `field` parameter will override this setting.
     * @param filters Any additional filters to include.
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType,
        selectMap: Selected,
        filters: FilterObject
    ): SelectQueryBuilder<any>;

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param selectMap Whether to select fields. When `true`, all
     *     fields are selected including relations. No fields are selected
     *     when false. When an object, only the keys of the object
     *     corresponding to column names are selected with respect to
     *     their truthiness. Default is `true`.
     * 
     *     NOTE: The `field` parameter will override this setting.
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType,
        selectMap: Selected
    ): SelectQueryBuilder<any>;

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param field The (optional) field to select. Default is all fields.
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType,
        field: string
    ): SelectQueryBuilder<any>;

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType
    ): SelectQueryBuilder<any>;

    createQueryTo(
        action: string,
        subject: SubjectType,
        field?: string | Selected,
        selectMap?: Selected | FilterObject,
        filters?: FilterObject
    ): SelectQueryBuilder<any> {
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
        const repo = this.manager.getRepository(subject)
        const builder = repo.createQueryBuilder(table)

        /**
         * handle overload parameters
         */

        if ((typeof field === 'object' || typeof field === 'boolean')) {
            filters = selectMap as FilterObject
            selectMap = field as Selected
            field = undefined
        }

        if (selectMap === undefined) selectMap = true

        const mainstate: QueryState = {
            builder,
            aliasID: 0,
            and: true,
            where: builder.andWhere.bind(builder),
            repo,
            selectMap: selectMap as Selected,
        }

        const mongoQuery = this.rulesToQuery(
            this.casl,
            action,
            subject,
            field as string
        )

        if (!mongoQuery) {
            builder.where('1 = 0') // deny all
            return builder
        }

        const context: QueryContext = {
            parameter: 0,
            table,
            join: builder['leftJoin'].bind(builder),
            builder,
            field: field as string,
            selectMap: selectMap as Selected,
            selected: new Set(),
            aliases: [table],
            columns: [],
            stack: [],
            currentState: mainstate
        }

        this.selectPrimaryField(context)
        if (Object.keys(mongoQuery).length === 0)
            this.selectAllImmediateFields(context)
        else this.insertOperations(context, mongoQuery)

        if (filters) this.insertFilters(context, filters)

        builder.select(Array.from(context.selected))

        return builder
    }

    private selectPrimaryField(context: QueryContext) {
        const { field } = context

        if (!field) return

        context.selectMap = true
        context.currentState.selectMap = true

        context.field = null // allow selectField to work
        this.setColumn(context, field)
        this.selectField(context)
        context.field = field

        if (!this.isColumnJoinable(context)) return

        /**
         * join the column if it is a relation
         */

        const nextAliasID   = this.createAliasFrom(context)
        const nextAliasName = this.getAliasName(context, nextAliasID)
        const aliasName     = this.getAliasName(context)
        const columnName    = this.getColumnName(context)

        context.builder.leftJoin(`${aliasName}.${columnName}`, nextAliasName)

        /**
         * select all whitelisted fields from the relation
         */

        const { repo } = context.currentState
        const repoType = this.getJoinableType(context)
        const nextRepo = repo.manager.getRepository(repoType)

        this.scopedInvoke(context, () => {
            context.field = null // allow selectField to work
            nextRepo.metadata.ownColumns.forEach(metadata => {
                const joinColumnName = metadata.propertyName
                this.setColumn(context, joinColumnName)
                this.selectField(context)
            })
            context.field = field
        }, {
            aliasID: nextAliasID,
            repo: nextRepo,
            selectMap: this.nextSelectMap(context, field)
        })
    }

    private selectAllImmediateFields(context: QueryContext) {
        const { repo } = context.currentState
        const { field } = context

        repo.metadata.ownColumns.forEach(metadata => {
            const column = metadata.propertyName

            context.field = null // allow selectField to work
            this.setColumn(context, column)
            this.selectField(context)
            context.field = field

            if (!metadata.relationMetadata) return

            const nextAliasID = this.createAliasFrom(context)
            const nextAliasName = this.getAliasName(context, nextAliasID)
            const aliasName = this.getAliasName(context)
            const columnName = this.getColumnName(context)

            context.join(`${aliasName}.${columnName}`, nextAliasName)

            const repoType = this.getJoinableType(context)
            const nextRepo = repo.manager.getRepository(repoType)

            this.scopedInvoke(context, () => {
                nextRepo.metadata.ownColumns.forEach(metadata => {
                    const joinColumn = metadata.propertyName
                    context.field = null // allow selectField to work
                    this.setColumn(context, joinColumn)
                    this.selectField(context)
                    context.field = field
                })
            }, {
                aliasID: nextAliasID,
                repo: nextRepo,
                selectMap: this.nextSelectMap(context, column)
            })
        })
    }

    private insertFilters(
        context: QueryContext,
        filters: FilterObject
    ) {
        // prevent erroneous column selection
        delete context.currentState.columnID

        this.scopedInvoke(context, () => {
            context.currentState.selectMap = false
            this.insertObject(context, filters, 'no-column')
        })
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
        subjectType?: SubjectType,
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
     * This will throw an error if the specified column
     * does not exist in the given repository's table.
     * 
     * Override this function for more strict checks.
     * 
     * @param column The column key to check.
     * @returns The column metadata if valid.
     */
    protected checkColumn(
        column: string,
        repo: Repository<any>
    ) {
        /* -------------------------------- *\
         *   !! THIS CHECK IS CRITICAL !!   *
        \* -------------------------------- */

        const map = repo.metadata.ownColumns
        const metadata = map.find(k => k.propertyName === column)

        if (!metadata) throw new Error(`Invalid column key ${column}`)
        return metadata
    }

    /**
     * IMPORTANT:
     * All alias names MUST be created with `createAliasFrom()`!
     * 
     * @param context The current query building context.
     * @param columnID The associated column ID. If not provided,
     *                 the current scope's column ID is used.
     */
    private createAliasFrom(
        context: QueryContext,
        columnID?: number
    ) {
        const columnName = this.getColumnName(context, columnID)
        const parentAlias = this.getAliasName(context)
        const aliasName = `${parentAlias}_${columnName}`
        const aid = context.aliases.length

        context.aliases.push(aliasName)

        return aid
    }

    private findAliasIDFor(context: QueryContext) {
        const parentAlias = this.getAliasName(context)
        const columnName = this.getColumnName(context)
        const aliasName = `${parentAlias}_${columnName}`
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
    private setColumn(
        context: QueryContext,
        column: string
    ) {
        const { repo } = context.currentState
        const metadata = this.checkColumn(column, repo)
        if (context.columns.indexOf(metadata) < 0)
            context.columns.push(metadata)
        context.currentState.columnID = context.columns.indexOf(metadata)
    }

    /**
     * Gets the column name for the query context.
     * 
     * @param context The current query building context.
     * @param id The associated column ID. If not provided,
     *           the current scope's column ID is used.
     * @returns The column name.
     */
    private getColumnName(
        context: QueryContext,
        id?: number
    ) {
        const cid = id ?? context.currentState.columnID
        const column = context.columns[cid]
        if (!column) throw new Error(`Column ID ${cid} not found in context`)
        return column.propertyName
    }

    /**
     * NOTE: This will also return false if the column is
     *       not found in the current context or invalid.
     */
    private isColumnJoinable(
        context: QueryContext,
        id?: number
    ) {
        const cid = id ?? context.currentState.columnID
        const column = context.columns[cid]
        return !!column?.relationMetadata
    }

    private getJoinableType(
        context: QueryContext,
        id?: number
    ) {
        const cid = id ?? context.currentState.columnID
        const column = context.columns[cid]
        if (!column) throw new Error(`Column ${cid} not found in context`)
        if (!column.relationMetadata)
            throw new Error(`Column ${cid} has no relational data`)
        return column.relationMetadata.type
    }

    /**
     * Adds the given column to the list of selected fields.
     * If the column is disabled in the select map, it will not
     * be added to the list.
     * 
     * @param context The current query building context.
     * @param column The column to select.
     */
    private selectField(
        context: QueryContext,
        columnID?: number
    ) {
        if (context.field) return

        const { selectMap } = context.currentState
        const columnName = this.getColumnName(context, columnID)
        const aliasName = this.getAliasName(context)
        const selectName = `${aliasName}.${columnName}`

        const selected =
            (typeof selectMap === 'boolean' && selectMap) ||
            (typeof selectMap === 'object' && !!selectMap[columnName])

        if (selected) context.selected.add(selectName)
    }

    /**
     * NOTE: column name is only used here to get the next
     *       select map. It is not used for anything else.
     */
    private nextSelectMap(
        context: QueryContext,
        column: string
    ) {
        const { selectMap } = context.currentState
        if (typeof selectMap !== 'object') return !!selectMap
        const value = selectMap[column]
        return typeof value === 'object' ? value : !!value
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
        /* - paranoia check - */
        const n = Math.trunc(context.parameter++)
        if (!isFinite(n) || n < 0)
            throw new Error('Invalid parameter index')
        return `param_${n}`
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
            columnID: context.currentState.columnID,
            repo: context.currentState.repo,
            selectMap: context.selectMap,
            and: true,
            not: false
        }, options ?? {})
        const { where } = context.currentState
        const BracketClass = opts.not ? NotBrackets : Brackets

        where(new BracketClass(qb => {
            const nextState: QueryState = {
                builder: qb,
                aliasID: opts.aliasID,
                columnID: opts.columnID,
                and: opts.and,
                where: opts.and
                    ? qb.andWhere.bind(qb)
                    : qb.orWhere.bind(qb),
                repo: opts.repo,
                selectMap: opts.selectMap
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
        this.selectField(context)

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
        const isJoinable = this.isColumnJoinable(context)

        if (mode === 'normal') {
            /**
             * First we need to find the associated column info.
             */

            if (!isJoinable && !isQuery) {
                throw new Error(`Column ${
                    this.getColumnName(context)
                } has no relational data`)
            }
        }

        /**
         * If there is no relational info for the column,
         * then let's just insert the operations or fields.
         */

        if (!isJoinable) {
            if (isQuery) this.insertOperations(context, obj as MongoQueryObject)
            else this.insertFields(context, obj as MongoFields)

            return
        }

        const repoType = this.getJoinableType(context)
        const nextRepo = repo.manager.getRepository(repoType)

        /**
         * Then we can perform a left-join of the column.
         * If alias is already joined, we don't need to join it again
         */

        const columnName = this.getColumnName(context)
        let nextAliasID = this.findAliasIDFor(context)
        if (nextAliasID < 0) {
            nextAliasID = this.createAliasFrom(context)
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
        }, {
            aliasID: nextAliasID,
            repo: nextRepo,
            columnID: null,
            selectMap: this.nextSelectMap(context, columnName),
        })
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
        const param     = this.getParamName(context)
        const columnID  = context.currentState.columnID
        let columnName: string = undefined

        switch (operator) {
        case '$and':
        case '$or':
        case '$not':
            if (!operand || typeof operand !== 'object')
                throw new Error(`Invalid operand for ${operator} operation`)
            break
        default: columnName = this.getColumnName(context); break
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
            }, { columnID, not: true })
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
     * `column` is validated when setColumn() or              *
     *          checkColumn() is called. checkColumn() may    *
     *          be overridden for more strict checks.         *
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
     *         with a paranoia check to ensure N is always    *
     *         numeric, finite, positive, and whole.          *
    \**********************************************************/
}
