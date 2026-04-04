import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { TypeOrmSchema_TestContext } from './types.test'
import { TypeOrmQueryBuilder } from './typeorm-query-builder'
import { TypeOrmBrackets } from './typeorm-brackets'

export function describeTypeOrmQueryBuilder(
    ctx: TypeOrmSchema_TestContext
) {
    
    describe('TypeOrmQueryBuilder', () => {
        describe('nextParamId', () => {
            it('should return 0 if no parameters', () => {
                const builder = new TypeOrmQueryBuilder(null, null, null, {})
                expect(builder.nextParamId()).to.equal(0)
            })

            it('should return the next parameter ID', () => {
                const builder = new TypeOrmQueryBuilder(
                    null, null, null,
                    {
                        param_1: 0,
                        param_3: 0,
                        param_2: 0,
                        param_0: 0,
                    }
                )
                expect(builder.nextParamId()).to.equal(4)
            })
        })

        describe('join', () => {
            it('should call base join function', () => {
                const joinStub = sinon.stub()
                const builder = new TypeOrmQueryBuilder(null, joinStub, null)

                builder.join('relation', 'alias')
                expect(joinStub.calledOnceWith('relation', 'alias')).to.be.true
            })
        })

        describe('select', () => {
            it('should call base select function', () => {
                const selectStub = sinon.stub()
                const builder = new TypeOrmQueryBuilder(null, null, selectStub)
                const params = ['column']

                builder.select(params)
                expect(selectStub.calledOnceWith(params)).to.be.true
            })
        })

        describe('where', () => {
            it('should call base where function', () => {
                const where = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ where } as any, null, null)
                const params = { param: 'value' }

                builder.where('condition', params)
                expect(where.calledOnceWith('condition', params)).to.be.true
            })

            it('should call base where function with brackets', () => {
                const where = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ where } as any, null, null)
                const params = { param: 'value' }
                const brackets = { data: {} }

                builder.where(brackets, params)
                expect(where.calledOnceWith(brackets.data, params)).to.be.true
            })
        })

        describe('andWhere', () => {
            it('should call base andWhere function', () => {
                const andWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ andWhere } as any, null, null)
                const params = { param: 'value' }

                builder.andWhere('condition', params)
                expect(andWhere.calledOnceWith('condition', params)).to.be.true
            })

            it('should call base andWhere function with brackets', () => {
                const andWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ andWhere } as any, null, null)
                const params = { param: 'value' }
                const brackets = { data: {} }

                builder.andWhere(brackets, params)
                expect(andWhere.calledOnceWith(brackets.data, params)).to.be.true
            })
        })

        describe('orWhere', () => {
            it('should call base orWhere function', () => {
                const orWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ orWhere } as any, null, null)
                const params = { param: 'value' }

                builder.orWhere('condition', params)
                expect(orWhere.calledOnceWith('condition', params)).to.be.true
            })

            it('should call base orWhere function with brackets', () => {
                const orWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ orWhere } as any, null, null)
                const params = { param: 'value' }
                const brackets = { data: {} }

                builder.orWhere(brackets, params)
                expect(orWhere.calledOnceWith(brackets.data, params)).to.be.true
            })
        })

        describe('createBrackets', () => {
            it('should create a new instance', () => {
                const builder = new TypeOrmQueryBuilder(null, null, null)
                const bracketsCallback = sinon.stub()

                const bracketsInstance = builder.createBrackets(bracketsCallback)
                expect(bracketsInstance).to.be.instanceOf(TypeOrmBrackets)
            })
        })

        describe('createNotBrackets', () => {
            it('should create a new instance', () => {
                const builder = new TypeOrmQueryBuilder(null, null, null)
                const bracketsCallback = sinon.stub()

                const bracketsInstance = builder.createNotBrackets(bracketsCallback)
                expect(bracketsInstance).to.be.instanceOf(TypeOrmBrackets)
            })
        })
    })
}
