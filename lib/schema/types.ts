
/** Return true to 'break' */
export type ColumnIteratorCallback =
    (column: IColumnInfo) => boolean | null | undefined | void

export interface ITableInfo {
    data: any

    hasColumn(name: string): boolean
    getColumn(name: string): IColumnInfo | null
    forEach(callback: ColumnIteratorCallback): void
    quotedName(name: string): string

    classType(): string

    createQueryBuilder(alias: string): IQueryBuilder
}

export interface IColumnInfo {
    data: any

    getName(): string
    getQuotedName(name?: string): string
    getRelation(): ITableInfo | null

    isJoinable(): boolean
    isIdentifier(name: string): boolean
}

export interface IBrackets {
    data: any
}

export type BracketsCallback = (builder: IQueryBuilder) => void

export interface IQueryBuilder {
    data: any

    nextParamId(): number

    join(relation: string, alias: string): IQueryBuilder
    select(columns: string[]): IQueryBuilder

    where(condition: string | IBrackets, parameters?: object): IQueryBuilder
    andWhere(condition: string | IBrackets, parameters?: object): IQueryBuilder
    orWhere(condition: string | IBrackets, parameters?: object): IQueryBuilder

    createBrackets(callback: BracketsCallback): IBrackets
    createNotBrackets(callback: BracketsCallback): IBrackets
}
