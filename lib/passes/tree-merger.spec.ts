import 'mocha'
import { expect } from 'chai'
import { LiteralCondition } from '../condition/literal-condition'
import { ScopedCondition } from '../condition/scoped-condition'
import { PrimitiveCondition } from '../condition/primitive-condition'
import { PrimOp, ScopeOp } from '../condition/types'
import { TreeMerger } from './tree-merger'
import {
    andScope,
    joinScope,
    orScope,
    prim as primEq,
    root,
} from './common.test'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a primitive GT condition. */
function primGt(column: string, value: any): PrimitiveCondition {
    return new PrimitiveCondition({ column, operator: PrimOp.GREATER_THAN, operand: value })
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('TreeMerger', () => {
    describe('merge', () => {
        describe('degenerate inputs', () => {
            it('should return left unchanged when left is not scoped', () => {
                const lit = new LiteralCondition(true)
                const r = root('t')
                const result = TreeMerger.merge(lit, r).tree
                expect(result).to.equal(lit)
                r.unlink()
            })

            it('should return left unchanged when right is not scoped', () => {
                const r = root('t')
                const lit = new LiteralCondition(true)
                const result = TreeMerger.merge(r, lit).tree
                expect(result).to.equal(r)
                r.unlink()
            })
        })

        describe('empty tree handling', () => {
            it('should return a merged root with only right children when left is empty', () => {
                const left  = root('t')
                const right = root('t', primEq('id', 1))

                const merged = TreeMerger.merge(left, right).tree
                expect(merged.type).to.equal('scoped')
                const sc = merged as ScopedCondition
                expect(sc.conditions).to.have.length(1)
                expect((sc.conditions[0] as PrimitiveCondition).column).to.equal('id')
                merged.unlink()
                left.unlink()
                right.unlink()
            })

            it('should return a merged root with only left children when right is empty', () => {
                const left  = root('t', primEq('id', 1))
                const right = root('t')

                const merged = TreeMerger.merge(left, right).tree
                const sc = merged as ScopedCondition
                expect(sc.conditions).to.have.length(1)
                merged.unlink()
                left.unlink()
                right.unlink()
            })

            it('should return an empty merged root when both trees are empty', () => {
                const left  = root('t')
                const right = root('t')

                const merged = TreeMerger.merge(left, right).tree
                const sc = merged as ScopedCondition
                expect(sc.conditions).to.have.length(0)
                merged.unlink()
                left.unlink()
                right.unlink()
            })
        })

        describe('child flattening', () => {
            it('should flatten children of both roots into the merged root', () => {
                const left  = root('t', primEq('a', 1), primEq('b', 2))
                const right = root('t', primEq('c', 3))

                const merged = TreeMerger.merge(left, right).tree as ScopedCondition
                expect(merged.conditions).to.have.length(3)
                expect((merged.conditions[0] as PrimitiveCondition).column).to.equal('a')
                expect((merged.conditions[1] as PrimitiveCondition).column).to.equal('b')
                expect((merged.conditions[2] as PrimitiveCondition).column).to.equal('c')
                merged.unlink()
                left.unlink()
                right.unlink()
            })

            it('should inherit alias from left root', () => {
                const left  = root('my_alias', primEq('a', 1))
                const right = root('other',    primEq('b', 2))

                const merged = TreeMerger.merge(left, right).tree as ScopedCondition
                expect(merged.alias).to.equal('my_alias')
                merged.unlink()
                left.unlink()
                right.unlink()
            })

            it('should leave original roots as empty shells after merge', () => {
                const p1 = primEq('a', 1)
                const p2 = primEq('b', 2)
                const left  = root('t', p1)
                const right = root('t', p2)

                const merged = TreeMerger.merge(left, right).tree as ScopedCondition
                expect(left.conditions).to.have.length(0)
                expect(right.conditions).to.have.length(0)
                expect(merged.conditions).to.have.length(2)
                merged.unlink()
                left.unlink()
                right.unlink()
            })

            it('should update parent references for moved children', () => {
                const p1 = primEq('a', 1)
                const p2 = primEq('b', 2)
                const left  = root('t', p1)
                const right = root('t', p2)

                const merged = TreeMerger.merge(left, right).tree as ScopedCondition
                expect(p1.parent).to.equal(merged)
                expect(p2.parent).to.equal(merged)
                merged.unlink()
                left.unlink()
                right.unlink()
            })
        })

        describe('serialization equivalence', () => {
            it('should produce AND semantics (both conditions must apply)', () => {
                // Merged: AND(id=1, title='x') — both conditions present
                const left  = root('t', primEq('id', 1))
                const right = root('t', primEq('title', 'x'))

                const merged = TreeMerger.merge(left, right).tree as ScopedCondition
                expect(merged.scope).to.equal(ScopeOp.AND)
                expect(merged.conditions).to.have.length(2)
                merged.unlink()
                left.unlink()
                right.unlink()
            })

            it('should preserve nested scopes from left', () => {
                const orSc  = orScope(primEq('id', 1), primEq('id', 2))
                const left  = root('t', orSc)
                const right = root('t', primGt('id', 0))

                const merged = TreeMerger.merge(left, right).tree as ScopedCondition
                expect(merged.conditions).to.have.length(2)
                expect((merged.conditions[0] as ScopedCondition).scope).to.equal(ScopeOp.OR)
                merged.unlink()
                left.unlink()
                right.unlink()
            })

            it('should preserve nested scopes from right (join scope)', () => {
                const join  = joinScope('author', 't')
                join.push(primEq('id', 5))
                const left  = root('t')
                const right = root('t', join)

                const merged = TreeMerger.merge(left, right).tree as ScopedCondition
                expect(merged.conditions).to.have.length(1)
                const child = merged.conditions[0] as ScopedCondition
                expect(child.join).to.be.true
                expect(child.conditions).to.have.length(1)
                merged.unlink()
                left.unlink()
                right.unlink()
            })
        })
    })

    describe('dedupe', () => {
        it('should remove an identical duplicate primitive at the same level', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            scope.push(primEq('id', 1))
            scope.push(primEq('id', 1))
            scope.push(primEq('id', 2))

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(2)
            expect((scope.conditions[0] as PrimitiveCondition).operand).to.equal(1)
            expect((scope.conditions[1] as PrimitiveCondition).operand).to.equal(2)
            scope.unlink()
        })

        it('should keep distinct primitives', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            scope.push(primEq('id', 1))
            scope.push(primEq('id', 2))

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(2)
            scope.unlink()
        })

        it('should remove duplicate literal conditions', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            scope.push(new LiteralCondition(true))
            scope.push(new LiteralCondition(true))

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(1)
            scope.unlink()
        })

        it('should keep true and false literals as distinct', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            scope.push(new LiteralCondition(true))
            scope.push(new LiteralCondition(false))

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(2)
            scope.unlink()
        })

        it('should remove duplicate scoped subtrees', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            const s1 = andScope(primEq('id', 1))
            const s2 = andScope(primEq('id', 1))
            scope.push(s1)
            scope.push(s2)

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(1)
            scope.unlink()
        })

        it('should not dedupe non-identical scoped subtrees', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            const s1 = andScope(primEq('id', 1))
            const s2 = andScope(primEq('id', 2))
            scope.push(s1)
            scope.push(s2)

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(2)
            scope.unlink()
        })

        it('should remove the second occurrence when ability and external filters share a predicate', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            const caslPred   = primEq('id', 1)
            const filterPred = primEq('id', 1)
            scope.push(caslPred)
            scope.push(filterPred)

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(1)
            expect(scope.conditions[0]).to.equal(caslPred)
            scope.unlink()
        })

        it('should dedupe when same external filter is duplicated', () => {
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            scope.push(primGt('id', 0))
            scope.push(primGt('id', 0))
            scope.push(primGt('id', 0))

            TreeMerger.dedupe(scope)

            expect(scope.conditions).to.have.length(1)
            scope.unlink()
        })

        it('should only dedupe at the top level (not recurse into children)', () => {
            // inner scope has duplicates — dedupe should NOT remove them
            const inner = andScope(primEq('id', 1), primEq('id', 1))
            const scope = new ScopedCondition({ alias: 't', scope: ScopeOp.AND })
            scope.push(inner)

            TreeMerger.dedupe(scope)

            // Top-level scope still has 1 child (the inner scope)
            expect(scope.conditions).to.have.length(1)
            // Inner scope still has 2 children (dedupe did not recurse)
            expect(inner.conditions).to.have.length(2)
            scope.unlink()
        })
    })

    describe('nodesAreEqual', () => {
        describe('literal nodes', () => {
            it('should return true for two true literals', () => {
                expect(TreeMerger.nodesAreEqual(
                    new LiteralCondition(true),
                    new LiteralCondition(true)
                )).to.be.true
            })

            it('should return true for two false literals', () => {
                expect(TreeMerger.nodesAreEqual(
                    new LiteralCondition(false),
                    new LiteralCondition(false)
                )).to.be.true
            })

            it('should return false for true vs false', () => {
                expect(TreeMerger.nodesAreEqual(
                    new LiteralCondition(true),
                    new LiteralCondition(false)
                )).to.be.false
            })
        })

        describe('primitive nodes', () => {
            it('should return true for identical primitives', () => {
                expect(TreeMerger.nodesAreEqual(
                    primEq('id', 1),
                    primEq('id', 1)
                )).to.be.true
            })

            it('should return false when columns differ', () => {
                expect(TreeMerger.nodesAreEqual(
                    primEq('id', 1),
                    primEq('title', 1)
                )).to.be.false
            })

            it('should return false when operators differ', () => {
                const a = new PrimitiveCondition({ column: 'id', operator: PrimOp.EQUAL,        operand: 1 })
                const b = new PrimitiveCondition({ column: 'id', operator: PrimOp.GREATER_THAN, operand: 1 })
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
            })

            it('should return false when operands differ', () => {
                expect(TreeMerger.nodesAreEqual(
                    primEq('id', 1),
                    primEq('id', 2)
                )).to.be.false
            })

            it('should handle array operands', () => {
                const a = new PrimitiveCondition({ column: 'id', operator: PrimOp.IN, operand: [1, 2] })
                const b = new PrimitiveCondition({ column: 'id', operator: PrimOp.IN, operand: [1, 2] })
                const c = new PrimitiveCondition({ column: 'id', operator: PrimOp.IN, operand: [1, 3] })
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.true
                expect(TreeMerger.nodesAreEqual(a, c)).to.be.false
            })

            it('should handle Date operands (non-array object)', () => {
                const d1 = new Date('2024-01-01T00:00:00.000Z')
                const d2 = new Date('2024-01-01T00:00:00.000Z')
                const d3 = new Date('2024-06-01T00:00:00.000Z')
                const a = new PrimitiveCondition({ column: 'ts', operator: PrimOp.EQUAL, operand: d1 })
                const b = new PrimitiveCondition({ column: 'ts', operator: PrimOp.EQUAL, operand: d2 })
                const c = new PrimitiveCondition({ column: 'ts', operator: PrimOp.EQUAL, operand: d3 })
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.true
                expect(TreeMerger.nodesAreEqual(a, c)).to.be.false
            })

            it('should return false when one operand is null and the other is not', () => {
                const a = new PrimitiveCondition({ column: 'id', operator: PrimOp.IS,    operand: null })
                const b = new PrimitiveCondition({ column: 'id', operator: PrimOp.IS,    operand: true })
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
            })

            it('should return false when operands have different types', () => {
                const a = new PrimitiveCondition({ column: 'id', operator: PrimOp.EQUAL, operand: 1    })
                const b = new PrimitiveCondition({ column: 'id', operator: PrimOp.EQUAL, operand: '1' })
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
            })

            it('should return false when array operands have different lengths', () => {
                const a = new PrimitiveCondition({ column: 'id', operator: PrimOp.IN, operand: [1, 2]    })
                const b = new PrimitiveCondition({ column: 'id', operator: PrimOp.IN, operand: [1, 2, 3] })
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
            })
        })

        describe('scoped nodes', () => {
            it('should return true for two identical AND scopes', () => {
                const a = andScope(primEq('id', 1))
                const b = andScope(primEq('id', 1))
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.true
                a.unlink()
                b.unlink()
            })

            it('should return false when scope types differ', () => {
                const a = andScope(primEq('id', 1))
                const b = orScope(primEq('id', 1))
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
                a.unlink()
                b.unlink()
            })

            it('should return false when join flags differ', () => {
                const a = new ScopedCondition({ scope: ScopeOp.AND, join: false })
                const b = new ScopedCondition({ scope: ScopeOp.AND, join: true })
                a.push(primEq('id', 1))
                b.push(primEq('id', 1))
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
                a.unlink()
                b.unlink()
            })

            it('should return false when raw columns differ', () => {
                const a = new ScopedCondition({ scope: ScopeOp.AND, join: true, column: 'author' })
                const b = new ScopedCondition({ scope: ScopeOp.AND, join: true, column: 'editor' })
                a.push(primEq('id', 1))
                b.push(primEq('id', 1))
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
                a.unlink()
                b.unlink()
            })

            it('should return false when raw aliases differ', () => {
                const a = new ScopedCondition({ scope: ScopeOp.AND, join: true, column: 'rel', alias: 't_rel_1' })
                const b = new ScopedCondition({ scope: ScopeOp.AND, join: true, column: 'rel', alias: 't_rel_2' })
                a.push(primEq('id', 1))
                b.push(primEq('id', 1))
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
                a.unlink()
                b.unlink()
            })

            it('should return false when child counts differ', () => {
                const a = andScope(primEq('id', 1), primEq('id', 2))
                const b = andScope(primEq('id', 1))
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
                a.unlink()
                b.unlink()
            })

            it('should return false when a child differs', () => {
                const a = andScope(primEq('id', 1))
                const b = andScope(primEq('id', 2))
                expect(TreeMerger.nodesAreEqual(a, b)).to.be.false
                a.unlink()
                b.unlink()
            })

            it('should return false when types differ (literal vs primitive)', () => {
                expect(TreeMerger.nodesAreEqual(
                    new LiteralCondition(true),
                    primEq('id', 1)
                )).to.be.false
            })
        })
    })

    describe('simplification after merge', () => {
        it('should remove LiteralCondition(true) from AND (neutral element)', () => {
            const left  = root('t', new LiteralCondition(true))
            const right = root('t', primEq('id', 1))

            const merged = TreeMerger.merge(left, right).tree as ScopedCondition
            // true is neutral for AND → removed
            expect(merged.conditions).to.have.length(1)
            expect(merged.conditions[0].type).to.equal('primitive')
            merged.unlink()
            left.unlink()
            right.unlink()
        })

        it('should short-circuit to empty root when AND contains LiteralCondition(false)', () => {
            const left  = root('t', new LiteralCondition(false))
            const right = root('t', primEq('id', 1))

            const merged = TreeMerger.merge(left, right).tree as ScopedCondition
            // false in AND → merged becomes (1=0) sentinel
            expect(merged.conditions).to.have.length(1)
            expect(merged.conditions[0].type).to.equal('literal')
            expect((merged.conditions[0] as LiteralCondition).value).to.be.false
            merged.unlink()
            left.unlink()
            right.unlink()
        })

        it('should produce empty root when all literals simplify to true', () => {
            const left  = root('t', new LiteralCondition(true))
            const right = root('t', new LiteralCondition(true))

            const merged = TreeMerger.merge(left, right).tree as ScopedCondition
            // AND(true, true) → empty (no constraint)
            expect(merged.conditions).to.have.length(0)
            merged.unlink()
            left.unlink()
            right.unlink()
        })
    })

    describe('merge end-to-end deduplication', () => {
        it('should dedupe when ability and external filter both add the same predicate', () => {
            // Ability: id = 1
            const abilityTree = root('t', primEq('id', 1))
            // External filter: id = 1 (same predicate)
            const filterTree  = root('t', primEq('id', 1))

            const merged = TreeMerger.merge(abilityTree, filterTree).tree as ScopedCondition
            expect(merged.conditions).to.have.length(1)
            merged.unlink()
            abilityTree.unlink()
            filterTree.unlink()
        })

        it('should dedupe when the same external filter is applied twice', () => {
            const filter1 = root('t', primGt('id', 0))
            const filter2 = root('t', primGt('id', 0), primGt('id', 0))

            const merged = TreeMerger.merge(filter1, filter2).tree as ScopedCondition
            // filter1: 1 condition; filter2: 2 conditions (one is duplicate)
            // After merge: 3 total → dedupe removes 2 duplicates → 1
            expect(merged.conditions).to.have.length(1)
            merged.unlink()
            filter1.unlink()
            filter2.unlink()
        })

        it('should preserve distinct conditions when no duplicates exist', () => {
            const abilityTree = root('t', primEq('id', 1))
            const filterTree  = root('t', primGt('id', 0))

            const merged = TreeMerger.merge(abilityTree, filterTree).tree as ScopedCondition
            expect(merged.conditions).to.have.length(2)
            merged.unlink()
            abilityTree.unlink()
            filterTree.unlink()
        })

        it('should preserve complex scopes from both trees when no duplicates', () => {
            const orSc = orScope(primEq('id', 1), primEq('id', 2))
            const abilityTree = root('t', orSc)
            const filterTree  = root('t', primGt('id', 0), primEq('title', 'hi'))

            const merged = TreeMerger.merge(abilityTree, filterTree).tree as ScopedCondition
            expect(merged.conditions).to.have.length(3)
            merged.unlink()
            abilityTree.unlink()
            filterTree.unlink()
        })
    })
})
