
export enum ScopeOp {
    NOT,
    AND,
    OR,
}

export enum PrimOp {
    EMPTY_RESULT, // used to return no results
    EQUAL,
    NOT_EQUAL,
    GREATER_OR_EQUAL,
    GREATER_THAN,
    LESS_OR_EQUAL,
    LESS_THAN,
    IS,
    IS_NOT,
    IN,
    NOT_IN,
    LIKE,
    NOT_LIKE,
    ILIKE,
    NOT_ILIKE,
    REGEX,
    NOT_REGEX,
    IREGEX,
    NOT_IREGEX,
    BETWEEN,
    NOT_BETWEEN,
    SIZE,
}

export interface ICondition {
    readonly type: 'scoped' | 'primitive'
    readonly column: string | null
    readonly alias: string | null
    parent: IScopedCondition | null

    /**
     * Unlinks this condition from its parent.
     * This cleans up resources - avoiding memory leaks.
     */
    unlink(): void
    /** Pretty-print the condition stack */
    trace(): string
}

export type ConditionTree = ICondition

/**
 * Represents a bracketed condition.
 * For example: `(age > 18 AND age < 65)`
 */
export interface IScopedCondition extends ICondition {
    readonly type: 'scoped'
    join: boolean
    scope: ScopeOp
    conditions: ICondition[]
}

/**
 * Represents a simple primitive condition.
 * For example: `age > 18`
 */
export interface IPrimitiveCondition extends ICondition {
    readonly type: 'primitive'
    operator: PrimOp
    operand: any // parameterized value
}

export interface IQuery {
    isEmpty(): boolean
    /**
     * Generate a condition tree from the query.
     * @param alias The base table alias to use for the query.
     */
    build(alias?: string): ConditionTree
}
