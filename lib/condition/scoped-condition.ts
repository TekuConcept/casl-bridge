import { BaseCondition, IBaseConditionData } from './base-condition'
import { ICondition, IScopedCondition, ScopeOp } from './types'

export interface IScopedConditionData extends IBaseConditionData {
    scope: ScopeOp
    join: boolean
}

export class ScopedCondition
extends BaseCondition
implements IScopedCondition {
    readonly type = 'scoped'
    join: boolean
    scope: ScopeOp
    conditions: ICondition[]

    constructor(values?: Partial<IScopedConditionData>) {
        super(values)

        values = values ?? {}
        const { scope, join } = values
        this.scope = scope ?? ScopeOp.AND
        this.join = join ?? false
        this.conditions = []
    }

    /** Appends a new condition to this scope */
    push(condition: ICondition): void {
        condition.parent = this
        this.conditions.push(condition)
    }

    /** Removes all conditions in this scope, unlinking them */
    clear(): void {
        this.conditions.forEach(condition => condition.unlink())
        this.conditions = []
    }

    /** Call this to cleanup - avoid memory leaks */
    unlink(): void {
        this.clear()
        super.unlink()
    }
}
