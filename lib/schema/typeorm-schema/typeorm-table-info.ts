import {
    DataSource,
    EntityManager,
    Repository,
    SelectQueryBuilder,
} from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'
import {
    ITableInfo,
    IColumnInfo,
    ColumnIteratorCallback
} from '../types'
import { ColumnUnion, JoinFunction } from './types'
import { TypeOrmColumnInfo } from './typeorm-column-info'
import { TypeOrmSelectQueryBuilder } from './typeorm-select-query-builder'

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

    /** Returns the database dialect (e.g. `'better-sqlite3'`, `'mysql'`). */
    getDialectType(): string {
        return this.data.manager.connection.options.type as string
    }

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

    createQueryBuilder(alias: string, direction?: 'left' | 'inner'): TypeOrmSelectQueryBuilder {
        const queryBuilder = this.data.createQueryBuilder(alias)
        const join = TypeOrmTableInfo.createJoinFunction(queryBuilder, direction)
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
