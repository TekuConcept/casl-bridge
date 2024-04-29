import { IQueryBuilder } from '../schema'
import { ConditionTree } from '../condition'

export type SelectField = string | SelectPattern
export type SelectList = SelectField[]
export type SelectTuple = [string, SelectList]

/**
 * For example:
 * 
 * ```json
 * [
 *    'id',
 *    'title',
 *    [ 'author', [ 'id', 'name' ] ],
 * ]
 * ```
 * 
 * Or as a shorthand:
 * ```json
 * [ 'id', 'title', 'author' ]
 * ```
 * 
 * Or an even shorter shorthand:
 * ```json
 * '**'
 * ```
 * 
 * Unrecognized fields are ignored.
 */
export type SelectPattern =
    '-'  | // select only fields in the query
    '*'  | // select all top-level fields
    '**' | // select all fields including nested fields
    SelectList | // select specific fields
    object // select specific fields using keys of an object

export interface ISerializer {
    /**
     * Builds a query from the given condition and all its children.
     */
    serialize(query: ConditionTree): IQueryBuilder

    /**
     * Builds a query from the given condition and all its children.
     */
    serializeWith(
        builder: IQueryBuilder,
        query: ConditionTree,
    ): IQueryBuilder

    /**
     * Applies a select pattern to the query builder.
     */
    select(
        builder: IQueryBuilder,
        query: ConditionTree,
        pattern: SelectPattern,
    ): IQueryBuilder
}
