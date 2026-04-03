import 'mocha'
import { expect } from 'chai'
import { LiteralCondition } from '../condition/literal-condition'
import { ScopedCondition } from '../condition/scoped-condition'
import { PrimitiveCondition } from '../condition/primitive-condition'
import { PrimOp, ScopeOp } from '../condition/types'
import { PathPolicy } from '../types'
import { PathPolicyEnforcer } from './path-policy-enforcer'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirror depth-limiter.spec.ts conventions)
// ─────────────────────────────────────────────────────────────────────────────

/** Build a root AND scope that wraps the given child conditions. */
function root(alias: string, ...children: ScopedCondition[]): ScopedCondition {
    const r = new ScopedCondition({ alias, scope: ScopeOp.AND })
    children.forEach(c => r.push(c))
    return r
}

/** Build a join scope (relation hop). */
function joinScope(column: string, parentAlias: string, scope = ScopeOp.AND): ScopedCondition {
    const alias = `${parentAlias}_${column}`
    return new ScopedCondition({ column, alias, scope, join: true })
}

/** Build a non-join AND scope. */
function andScope(alias?: string): ScopedCondition {
    return new ScopedCondition({ alias, scope: ScopeOp.AND })
}

/** Build a non-join OR scope. */
function orScope(alias?: string): ScopedCondition {
    return new ScopedCondition({ alias, scope: ScopeOp.OR })
}

/** Build a non-join NOT scope. */
function notScope(alias?: string): ScopedCondition {
    return new ScopedCondition({ alias, scope: ScopeOp.NOT })
}

/** Build a primitive EQ condition. */
function prim(column: string): PrimitiveCondition {
    return new PrimitiveCondition({
        column,
        operator: PrimOp.EQUAL,
        operand: 1,
    })
}

