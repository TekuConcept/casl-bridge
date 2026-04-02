import { BaseCondition } from './base-condition'
import { ILiteralCondition } from './types'

/**
 * A synthetic condition node representing a constant boolean value
 * (`true` or `false`).  It is inserted into the condition tree by the
 * `DepthLimiter` and simplified away before serialisation where
 * possible.  When it reaches the serialiser it is emitted as the
 * DB-agnostic SQL literal `(1=1)` (true) or `(1=0)` (false).
 */
export class LiteralCondition
extends BaseCondition
implements ILiteralCondition {
    readonly type = 'literal' as const
    readonly value: boolean

    constructor(value: boolean) {
        super({ traceName: value ? 'TRUE' : 'FALSE' })
        this.value = value
    }
}
