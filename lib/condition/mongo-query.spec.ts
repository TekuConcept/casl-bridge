import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { MongoQuery, MongoTreeBuilder } from './mongo-query'
import { ScopedCondition } from './scoped-condition'
import { PrimitiveCondition } from './primitive-condition'
import { PrimOp, ScopeOp } from './types'

describe('MongoQuery', () => {
    describe('constructor', () => {
        it('should set properties', () => {
            const value = {}
            const query = new MongoQuery(value)

            expect(query['query']).to.equal(value)
            expect(query['_tree']).to.be.null
        })
    })

    describe('isEmpty', () => {
        it('should return true if query is empty', () => {
            const query = new MongoQuery({})
            expect(query.isEmpty()).to.be.true
        })

        it('should return false if query is not empty', () => {
            const query = new MongoQuery({ field: 1 })
            expect(query.isEmpty()).to.be.false
        })
    })

    describe('build', () => {
        it('should return the tree if already built', () => {
            const query = new MongoQuery({})
            const tree = new ScopedCondition()
            query['_tree'] = tree
            expect(query.build()).to.equal(tree)
        })

        it('should build the tree', () => {
            const query = new MongoQuery({})

            const result = query.build()
            expect(result.alias).to.equal('__root__')
            expect(result.type).to.equal('scoped')

            result.unlink()
        })
    })

    describe('tree', () => {
        it('should get the current tree', () => {
            const query = new MongoQuery({})
            const tree = new ScopedCondition()
            query['_tree'] = tree
            expect(query.tree).to.equal(tree)
        })
    })
})

