import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { ScopedCondition } from './scoped-condition'
import { ScopeOp } from './types'

describe('ScopedCondition', () => {
    describe('constructor', () => {
        it('should set properties', () => {
            const condition = new ScopedCondition({
                scope: ScopeOp.OR,
                join: true,
            })
            expect(condition['scope']).to.equal(ScopeOp.OR)
            expect(condition['join']).to.be.true
            expect(condition['conditions']).to.be.empty
            expect(condition['type']).to.equal('scoped')
        })

        it('should set default values', () => {
            const condition = new ScopedCondition()
            expect(condition['scope']).to.equal(ScopeOp.AND)
            expect(condition['join']).to.be.false
            expect(condition['conditions']).to.be.empty
            expect(condition['type']).to.equal('scoped')
        })
    })

    describe('push', () => {
        it('should set parent and push condition', () => {
            const condition = new ScopedCondition()
            const child = sinon.createStubInstance(ScopedCondition)

            expect(condition.conditions).to.be.empty

            condition.push(child)

            expect(child.parent).to.equal(condition)
            expect(condition.conditions).to.have.length(1)
            expect(condition.conditions[0]).to.equal(child)

            // cleanup
            condition.clear()
        })
    })

    describe('clear', () => {
        it('should unlink all conditions', () => {
            const condition = new ScopedCondition()
            const child = sinon.createStubInstance(ScopedCondition)
            condition.conditions.push(child)

            expect(condition.conditions).to.have.length(1)

            condition.clear()

            expect(condition.conditions).to.be.empty
            expect(child.unlink.calledOnce).to.be.true
        })
    })

    describe('unlink', () => {
        it('should unlink all conditions', () => {
            const condition = new ScopedCondition()
            const child = new ScopedCondition()
            const grandchild = new ScopedCondition()

            condition.push(child)
            child.push(grandchild)

            expect(grandchild.parent).to.not.be.null
            expect(child.parent).to.not.be.null
            expect(condition.parent).to.be.null
            expect(condition.conditions).to.have.length(1)
            expect(child.conditions).to.have.length(1)

            condition.unlink()

            expect(grandchild.parent).to.be.null
            expect(child.parent).to.be.null
            expect(condition.parent).to.be.null
            expect(condition.conditions).to.be.empty
            expect(child.conditions).to.be.empty
        })
    })
})
