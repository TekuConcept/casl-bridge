import 'mocha'
import { expect } from 'chai'
import { BaseCondition } from './base-condition'
import { ICondition, IScopedCondition, ScopeOp } from './types'

class TestBaseCondition extends BaseCondition {
    type: 'primitive'
}

class TestScopedCondition
extends BaseCondition
implements IScopedCondition {
    type: 'scoped'
    scope: ScopeOp
    conditions: ICondition[] = []
    join: boolean = false
}

describe('BaseCondition', () => {
    describe('constructor', () => {
        it('should set properties', () => {
            const condition = new TestScopedCondition({
                column: 'column',
                alias: 'test',
                traceName: 'trace'
            })
            expect(condition['_column']).to.equal('column')
            expect(condition['_alias']).to.equal('test')
            expect(condition['_parent']).to.be.null
            expect(condition['_traceName']).to.equal('trace')

            const condition2 = new TestBaseCondition({
                column: 'column',
                alias: 'test2',
                parent: condition,
            })
            expect(condition2['_column']).to.equal('column')
            expect(condition2['_alias']).to.equal('test2')
            expect(condition2['_parent']).to.equal(condition)
            expect(condition2['_traceName']).to.equal('?')

            // cleanup
            condition.unlink()
            condition2.unlink()
        })

        it('should set default values', () => {
            const condition = new TestScopedCondition()
            expect(condition['_column']).to.be.null
            expect(condition['_alias']).to.be.null
            expect(condition['_parent']).to.be.null
        })
    })

    describe('alias', () => {
        it('should return the alias if not null', () => {
            const condition = new TestScopedCondition({ alias: 'test' })
            expect(condition.alias).to.equal('test')
        })

        it('should return the parent alias if null', () => {
            const parent = new TestScopedCondition({ alias: 'parent' })
            const condition = new TestBaseCondition({ parent: parent })
            expect(condition.alias).to.equal('parent')

            // cleanup
            parent.unlink()
        })

        it('should throw an error if no alias is found', () => {
            const condition = new TestScopedCondition()
            expect(() => condition.alias).to.throw('Alias not set!\n\nTRACE: ?')
        })
    })

    describe('column', () => {
        it('should return the column if not null', () => {
            const condition = new TestScopedCondition({ column: 'test' })
            expect(condition.column).to.equal('test')
        })

        it('should return the parent column if null', () => {
            const parent = new TestScopedCondition({ column: 'test' })
            const condition = new TestBaseCondition({ parent: parent })
            expect(condition.column).to.equal('test')

            // cleanup
            parent.unlink()
        })

        it('should throw an error if no columnId is found', () => {
            const condition = new TestScopedCondition()
            expect(() => condition.column).to.throw('Column not found!\n\nTRACE: ?')
        })
    })

    describe('unlink', () => {
        it('should set the parent to null', () => {
            const parent = new TestScopedCondition()
            const condition = new TestBaseCondition({ parent: parent })

            expect(condition['_parent']).to.not.be.null
            condition.unlink()
            expect(condition['_parent']).to.be.null
        })
    })

    describe('trace', () => {
        it('should return the traceName if no parent', () => {
            const condition = new TestScopedCondition({ traceName: 'test' })
            expect(condition.trace()).to.equal('TRACE: test')
        })

        it('should return the parent traceName if parent', () => {
            const parent = new TestScopedCondition({ traceName: 'parent' })
            const condition = new TestScopedCondition({
                traceName: 'test',
                parent: parent
            })
            expect(condition.trace()).to.equal('TRACE: parent > test')

            // cleanup
            parent.unlink()
        })
    })
})
