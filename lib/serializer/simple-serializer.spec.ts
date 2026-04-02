import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { TestDatabase } from '@/test-db'
import { TypeOrmTableInfo } from '@/schema'
import { SimpleSerializer } from './simple-serializer'
import {
    MongoQuery,
    PrimOp,
    PrimitiveCondition,
    ScopeOp,
    ScopedCondition
} from '@/condition'

describe('SimpleSerializer', () => {
    let db: TestDatabase
    let table: TypeOrmTableInfo
    let serializer: SimpleSerializer

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        await db.seed()

        table = TypeOrmTableInfo.createFrom(db.source, 'Book')
        serializer = new SimpleSerializer(table)
    })
    after(async () => await db.disconnect())

    /** convinience function for comparing human-readable strings */
    function shrink(s: string) { return s.replace(/\s+/g, ' ').trim() }

    describe('serialize', () => {
        it('should serialize a simple query', () => {
            // USES: SimpleSerializer.serializeWith()
            const mondoQuery = new MongoQuery({ id: 2 })
            const tree = mondoQuery.build('__test__')
            const query = serializer.serialize(tree)

            query.data.select([]) // clear the selection to 'SELECT *'
            expect(shrink(query.data.getSql())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE ("__test__"."id" = 2)
                `)
            )
        })
    })

    describe('serializeWith', () => {
        it('should serialize a simple query', () => {
            const mondoQuery = new MongoQuery({ id: 2 })
            const tree = mondoQuery.build('__test__')
            const builder = table.createQueryBuilder('__test__')

            const query = serializer.serializeWith(
                builder,
                tree
            )

            query.data.select([]) // clear the selection to 'SELECT *'
            expect(shrink(query.data.getSql())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE ("__test__"."id" = 2)
                `)
            )
        })
    })

    describe('select', () => {
        it('should call the selector', () => {
            const select = sinon.stub(serializer.selector, 'select')
            const query = new PrimitiveCondition()

            const builder = table
                .createQueryBuilder('__test__')
                .select([]) // clear the selection to 'SELECT *'

            serializer.select(builder, query, '*')
            expect(select.calledOnceWith(builder, query, '*')).to.be.true

            select.restore()
        })
    })

    describe('serializeCondition', () => {
        it('should serialize a primitive condition', () => {
            const serializePrimCondition = sinon.stub(serializer, 'serializePrimCondition')
            const condition = new PrimitiveCondition()
            const scopeInfo = {} as any

            serializer.serializeCondition(scopeInfo, condition)
            expect(serializePrimCondition.calledOnceWith(scopeInfo, condition)).to.be.true

            serializePrimCondition.restore()
        })

        it('should serialize a scoped condition', () => {
            const serializeScopedCondition = sinon.stub(serializer, 'serializeScopedCondition')
            const condition = new ScopedCondition()
            const scopeInfo = {} as any

            serializer.serializeCondition(scopeInfo, condition)
            expect(serializeScopedCondition.calledOnceWith(scopeInfo, condition)).to.be.true

            serializeScopedCondition.restore()
        })
    })

    describe('serializeScopedCondition', () => {
        it('should serialize a scoped-not condition', () => {
            const serializeScopedNot = sinon.stub(serializer, 'serializeScopedNot')
            const condition = new ScopedCondition({ scope: ScopeOp.NOT })
            const scopeInfo = {} as any

            serializer.serializeScopedCondition(scopeInfo, condition)
            expect(serializeScopedNot.calledOnceWith(scopeInfo, condition)).to.be.true

            serializeScopedNot.restore()
        })

        it('should serialize a scoped-boolean condition', () => {
            const serializeScopedBoolean = sinon.stub(serializer, 'serializeScopedBoolean')
            const condition = new ScopedCondition({ scope: ScopeOp.AND })
            const scopeInfo = {} as any

            serializer.serializeScopedCondition(scopeInfo, condition)
            expect(serializeScopedBoolean.calledOnceWith(scopeInfo, condition)).to.be.true

            serializeScopedBoolean.restore()
        })
    })

    describe('getNextTable', () => {
        let root: ScopedCondition
        let scopeInfo: any

        beforeEach(() => {
            root = new ScopedCondition({
                alias: '__test__',
                scope: ScopeOp.AND,
            })

            const builder = table.createQueryBuilder('__test__')
            builder.select([]) // clear the selection to 'SELECT *'
            scopeInfo = {
                table,
                builder,
                shared: { counter: 0 },
                where: builder.andWhere.bind(builder),
            }
        })
        afterEach(() => root.unlink())

        it('should return the same table if no join is anticipated', () => {
            const condition = new ScopedCondition({ join: false })
            const nextTable = serializer.getNextTable(scopeInfo, condition)
            expect(nextTable).to.equal(table)
        })

        it('should throw an error if column not found', () => {
            const scope = new ScopedCondition({
                column: 'unknown',
                scope: ScopeOp.AND,
                join: true
            })
            root.push(scope)

            expect(() => serializer.getNextTable(scopeInfo, scope))
                .to.throw('Column \'unknown\' not found in Book')
        })

        it('should throw an error if column is not joinable', () => {
            const scope = new ScopedCondition({
                column: 'title',
                scope: ScopeOp.AND,
                join: true
            })
            root.push(scope)

            expect(() => serializer.getNextTable(scopeInfo, scope))
                .to.throw('Column \'title\' is not joinable')
        })

        // NOTE: This should never happen, but it's good to check
        it('should throw an error if condition has no parent', () => {
            const scope = new ScopedCondition({
                column: 'author',
                scope: ScopeOp.AND,
                join: true
            })

            expect(() => serializer.getNextTable(scopeInfo, scope))
                .to.throw('Parent condition not found')
        })

        it('should join the column and return its table', () => {
            const scope = new ScopedCondition({
                column: 'author',
                scope: ScopeOp.AND,
                join: true
            })
            root.push(scope)

            const nextTable = serializer.getNextTable(scopeInfo, scope)
            expect(nextTable.classType()).to.equal('Author')

            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    LEFT JOIN "author" "__test__" ON "__test__"."id"="__test__"."authorId"
                `)
            )
        })
    })

    describe('serializeScopedNot', () => {
        it('should serialize a scoped-not condition', () => {
            const mondoQuery = new MongoQuery({
                $not: { id: 2, title: 'foo' }
            })
            const tree = mondoQuery.build('__test__')
            const query = serializer.serialize(tree)

            query.data.select([]) // clear the selection to 'SELECT *'
            expect(shrink(query.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE (NOT(("__test__"."id"    = :param_0 AND
                                "__test__"."title" = :param_1)))
                `)
            )
        })
    })

    describe('serializeScopedBoolean', () => {
        it('should serialize a scoped-and condition', () => {
            const mondoQuery = new MongoQuery({
                $and: [{ id: 2 }, { title: 'foo' }]
            })
            const tree = mondoQuery.build('__test__')
            const query = serializer.serialize(tree)

            query.data.select([]) // clear the selection to 'SELECT *'
            expect(shrink(query.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE ((("__test__"."id"    = :param_0) AND
                            ("__test__"."title" = :param_1)))
                `)
            )
        })

        it('should serialize a scoped-or condition', () => {
            const mondoQuery = new MongoQuery({
                $or: [{ id: 2 }, { title: 'foo' }]
            })
            const tree = mondoQuery.build('__test__')
            const query = serializer.serialize(tree)

            query.data.select([]) // clear the selection to 'SELECT *'
            expect(shrink(query.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE ((("__test__"."id"    = :param_0) OR
                            ("__test__"."title" = :param_1)))
                `)
            )
        })
    })

    describe('serializePrimCondition', () => {
        let scopeInfo: any
        let condition: PrimitiveCondition

        beforeEach(() => {
            const builder = table.createQueryBuilder('__test__')
            scopeInfo = {
                shared: { counter: 0 },
                table,
                builder,
                where: builder.andWhere.bind(builder)
            }
            builder.select([]) // clear the selection to 'SELECT *'

            condition = new PrimitiveCondition({
                alias: '__test__',
                column: 'title',
                operator: PrimOp.EQUAL,
                operand: ''
            })
        })

        it('should serialize empty result conditions', () => {
            condition.operator = PrimOp.EMPTY_RESULT

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink('SELECT * FROM "book" "__test__" WHERE FALSE')
            )
        })

        it('should throw an error for unknown columns', () => {
            const condition = new PrimitiveCondition({
                alias: '__test__',
                column: 'unknown',
                operator: PrimOp.EQUAL,
                operand: 42
            })

            expect(() => serializer.serializePrimCondition(scopeInfo, condition))
                .to.throw('Column \'unknown\' not found in table \'Book\'')
        })

        it('should serialize "equals"', () => {
            condition.operator = PrimOp.EQUAL

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" = :param_0
                `)
            )
        })

        it('should serialize "not equals"', () => {
            condition.operator = PrimOp.NOT_EQUAL

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" != :param_0
                `)
            )
        })

        it('should serialize "greater than"', () => {
            condition.operator = PrimOp.GREATER_THAN

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" > :param_0
                `)
            )
        })

        it('should serialize "greater than or equals"', () => {
            condition.operator = PrimOp.GREATER_OR_EQUAL

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" >= :param_0
                `)
            )
        })

        it('should serialize "less than"', () => {
            condition.operator = PrimOp.LESS_THAN

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" < :param_0
                `)
            )
        })

        it('should serialize "less than or equals"', () => {
            condition.operator = PrimOp.LESS_OR_EQUAL

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" <= :param_0
                `)
            )
        })

        it('should serialize "in"', () => {
            condition.operator = PrimOp.IN

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IN (:...param_0)
                `)
            )
        })

        it('should serialize "not in"', () => {
            condition.operator = PrimOp.NOT_IN

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT IN (:...param_0)
                `)
            )
        })

        it('should serialize "like"', () => {
            condition.operator = PrimOp.LIKE

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" LIKE :param_0
                `)
            )
        })

        it('should serialize "not like"', () => {
            condition.operator = PrimOp.NOT_LIKE

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT LIKE :param_0
                `)
            )
        })

        it('should serialize "ilike"', () => {
            condition.operator = PrimOp.ILIKE

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" ILIKE :param_0
                `)
            )
        })

        it('should serialize "not ilike"', () => {
            condition.operator = PrimOp.NOT_ILIKE

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT ILIKE :param_0
                `)
            )
        })

        it('should serialize "regex"', () => {
            condition.operator = PrimOp.REGEX

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" REGEXP :param_0
                `)
            )
        })

        it('should serialize "not regex"', () => {
            condition.operator = PrimOp.NOT_REGEX

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT REGEXP :param_0
                `)
            )
        })

        it('should serialize "iregex"', () => {
            condition.operator = PrimOp.IREGEX

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IREGEXP :param_0
                `)
            )
        })

        it('should serialize "not iregex"', () => {
            condition.operator = PrimOp.NOT_IREGEX

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT IREGEXP :param_0
                `)
            )
        })

        it('should serialize "between"', () => {
            condition.operator = PrimOp.BETWEEN
            condition.operand = [0, 42]

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" BETWEEN :aparam_0 AND :bparam_0
                `)
            )
        })

        it('should serialize "not between"', () => {
            condition.operator = PrimOp.NOT_BETWEEN
            condition.operand = [0, 42]

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT BETWEEN :aparam_0 AND :bparam_0
                `)
            )
        })

        it('should serialize "size"', () => {
            condition.operator = PrimOp.SIZE

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE array_length("__test__"."title", 1) = :param_0
                `)
            )
        })

        it('should serialize "is null"', () => {
            condition.operator = PrimOp.IS
            condition.operand = null

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NULL
                `)
            )
        })

        it('should serialize "is true"', () => {
            condition.operator = PrimOp.IS
            condition.operand = true

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS TRUE
                `)
            )
        })

        it('should serialize "is false"', () => {
            condition.operator = PrimOp.IS
            condition.operand = false

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS FALSE
                `)
            )
        })

        it('should serialize "is not null"', () => {
            condition.operator = PrimOp.IS_NOT
            condition.operand = null

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NOT NULL
                `)
            )
        })

        it('should serialize "is not true"', () => {
            condition.operator = PrimOp.IS_NOT
            condition.operand = true

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NOT TRUE
                `)
            )
        })

        it('should serialize "is not false"', () => {
            condition.operator = PrimOp.IS_NOT
            condition.operand = false

            serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NOT FALSE
                `)
            )
        })

        it('should throw an error for unknown operators', () => {
            const condition = new PrimitiveCondition({
                alias: '__test__',
                column: 'title',
                operator: 'unknown' as any,
                operand: 42
            })

            expect(() => serializer.serializePrimCondition(scopeInfo, condition))
                .to.throw('Unknown operator unknown')
        })
    })
})