describe('MongoTreeBuilder', () => {
    describe('constructor', () => {
        it('should set properties', () => {
            const value = {}
            const builder = new MongoTreeBuilder(value)

            expect(builder['query']).to.equal(value)
            expect(builder['alias']).to.equal('__root__')
            expect(builder['conditionStack']).to.eql([])
            expect(builder['fieldStack']).to.eql([])
        })
    })

    describe('isQuery', () => {
        it('should return true if all keys start with $', () => {
            const builder = new MongoTreeBuilder({})
            const result = builder.isQuery({ $and: [] })

            expect(result).to.be.true
        })

        it('should return false if any key does not start with $', () => {
            const builder = new MongoTreeBuilder({})
            const result = builder.isQuery({ $and: [], test: 1 })

            expect(result).to.be.false
        })
    })

    describe('build', () => {
        it('should build an empty query', () => {
            const builder = new MongoTreeBuilder({})
            const result = builder.build() as ScopedCondition

            expect(result.type).to.equal('scoped')
            expect(result.scope).to.equal(ScopeOp.AND)
            expect(result.conditions).to.have.lengthOf(0)

            result.unlink()
        })

        it('should build a field query', () => {
            const builder = new MongoTreeBuilder({ field: 1 })
            const result = builder.build() as ScopedCondition

            expect(result.type).to.equal('scoped')
            expect(result.scope).to.equal(ScopeOp.AND)
            expect(result.conditions).to.have.lengthOf(1)

            const condition = result.conditions[0] as PrimitiveCondition
            expect(condition.column).to.equal('field')
            expect(condition.operator).to.equal(PrimOp.EQUAL)
            expect(condition.operand).to.equal(1)

            result.unlink()
        })

        it('should build a complex query', () => {
            const builder = new MongoTreeBuilder({
                $and: [
                    { field: 1 },
                    {
                        field2: 2,
                        field3: {
                            id: { $eq: 3 }
                        }
                    }
                ]
            })
            const root = builder.build() as ScopedCondition

            // root is scoped-AND
            expect(root.type).to.equal('scoped')
            expect(root.scope).to.equal(ScopeOp.AND)
            expect(root.conditions).to.have.lengthOf(1)
            expect(root.alias).to.equal('__root__')

            // $and operations
            const and = root.conditions[0] as ScopedCondition
            expect(and.type).to.equal('scoped')
            expect(and.scope).to.equal(ScopeOp.AND)
            expect(and.conditions).to.have.lengthOf(2)
            expect(and.alias).to.equal('__root__')

            // { field1 } is scoped-AND
            const first = and.conditions[0] as ScopedCondition
            expect(first.type).to.equal('scoped')
            expect(first.scope).to.equal(ScopeOp.AND)
            expect(first.conditions).to.have.lengthOf(1)
            expect(first.alias).to.equal('__root__')

            // field1 is primitive
            const field1 = first.conditions[0] as PrimitiveCondition
            expect(field1.type).to.equal('primitive')
            expect(field1.column).to.equal('field')
            expect(field1.operator).to.equal(PrimOp.EQUAL)
            expect(field1.operand).to.equal(1)
            expect(field1.alias).to.equal('__root__')

            // { field2, field3 } is scoped-AND
            const second = and.conditions[1] as ScopedCondition
            expect(second.type).to.equal('scoped')
            expect(second.scope).to.equal(ScopeOp.AND)
            expect(second.conditions).to.have.lengthOf(2)
            expect(second.alias).to.equal('__root__')

            // field2 is primitive
            const field2 = second.conditions[0] as PrimitiveCondition
            expect(field2.type).to.equal('primitive')
            expect(field2.column).to.equal('field2')
            expect(field2.operator).to.equal(PrimOp.EQUAL)
            expect(field2.operand).to.equal(2)
            expect(field2.alias).to.equal('__root__')

            // field3 { id } is scoped-AND
            const field3 = second.conditions[1] as ScopedCondition
            expect(field3.type).to.equal('scoped')
            expect(field3.scope).to.equal(ScopeOp.AND)
            expect(field3.conditions).to.have.lengthOf(1)
            expect(field3.column).to.equal('field3')
            expect(field3.alias).to.equal('__root___field3')

            // id is primitive
            const id = field3.conditions[0] as PrimitiveCondition
            expect(id.type).to.equal('primitive')
            expect(id.column).to.equal('id')
            expect(id.operator).to.equal(PrimOp.EQUAL)
            expect(id.operand).to.equal(3)
            expect(id.alias).to.equal('__root___field3')

            root.unlink()
        })
    })

    describe('getTraceName', () => {
        it('should return the field and operator if field is provided', () => {
            const builder = new MongoTreeBuilder({})
            const result = builder.getTraceName('$and', 'field')

            expect(result).to.equal('field > $and')
        })

        it('should return only the operator if field is not provided', () => {
            const builder = new MongoTreeBuilder({})
            const result = builder.getTraceName('$and')

            expect(result).to.equal('$and')
        })
    })

    describe('scopedInvoke', () => {
        let builder: MongoTreeBuilder
        let root: ScopedCondition

        beforeEach(() => {
            builder = new MongoTreeBuilder({})
            root = new ScopedCondition({ alias: '__root__' })
            builder['conditionStack'].push(root)
        })
        afterEach(() => root.unlink())

        it('should push a new scope onto the stack', () => {
            const callback = sinon.stub().callsFake(() => {
                expect(builder['conditionStack']).to.have.lengthOf(2)
                const scope = builder['conditionStack'][1]

                expect(scope.parent).to.equal(root)
                expect(scope.alias).to.equal('__root__')
                expect(scope['_traceName']).to.equal('field > $and')
            })

            builder.scopedInvoke(callback, 'field')

            expect(builder['conditionStack']).to.have.lengthOf(1)
            expect(callback.calledOnce).to.be.true
            expect(root.conditions).to.have.lengthOf(1)
        })

        it('should join alias', () => {
            const callback = sinon.stub()
            builder.scopedInvoke(callback, 'field', ScopeOp.AND, true)
            expect(callback.calledOnce).to.be.true
            expect(root.conditions).to.have.lengthOf(1)
            const condition = root.conditions[0]
            expect(condition.alias).to.equal('__root___field')
        })

        it('should push a new AND scope', () => {
            const callback = sinon.stub().callsFake(() => {
                expect(builder['conditionStack']).to.have.lengthOf(2)
                const scope = builder['conditionStack'][1]
                expect(scope['_traceName']).to.equal('field > $and')
            })

            builder.scopedInvoke(callback, 'field', ScopeOp.AND)
            expect(callback.calledOnce).to.be.true
        })

        it('should push a new OR scope', () => {
            const callback = sinon.stub().callsFake(() => {
                expect(builder['conditionStack']).to.have.lengthOf(2)
                const scope = builder['conditionStack'][1]
                expect(scope['_traceName']).to.equal('field > $or')
            })

            builder.scopedInvoke(callback, 'field', ScopeOp.OR)
            expect(callback.calledOnce).to.be.true
        })

        it('should push a new NOT scope', () => {
            const callback = sinon.stub().callsFake(() => {
                expect(builder['conditionStack']).to.have.lengthOf(2)
                const scope = builder['conditionStack'][1]
                expect(scope['_traceName']).to.equal('field > $not')
            })

            builder.scopedInvoke(callback, 'field', ScopeOp.NOT)
            expect(callback.calledOnce).to.be.true
        })

        it('should throw an error if unknown scope provided', () => {
            const callback = sinon.stub()
            expect(() => builder.scopedInvoke(callback, 'field', 99 as any))
                .to.throw('Unknown scope: 99')
            expect(callback.notCalled).to.be.true
        })

        it('should throw an error if no field for join', () => {
            const callback = sinon.stub()
            expect(() => builder.scopedInvoke(
                callback,
                undefined, // use empty field
                undefined, // use default scope
                true
            )).to.throw('Expected field name for join')
            expect(callback.notCalled).to.be.true
        })

        it('should set column to null if empty field', () => {
            const callback = sinon.stub().callsFake(() => {
                expect(builder['conditionStack']).to.have.lengthOf(2)
                const scope = builder['conditionStack'][1]
                expect(scope['_column']).to.be.null
            })

            builder.scopedInvoke(callback, undefined)
            expect(callback.calledOnce).to.be.true
        })
    })

    describe('buildObject', () => {
        let builder: MongoTreeBuilder

        beforeEach(() => builder = new MongoTreeBuilder({}))

        it('should throw an error if input not an object', () => {
            expect(() => builder.buildObject(2 as any)).to.throw('Expected object')
        })

        it('should build array of objects', () => {
            const buildOperator = sinon.stub(builder, 'buildOperator')
            const input = [{}, {}]
            builder.buildObject(input)
            expect(buildOperator.calledOnceWith('$and', input)).to.be.true
        })

        it('should build query object', () => {
            const buildOperator = sinon.stub(builder, 'buildOperator')
            const andObj = []
            const input = { $and: andObj }
            builder.buildObject(input)
            expect(buildOperator.calledOnceWith('$and', andObj)).to.be.true
        })

        it('should build fields object', () => {
            const buildField = sinon.stub(builder, 'buildField')
            const input = { field: 1 }
            builder.buildObject(input)
            expect(buildField.calledOnceWith('field', 1)).to.be.true
        })
    })

    describe('buildFields', () => {
        it('should build fields', () => {
            const builder = new MongoTreeBuilder({})
            const buildField = sinon.stub(builder, 'buildField')
            const input = { field: 1 }
            builder.buildFields(input)
            expect(buildField.calledOnceWith('field', 1)).to.be.true
        })
    })

    describe('collapseFields', () => {
        let builder: MongoTreeBuilder

        before(() => builder = new MongoTreeBuilder({}))

        it('should ignore non-dot fields', () => {
            const obj = {
                'id': 0,
                'title': 'Alice in Wonderland'
            }

            builder.collapseFields(obj)

            expect(obj).to.deep.equal({
                'id': 0,
                'title': 'Alice in Wonderland'
            })
        })

        it('should merge dot fields', () => {
            const obj = {
                id: 0,
                'author.id': { $eq: 1 },
                'author.name': 'Lewis Carroll'
            }

            builder.collapseFields(obj)

            expect(obj).to.deep.equal({
                id: 0,
                author: {
                    id: { $eq: 1 },
                    name: 'Lewis Carroll'
                }
            })
        })

        it('should merge field groups', () => {
            const obj = {
                id: 2,
                'author.id': { $eq: 1 },
                author: { name: 'Lewis Carroll' }
            }

            builder.collapseFields(obj)

            expect(obj).to.deep.equal({
                id: 2,
                author: {
                    id: { $eq: 1 },
                    name: 'Lewis Carroll'
                }
            })
        })

        it('should throw if field group is not object', () => {
            const obj = {
                id: 2,
                'author.id': { $eq: 1 },
                author: 'Lewis Carroll'
            }

            expect(() => builder.collapseFields(obj))
                .to.throw('Expected object for \'author\', got string')
        })
    })

    describe('buildField', () => {
        let builder: MongoTreeBuilder
        let root: ScopedCondition

        beforeEach(() => {
            builder = new MongoTreeBuilder({})
            root = new ScopedCondition({ alias: '__root__' })
            builder['conditionStack'].push(root)
        })
        afterEach(() => root.unlink())

        it('should build null field', () => {
            const buildOperator = sinon.stub(builder, 'buildOperator')
                .callsFake(() => {
                    expect(builder['fieldStack']).to.deep.equal(['field'])
                })
            builder.buildField('field', null)
            expect(buildOperator.calledOnceWith('$is', null)).to.be.true
            expect(builder['fieldStack']).to.be.empty
        })

        it('should build array field', () => {
            const buildOperator = sinon.stub(builder, 'buildOperator')
                .callsFake(() => {
                    expect(builder['fieldStack']).to.deep.equal(['field'])
                })
            const value = []
            builder.buildField('field', value)
            expect(buildOperator.calledOnceWith('$in', value)).to.be.true
            expect(builder['fieldStack']).to.be.empty
        })

        it('should build query object field', () => {
            const buildQuery = sinon.stub(builder, 'buildQuery')
                .callsFake(() => {
                    expect(builder['fieldStack']).to.deep.equal(['field'])
                })
            const value = {}
            builder.buildField('field', value)
            expect(buildQuery.calledOnceWith(value)).to.be.true
            expect(builder['fieldStack']).to.be.empty
        })

        it('should build embedded fields', () => {
            const value = { embedded: 1 }
            const buildFields = sinon.stub(builder, 'buildFields')
                .callsFake(() => {
                    expect(builder['fieldStack']).to.deep.equal(['field'])
                })

            builder.buildField('field', value)

            expect(buildFields.calledOnceWith(value)).to.be.true
            expect(builder['fieldStack']).to.deep.equal([])

            expect(root.conditions).to.have.lengthOf(1)
            const condition = root.conditions[0]
            expect(condition.alias).to.equal('__root___field')
        })

        it('should build general field', () => {
            const buildOperator = sinon.stub(builder, 'buildOperator')
                .callsFake(() => {
                    expect(builder['fieldStack']).to.deep.equal(['field'])
                })
            builder.buildField('field', 1)
            expect(buildOperator.calledOnceWith('$eq', 1)).to.be.true
            expect(builder['fieldStack']).to.be.empty
        })
    })

    describe('buildQuery', () => {
        it('should build operations', () => {
            const builder = new MongoTreeBuilder({})
            const buildOperator = sinon.stub(builder, 'buildOperator')
            const input = { '$eq': 1 }
            builder.buildQuery(input)
            expect(buildOperator.calledOnceWith('$eq', 1)).to.be.true
        })
    })

    describe('buildOperator', () => {
        let builder: MongoTreeBuilder
        let buildPrimCondition: sinon.SinonStub
        let root: ScopedCondition

        beforeEach(() => {
            builder = new MongoTreeBuilder({})
            builder['fieldStack'].push('field')
            root = new ScopedCondition({ alias: '__root__' })
            builder['conditionStack'].push(root)
            buildPrimCondition = sinon.stub(builder, 'buildPrimCondition')
        })
        afterEach(() => root.unlink())

        it('should build $eq operator', () => {
            builder.buildOperator('$eq', 1)
            expect(buildPrimCondition.calledOnceWith('$eq', PrimOp.EQUAL, 1, 'field')).to.be.true
        })

        it('should build $ne operator', () => {
            builder.buildOperator('$ne', 1)
            expect(buildPrimCondition.calledOnceWith('$ne', PrimOp.NOT_EQUAL, 1, 'field')).to.be.true
        })

        it('should build $ge operator', () => {
            builder.buildOperator('$ge', 1)
            expect(buildPrimCondition.calledOnceWith('$ge', PrimOp.GREATER_OR_EQUAL, 1, 'field')).to.be.true
        })

        it('should build $gte operator', () => {
            builder.buildOperator('$gte', 1)
            expect(buildPrimCondition.calledOnceWith('$gte', PrimOp.GREATER_OR_EQUAL, 1, 'field')).to.be.true
        })

        it('should build $gt operator', () => {
            builder.buildOperator('$gt', 1)
            expect(buildPrimCondition.calledOnceWith('$gt', PrimOp.GREATER_THAN, 1, 'field')).to.be.true
        })

        it('should build $le operator', () => {
            builder.buildOperator('$le', 1)
            expect(buildPrimCondition.calledOnceWith('$le', PrimOp.LESS_OR_EQUAL, 1, 'field')).to.be.true
        })

        it('should build $lte operator', () => {
            builder.buildOperator('$lte', 1)
            expect(buildPrimCondition.calledOnceWith('$lte', PrimOp.LESS_OR_EQUAL, 1, 'field')).to.be.true
        })

        it('should build $lt operator', () => {
            builder.buildOperator('$lt', 1)
            expect(buildPrimCondition.calledOnceWith('$lt', PrimOp.LESS_THAN, 1, 'field')).to.be.true
        })

        it('should build $is operator', () => {
            builder.buildOperator('$is', null)
            expect(buildPrimCondition.calledOnceWith('$is', PrimOp.IS, null, 'field')).to.be.true
        })

        it('should build $isNot operator', () => {
            builder.buildOperator('$isNot', null)
            expect(buildPrimCondition.calledOnceWith('$isNot', PrimOp.IS_NOT, null, 'field')).to.be.true
        })

        it('should build $in operator', () => {
            builder.buildOperator('$in', [1])
            expect(buildPrimCondition.calledOnceWith('$in', PrimOp.IN, [1], 'field')).to.be.true
        })

        it('should build $notIn operator', () => {
            builder.buildOperator('$notIn', [1])
            expect(buildPrimCondition.calledOnceWith('$notIn', PrimOp.NOT_IN, [1], 'field')).to.be.true
        })

        it('should build $like operator', () => {
            builder.buildOperator('$like', 'test')
            expect(buildPrimCondition.calledOnceWith('$like', PrimOp.LIKE, 'test', 'field')).to.be.true
        })

        it('should build $notLike operator', () => {
            builder.buildOperator('$notLike', 'test')
            expect(buildPrimCondition.calledOnceWith('$notLike', PrimOp.NOT_LIKE, 'test', 'field')).to.be.true
        })

        it('should build $iLike operator', () => {
            builder.buildOperator('$iLike', 'test')
            expect(buildPrimCondition.calledOnceWith('$iLike', PrimOp.ILIKE, 'test', 'field')).to.be.true
        })

        it('should build $notILike operator', () => {
            builder.buildOperator('$notILike', 'test')
            expect(buildPrimCondition.calledOnceWith('$notILike', PrimOp.NOT_ILIKE, 'test', 'field')).to.be.true
        })

        it('should build $regex operator', () => {
            builder.buildOperator('$regex', 'test')
            expect(buildPrimCondition.calledOnceWith('$regex', PrimOp.REGEX, 'test', 'field')).to.be.true
        })

        it('should build $regexp operator', () => {
            builder.buildOperator('$regexp', 'test')
            expect(buildPrimCondition.calledOnceWith('$regexp', PrimOp.REGEX, 'test', 'field')).to.be.true
        })

        it('should build $notRegex operator', () => {
            builder.buildOperator('$notRegex', 'test')
            expect(buildPrimCondition.calledOnceWith('$notRegex', PrimOp.NOT_REGEX, 'test', 'field')).to.be.true
        })

        it('should build $notRegexp operator', () => {
            builder.buildOperator('$notRegexp', 'test')
            expect(buildPrimCondition.calledOnceWith('$notRegexp', PrimOp.NOT_REGEX, 'test', 'field')).to.be.true
        })

        it('should build $iRegexp operator', () => {
            builder.buildOperator('$iRegexp', 'test')
            expect(buildPrimCondition.calledOnceWith('$iRegexp', PrimOp.IREGEX, 'test', 'field')).to.be.true
        })

        it('should build $notIRegexp operator', () => {
            builder.buildOperator('$notIRegexp', 'test')
            expect(buildPrimCondition.calledOnceWith('$notIRegexp', PrimOp.NOT_IREGEX, 'test', 'field')).to.be.true
        })

        it('should build $between operator', () => {
            builder.buildOperator('$between', [1, 2])
            expect(buildPrimCondition.calledOnceWith('$between', PrimOp.BETWEEN, [1, 2], 'field')).to.be.true
        })

        it('should build $notBetween operator', () => {
            builder.buildOperator('$notBetween', [1, 2])
            expect(buildPrimCondition.calledOnceWith('$notBetween', PrimOp.NOT_BETWEEN, [1, 2], 'field')).to.be.true
        })

        it('should build $size operator', () => {
            builder.buildOperator('$size', 1)
            expect(buildPrimCondition.calledOnceWith('$size', PrimOp.SIZE, 1, 'field')).to.be.true
        })

        describe('$and', () => {
            it('should build an array of objects', () => {
                const buildObject = sinon.stub(builder, 'buildObject')
                const obj = {}
                const operand = [obj]
                builder.buildOperator('$and', operand)
                expect(buildObject.calledOnceWith(obj)).to.be.true

                expect(root.conditions).to.have.lengthOf(1)
                const condition = root.conditions[0] as ScopedCondition
                expect(condition.scope).to.equal(ScopeOp.AND)
                expect(condition.conditions).to.have.lengthOf(1)
                const subCondition = condition.conditions[0] as ScopedCondition
                expect(subCondition.scope).to.equal(ScopeOp.AND)
            })

            it('should build a single object', () => {
                const buildObject = sinon.stub(builder, 'buildObject')
                const operand = {}
                builder.buildOperator('$and', operand)
                expect(buildObject.calledOnceWith(operand)).to.be.true

                expect(root.conditions).to.have.lengthOf(1)
                const condition = root.conditions[0] as ScopedCondition
                expect(condition.scope).to.equal(ScopeOp.AND)
            })

            it('should throw an error if not array or object', () => {
                expect(() => builder.buildOperator('$and', 1 as any))
                    .to.throw('Expected array or object for \'$and\', got number')
            })
        })

        describe('$or', () => {
            it('should build an array of objects', () => {
                const buildObject = sinon.stub(builder, 'buildObject')
                const obj = {}
                const operand = [obj]
                builder.buildOperator('$or', operand)
                expect(buildObject.calledOnceWith(obj)).to.be.true

                expect(root.conditions).to.have.lengthOf(1)
                const condition = root.conditions[0] as ScopedCondition
                expect(condition.scope).to.equal(ScopeOp.OR)
                expect(condition.conditions).to.have.lengthOf(1)
                const subCondition = condition.conditions[0] as ScopedCondition
                expect(subCondition.scope).to.equal(ScopeOp.AND)
            })

            it('should build a single object', () => {
                const buildObject = sinon.stub(builder, 'buildObject')
                const operand = {}
                builder.buildOperator('$or', operand)
                expect(buildObject.calledOnceWith(operand)).to.be.true

                expect(root.conditions).to.have.lengthOf(1)
                const condition = root.conditions[0] as ScopedCondition
                expect(condition.scope).to.equal(ScopeOp.OR)
            })

            it('should throw an error if not array or object', () => {
                expect(() => builder.buildOperator('$or', 1 as any))
                    .to.throw('Expected array or object for \'$or\', got number')
            })
        })

        describe('$not', () => {
            it('should build an array of objects', () => {
                const buildObject = sinon.stub(builder, 'buildObject')
                const obj = {}
                const operand = [obj]
                builder.buildOperator('$not', operand)
                expect(buildObject.calledOnceWith(obj)).to.be.true

                expect(root.conditions).to.have.lengthOf(1)
                const condition = root.conditions[0] as ScopedCondition
                expect(condition.scope).to.equal(ScopeOp.NOT)
                expect(condition.conditions).to.have.lengthOf(1)
                const subCondition = condition.conditions[0] as ScopedCondition
                expect(subCondition.scope).to.equal(ScopeOp.AND)
            })

            it('should build a single object', () => {
                const buildObject = sinon.stub(builder, 'buildObject')
                const operand = {}
                builder.buildOperator('$not', operand)
                expect(buildObject.calledOnceWith(operand)).to.be.true

                expect(root.conditions).to.have.lengthOf(1)
                const condition = root.conditions[0] as ScopedCondition
                expect(condition.scope).to.equal(ScopeOp.NOT)
            })

            it('should throw an error if not array or object', () => {
                expect(() => builder.buildOperator('$not', 1 as any))
                    .to.throw('Expected array or object for \'$not\', got number')
            })
        })

        it('should throw an error if unknown operator', () => {
            expect(() => builder.buildOperator('$test', 1))
                .to.throw('Unsupported operator \'$test\'')
        })
    })

    describe('buildPrimCondition', () => {
        it('should build a primitive condition', () => {
            const builder = new MongoTreeBuilder({})
            const root = new ScopedCondition({ alias: '__root__' })
            builder['conditionStack'].push(root)

            builder.buildPrimCondition(
                '$eq', PrimOp.EQUAL, 1, 'field'
            )

            expect(root.conditions).to.have.lengthOf(1)

            const condition = root.conditions[0] as PrimitiveCondition
            expect(condition.type).to.equal('primitive')
            expect(condition.alias).to.equal('__root__')
            expect(condition.column).to.equal('field')
            expect(condition.operator).to.equal(PrimOp.EQUAL)
            expect(condition.operand).to.equal(1)
            expect(condition.parent).to.equal(root)

            // cleanup
            root.unlink()
        })

        it('should throw an error if no column name', () => {
            const builder = new MongoTreeBuilder({})
            const root = new ScopedCondition({ alias: '__root__' })
            builder['conditionStack'].push(root)

            expect(() => builder.buildPrimCondition(
                '$eq', PrimOp.EQUAL, 1, ''
            )).to.throw('Expected column name for \'$eq\'!')

            // cleanup
            root.unlink()
        })
    })

    describe('print', () => {
        it('should print a query', () => {
            const builder = new MongoTreeBuilder({
                $and: [
                    { field: 1 },
                    {
                        field2: 2,
                        field3: {
                            id: { $eq: 3 }
                        }
                    }
                ]
            })
            const root = builder.build() as ScopedCondition
            expect(MongoTreeBuilder.print(root)).to.toMatchSnapshot()
        })
    })

    describe('examples', () => {
        describe('query 1', () => {
            it('should build the query', () => {
                const rawQuery = { id: { $gt: 1, $lt: 5 } }
                const builder = new MongoTreeBuilder(rawQuery)
                const root = builder.build() as ScopedCondition

                expect(root.type).to.equal('scoped')
                expect(root.conditions).to.have.lengthOf(2)

                const condition1 = root.conditions[0] as PrimitiveCondition
                const condition2 = root.conditions[1] as PrimitiveCondition

                expect(condition1.column).to.equal('id')
                expect(condition1.operator).to.equal(PrimOp.GREATER_THAN)
                expect(condition1.operand).to.equal(1)

                expect(condition2.column).to.equal('id')
                expect(condition2.operator).to.equal(PrimOp.LESS_THAN)
                expect(condition2.operand).to.equal(5)
            })
        })

        describe('query 2', () => {
            it('should build queries with dot-notation', () => {
                const rawQuery = {
                    id: 2,
                    'author.id': { $eq: 1 },
                    'author.name': 'Lewis Carroll',
                    'author.comments.id': { $in: [1, 2] }
                }
                const builder = new MongoTreeBuilder(rawQuery)
                const root = builder.build() as ScopedCondition
                const str = MongoTreeBuilder.print(root)

                expect(str).to.toMatchSnapshot()
            })
        })
    })
})
