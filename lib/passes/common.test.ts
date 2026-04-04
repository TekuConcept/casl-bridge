import {
    LiteralCondition,
    PrimitiveCondition,
    PrimOp,
    ScopedCondition,
    ScopeOp,
} from '@/condition'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirror depth-limiter.spec.ts conventions)
// ─────────────────────────────────────────────────────────────────────────────

/** Build a root AND scope that wraps the given child conditions. */
export function root(
    alias: string = '__root__',
    ...children: (ScopedCondition | PrimitiveCondition | LiteralCondition)[]
): ScopedCondition {
    const r = new ScopedCondition({ alias, scope: ScopeOp.AND })
    children.forEach(c => r.push(c))
    return r
}

/** Build a join scope (relation hop). */
export function joinScope(
    column: string,
    parentAlias: string,
    scope = ScopeOp.AND,
): ScopedCondition {
    const alias = `${parentAlias}_${column}`
    return new ScopedCondition({ column, alias, scope, join: true })
}

/** Build a non-join AND scope. */
export function andScopeAlias(alias?: string): ScopedCondition {
    return new ScopedCondition({ alias, scope: ScopeOp.AND })
}
export function andScopeColumn(column?: string): ScopedCondition {
    return new ScopedCondition({ scope: ScopeOp.AND, column: column ?? null })
}
export function andScope(...children: any[]): ScopedCondition {
    const s = new ScopedCondition({ scope: ScopeOp.AND })
    children.forEach(c => s.push(c))
    return s
}

/** Build a non-join OR scope. */
export function orScopeAlias(alias?: string): ScopedCondition {
    return new ScopedCondition({ alias, scope: ScopeOp.OR })
}
export function orScopeColumn(column?: string): ScopedCondition {
    return new ScopedCondition({ scope: ScopeOp.OR, column: column ?? null })
}
export function orScope(...children: any[]): ScopedCondition {
    const s = new ScopedCondition({ scope: ScopeOp.OR })
    children.forEach(c => s.push(c))
    return s
}

/** Build a non-join NOT scope. */
export function notScopeAlias(alias?: string): ScopedCondition {
    return new ScopedCondition({ alias, scope: ScopeOp.NOT })
}

/** Build a primitive EQ condition. */
export function prim(column: string, value: any = 1): PrimitiveCondition {
    return new PrimitiveCondition({
        column,
        operator: PrimOp.EQUAL,
        operand: value,
    })
}
