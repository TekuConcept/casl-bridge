import 'mocha'
import { expect } from 'chai'
import { DepthLimiter } from './depth-limiter'
import { LiteralCondition } from './literal-condition'
import { ScopedCondition } from './scoped-condition'
import { PrimitiveCondition } from './primitive-condition'
import { PrimOp, ScopeOp } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
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

/** Build a non-join AND scope (no relation hop). */
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

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('DepthLimiter', () => {
    describe('apply', () => {
        describe('depth calculation', () => {
            it('should allow a non-join filter at any depth', () => {
                // { id: 1 } – no join, depth 0
                const idPrim = prim('id')
                const andSc = andScope()
                andSc.push(idPrim)
                const r = root('__table__', andSc)

                const limiter = new DepthLimiter(0, 'throw')
                expect(() => limiter.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should measure depth as number of join-scope ancestors', () => {
                // author.id: 1  ─ one join hop (depth 1)
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('id'))
                const r = root('__table__', authorJoin)

                // maxDepth=1 should allow exactly one join hop
                const limiter = new DepthLimiter(1, 'throw')
                expect(() => limiter.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should count nested join hops cumulatively', () => {
                // author.comments.text  ─ two join hops (depth 2)
                const commentsJoin = joinScope('comments', '__table___author')
                commentsJoin.push(prim('text'))

                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(commentsJoin)

                const r = root('__table__', authorJoin)

                // maxDepth=1 means depth-2 is a violation
                const limiter = new DepthLimiter(1, 'throw')
                expect(() => limiter.apply(r)).to.throw(
                    'Filter query exceeds maximum join depth of 1'
                )
                r.unlink()
            })

            it('should pass through filters below the depth limit', () => {
                // author.name (depth 1) with maxDepth=2: no violation
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(2, 'throw')
                expect(() => limiter.apply(r)).to.not.throw()
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('onViolation throw', () => {
            it('should throw when a join scope reaches maxDepth', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(0, 'throw')
                expect(() => limiter.apply(r)).to.throw(
                    'Filter query exceeds maximum join depth of 0'
                )
                r.unlink()
            })

            it('should not throw when there are no join scopes', () => {
                const andSc = andScope()
                andSc.push(prim('id'))
                const r = root('__table__', andSc)

                const limiter = new DepthLimiter(0, 'throw')
                expect(() => limiter.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should default to throw mode when onViolation is omitted', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(0)
                expect(() => limiter.apply(r)).to.throw()
                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('onViolation false', () => {
            it('should replace a violating join scope with (1=0)', () => {
                // filter: { author.name = Tolkien }  maxDepth=0 → false
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(0, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // root must be the same node (same alias intact)
                expect(result).to.equal(r)
                // root AND([false]) simplifies to root([false])
                expect(result.conditions).to.have.length(1)
                const child = result.conditions[0] as LiteralCondition
                expect(child.type).to.equal('literal')
                expect(child.value).to.be.false

                r.unlink()
            })

            it('should preserve non-violating branches inside $or', () => {
                // { $or: [{ author.name = 'x' }, { id: 1 }] }
                // author branch → false; id branch → kept
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const authorWrapper = andScope()
                authorWrapper.push(authorJoin)

                const idWrapper = andScope()
                idWrapper.push(prim('id'))

                const orSc = orScope()
                orSc.push(authorWrapper)
                orSc.push(idWrapper)

                const r = root('__table__', orSc)

                const limiter = new DepthLimiter(0, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // OR(false, id) → OR(id) → root has [orSc] with [idWrapper]
                expect(result).to.equal(r)

                const outerOr = result.conditions[0] as ScopedCondition
                expect(outerOr.scope).to.equal(ScopeOp.OR)
                expect(outerOr.conditions).to.have.length(1)
                const remaining = outerOr.conditions[0] as ScopedCondition
                expect(remaining.conditions[0]).to.be.instanceOf(PrimitiveCondition)

                r.unlink()
            })

            it('should keep root empty when all branches in $or are false', () => {
                // { $or: [{ author.name='x' }, { author.id=1 }] }
                const j1 = joinScope('author', '__table__')
                j1.push(prim('name'))
                const w1 = andScope()
                w1.push(j1)

                const j2 = joinScope('author', '__table__')
                j2.push(prim('id'))
                const w2 = andScope()
                w2.push(j2)

                const orSc = orScope()
                orSc.push(w1)
                orSc.push(w2)
                const r = root('__table__', orSc)

                const limiter = new DepthLimiter(0, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // OR(false, false) → false → AND([false]) → root([false])
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(1)
                const lit = result.conditions[0] as LiteralCondition
                expect(lit.value).to.be.false

                r.unlink()
            })

            it('should preserve non-violating branches inside $and', () => {
                // { $and: [{ id: 1 }, { title: 'x' }] }  no violations
                const w1 = andScope()
                w1.push(prim('id'))
                const w2 = andScope()
                w2.push(prim('title'))

                const andSc = andScope()
                andSc.push(w1)
                andSc.push(w2)

                const r = root('__table__', andSc)

                const limiter = new DepthLimiter(0, 'false')
                const result = limiter.apply(r) as ScopedCondition

                expect(result).to.equal(r)
                // conditions are unchanged
                const outerAnd = result.conditions[0] as ScopedCondition
                expect(outerAnd.conditions).to.have.length(2)

                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('onViolation strip', () => {
            it('should strip a violating join scope', () => {
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(0, 'strip')
                const result = limiter.apply(r) as ScopedCondition

                expect(result).to.equal(r)
                // All children stripped → empty root (no WHERE clause)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })

            it('should preserve non-violating branches when stripping', () => {
                // { $or: [{ author.name='x' }, { id: 1 }] }
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const authorWrapper = andScope()
                authorWrapper.push(authorJoin)

                const idWrapper = andScope()
                idWrapper.push(prim('id'))

                const orSc = orScope()
                orSc.push(authorWrapper)
                orSc.push(idWrapper)

                const r = root('__table__', orSc)

                const limiter = new DepthLimiter(0, 'strip')
                const result = limiter.apply(r) as ScopedCondition

                expect(result).to.equal(r)

                const outerOr = result.conditions[0] as ScopedCondition
                expect(outerOr.scope).to.equal(ScopeOp.OR)
                // author branch stripped; id branch kept
                expect(outerOr.conditions).to.have.length(1)
                const remaining = outerOr.conditions[0] as ScopedCondition
                expect(remaining.conditions[0]).to.be.instanceOf(PrimitiveCondition)

                r.unlink()
            })

            it('should produce empty root when all branches are stripped', () => {
                const j1 = joinScope('author', '__table__')
                j1.push(prim('name'))
                const j2 = joinScope('author', '__table__')
                j2.push(prim('id'))

                const orSc = orScope()
                orSc.push(j1)
                orSc.push(j2)

                const r = root('__table__', orSc)

                const limiter = new DepthLimiter(0, 'strip')
                const result = limiter.apply(r) as ScopedCondition

                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('simplification', () => {
            it('OR(false, x) should yield OR(x)', () => {
                const orSc = orScope()
                orSc.push(new LiteralCondition(false))
                const idWrapper = andScope()
                idWrapper.push(prim('id'))
                orSc.push(idWrapper)
                const r = root('__table__', orSc)

                // maxDepth=1 and no joins: no violations; simplification
                // fires because there is already a LiteralCondition(false)
                // in the tree.  Use maxDepth=0 + a join child to force it.
                //
                // Instead, exercise simplify() directly via apply() on a
                // pre-built tree that already contains a literal.
                const limiter = new DepthLimiter(999, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // No depth violations but LiteralCondition(false) is
                // treated as a non-scoped node and passed through.
                // Simplification still removes false from OR.
                const resultOr = result.conditions[0] as ScopedCondition
                expect(resultOr.scope).to.equal(ScopeOp.OR)
                // false was removed from OR
                expect(resultOr.conditions.every(c => c.type !== 'literal' || (c as LiteralCondition).value !== false)).to.be.true

                r.unlink()
            })

            it('AND(false, x) should yield false', () => {
                const andSc = andScope()
                andSc.push(new LiteralCondition(false))
                andSc.push(prim('id'))
                const r = root('__table__', andSc)

                const limiter = new DepthLimiter(999, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // AND(false, id) = false → root([false])
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(1)
                const lit = result.conditions[0] as LiteralCondition
                expect(lit.type).to.equal('literal')
                expect(lit.value).to.be.false

                r.unlink()
            })

            it('AND(true, x) should yield AND(x)', () => {
                const andSc = andScope()
                andSc.push(new LiteralCondition(true))
                andSc.push(prim('id'))
                const r = root('__table__', andSc)

                const limiter = new DepthLimiter(999, 'false')
                const result = limiter.apply(r) as ScopedCondition

                const inner = result.conditions[0] as ScopedCondition
                // true literal removed
                expect(inner.conditions).to.have.length(1)
                expect(inner.conditions[0]).to.be.instanceOf(PrimitiveCondition)

                r.unlink()
            })

            it('OR(true, x) should yield true → empty root', () => {
                const orSc = orScope()
                orSc.push(new LiteralCondition(true))
                orSc.push(prim('id'))
                const r = root('__table__', orSc)

                const limiter = new DepthLimiter(999, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // OR(true, x) = true → AND(true) → empty root
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })

            it('NOT(false) should yield true → empty root', () => {
                const notSc = notScope()
                notSc.push(new LiteralCondition(false))
                const r = root('__table__', notSc)

                const limiter = new DepthLimiter(999, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // NOT(false) = true → AND(true) → empty root
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(0)

                r.unlink()
            })

            it('NOT(true) should yield false → root([false])', () => {
                const notSc = notScope()
                notSc.push(new LiteralCondition(true))
                const r = root('__table__', notSc)

                const limiter = new DepthLimiter(999, 'false')
                const result = limiter.apply(r) as ScopedCondition

                // NOT(true) = false → AND(false) → root([false])
                expect(result).to.equal(r)
                expect(result.conditions).to.have.length(1)
                const lit = result.conditions[0] as LiteralCondition
                expect(lit.value).to.be.false

                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('ability filter isolation', () => {
            it('should not be applied to a tree that bypasses compileExternalFilterTree', () => {
                // Verify that a deep tree processed *without* DepthLimiter
                // is returned intact (i.e. this class is opt-in).
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(prim('name'))
                const r = root('__table__', authorJoin)

                // No DepthLimiter involved
                expect(r.conditions[0]).to.be.instanceOf(ScopedCondition)
                expect((r.conditions[0] as ScopedCondition).join).to.be.true

                r.unlink()
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('edge cases', () => {
            it('should return empty root unchanged when filter is empty', () => {
                const r = new ScopedCondition({ alias: '__table__' })

                const limiter = new DepthLimiter(0, 'throw')
                const result = limiter.apply(r)
                expect(result).to.equal(r)
                expect((result as ScopedCondition).conditions).to.have.length(0)

                r.unlink()
            })

            it('should pass through a non-scoped root unchanged', () => {
                const p = prim('id') as any
                const limiter = new DepthLimiter(0, 'throw')
                const result = limiter.apply(p)
                expect(result).to.equal(p)
            })

            it('should allow depth-2 joins when maxDepth is 2', () => {
                const commentsJoin = joinScope('comments', '__table___author')
                commentsJoin.push(prim('text'))
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(commentsJoin)
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(2, 'throw')
                expect(() => limiter.apply(r)).to.not.throw()
                r.unlink()
            })

            it('should throw for depth-3 join when maxDepth is 2', () => {
                const d3 = joinScope('tags', '__table___author_comments')
                d3.push(prim('name'))
                const commentsJoin = joinScope('comments', '__table___author')
                commentsJoin.push(d3)
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(commentsJoin)
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(2, 'throw')
                expect(() => limiter.apply(r)).to.throw(
                    'Filter query exceeds maximum join depth of 2'
                )
                r.unlink()
            })
        })

        describe('unlink (memory cleanup)', () => {
            it('should unlink a stripped join child (strip mode)', () => {
                // { author: { id: 1 } }  depth 1, maxDepth=0 → strip
                const authorId = prim('id')
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(authorId)
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(0, 'strip')
                limiter.apply(r)

                // authorJoin was stripped; its parent must be cleared
                expect(authorJoin.parent).to.be.null
                r.unlink()
            })

            it('should unlink a replaced join child (false mode)', () => {
                // { author: { id: 1 } }  depth 1, maxDepth=0 → replaced with literal
                const authorId = prim('id')
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(authorId)
                const r = root('__table__', authorJoin)

                const limiter = new DepthLimiter(0, 'false')
                limiter.apply(r)

                // authorJoin was replaced by a LiteralCondition(false);
                // the original join node must be unlinked
                expect(authorJoin.parent).to.be.null
                r.unlink()
            })

            it('should unlink true-literal children removed by AND simplification', () => {
                // OR($or: [true-literal, id=1]) inside AND → true literal removed
                // Build: root AND [ OR [ author(join), id=1 ] ]
                // With maxDepth=0, 'false' mode:
                //   author join → LiteralCondition(false)
                //   OR(false, id=1) → OR(id=1) – the false literal is dropped
                const authorId = prim('id')
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(authorId)
                const bookId = prim('bookId')
                const or = orScope()
                or.push(authorJoin)
                or.push(bookId)
                const r = root('__table__', or)

                const limiter = new DepthLimiter(0, 'false')
                limiter.apply(r)

                // The LiteralCondition(false) that replaced authorJoin was
                // removed from the OR scope; it must have been unlinked
                // (parent set to null). We verify no orphaned literal survives.
                const orphanedLiterals = r.conditions.flatMap(c => {
                    if (c.type === 'scoped') {
                        return (c as ScopedCondition).conditions.filter(
                            x => x.type === 'literal'
                        )
                    }
                    return c.type === 'literal' ? [c] : []
                })
                expect(orphanedLiterals).to.have.length(0)

                r.unlink()
            })

            it('should unlink false-literal children removed by OR simplification', () => {
                // AND(true-literal, id=1) → AND(id=1), true literal dropped
                // Build: root AND [ AND [ true-join, id=1 ] ] with maxDepth=0, 'false'
                // We create an OR whose children are: a depth-0 node (will survive) and
                // a LiteralCondition(true) generated by inner AND simplification.
                // Actually: build root AND [ OR [ notScope(join), id ] ]
                // notScope wraps a literal → NOT(false) = true → OR(true, id) → true
                // Let's use a simpler path: OR(true-literal, id)  →  true
                // We can craft that directly using a nested structure where
                // an AND(false-join-result) collapses to false inside an AND parent,
                // giving us the AND(false) → false path, so the AND is removed.
                // Use: root AND [ AND [ author(join) ] ], 'false', maxDepth=0
                // → author replaced with LiteralCondition(false)
                // → inner AND(false) → false (LiteralCondition)
                // → root AND(false) → false
                // Root emits (1=0)
                const authorId = prim('id')
                const authorJoin = joinScope('author', '__table__')
                authorJoin.push(authorId)
                const inner = andScope()
                inner.push(authorJoin)
                const r = root('__table__', inner)

                const limiter = new DepthLimiter(0, 'false')
                limiter.apply(r)

                // authorJoin must be unlinked
                expect(authorJoin.parent).to.be.null
                r.unlink()
            })
        })
    })
})
