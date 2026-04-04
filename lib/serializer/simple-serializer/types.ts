import { IBrackets, IQueryBuilder, ITableInfo } from '@/schema'

export interface ScopeInfo {
    shared: { counter: number }
    table: ITableInfo
    builder: IQueryBuilder
    where: (
        condition: string | IBrackets,
        parameters?: object
    ) => IQueryBuilder
}
