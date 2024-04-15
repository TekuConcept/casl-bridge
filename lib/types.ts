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

export type FilterObject = MongoFields | MongoQueryObject

export type Selected = SelectMap | boolean | '*'
export interface SelectMap { [column: string]: Selected }

/**
 * The validation method to use when validating column names.
 */
export enum ColumnValidationMethod {
    /**
     * Validate column names with respect to repo schema. (default)
     */
    Table = 'Table',
    // TODO: Can these be implemented without repo dependency?
    // /**
    //  * Validate column names with respect to a
    //  * provided array of nested `columnNames`.
    //  */
    // Static = 'Static',
    // /**
    //  * Validate column names with respect to the general SQL
    //  * grammar rules. This is the least restrictive and should
    //  * be used with caution.
    //  * 
    //  * The match pattern is:
    //  * ```
    //  * /^[a-zA-Z_][a-zA-Z0-9_]*$/
    //  * ```
    //  */
    // Grammar = 'Grammar',
}

export interface QueryOptions {
    /**
     * Table alias to use in the query.
     * Defaults to `__table__`.
     */
    table?: string,
    /**
     * The action to check against the CASL rules.
     * eg `create`, `read`, `update`, etc.
     * 
     * Defaults to `manage`.
     */
    action?: string,
    /**
     * The subject to check against the CASL rules.
     * This can be a string, class instance, or other supported type.
     */
    subject: Subject,
    /**
     * An optional field to check against the CASL rules.
     */
    field?: string,
    /**
     * Selects the fields to include in the query result.
     * - `true` - includes all fields marked by CASL rules
     * - `'*'`  - includes all fields regardless of rules
     *            including any joined tables.
     *            NOTE: This does not auto-join tables.
     * - `SelectMap` - an object in the form of:
     *                 `{ field: true | SelectMap }`
     */
    select?: Selected,
    /**
     * Additional filters to apply to the query. Object
     * takes the form of a Mongo-style query object.
     * 
     * For example:
     * 
     * ```json
     * {
     *    "id": { "$ge": 1, "$lt": 10 },
     *    "field": "value"
     * }
     * ```
     */
    filters?: FilterObject,
    // /**
    //  * The validation method to use when validating column names.
    //  * Default is validation with respect to `Table` schemas.
    //  */
    // validation?: ColumnValidationMethod | (keyof typeof ColumnValidationMethod),
}

export interface InternalQueryOptions extends QueryOptions {
    selectAll: boolean
    subject: string // help with type checking
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
    selectMap: Selected
}

export interface QueryContext {
    // the incremental parameter index
    parameter: number
    // the alias of the current table
    table: string
    // the join function (left-join only or left-join-and-select)
    join: (...args: any[]) => any
    // the top-level query builder
    builder: SelectQueryBuilder<any>
    // the optional selected field
    field?: string
    // map of fields to select (true/false or nested map)
    selectMap: Selected
    // list of selected fields
    selected: Set<string>
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
    selectMap?: Selected
    repo?: Repository<any>
    and?: boolean
    not?: boolean
}
