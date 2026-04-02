import {
    Brackets,
    DataSource,
    EntityManager,
    NotBrackets,
    Repository,
    SelectQueryBuilder,
    WhereExpressionBuilder
} from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata'
import {
    ITableInfo,
    IColumnInfo,
    IBrackets,
    IQueryBuilder,
    BracketsCallback,
    ColumnIteratorCallback
} from './types'

type ColumnUnion = ColumnMetadata | RelationMetadata

/** Wraps a TypeORM repo object */
export class TypeOrmTableInfo implements ITableInfo {
    /**
     * TypeORM automatically quotes all named fields.
     * However, it assumes the developer is using best
     * naming practices, so it will not work properly
     * if quote chars in column names are not already
     * doubled-up.
     * 
     * That being said, when `extraStrict` is set to
     * true, getQuotedName will double-up quote chars
     * as need in column names.
     * 
     * REMINDER: This is a global flag.
     */
    static extraStrict: boolean = false

    constructor(public readonly data: Repository<any>) {}

    hasColumn(name: string): boolean {
        const isColumn = this.data.metadata.columns
            .find(column => column.propertyName === name) !== undefined
        const isRelation = this.data.metadata.relations
            .find(relation => relation.propertyName === name) !== undefined
        return isColumn || isRelation
    }

    getColumn(name: string): IColumnInfo | null {
        // TODO: [cache] map column names to column objects
        let columnMetadata: ColumnUnion = this.data.metadata.columns
            .find(column => column.propertyName === name)
        let relationMetadata =
            (columnMetadata as ColumnMetadata)?.relationMetadata ?? null

        if (!columnMetadata) {
            relationMetadata = this.data.metadata.relations
                .find(relation => relation.propertyName === name)
            columnMetadata = relationMetadata
        }

        let repo: Repository<any> | null = null
        if (relationMetadata) {
            let type = relationMetadata.type // string or class
            repo = this.data.manager.getRepository(type)
        }

        return columnMetadata ? new TypeOrmColumnInfo(
            columnMetadata,
            this.quotedName.bind(this),
            repo
        ) : null
    }

    forEach(callback: ColumnIteratorCallback): void {
        for (let i = 0; i < this.data.metadata.columns.length; i++) {
            const column = this.data.metadata.columns[i]

            // leave relations for next loop
            if (column.relationMetadata) continue

            const breaking = callback(
                new TypeOrmColumnInfo(column, this.quotedName.bind(this))
            )

            if (breaking) return
        }

        for (let i = 0; i < this.data.metadata.relations.length; i++) {
            const relation = this.data.metadata.relations[i]
            const breaking = callback(
                new TypeOrmColumnInfo(
                    relation,
                    this.quotedName.bind(this),
                    this.data.manager.getRepository(relation.type)
                )
            )

            if (breaking) return
        }
    }

    classType(): string { return this.data.metadata.targetName }

    quotedName(name: string): string {
        let result = name
        let left: string = '"'
        let right: string = '"'

        const quoteChars = this.getQuoteChars()

        if (TypeOrmTableInfo.extraStrict) {
            quoteChars.forEach(c => {
                // checks if a character is by itself - no
                // character is like it before or after
                const regex = new RegExp(`(?<!\\${c})\\${c}(?!\\${c})`, 'g')
                result = result.replace(regex, `${c}${c}`)
            })
        }

        if (quoteChars.length === 2) {
            left = quoteChars[0]
            right = quoteChars[1]
            // paranoia check - make sure left and right are unique
            if (left === right)
                throw new Error('Unexpected quote characters')
        } else if (quoteChars.length === 1)
            left = right = quoteChars[0]
        else throw new Error('Unexpected quote characters')

        // return `${left}${result}${right}`

        // ----------------------------------------------------------
        // IMPORTANT NOTE:
        // ----------------------------------------------------------
        // TypeORM does not fully support quoted column names, and
        // the way it handles them isn't very safe or reliable.
        //
        // Please use alphanumeric characters and underscores in
        // your column names to avoid any issues with TypeORM...
        // ...or use a better ORM!
        // ----------------------------------------------------------
        return result
    }

    getQuoteChars(): string[] {
        const databaseType = this.data.manager.connection.options.type

        switch (databaseType) {
        case 'mysql':
        case 'aurora-mysql':
        case 'mariadb': return ['`']
        case 'sqljs':
        case 'sqlite':
        case 'better-sqlite3':
        case 'postgres':
        case 'aurora-postgres':
        case 'oracle': return ['"']
        case 'mssql': return ['[', ']']
        default: throw new Error(`${databaseType} not supported`)
        }
    }

