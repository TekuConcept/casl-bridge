import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { SimpleSelector } from './simple-selector'
import { TestDatabase } from '@/test-db'
import { TypeOrmTableInfo } from '@/schema'
import { PrimOp, PrimitiveCondition, ScopedCondition } from '@/condition'
import { SelectTuple } from './types'

describe('SimpleSelector', () => {
    let db: TestDatabase
    let table: TypeOrmTableInfo
    let selector: SimpleSelector

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        await db.seed()

        table = TypeOrmTableInfo.createFrom(db.source, 'Book')
        selector = new SimpleSelector(table)
    })
    after(async () => await db.disconnect())

    describe('select', () => {
        it('should select by pattern', () => {
            const builder = table.createQueryBuilder('__table__')
            const query = new ScopedCondition({ alias: '__table__' })

            selector.select(builder, query, '*')

            expect(builder.data.getQuery()).toMatchSnapshot()
        })
    })

    describe('recursiveSelect', () => {
        it('should select query pattern', () => {
            const selectQueryPattern = sinon.stub(selector, 'selectQueryPattern')
            selectQueryPattern.returns([ 'id', 'title' ])

            const query = new ScopedCondition()
            const result = selector.recursiveSelect(table, query, '-')

            expect(result).to.deep.equal([ 'id', 'title' ])
            expect(selectQueryPattern.calledOnce).to.be.true

            selectQueryPattern.restore()
        })

        it('should select immediate fields', () => {
            const selectImmediate = sinon.stub(selector, 'selectImmediate')
            selectImmediate.returns([ 'id', 'title' ])

            const query = new ScopedCondition({ alias: '__table__' })
            const result = selector.recursiveSelect(table, query, '*')

            expect(result).to.deep.equal([ 'id', 'title' ])
            expect(selectImmediate.calledOnce).to.be.true

            selectImmediate.restore()
        })

        it('should select deep fields', () => {
            const selectDeep = sinon.stub(selector, 'selectDeep')
            selectDeep.returns([ 'id', 'title' ])

            const query = new ScopedCondition({ alias: '__table__' })
            const result = selector.recursiveSelect(table, query, '**')

            expect(result).to.deep.equal([ 'id', 'title' ])
            expect(selectDeep.calledOnce).to.be.true

            selectDeep.restore()
        })

        it('should select specified fields', () => {
            const selectFields = sinon.stub(selector, 'selectFields')
            selectFields.returns([ 'id', 'title' ])

            const query = new ScopedCondition({ alias: '__table__' })
            const result = selector.recursiveSelect(table, query, [ 'id', 'title' ])

            expect(result).to.deep.equal([ 'id', 'title' ])
            expect(selectFields.calledOnce).to.be.true

            selectFields.restore()
        })

        it('should select specified fields from object keys', () => {
            const selectFields = sinon.stub(selector, 'selectFields')
            selectFields.returns([ 'id', 'title' ])

            const query = new ScopedCondition({ alias: '__table__' })
            const result = selector.recursiveSelect(table, query, {
                id: true,
                title: true,
            })

            expect(result).to.deep.equal([ 'id', 'title' ])
            expect(selectFields.calledOnce).to.be.true
            expect(selectFields.args[0][2]).to.deep.equal([ 'id', 'title' ])

            selectFields.restore()
        })

        it('should throw on unrecognized pattern', () => {
            const query = new ScopedCondition({ alias: '__table__' })
            expect(() => selector.recursiveSelect(table, query, <any>'skip'))
                .to.throw('Unexpected select pattern \'skip\'')
        })

        it('should select at least something', () => {
            const selectQueryPattern = sinon.stub(selector, 'selectQueryPattern')
            const selectImmediate = sinon.stub(selector, 'selectImmediate')
            selectQueryPattern.returns([])
            selectImmediate.returns([ 'id', 'title' ])

            const query = new ScopedCondition({ alias: '__table__' })
            const result = selector.recursiveSelect(table, query, '-')

            expect(result).to.deep.equal([ 'id', 'title' ])
            expect(selectImmediate.calledOnce).to.be.true

            selectImmediate.restore()
            selectQueryPattern.restore()
        })
    })

    describe('convertToArrayPattern', () => {
        it('should convert keys of an object to a list', () => {
            const pattern = {
                id: true,
                title: true,
                author: {
                    id: true,
                    name: true,
                },
            }

            const result = selector.convertToArrayPattern(pattern)

            expect(result).to.deep.equal([
                'id',
                'title',
                [ 'author', [ 'id', 'name' ] ],
            ])
        })

        it('should handle circular references', () => {
            const patternA = {
                id: true,
            }
            const patternB = {
                id: true,
            }
            patternA['b'] = patternB
            patternB['a'] = patternA

            const result = selector.convertToArrayPattern(patternA)

            expect(result).to.deep.equal([ 'id', [ 'b', [ 'id' ] ] ])
        })
    })

    describe('selectQueryPattern', () => {
        it('should select from scoped condition', () => {
            const selectScopedCondition = sinon.stub(selector, 'selectScopedCondition')
            selectScopedCondition.returns([ 'id', 'title' ])

            const scopedCondition = new ScopedCondition()
            const result = selector.selectQueryPattern(table, scopedCondition)

            expect(result).to.deep.equal([ 'id', 'title' ])
            expect(selectScopedCondition.calledOnceWith(table, scopedCondition)).to.be.true

            selectScopedCondition.restore()
        })

        it('should select from primitive condition', () => {
            const selectPrimitiveCondition = sinon.stub(selector, 'selectPrimitiveCondition')
            selectPrimitiveCondition.returns([ 'id' ])

            const primitiveCondition = new PrimitiveCondition()
            const result = selector.selectQueryPattern(table, primitiveCondition)

            expect(result).to.deep.equal([ 'id' ])
            expect(selectPrimitiveCondition.calledOnceWith(table, primitiveCondition)).to.be.true

            selectPrimitiveCondition.restore()
        })
    })

    describe('selectScopedCondition', () => {
        it('should return empty array for unrecognized fields', () => {
            const condition = new ScopedCondition({
                join: true,
                column: 'skip',
            })
            const result = selector.selectScopedCondition(table, condition)

            expect(result).to.deep.equal([])
        })

        it('should update table when joining', () => {
            const selectQueryPattern = sinon.stub(selector, 'selectQueryPattern')
            selectQueryPattern.returns([ 'id', 'name' ])

            const scope = new ScopedCondition({
                join: true,
                column: 'author',
            })
            const property = new PrimitiveCondition()
            scope.conditions.push(property)

            const result = selector.selectScopedCondition(table, scope)

            expect(result).to.deep.equal([ 'id', 'name' ])
            expect(selectQueryPattern.calledOnce).to.be.true
            expect(selectQueryPattern.args[0][0].classType()).to.equal('Author')
            expect(selectQueryPattern.args[0][1]).to.equal(property)

            scope.unlink()
            selectQueryPattern.restore()
        })

        it('should treat non-join scopes as transparent', () => {
            const selectQueryPattern = sinon.stub(selector, 'selectQueryPattern')
            selectQueryPattern.returns([ 'id' ])

            const scope = new ScopedCondition({
                join: false,
                alias: '__table__',
            })
            const property = new PrimitiveCondition()
            scope.conditions.push(property)

            const result = selector.selectScopedCondition(table, scope)

            expect(result).to.deep.equal([ 'id' ])
            expect(selectQueryPattern.calledOnce).to.be.true
            expect(selectQueryPattern.args[0][0].classType()).to.equal('Book')
            expect(selectQueryPattern.args[0][1]).to.equal(property)

            scope.unlink()
            selectQueryPattern.restore()
        })
    })

    describe('selectPrimitiveCondition', () => {
        it('should return empty array for unrecognized fields', () => {
            const condition = new PrimitiveCondition({
                column: 'skip',
                alias: '__table__',
                operator: PrimOp.EQUAL,
                operand: 1,
            })

            const result = selector.selectPrimitiveCondition(table, condition)

            expect(result).to.deep.equal([])
        })

        it('should return selection for recognized fields', () => {
            const condition = new PrimitiveCondition({
                column: 'id',
                alias: '__table__',
                operator: PrimOp.EQUAL,
                operand: 1,
            })

            const result = selector.selectPrimitiveCondition(table, condition)

            expect(result).to.deep.equal([ '__table__.id' ])
        })
    })

    describe('selectImmediate', () => {
        it('should only select non-relational fields', () => {
            const result = selector.selectImmediate(table, '__table__')

            // NOTE: better-sqlite3 uses double quotes for quoting
            expect(result).to.deep.equal([
                '__table__.id',
                '__table__.title'
            ])
        })
    })

    describe('selectDeep', () => {
        it('should select all fields', () => {
            // NOTE: this does NOT recursively select embedded fields.
            //       For example, it will not select:
            //       `book.author.comment.id`
            //       but it will select:
            //       `book.author.id`
            //       where book is the table alias.

            const result = selector.selectDeep(table, '__table__')

            // NOTE: better-sqlite3 uses double quotes for quoting
            expect(result).to.deep.equal([
                '__table__.id',
                '__table__.title',
                '__table__.author',
                '__table___author.id',
                '__table___author.name',
            ])
        })
    })

    describe('selectFields', () => {
        it('should only select specified fields', () => {
            const fields = [
                'id',
                'skip',
                [ 'author', [ 'id' ] ],
            ]

            const result = selector.selectFields(table, '__table__', fields)

            // NOTE: better-sqlite3 uses double quotes for quoting
            expect(result).to.deep.equal([
                '__table__.id',
                '__table__.author',
                '__table___author.id',
            ])
        })
    })

    describe('selectEmbeddedFields', () => {
        it('should throw if relation is not a string', () => {
            const pattern = [ 1 ] as any
            expect(() => selector
                .selectEmbeddedFields(table, '__table__', pattern))
                .to.throw('Expected string, got number')
        })

        it('should throw if subpattern is not an array', () => {
            const pattern = [ 'author', 1 ] as any
            expect(() => selector
                .selectEmbeddedFields(table, '__table__', pattern))
                .to.throw('Expected array, got number')
        })

        it('should return empty array for unrecognized fields', () => {
            const pattern = [ 'skip', [] ] as SelectTuple
            const result = selector
                .selectEmbeddedFields(table, '__table__', pattern)
            expect(result).to.deep.equal([])
        })

        it('should return single non-relational field', () => {
            const pattern = [ 'id', [] ] as SelectTuple
            const result = selector
                .selectEmbeddedFields(table, '__table__', pattern)
            expect(result).to.deep.equal([ '__table__.id' ])
        })

        it('should return embedded fields', () => {
            const pattern = [ 'author', [ 'id' ] ] as SelectTuple
            const result = selector
                .selectEmbeddedFields(table, '__table__', pattern)
            expect(result).to.deep.equal([
                '__table__.author',
                '__table___author.id'
            ])
        })
    })

    describe('selectSimpleFields', () => {
        it('should throw if field is not a string', () => {
            const field = [ 1 ] as any
            expect(() => selector.selectSimpleField(table, '__table__', field))
                .to.throw('Expected string, got object')
        })

        it('should return null for unrecognized fields', () => {
            const field = 'skip'
            const result = selector.selectSimpleField(table, '__table__', field)
            expect(result).to.be.null
        })

        it('should return selection for recognized fields', () => {
            const field = 'id'
            const result = selector.selectSimpleField(table, '__table__', field)
            expect(result).to.equal('__table__.id')
        })
    })
})
