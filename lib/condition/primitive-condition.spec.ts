import 'mocha'
import { expect } from 'chai'
import { PrimitiveCondition } from './primitive-condition'
import { PrimOp } from './types'

describe('PrimitiveCondition', () => {
    describe('constructor', () => {
        it('should set properties', () => {
            const condition = new PrimitiveCondition({
                operator: PrimOp.IS,
                operand: null,
            })
            expect(condition['operator']).to.equal(PrimOp.IS)
            expect(condition['operand']).to.equal(null)
            expect(condition['type']).to.equal('primitive')
        })

        it('should set default values', () => {
            const condition = new PrimitiveCondition()
            expect(condition['operator']).to.equal(PrimOp.EQUAL)
            expect(condition['operand']).to.equal(0)
            expect(condition['type']).to.equal('primitive')
        })
    })
})
