import { BaseCondition, IBaseConditionData } from './base-condition'
import { IPrimitiveCondition, PrimOp } from './types'

export interface IPrimitiveConditionData extends IBaseConditionData {
    operator: PrimOp
    operand: any
}

export class PrimitiveCondition
extends BaseCondition
implements IPrimitiveCondition {
    readonly type = 'primitive'
    operator: PrimOp
    operand: any

    constructor(values?: Partial<IPrimitiveConditionData>) {
        super(values)

        values = values ?? {}
        const { operator, operand } = values
        this.operator = operator ?? PrimOp.EQUAL
        this.operand = 'operand' in values ? operand : 0
    }
}
