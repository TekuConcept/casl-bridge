import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import { Rule } from '@casl/ability'
import {
    AbilityBuilder,
    AnyAbility,
    SubjectType,
    createMongoAbility
} from '@casl/ability'
import { CaslGate, FilterOptions, QueryOptions } from './types'
import { SelectPattern } from './serializer/types'
import {
    MongoQuery,
    MongoQueryObject,
    MongoQueryObjects,
} from './condition'
import {
    DepthLimiter,
    PathPolicyEnforcer,
    RelationIdRewriter,
    RelationMetaProvider,
    TreeMerger,
} from './passes'
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
        casl?: CaslGate | null,
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
        const caslTree = mongoQuery.build(options.table)

        let combined = caslTree
        if (options.filters) {
            const filterTree = this.compileExternalFilterTree(
                options.filters,
                options.table,
                options.filterOptions,
                table,
            )
            combined = TreeMerger.merge(caslTree, filterTree).tree as typeof caslTree
            filterTree.unlink()  // empty shell after merge — cleanup
        }

        const query = serializer.serialize(
            combined, options.filterOptions?.joinType ?? 'left')

        serializer.select(query, combined, options.select)
        combined.unlink()
        if (combined !== caslTree) caslTree.unlink()
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
        filters: FilterObject | null,
        selectPatten: SelectPattern = '*',
        alias = '__table__',
        filterOptions?: FilterOptions | null,
    ): SelectQueryBuilder<any> {
        const table = TypeOrmTableInfo.createFrom(
            this.manager, subject)
        const serializer = new SimpleSerializer(table)

        const filterTree = this.compileExternalFilterTree(
            filters ?? {},
            alias,
            filterOptions,
            table,
        )

        const query = serializer.serialize(
            filterTree, filterOptions?.joinType ?? 'left')
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
        filters: FilterObject | null,
        filterOptions?: FilterOptions | null,
    ): SelectQueryBuilder<any> {
        if (!filters) return query

        const alias = query.expressionMap.findAliasByName(aliasName)

        const table = TypeOrmTableInfo.createFrom(
            this.manager, alias.target)
        const serializer = new SimpleSerializer(table)
        const filterTree = this.compileExternalFilterTree(
            filters,
            aliasName,
            filterOptions,
            table,
        )

        const join = TypeOrmTableInfo.createJoinFunction(
            query, filterOptions?.joinType ?? 'left')
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
     * Builds a ConditionTree from an external filter object and
     * applies any depth limiting specified in `filterOptions`.
     *
     * This is the single internal entry point for constructing
     * external filter trees.  CASL ability trees bypass this method
     * entirely and are therefore unaffected by `maxDepth` or the
     * relation-ID rewrite optimisation.
     *
     * @param filters       The raw Mongo-style filter object.
     * @param alias         The table alias to use in the tree.
     * @param filterOptions Options controlling depth limiting and
     *                      violation behaviour.
     * @param tableInfo     TypeORM table info for the root entity; when
     *                      provided the relation-ID rewrite pass is
     *                      applied to eliminate unnecessary JOINs.
     */
    private compileExternalFilterTree(
        filters: MongoQueryObjects,
        alias: string,
        filterOptions?: FilterOptions | null,
        tableInfo?: TypeOrmTableInfo | null,
    ) {
        const filterQuery = new MongoQuery(filters)
        let tree = filterQuery.build(alias)

        if (filterOptions?.maxDepth !== undefined) {
            const limiter = new DepthLimiter(
                filterOptions.maxDepth,
                filterOptions.onViolation ?? 'throw',
            )
            tree = limiter.apply(tree).tree
        }

        if (filterOptions?.pathPolicy !== undefined) {
            const enforcer = new PathPolicyEnforcer(
                filterOptions.pathPolicy,
                filterOptions.onViolation ?? 'throw',
            )
            tree = enforcer.apply(tree).tree
        }

        if (tableInfo) {
            const provider = this.makeRelationMetaProvider(tableInfo)
            const rewriter = new RelationIdRewriter(provider)
            tree = rewriter.apply(tree).tree
        }

        return tree
    }

    /**
     * Builds a {@link RelationMetaProvider} that resolves FK metadata
     * from TypeORM entity metadata for the given table.
     *
     * Returns `null` for:
     * - Relations not found on the entity.
     * - Inverse/non-owning sides of relations (no `joinColumns`).
     * - Many-to-many relations (join table, no direct FK on entity).
     * - Relations with missing column/referenced-column metadata.
     */
    private makeRelationMetaProvider(table: TypeOrmTableInfo): RelationMetaProvider {
        return (relationProperty: string): ReturnType<RelationMetaProvider> => {
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
                // pkProp: PK property name on the target entity (e.g. 'id' or 'code')
                const pkProp = jc.referencedColumn.propertyName
                // fkPropertyName: owning-side property name that TypeORM uses to
                // construct the column reference in raw SQL (e.g. 'author', 'primaryTag').
                // TypeORM translates this unquoted property path to the actual DB
                // column name (e.g. 'authorId', 'tagCode') when compiling the query.
                const fkPropertyName = jc.propertyName
                // Only include if the FK property actually lives on the owning entity.
                // This filters out many-to-many join-table columns (e.g. `author_id`
                // is in the join table, not on Author itself).
                if (pkProp && fkPropertyName && table.hasColumn(fkPropertyName)) {
                    fkMapping[pkProp] = fkPropertyName
                }
            }
            if (Object.keys(fkMapping).length === 0) return null

            // Build a provider for the target entity (enables recursive rewrite).
            const targetRepo  = table.data.manager.getRepository(relation.type)
            const targetTable = new TypeOrmTableInfo(targetRepo)
            const childProvider = this.makeRelationMetaProvider(targetTable)

            return { fkMapping, childProvider }
        }
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
