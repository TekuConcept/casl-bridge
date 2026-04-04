import 'mocha'
import { expect } from 'chai'
import { ScopedCondition } from '../condition/scoped-condition'
import { PrimitiveCondition } from '../condition/primitive-condition'
import { LiteralCondition } from '../condition/literal-condition'
import { PrimOp, ScopeOp } from '../condition/types'
import {
    RelationIdRewriter,
    RelationIdMeta,
    RelationMetaProvider,
} from './relation-id-rewriter'
import {
    andScopeColumn as andScope,
    joinScope,
    orScopeColumn as orScope,
    root,
    prim,
} from './common.test'

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build primitive conditions. */
function $gt(column: string, value = 0): PrimitiveCondition {
    return new PrimitiveCondition({ column, operator: PrimOp.GREATER_THAN, operand: value })
}
function $lt(column: string, value = 0): PrimitiveCondition {
    return new PrimitiveCondition({ column, operator: PrimOp.LESS_THAN, operand: value })
}
function $in(column: string, value: any[] = []): PrimitiveCondition {
    return new PrimitiveCondition({ column, operator: PrimOp.IN, operand: value })
}

/** Simple single-level provider: maps relation property → fkMapping. */
function provider(
    map: Record<string, RelationIdMeta>,
): RelationMetaProvider {
    return (rel) => map[rel] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('RelationIdRewriter', () => {
    describe('apply', () => {

        // ─────────────────────────────────────────────────────────────────
        describe('join removal', () => {
            it('must remove join scope when single child is a PK primitive', () => {
                // root → joinScope(author) → prim(id=5)
                const join = joinScope('author', '__table__')
                join.push(prim('id', 5))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                // join scope gone; one child remains directly in root
                expect(r.conditions).to.have.length(1)
                expect(r.conditions[0].type).to.equal('primitive')
                const p = r.conditions[0] as PrimitiveCondition
                expect((p as any)['_column']).to.equal('author')
                expect(p.operator).to.equal(PrimOp.EQUAL)
                expect(p.operand).to.equal(5)
                r.unlink()
            })

            it('must wrap multiple PK primitives in a non-join scope to preserve AND semantics', () => {
                // root → joinScope(author, AND) → [prim(id>0), prim(id<10)]
                const join = joinScope('author', '__table__')
                join.push($gt('id', 0))
                join.push($lt('id', 10))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                // The two primitives are wrapped in a non-join AND scope
                expect(r.conditions).to.have.length(1)
                const wrapper = r.conditions[0] as ScopedCondition
                expect(wrapper.type).to.equal('scoped')
                expect(wrapper.join).to.equal(false)
                expect(wrapper.scope).to.equal(ScopeOp.AND)
                expect(wrapper.conditions).to.have.length(2)
                const [p1, p2] = wrapper.conditions as PrimitiveCondition[]
                expect((p1 as any)['_column']).to.equal('author')
                expect(p1.operator).to.equal(PrimOp.GREATER_THAN)
                expect((p2 as any)['_column']).to.equal('author')
                expect(p2.operator).to.equal(PrimOp.LESS_THAN)
                r.unlink()
            })

            it('must preserve operator and operand when rewriting', () => {
                const join = joinScope('author', '__table__')
                join.push($in('id', [1, 2, 3]))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                expect(r.conditions).to.have.length(1)
                const p = r.conditions[0] as PrimitiveCondition
                expect((p as any)['_column']).to.equal('author')
                expect(p.operator).to.equal(PrimOp.IN)
                expect(p.operand).to.deep.equal([1, 2, 3])
                r.unlink()
            })

            it('must rewrite join scope inside a non-join OR scope', () => {
                // root → orScope → [innerAND → joinScope(author) → prim(id=5)]
                const inner = joinScope('author', '__table__')
                inner.push(prim('id', 5))
                const or = orScope()
                or.push(inner)
                const r = root('__table__', or)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                // OR scope's child should now be a primitive, not a join scope
                expect(or.conditions).to.have.length(1)
                expect(or.conditions[0].type).to.equal('primitive')
                r.unlink()
            })

            it('must handle non-standard FK property name mapping', () => {
                // Simulates a relation where FK property is not '<rel>Id'
                const join = joinScope('primaryTag', '__table__')
                join.push(prim('code', 'TECH'))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    primaryTag: {
                        fkMapping: { code: 'primaryTag' },
                        childProvider: null,
                    },
                }))
                rw.apply(r)

                expect(r.conditions).to.have.length(1)
                const p = r.conditions[0] as PrimitiveCondition
                // FK property name must come from fkMapping, not from a naming convention
                expect((p as any)['_column']).to.equal('primaryTag')
                expect(p.operand).to.equal('TECH')
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('join retention', () => {
            it('must retain join when child primitive is on a non-PK column', () => {
                // root → joinScope(author) → prim(name='John')
                const join = joinScope('author', '__table__')
                join.push(prim('name', 'John'))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    // fkMapping only has 'id', not 'name'
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                // join scope must remain
                expect(r.conditions).to.have.length(1)
                expect(r.conditions[0].type).to.equal('scoped')
                const js = r.conditions[0] as ScopedCondition
                expect(js.join).to.equal(true)
                r.unlink()
            })

            it('must retain join when children are mixed PK and non-PK', () => {
                const join = joinScope('author', '__table__')
                join.push(prim('id', 5))
                join.push(prim('name', 'John'))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                // join scope must remain (name is not in fkMapping)
                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })

            it('must retain join when a child is a scoped condition (not a primitive)', () => {
                const join = joinScope('author', '__table__')
                const inner = andScope()
                inner.push(prim('id', 5))
                join.push(inner)
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                // join scope must remain (child is a scoped condition, not a primitive)
                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })

            it('must retain join when a child is a LiteralCondition', () => {
                const join = joinScope('author', '__table__')
                join.push(new LiteralCondition(false))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })

            it('must retain join when the join scope has no children', () => {
                const join = joinScope('author', '__table__')
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })

            it('must retain join when no FK metadata is available', () => {
                const join = joinScope('unknown', '__table__')
                join.push(prim('id', 5))
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({})) // empty provider
                rw.apply(r)

                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })

            it('must skip a join scope whose _column is null (defensive null-column guard)', () => {
                // A join scope with no column set is treated as unrecognised and skipped.
                // The provider must NOT be called, and the scope must remain intact.
                const nullColJoin = new ScopedCondition({ join: true, scope: ScopeOp.AND })
                // _column is null by default (no column argument)
                nullColJoin.push(prim('id', 5))
                const r = root('__table__', nullColJoin)

                let providerCalled = false
                const rw = new RelationIdRewriter((_rel) => {
                    providerCalled = true
                    return null
                })
                rw.apply(r)

                // Provider must NOT have been called for the null-column join scope
                expect(providerCalled).to.equal(false)
                // Scope must remain unchanged
                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('recursive rewrite', () => {
            it('must rewrite an inner join scope using the child provider', () => {
                // root → joinScope(author) → joinScope(company) → prim(id=7)
                const innerJoin = joinScope('company', '__table___author')
                innerJoin.push(prim('id', 7))
                const outerJoin = joinScope('author', '__table__')
                outerJoin.push(innerJoin)
                const r = root('__table__', outerJoin)

                const authorProvider: RelationMetaProvider = (rel) => {
                    if (rel === 'company') {
                        return { fkMapping: { id: 'company' }, childProvider: null }
                    }
                    return null
                }
                const rw = new RelationIdRewriter(provider({
                    author: {
                        fkMapping: { id: 'author' }, // 'id' is Author PK – not 'company'
                        childProvider: authorProvider,
                    },
                }))
                rw.apply(r)

                // inner join (company) was rewritten → author scope now has prim(company=7)
                // prim('company') is NOT in author's fkMapping → outer join (author) retained
                expect(r.conditions).to.have.length(1)
                const authorScope = r.conditions[0] as ScopedCondition
                expect(authorScope.join).to.equal(true)
                expect(authorScope.conditions).to.have.length(1)
                const p = authorScope.conditions[0] as PrimitiveCondition
                expect(p.type).to.equal('primitive')
                expect((p as any)['_column']).to.equal('company')
                r.unlink()
            })

            it('must rewrite inner join and then the outer join when outer becomes all-PK', () => {
                // root → joinScope(author) → joinScope(tag) → prim(id=3)
                // After inner rewrite: author scope has prim(tagFk=3)
                // If 'tagFk' is Author's PK, outer join also gets rewritten.
                const innerJoin = joinScope('tag', '__table___author')
                innerJoin.push(prim('id', 3))
                const outerJoin = joinScope('author', '__table__')
                outerJoin.push(innerJoin)
                const r = root('__table__', outerJoin)

                const authorProvider: RelationMetaProvider = (rel) => {
                    if (rel === 'tag') {
                        // inner rewrite: tag.id → authorTagFk on Author
                        return { fkMapping: { id: 'authorTag' }, childProvider: null }
                    }
                    return null
                }
                const rw = new RelationIdRewriter(provider({
                    author: {
                        // 'author' is Book's PK relation; fkMapping has 'authorTag' as Book's PK
                        fkMapping: { authorTag: 'authorTagOnBook' },
                        childProvider: authorProvider,
                    },
                }))
                rw.apply(r)

                // inner: tag.id → prim(authorTag=3); outer: prim(authorTag=3) maps to 'authorTagOnBook'
                // Both joins removed, root has prim(authorTagOnBook=3)
                expect(r.conditions).to.have.length(1)
                const p = r.conditions[0] as PrimitiveCondition
                expect(p.type).to.equal('primitive')
                expect((p as any)['_column']).to.equal('authorTagOnBook')
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('edge cases', () => {
            it('should return tree unchanged when it is not a scoped condition', () => {
                const p = prim('id', 1)
                const rw = new RelationIdRewriter(provider({}))
                const result = rw.apply(p)
                expect(result.tree).to.equal(p)
            })

            it('should handle multiple join scopes at the same level', () => {
                // root → [joinScope(author) → prim(id=1), joinScope(author) → prim(id=2)]
                const j1 = joinScope('author', '__table__')
                j1.push(prim('id', 1))
                const j2 = joinScope('author', '__table__')
                j2.push(prim('id', 2))
                const r = root('__table__', j1, j2)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                expect(r.conditions).to.have.length(2)
                expect(r.conditions[0].type).to.equal('primitive')
                expect(r.conditions[1].type).to.equal('primitive')
                r.unlink()
            })

            it('should leave non-join scopes unchanged at root level', () => {
                const inner = andScope()
                inner.push(prim('id', 5))
                const r = root('__table__', inner)

                const rw = new RelationIdRewriter(provider({
                    id: { fkMapping: {}, childProvider: null }, // should not be invoked for non-join
                }))
                rw.apply(r)

                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(false)
                r.unlink()
            })

            it('should leave NOT-scoped join scope unchanged when child is non-primitive', () => {
                const join = joinScope('author', '__table__', ScopeOp.NOT)
                join.push(andScope()) // scoped child → not rewritable
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })

            it('should treat a null-column primitive inside a join scope as non-rewritable (canRewrite returns false)', () => {
                // A PrimitiveCondition with _column === null (e.g. EMPTY_RESULT) is not
                // rewritable — its column cannot be mapped via fkMapping.
                const join = joinScope('author', '__table__')
                const nullColPrim = new PrimitiveCondition({
                    // column deliberately omitted → _column stays null
                    operator: PrimOp.EMPTY_RESULT,
                    operand: null,
                })
                join.push(nullColPrim)
                const r = root('__table__', join)

                const rw = new RelationIdRewriter(provider({
                    author: { fkMapping: { id: 'author' }, childProvider: null },
                }))
                rw.apply(r)

                // canRewrite returns false → join scope retained unchanged
                expect(r.conditions).to.have.length(1)
                expect((r.conditions[0] as ScopedCondition).join).to.equal(true)
                r.unlink()
            })
        })
    })
})
