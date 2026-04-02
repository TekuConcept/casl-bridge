import {
    AbilityBuilder,
    AbilityTuple,
    ExtractSubjectType,
    MongoAbility,
    MongoQuery,
    Subject,
    SubjectRawRule
} from '@casl/ability'
import { SelectPattern } from './serializer/types'
import { MongoQueryObjects } from './condition'

export type CaslRule = SubjectRawRule<
    string, ExtractSubjectType<Subject>, MongoQuery
>
export type CaslGate = MongoAbility<AbilityTuple, MongoQuery>
export type CaslGateBuilder = AbilityBuilder<CaslGate>

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
    subject: ExtractSubjectType<Subject>,
    /**
     * An optional field to check against the CASL rules.
     */
    field?: string,
    /**
     * The select pattern to use.
     *     '-'        - select only fields in the query
     *     '*'        - select all non-relational fields
     *     '**'       - select all fields including relational fields
     *     SelectList - select specific fields
     *                  `[ 'id', 'title', ['author', [ 'id', 'name' ]] ]`
     *     object     - select specific fields using keys of an object
     *                  `{ id: 1, title: 1, author: { id: 1, name: 1 } }`
     */
    select?: SelectPattern,
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
    filters?: MongoQueryObjects,
    /**
     * @deprecated
     * Whether to use strict validation for column names.
     * Only alpha-numeric column names matching the pattern
     * `/^[a-zA-Z_][a-zA-Z0-9_]*$/` will be allowed
     * regardless of the database schema. Default is `true`.
     */
    strict?: boolean,
}
