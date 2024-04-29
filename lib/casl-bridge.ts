import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import { Rule } from '@casl/ability/dist/types/Rule'
import {
    AbilityBuilder,
    AnyAbility,
    SubjectType,
    createMongoAbility
} from '@casl/ability'
import { CaslGate, QueryOptions } from './types'
import { SelectPattern } from './serializer/types'
import {
    MongoQuery,
    MongoQueryObject,
    MongoQueryObjects,
} from './condition'
import { TypeOrmQueryBuilder, TypeOrmTableInfo } from './schema'
import { SimpleSerializer } from './serializer/simple-serializer'

export type FilterObject = MongoQueryObjects

export class CaslBridge {
    casl: CaslGate

    constructor(
        // TODO: replace with generics for multi-ORM support
        /** The (TypeORM) ORM source */
        public readonly manager: DataSource | EntityManager,
        /** (Optional) pre-built casl ability */
        casl?: CaslGate,
        /**
         * @deprecated
         * Whether to escape quote chars and encode aliases.
         * Default is `false`.
         */
        public strict = false,
    ) {
        if (casl) this.casl = casl
        else {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('manage', 'all')
            this.casl = builder.build()
        }
    }

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param field The (optional) field to select. Default is all fields.
     *     This will override the `select` parameter.
     * @param selectPatten The select pattern to use.
     *     '-'        - select only fields in the query
     *     '*'        - select all non-relational fields
     *     '**'       - select all fields including relational fields
     *     SelectList - select specific fields
     *                  `[ 'id', 'title', ['author', [ 'id', 'name' ]] ]`
     *     object     - select specific fields using keys of an object
     *                  `{ id: 1, title: 1, author: { id: 1, name: 1 } }`
     * @param filters Any additional filters to include.
     * @returns The (TypeORM) query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType,
        field: string,
        selectPattern: SelectPattern,
        filters: FilterObject
    ): SelectQueryBuilder<any>;

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param selectPatten The select pattern to use.
     *     '-'        - select only fields in the query
     *     '*'        - select all non-relational fields
     *     '**'       - select all fields including relational fields
     *     SelectList - select specific fields
     *                  `[ 'id', 'title', ['author', [ 'id', 'name' ]] ]`
     *     object     - select specific fields using keys of an object
     *                  `{ id: 1, title: 1, author: { id: 1, name: 1 } }`
     * @param filters Any additional filters to include.
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType,
        selectPattern: SelectPattern,
        filters: FilterObject
    ): SelectQueryBuilder<any>;

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param selectPatten The select pattern to use.
     *     '-'        - select only fields in the query
     *     '*'        - select all non-relational fields
     *     '**'       - select all fields including relational fields
     *     SelectList - select specific fields
     *                  `[ 'id', 'title', ['author', [ 'id', 'name' ]] ]`
     *     object     - select specific fields using keys of an object
     *                  `{ id: 1, title: 1, author: { id: 1, name: 1 } }`
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        action: string,
        subject: SubjectType,
        selectPatten: SelectPattern
    ): SelectQueryBuilder<any>;

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param action The permissible action, eg `read`, `update`, etc.
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param field The (optional) field to select. Default is all fields.
     *     This will override the `select` parameter.
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

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to the CASL rules for the given action. It is
     * the caller's responsibility to execute the query.
     * 
     * @param options Options to use for this query.
     * @returns The TypeORM query builder instance.
     */
    createQueryTo(
        options: QueryOptions
    ): SelectQueryBuilder<any>;

    createQueryTo(
        ...args: any[]
    ): SelectQueryBuilder<any> {
        const options = this.getOptions(...args)

        const table = TypeOrmTableInfo.createFrom(
            this.manager, options.subject)
        const serializer = new SimpleSerializer(table)

        const caslQuery = this.rulesToQuery(
            this.casl,
            options.action,
            options.subject,
            options.field
        )

        const mongoQuery = new MongoQuery(caslQuery)
        const tree = mongoQuery.build(options.table)
        const query = serializer.serialize(tree)

        if (options.filters) {
            const filterQuery = new MongoQuery(options.filters)
            const filterTree = filterQuery.build(options.table)
            serializer.serializeWith(query, filterTree)
            filterTree.unlink()
        }

        serializer.select(query, tree, options.select)
        tree.unlink()
        return query.data
    }

    /**
     * Creates a new TypeORM query builder and sets up the query
     * with respect to filter rules for the given subject. It is
     * the caller's responsibility to execute the query.
     * 
     * @param subject The subject type to query, eg `Book`, `Author`, etc.
     * @param selectPatten The select pattern to use.
     *     '-'        - select only fields in the query
     *     '*'        - select all non-relational fields
     *     '**'       - select all fields including relational fields
     *     SelectList - select specific fields
     *                  `[ 'id', 'title', ['author', [ 'id', 'name' ]] ]`
     *     object     - select specific fields using keys of an object
     *                  `{ id: 1, title: 1, author: { id: 1, name: 1 } }`
     * @param filters Filters to apply to the query.
     * @param alias The table alias to use in the query. Default is `__table__`.
     */
    createFilterFor(
        subject: SubjectType,
        filters: FilterObject,
        selectPatten: SelectPattern = '*',
        alias = '__table__'
    ): SelectQueryBuilder<any> {
        const table = TypeOrmTableInfo.createFrom(
            this.manager, subject)
        const serializer = new SimpleSerializer(table)

        const filterQuery = new MongoQuery(filters ?? {})
        const filterTree = filterQuery.build(alias)

        const query = serializer.serialize(filterTree)
        serializer.select(query, filterTree, selectPatten)
        filterTree.unlink()

        return query.data
    }

    /**
     * @experimental - API and functionality may change
     * 
     * Applies the given filters to an existing query builder.
     * 
     * For example, suppose a query exists for Books,
     * and now we want to filter by Author:
     * 
     * ```typescript
     * const query = repo
     *     .createQueryBuilder('book')
     *     .leftJoinAndSelect('book.author', 'author')
     *     .where('book.genre = :genre', { genre: 'fantasy' })
     * 
     * bridge.applyFilterTo(query, 'author', { name: 'Tolkien' })
     * ```
     * 
     * @param query The ORM query builder to apply the filter to.
     * @param aliasName The target join alias used in the query.
     * @param filters Filters to apply to the query.
     * @returns The modified query builder.
     */
    applyFilterTo(
        query: SelectQueryBuilder<any>,
        aliasName: string,
        filters: FilterObject,
    ): SelectQueryBuilder<any> {
        if (!filters) return query

        const alias = query.expressionMap.findAliasByName(aliasName)

        const table = TypeOrmTableInfo.createFrom(
            this.manager, alias.target)
        const serializer = new SimpleSerializer(table)
        const filterQuery = new MongoQuery(filters)
        const filterTree = filterQuery.build(aliasName)

        const join = query.leftJoin.bind(query)
        const queryBuilder = new TypeOrmQueryBuilder(
            query,
            join,
            () => {},
            query.expressionMap.parameters
        )

        serializer.serializeWith(queryBuilder, filterTree)
        filterTree.unlink()

        return query
    }

    /**
     * Makes sure the options are valid and normalized.
     */
    private checkOptions(options: QueryOptions) {
        if (!options.subject)
            throw new Error('Subject type is required')

        // For now, parameterized table names are not allowed.
        // Names must be alphanumeric with underscores only.
        // const SimpleColumnGrammar = /^[a-zA-Z_][a-zA-Z0-9_]*$/
        // if (!SimpleColumnGrammar.test(options.table))
        //     throw new Error(`Invalid table name: ${options.table}`)

        if (typeof options.filters !== 'object' ||
            options.filters === null)
            options.filters = undefined

        if (typeof options.field !== 'string')
            options.field = undefined
        else options.select = [ options.field ]

        if (typeof options.select === 'string') {
            const allowed = [ '-', '*', '**' ]
            if (!allowed.includes(options.select))
                options.select = '*'
        } else if (typeof options.select !== 'object' ||
            options.select === null)
            options.select = '*'

        return options
    }

    private getOptions(...args: any[]): QueryOptions {
        let options: QueryOptions = {
            table: '__table__',
            action: 'manage',
            subject: '',
            field: undefined,
            select: '*',
            filters: undefined,
        }

        if (typeof args[0] === 'object' && args[0] !== null) {
            options = Object.assign(options, args[0])
            return this.checkOptions(options)
        }

        options.action  = args[0] ?? 'manage'
        options.subject = args[1]

        if ((typeof args[2] === 'object' && args[2] !== null) ||
            args[2] === '*' || args[2] === '**' || args[2] === '-'
        ) {
            options.select  = args[2]
            options.filters = args[3]
        } else {
            options.field   = args[2]
            options.select  = args[3]
            options.filters = args[4]
        }

        return this.checkOptions(options)
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
}
