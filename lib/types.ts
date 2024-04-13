import {
    AbilityBuilder,
    AbilityTuple,
    ExtractSubjectType,
    MongoAbility,
    MongoQuery,
    Subject,
    SubjectRawRule
} from '@casl/ability'
import {
    Brackets,
    ObjectLiteral,
    Repository,
    SelectQueryBuilder,
    WhereExpressionBuilder
} from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'

export type CaslRule = SubjectRawRule<
    string, ExtractSubjectType<Subject>, MongoQuery
>
export type CaslGate = MongoAbility<AbilityTuple, MongoQuery>
export type CaslGateBuilder = AbilityBuilder<CaslGate>

export type Primitive =
    object |
    string |
    number |
    boolean |
    null |
    undefined |
    Date

export interface MongoFields {
    [key: string]: MongoQueryObject | Primitive
}

export interface MongoQueryObject {
    '$eq'?: Primitive
    '$ne'?: Primitive
    '$gte'?: Primitive
    '$gt'?: Primitive
    '$lte'?: Primitive
    '$lt'?: Primitive
    '$not'?: MongoFields
    '$is'?: null
    '$isNot'?: null
    '$in'?: Primitive[]
    '$notIn'?: Primitive[]
    '$like'?: string
    '$notLike'?: string
    '$iLike'?: string
    '$notILike'?: string
    '$regex'?: string
    '$regexp'?: string
    '$notRegex'?: string
    '$notRegexp'?: string
    '$iRegexp'?: string
    '$notIRegexp'?: string
    '$between'?: [Primitive, Primitive]
    '$notBetween'?: [Primitive, Primitive]
    '$and'?: MongoFields | MongoFields[]
    '$or'?: MongoFields | MongoFields[]
    '$size'?: number
}

export interface QueryState {
    builder: WhereExpressionBuilder
    and: boolean // is is andWhere or orWhere
    where: (
        where: string | Brackets,
        parameters?: ObjectLiteral
    ) => WhereExpressionBuilder
    aliasID: number
    columnID?: number
    repo: Repository<any>
}

export interface QueryContext {
    // the incremental parameter index
    parameter: number
    // the alias of the current table
    table: string
    // the join function (left-join only or left-join-and-select)
    join: (...args: any[]) => any
    // the full mongodb query object
    mongoQuery: MongoQueryObject
    // the top-level query builder
    builder: SelectQueryBuilder<any>
    // the optional selected field
    field?: string
    // the list of aliases created and validated
    aliases: string[]
    // the list of validated columns
    columns: ColumnMetadata[]
    // the bracketed query stack
    stack: QueryState[]
    // the current query state
    // NOTE: use context.join() to join tables
    currentState: QueryState
}

export type ScopedCallback = (
    context: QueryContext,
    builder: WhereExpressionBuilder
) => void

export interface ScopedOptions {
    aliasID?: number
    columnID?: number
    repo?: Repository<any>
    and?: boolean
    not?: boolean
}
