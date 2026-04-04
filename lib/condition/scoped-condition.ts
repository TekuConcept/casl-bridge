import { BaseCondition, IBaseConditionData } from './base-condition'
import { ICondition, IScopedCondition, ScopeOp } from './types'

export interface IScopedConditionData extends IBaseConditionData {
    scope: ScopeOp
    join: boolean
    /** When `true`, this scope represents a JSON path traversal, not a DB join. */
    isJsonTraversal?: boolean
}

export class ScopedCondition
extends BaseCondition
implements IScopedCondition {
    readonly type = 'scoped'
    join: boolean
    scope: ScopeOp
    conditions: ICondition[]
    /**
     * When `true`, this scope was identified by {@link JsonPathAnnotator} as
     * a JSON path traversal.  The serializer skips the SQL JOIN and instead
     * relies on the `jsonColumn`/`jsonPath`/`jsonTableAlias` fields of the
     * leaf {@link PrimitiveCondition}s.
     */
    isJsonTraversal?: boolean

    constructor(values?: Partial<IScopedConditionData>) {
        super(values)

        values = values ?? {}
        const { scope, join, isJsonTraversal } = values
        this.scope = scope ?? ScopeOp.AND
        this.join = join ?? false
        this.conditions = []
        this.isJsonTraversal = isJsonTraversal
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
