import { BaseCondition, IBaseConditionData } from './base-condition'
import { IPrimitiveCondition, PrimOp } from './types'

export interface IPrimitiveConditionData extends IBaseConditionData {
    operator: PrimOp
    operand: any
    /** JSON column name when this condition targets a JSON sub-path. */
    jsonColumn?: string
    /** Dot-separated JSON sub-path (e.g. `'library.isbn'`). */
    jsonPath?: string
    /**
     * Alias of the table that owns the JSON column.
     * Set by {@link JsonPathAnnotator} when a JSON column is detected.
     */
    jsonTableAlias?: string
}

export class PrimitiveCondition
extends BaseCondition
implements IPrimitiveCondition {
    readonly type = 'primitive'
    operator: PrimOp
    operand: any
    /** JSON column name when this condition targets a JSON sub-path. */
    jsonColumn?: string
    /** Dot-separated JSON sub-path (e.g. `'library.isbn'`). */
    jsonPath?: string
    /**
     * Alias of the table that owns the JSON column.
     * Set by {@link JsonPathAnnotator} when a JSON column is detected.
     */
    jsonTableAlias?: string

    constructor(values?: Partial<IPrimitiveConditionData>) {
        super(values)

        values = values ?? {}
        const { operator, operand, jsonColumn, jsonPath, jsonTableAlias } = values
        this.operator = operator ?? PrimOp.EQUAL
        this.operand = 'operand' in values ? operand : 0
        this.jsonColumn = jsonColumn
        this.jsonPath = jsonPath
        this.jsonTableAlias = jsonTableAlias
    }
}