/** Build an enforcer with a given policy and violation mode. */
function enforcer(
    policy: PathPolicy,
    onViolation: 'throw' | 'false' | 'strip' = 'throw',
): PathPolicyEnforcer {
    return new PathPolicyEnforcer(policy, onViolation)
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('PathPolicyEnforcer', () => {
    describe('apply', () => {

        // ─────────────────────────────────────────────────────────────────
        describe('exact path matching', () => {
            it('should allow a root-level field that matches an allow rule', () => {
                const r = root('__table__', andScope())
                const inner = r.conditions[0] as ScopedCondition
                inner.push(prim('id'))

                const e = enforcer({ rules: [{ path: 'id', decision: 'allow' }] })
                expect(() => e.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should report PATH_POLICY_VIOLATION for a root-level field that matches a deny rule', () => {
                const r = root('__table__', andScope())
                const inner = r.conditions[0] as ScopedCondition
                inner.push(prim('id'))

                const e = enforcer({ rules: [{ path: 'id', decision: 'deny' }] })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                expect(result.issues[0].message).to.include('"id" is not permitted')
                r.unlink()
            })

            it('should allow an exact nested field that matches an allow rule', () => {
                // { author: { name: 'x' } }
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = enforcer({ rules: [{ path: 'author.name', decision: 'allow' }] })
                expect(() => e.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should report PATH_POLICY_VIOLATION for an exact nested field that matches a deny rule', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = enforcer({ rules: [{ path: 'author.name', decision: 'deny' }] })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                expect(result.issues[0].path).to.equal('author.name')
                r.unlink()
            })

            it('should deny a join relation path that matches a deny rule exactly', () => {
                // rule: deny 'author' (exact) → join traversal not checked,
                // but the FIELD 'author.name' has no matching allow rule
                // and default is 'allow', so it should NOT throw.
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                // An exact rule for 'author' only matches the path "author";
                // since enforcement is at the primitive level, this rule will
                // never fire and the filter must pass through unchanged.
                const e = enforcer({ rules: [{ path: 'author', decision: 'deny' }] })
                expect(() => e.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should allow a join relation that matches an allow rule', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                // 'author' exact rule never fires on primitives; default is 'allow'
                // so the filter still passes through.
                const e = enforcer({ rules: [{ path: 'author', decision: 'allow' }] })
                expect(() => e.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should use the first matching rule when multiple rules match', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                // first rule: deny author.name; second rule: allow author.name
                const e = enforcer({
                    rules: [
                        { path: 'author.name', decision: 'deny' },
                        { path: 'author.name', decision: 'allow' },
                    ],
                })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('descendant wildcard matching', () => {
            it('should deny any field under a denied wildcard', () => {
                // policy: deny author.**  → author.name is denied
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = enforcer({ rules: [{ path: 'author.**', decision: 'deny' }] })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                expect(result.issues[0].path).to.equal('author.name')
                r.unlink()
            })

            it('should allow any field under an allowed wildcard', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = enforcer({
                    default: 'deny',
                    rules: [{ path: 'author.**', decision: 'allow' }],
                })
                expect(() => e.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should not match the join relation itself, only its field descendants', () => {
                // "author.**" should NOT match the bare path "author"
                // (enforcement is at the primitive level; joins are traversal only).
                // With deny author.** the primitive 'author.name' IS matched → issue.
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = enforcer({ rules: [{ path: 'author.**', decision: 'deny' }] })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].path).to.equal('author.name')
                r.unlink()
            })

            it('should match deeply nested paths with a top-level wildcard', () => {
                // author.publisher.city (depth 3)
                const cityPrim = prim('city')
                const pubJoin = joinScope('publisher', '__table___author')
                pubJoin.push(cityPrim)
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(pubJoin)
                const r = root('__table__', authorJoin)

                // deny author.** → fires on the first primitive whose path starts with "author."
                // That is author.publisher.city
                const e = enforcer({ rules: [{ path: 'author.**', decision: 'deny' }] })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                expect(result.issues[0].path).to.equal('author.publisher.city')
                r.unlink()
            })

            it('should match deeply nested fields when the join itself passes', () => {
                // author.publisher.city (depth 3) with allow author.publisher but deny all
                const cityPrim = prim('city')
                const pubJoin = joinScope('publisher', '__table___author')
                pubJoin.push(cityPrim)
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(pubJoin)
                const r = root('__table__', authorJoin)

                // allow author, allow author.publisher, deny author.**
                // author.publisher.city matches author.** → denied
                const e = enforcer({
                    rules: [
                        { path: 'author', decision: 'allow' },
                        { path: 'author.publisher', decision: 'allow' },
                        { path: 'author.**', decision: 'deny' },
                    ],
                })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].path).to.equal('author.publisher.city')
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('default allow/deny behavior', () => {
            it('should default to allow when no rules match', () => {
                const makeTree = () => {
                    const r = root('__table__', andScope())
                    const inner = r.conditions[0] as ScopedCondition
                    inner.push(prim('id'))
                    return r
                }

                // no rules, no default → implicit allow
                const r1 = makeTree()
                const e1 = enforcer({})
                expect(() => e1.apply(r1)).to.not.throw()
                r1.unlink()

                // explicit default: 'allow'
                const r2 = makeTree()
                const e2 = enforcer({ default: 'allow' })
                expect(() => e2.apply(r2)).to.not.throw()
                r2.unlink()
            })

            it('should deny when default is deny and no rules match', () => {
                const r = root('__table__', andScope())
                const inner = r.conditions[0] as ScopedCondition
                inner.push(prim('id'))

                const e = enforcer({ default: 'deny' })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                expect(result.issues[0].path).to.equal('id')
                r.unlink()
            })

            it('should use explicit allow rule to override default deny', () => {
                const r = root('__table__', andScope())
                const inner = r.conditions[0] as ScopedCondition
                inner.push(prim('id'))

                const e = enforcer({
                    default: 'deny',
                    rules: [{ path: 'id', decision: 'allow' }],
                })
                expect(() => e.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should use explicit deny rule to override default allow', () => {
                const r = root('__table__', andScope())
                const inner = r.conditions[0] as ScopedCondition
                inner.push(prim('id'))

                const e = enforcer({
                    default: 'allow',
                    rules: [{ path: 'id', decision: 'deny' }],
                })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('onViolation throw', () => {
            it('should report PATH_POLICY_VIOLATION when a field is denied', () => {
                const r = root('__table__', andScope())
                const inner = r.conditions[0] as ScopedCondition
                inner.push(prim('id'))

                const e = new PathPolicyEnforcer(
                    { rules: [{ path: 'id', decision: 'deny' }] },
                    'throw'
                )
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                expect(result.issues[0].message).to.include('"id" is not permitted')
                r.unlink()
            })

            it('should default to throw mode when onViolation is omitted', () => {
                const r = root('__table__', andScope())
                const inner = r.conditions[0] as ScopedCondition
                inner.push(prim('id'))

                const e = new PathPolicyEnforcer({ rules: [{ path: 'id', decision: 'deny' }] })
                const result = e.apply(r)
                expect(result.issues).to.have.length(1)
                expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('onViolation false', () => {
            it('should replace a denied field with (1=0)', () => {
                // { id: 1 } with deny id → root([false])
                const idAnd = andScope()
                idAnd.push(prim('id'))
                const r = root('__table__', idAnd)

                const e = new PathPolicyEnforcer(
                    { rules: [{ path: 'id', decision: 'deny' }] },
                    'false'
                )
                const result = e.apply(r).tree as ScopedCondition

                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(1)
                const lit = result.conditions[0] as LiteralCondition
                expect(lit.type).to.equal('literal')
                expect(lit.value).to.be.false

                r.unlink()
            })

            it('should replace a denied nested field with (1=0)', () => {
                // deny author.name → join scope passed through, primitive replaced with false
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = new PathPolicyEnforcer(
                    { rules: [{ path: 'author.name', decision: 'deny' }] },
                    'false'
                )
                const result = e.apply(r).tree as ScopedCondition

                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(1)
                const lit = result.conditions[0] as LiteralCondition
                expect(lit.type).to.equal('literal')
                expect(lit.value).to.be.false

                r.unlink()
            })

            it('should preserve non-denied branches inside $or (branch-local false)', () => {
                // { $or: [{ id: 1 }, { secret: 'x' }] } deny secret → OR(id)
                const secretAnd = andScope()
                secretAnd.push(prim('secret'))
                const idAnd = andScope()
                idAnd.push(prim('id'))

                const orSc = orScope()
                orSc.push(secretAnd)
                orSc.push(idAnd)

                const r = root('__table__', orSc)

                const e = new PathPolicyEnforcer(
                    { rules: [{ path: 'secret', decision: 'deny' }] },
                    'false'
                )
                const result = e.apply(r).tree as ScopedCondition

                // OR(false, id) → OR(id) → root has [orSc] with [idAnd]
                expect(result).to.equal(r)
                const outerOr = result.conditions[0] as ScopedCondition
                expect(outerOr.scope).to.equal(ScopeOp.OR)
                expect(outerOr.conditions).to.have.length(1)
                const remaining = outerOr.conditions[0] as ScopedCondition
                expect(remaining.conditions[0]).to.be.instanceOf(PrimitiveCondition)

                r.unlink()
            })

            it('should produce (1=0) when all branches are denied in $or', () => {
                // { $or: [{ secret: 'x' }, { password: 'y' }] } deny both → false
                const s1 = andScope()
                s1.push(prim('secret'))
                const s2 = andScope()
                s2.push(prim('password'))

                const orSc = orScope()
                orSc.push(s1)
                orSc.push(s2)
                const r = root('__table__', orSc)

                const e = new PathPolicyEnforcer(
                    {
                        rules: [
                            { path: 'secret', decision: 'deny' },
                            { path: 'password', decision: 'deny' },
                        ],
                    },
                    'false'
                )
                const result = e.apply(r).tree as ScopedCondition

                // OR(false, false) → false → root([false])
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(1)
                const lit = result.conditions[0] as LiteralCondition
                expect(lit.value).to.be.false

                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('onViolation strip', () => {
            it('should strip a denied field', () => {
                // { id: 1 } deny id → empty root (no WHERE)
                const idAnd = andScope()
                idAnd.push(prim('id'))
                const r = root('__table__', idAnd)

                const e = new PathPolicyEnforcer(
                    { rules: [{ path: 'id', decision: 'deny' }] },
                    'strip'
                )
                const result = e.apply(r).tree as ScopedCondition

                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })

            it('should strip a denied nested field', () => {
                // deny author.name → join scope passed through, field stripped
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = new PathPolicyEnforcer(
                    { rules: [{ path: 'author.name', decision: 'deny' }] },
                    'strip'
                )
                const result = e.apply(r).tree as ScopedCondition

                // 'name' stripped → authorJoin has no children → simplified away → empty root
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })

            it('should preserve non-denied branches when stripping', () => {
                // { $or: [{ secret: 'x' }, { id: 1 }] } deny secret → OR(id)
                const secretAnd = andScope()
                secretAnd.push(prim('secret'))
                const idAnd = andScope()
                idAnd.push(prim('id'))

                const orSc = orScope()
                orSc.push(secretAnd)
                orSc.push(idAnd)
                const r = root('__table__', orSc)

                const e = new PathPolicyEnforcer(
                    { rules: [{ path: 'secret', decision: 'deny' }] },
                    'strip'
                )
                const result = e.apply(r).tree as ScopedCondition

                expect(result).to.equal(r)
                const outerOr = result.conditions[0] as ScopedCondition
                expect(outerOr.scope).to.equal(ScopeOp.OR)
                expect(outerOr.conditions).to.have.length(1)
                const remaining = outerOr.conditions[0] as ScopedCondition
                expect(remaining.conditions[0]).to.be.instanceOf(PrimitiveCondition)

                r.unlink()
            })

            it('should produce empty root when all branches are stripped', () => {
                const s1 = andScope()
                s1.push(prim('secret'))
                const s2 = andScope()
                s2.push(prim('password'))

                const orSc = orScope()
                orSc.push(s1)
                orSc.push(s2)
                const r = root('__table__', orSc)

                const e = new PathPolicyEnforcer(
                    {
                        rules: [
                            { path: 'secret', decision: 'deny' },
                            { path: 'password', decision: 'deny' },
                        ],
                    },
                    'strip'
                )
                const result = e.apply(r).tree as ScopedCondition

                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('ability filter isolation', () => {
            it('should not be applied to a tree that bypasses compileExternalFilterTree', () => {
                // A deep tree NOT processed through PathPolicyEnforcer is intact
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                // No enforcer applied – tree should be unchanged
                expect(r.conditions[0]).to.be.instanceOf(ScopedCondition)
                expect((r.conditions[0] as ScopedCondition).join).to.be.true

                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('edge cases', () => {
            it('should return empty root unchanged when filter is empty', () => {
                const r = new ScopedCondition({ alias: '__table__' })

                const e = new PathPolicyEnforcer({ default: 'deny' }, 'throw')
                const result = e.apply(r).tree
                expect(result).to.equal(r)
                expect((result as ScopedCondition).conditions).to.have.length(0)

                r.unlink()
            })

            it('should pass through a non-scoped root unchanged', () => {
                const p = prim('id') as any
                const e = new PathPolicyEnforcer({ default: 'deny' }, 'throw')
                const result = e.apply(p).tree
                expect(result).to.equal(p)
            })

            it('should pass through a synthetic null-column primitive', () => {
                // buildNullCondition creates a primitive with column: null
                const nullPrim = new PrimitiveCondition({
                    column: null,
                    operator: PrimOp.EMPTY_RESULT,
                    operand: null,
                })
                const r = new ScopedCondition({ alias: '__table__' })
                r.push(nullPrim)

                // even with default:deny, null-column primitives must pass through
                const e = new PathPolicyEnforcer({ default: 'deny' }, 'throw')
                expect(() => e.apply(r)).to.not.throw()
                expect((r as ScopedCondition).conditions).to.have.length(1)

                r.unlink()
            })

            it('should pass through a LiteralCondition child unchanged', () => {
                const r = new ScopedCondition({ alias: '__table__' })
                r.push(new LiteralCondition(false))

                const e = new PathPolicyEnforcer({ default: 'deny' }, 'throw')
                // literal has no path, must not trigger a violation
                expect(() => e.apply(r)).to.not.throw()
                // LiteralCondition(false) inside AND root → simplification collapses to false
                expect((r as ScopedCondition).conditions).to.have.length(1)
                const lit = (r as ScopedCondition).conditions[0] as LiteralCondition
                expect(lit.value).to.be.false

                r.unlink()
            })

            it('should allow an empty rules list with default allow', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const e = new PathPolicyEnforcer({ rules: [] }, 'throw')
                expect(() => e.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should simplify AND(true, x) to AND(x)', () => {
                // Inject a true literal alongside a real primitive in an AND scope.
                const andSc = andScope()
                andSc.push(new LiteralCondition(true))
                andSc.push(prim('id'))
                const r = root('__table__', andSc)

                const e = new PathPolicyEnforcer({}, 'false')
                const result = e.apply(r).tree as ScopedCondition

                // AND(true, id) → AND(id) — true literal removed, prim remains
                const inner = result.conditions[0] as ScopedCondition
                expect(inner.conditions).to.have.length(1)
                expect(inner.conditions[0]).to.be.instanceOf(PrimitiveCondition)

                r.unlink()
            })

            it('should handle NOT scope simplification (NOT(false) → true → empty root)', () => {
                const notSc = notScope()
                notSc.push(new LiteralCondition(false))
                const r = root('__table__', notSc)

                const e = new PathPolicyEnforcer({}, 'false')
                const result = e.apply(r).tree as ScopedCondition

                // NOT(false) = true → AND(true) → empty root
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })

            it('should handle NOT scope simplification (NOT(true) → false → root([false]))', () => {
                const notSc = notScope()
                notSc.push(new LiteralCondition(true))
                const r = root('__table__', notSc)

                const e = new PathPolicyEnforcer({}, 'false')
                const result = e.apply(r).tree as ScopedCondition

                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(1)
                const lit = result.conditions[0] as LiteralCondition
                expect(lit.value).to.be.false

                r.unlink()
            })

            it('should simplify OR(true, x) to true → empty root', () => {
                const orSc = orScope()
                orSc.push(new LiteralCondition(true))
                orSc.push(prim('id'))
                const r = root('__table__', orSc)

                const e = new PathPolicyEnforcer({}, 'false')
                const result = e.apply(r).tree as ScopedCondition

                // OR(true, id) = true → AND(true) → empty root
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })

            it('should keep existing SQL output unchanged when pathPolicy is undefined', () => {
                // No policy enforcement at all → tree is returned as-is
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                // calling without a PathPolicyEnforcer → no change
                expect(r.conditions[0]).to.be.instanceOf(ScopedCondition)
                expect((r.conditions[0] as ScopedCondition).join).to.be.true
                expect((r.conditions[0] as ScopedCondition).conditions).to.have.length(1)

                r.unlink()
            })
        })
    })
})