    createQueryBuilder(alias: string): TypeOrmSelectQueryBuilder {
        const queryBuilder = this.data.createQueryBuilder(alias)
        const join = TypeOrmTableInfo.createJoinFunction(queryBuilder)
        const select = queryBuilder.select.bind(queryBuilder)

        return new TypeOrmSelectQueryBuilder(
            queryBuilder,
            join,
            select,
            queryBuilder.expressionMap.parameters
        )
    }

    static createFrom(
        source: DataSource | EntityManager,
        table: any
    ): TypeOrmTableInfo {
        const repo = source.getRepository(table)
        return new TypeOrmTableInfo(repo)
    }

    /**
     * Creates a wrapped join function for a TypeORM query builder.
     * The new join function will only join a relation once.
     */
    static createJoinFunction(
        query: SelectQueryBuilder<any>,
        direction: 'inner' | 'left' = 'left'
    ): JoinFunction {
        const join = direction === 'inner'
            ? query.innerJoin.bind(query)
            : query.leftJoin.bind(query)

        return (relation: string, alias: string) => {
            const attr = query.expressionMap.joinAttributes.find(j => {
                return j.entityOrProperty === relation
            })
            if (!attr) join(relation, alias)
        }
    }
}

/** Wraps a TypeORM column object */
export class TypeOrmColumnInfo implements IColumnInfo {
    constructor(
        readonly data: ColumnUnion,
        readonly quoteName: (name: string) => string,
        readonly relation: Repository<any> | null = null
    ) {}

    getName(): string { return this.data.propertyName }

    getQuotedName(name?: string): string {
        return name
            ? this.quoteName(name)
            : this.quoteName(this.data.propertyName)
    }

    getRelation(): ITableInfo | null {
        // TODO: [cache] relation objects
        return this.relation ? new TypeOrmTableInfo(this.relation) : null
    }

    isJoinable(): boolean { return !!this.relation }

    isIdentifier(): boolean {
        const SimpleColumnGrammar = /^[a-zA-Z_][a-zA-Z0-9_]*$/
        return SimpleColumnGrammar.test(this.data.propertyName)
    }
}

export class TypeOrmBrackets implements IBrackets {
    constructor(public readonly data: Brackets) {}
}

type JoinFunction = (relation: string, alias: string) => void
type SelectFunction = (columns: string[]) => void

/** Wraps a TypeORM query builder object */
export class TypeOrmQueryBuilder implements IQueryBuilder {
    constructor(
        public readonly data: WhereExpressionBuilder,
        private readonly _join: JoinFunction,
        private readonly _select: SelectFunction,
        private readonly _params: object = {}
    ) {}

    /**
     * This helps to generate unique parameter names.
     * Each key in the `_params` object is a parameter
     * name that has already been added to the builder.
     */
    nextParamId(): number {
        const pattern = /^param_(\d+)$/
        const keys = Object
            .keys(this._params)
            .filter(k => pattern.test(k))
            .sort()
        if (keys.length === 0) return 0
        return parseInt(keys[keys.length - 1].match(pattern)![1]) + 1
    }

    join(relation: string, alias: string): TypeOrmQueryBuilder {
        this._join(relation, alias)
        return this
    }

    select(columns: string[]): TypeOrmQueryBuilder {
        this._select(columns)
        return this
    }

    where(
        condition: string | IBrackets,
        parameters?: object
    ): TypeOrmQueryBuilder {
        if (typeof condition === 'string')
            this.data.where(condition, parameters)
        else this.data.where(condition.data, parameters)
        return this
    }

    andWhere(
        condition: string | IBrackets,
        parameters?: object
    ): TypeOrmQueryBuilder {
        if (typeof condition === 'string')
            this.data.andWhere(condition, parameters)
        else this.data.andWhere(condition.data, parameters)
        return this
    }

    orWhere(
        condition: string | IBrackets,
        parameters?: object
    ): TypeOrmQueryBuilder {
        if (typeof condition === 'string')
            this.data.orWhere(condition, parameters)
        else this.data.orWhere(condition.data, parameters)
        return this
    }

    createBrackets(callback: BracketsCallback): TypeOrmBrackets {
        const brackets = new Brackets(qb => {
            const builder = new TypeOrmQueryBuilder(
                qb,
                this._join,
                this._select,
                this._params
            )
            callback(builder)
        })

        return new TypeOrmBrackets(brackets)
    }

    createNotBrackets(callback: BracketsCallback): TypeOrmBrackets {
        const brackets = new NotBrackets(qb => {
            const builder = new TypeOrmQueryBuilder(
                qb,
                this._join,
                this._select,
                this._params
            )
            callback(builder)
        })

        return new TypeOrmBrackets(brackets)
    }
}

export class TypeOrmSelectQueryBuilder extends TypeOrmQueryBuilder {
    declare data: SelectQueryBuilder<any>
}
