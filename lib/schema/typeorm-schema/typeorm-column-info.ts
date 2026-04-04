import { Repository } from 'typeorm'
import { IColumnInfo, ITableInfo } from '../types'
import { ColumnUnion } from './types'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'
// circular import, but only used in getRelation, so should be fine
import { TypeOrmTableInfo } from './typeorm-table-info'

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

    isJsonColumn(): boolean {
        if (this.relation) return false
        const col = this.data as ColumnMetadata
        const type = col.type as string
        return type === 'json' || type === 'simple-json'
    }

    isIdentifier(): boolean {
        const SimpleColumnGrammar = /^[a-zA-Z_][a-zA-Z0-9_]*$/
        return SimpleColumnGrammar.test(this.data.propertyName)
    }
}
