import 'mocha'
import { expect } from 'chai'
import { LiteralCondition } from './literal-condition'
import { ScopedCondition } from './scoped-condition'

describe('LiteralCondition', () => {
    describe('constructor', () => {
        it('should set value to true', () => {
            const condition = new LiteralCondition(true)
            expect(condition.value).to.be.true
            expect(condition.type).to.equal('literal')
        })

        it('should set value to false', () => {
            const condition = new LiteralCondition(false)
            expect(condition.value).to.be.false
            expect(condition.type).to.equal('literal')
        })

        it('should set a descriptive traceName', () => {
            const t = new LiteralCondition(true)
            const f = new LiteralCondition(false)
            expect(t.trace()).to.include('TRUE')
            expect(f.trace()).to.include('FALSE')
        })

        it('should have null alias, column and parent by default', () => {
            const condition = new LiteralCondition(false)
            expect(condition.parent).to.be.null
        })
    })

    describe('unlink', () => {
        it('should clear the parent reference', () => {
            const parent = new ScopedCondition({ alias: '__table__' })
            const condition = new LiteralCondition(false)
            parent.push(condition)

            expect(condition.parent).to.equal(parent)
            condition.unlink()
            expect(condition.parent).to.be.null

            // cleanup
            parent.clear()
        })
    })
})
