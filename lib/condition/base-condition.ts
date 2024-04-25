import { ICondition, IScopedCondition } from './types'

export interface IBaseConditionData {
    alias: string
    column: string
    parent: IScopedCondition
    /** Used to identify where in the tree this node exists */
    traceName: string
}

export abstract class BaseCondition implements ICondition {
    abstract readonly type: 'scoped' | 'primitive'

    protected _parent: IScopedCondition = null
    protected readonly _alias: string | null = null
    protected readonly _column: string | null = null
    protected readonly _traceName: string

    constructor(values?: Partial<IBaseConditionData>) {
        const { alias, column, parent, traceName } = values ?? {}

        this._column    = column    ?? null
        this._alias     = alias     ?? null
        this._parent    = parent    ?? null
        this._traceName = traceName ?? '?'
    }

    get parent(): IScopedCondition { return this._parent }
    set parent(value: IScopedCondition) { this._parent = value }

    get alias(): string {
        if (this._alias) return this._alias
        if (this.parent) return this.parent.alias

        const trace = this.trace()
        throw new Error(`Alias not set!\n\n${trace}`)
    }

    get column(): string {
        if (this._column) return this._column
        if (this.parent) return this.parent.column

        const trace = this.trace()
        throw new Error(`Column not found!\n\n${trace}`)
    }

    unlink(): void { this._parent = null }
    trace(): string {
        if (this.parent)
            return `${this.parent.trace()} > ${this._traceName}`
        else return `TRACE: ${this._traceName}`
    }
}
