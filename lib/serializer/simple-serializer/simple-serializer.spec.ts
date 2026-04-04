import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { TestDatabase } from '@/test-db'
import { TypeOrmTableInfo } from '@/schema'
import { DepthLimiter } from '@/passes/depth-limiter'
import {
    MongoQuery,
    PrimOp,
    PrimitiveCondition,
    ScopeOp,
    ScopedCondition
} from '@/condition'
import { SimpleSerializer } from './simple-serializer'
import { describeGetNextTable } from './utils.test'
import { describeSerializePrimCondition } from './serialize-prim-condition.test'
import { describeJsonPathConditions } from './json-path-conditions.test'

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

        it('should use INNER JOIN when direction is inner', () => {
            const mondoQuery = new MongoQuery({ author: { name: 'nobody' } })
            const tree = mondoQuery.build('__test__')
            const query = serializer.serialize(tree, 'inner')

            const sql = shrink(query.data.getSql())
            expect(sql).to.contain('INNER JOIN')
            expect(sql).to.not.contain('LEFT JOIN')
        })

        it('should use LEFT JOIN when direction is left (default)', () => {
            const mondoQuery = new MongoQuery({ author: { name: 'nobody' } })
            const tree = mondoQuery.build('__test__')
            const query = serializer.serialize(tree, 'left')

            expect(shrink(query.data.getSql())).to.contain('LEFT JOIN')
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

    describeGetNextTable({ get table() { return table }})

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

    describeSerializePrimCondition({
        get table() { return table },
        get serializer() { return serializer }
    })

    describe('serializeLiteralCondition', () => {
        let scopeInfo: any

        beforeEach(() => {
            const builder = table.createQueryBuilder('__test__')
            scopeInfo = {
                shared: { counter: 0 },
                table,
                builder,
                where: builder.andWhere.bind(builder)
            }
            builder.select([]) // clear the selection to 'SELECT *'
        })

        it('should serialize LiteralCondition(false) as (1=0)', () => {
            const condition = new (require('@/condition').LiteralCondition)(false)

            serializer.serializeLiteralCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink('SELECT * FROM "book" "__test__" WHERE (1=0)')
            )
        })

        it('should serialize LiteralCondition(true) as (1=1)', () => {
            const condition = new (require('@/condition').LiteralCondition)(true)

            serializer.serializeLiteralCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink('SELECT * FROM "book" "__test__" WHERE (1=1)')
            )
        })

        it('should be dispatched from serializeCondition', () => {
            const condition = new (require('@/condition').LiteralCondition)(false)
            const spy = sinon.stub(serializer, 'serializeLiteralCondition')

            serializer.serializeCondition(scopeInfo, condition)
            expect(spy.calledOnceWith(scopeInfo, condition)).to.be.true

            spy.restore()
        })
    })

    describe('empty-list operands', () => {
        it('should serialize $in: [] as (1=0) and not produce IN ()', () => {
            const query = new MongoQuery({ id: { $in: [] } } as any)
            const tree = query.build('__test__')
            const builder = serializer.serialize(tree)

            builder.data.select([])
            const sql = shrink(builder.data.getSql())
            expect(sql).to.contain('1=0')
            expect(sql).to.not.contain('IN ()')
            expect(sql).to.not.contain('IN ( )')
        })

        it('should serialize $nin: [] as (1=1) and not produce NOT IN ()', () => {
            const query = new MongoQuery({ id: { $nin: [] } } as any)
            const tree = query.build('__test__')
            const builder = serializer.serialize(tree)

            builder.data.select([])
            const sql = shrink(builder.data.getSql())
            expect(sql).to.contain('1=1')
            expect(sql).to.not.contain('NOT IN ()')
            expect(sql).to.not.contain('NOT IN ( )')
        })

        it('should serialize $notIn: [] as (1=1) and not produce NOT IN ()', () => {
            const query = new MongoQuery({ id: { $notIn: [] } } as any)
            const tree = query.build('__test__')
            const builder = serializer.serialize(tree)

            builder.data.select([])
            const sql = shrink(builder.data.getSql())
            expect(sql).to.contain('1=1')
            expect(sql).to.not.contain('NOT IN ()')
        })

        it('should preserve non-empty $in list behaviour', () => {
            const query = new MongoQuery({ id: { $in: [1, 2, 3] } })
            const tree = query.build('__test__')
            const builder = serializer.serialize(tree)

            builder.data.select([])
            const sql = shrink(builder.data.getSql())
            expect(sql).to.contain('IN')
            expect(sql).to.not.contain('1=0')
        })

        it('should simplify AND($in: [], other) to (1=0) via boolean simplification', () => {
            const query = new MongoQuery({ $and: [{ id: { $in: [] } }, { title: 'foo' }] } as any)
            const tree = query.build('__test__')

            // apply DepthLimiter to trigger simplification (maxDepth=99, no violations)
            const limiter = new DepthLimiter(99, 'false')
            const simplified = limiter.apply(tree).tree

            const builder = serializer.serialize(simplified)
            builder.data.select([])
            const sql = shrink(builder.data.getSql())
            expect(sql).to.contain('1=0')
            expect(sql).to.not.contain('IN ()')
        })

        it('should simplify OR($nin: [], other) to preserve the other branch', () => {
            const query = new MongoQuery({ $or: [{ id: { $nin: [] } }, { title: 'foo' }] } as any)
            const tree = query.build('__test__')

            // apply DepthLimiter to trigger simplification
            const limiter = new DepthLimiter(99, 'false')
            const simplified = limiter.apply(tree).tree

            const builder = serializer.serialize(simplified)
            builder.data.select([])
            const sql = shrink(builder.data.getSql())
            // OR(true, x) = true → no WHERE clause (or just (1=1))
            expect(sql).to.not.contain('NOT IN ()')
        })
    })

    describeJsonPathConditions({
        get db() { return db },
        get table() { return table },
        get serializer() { return serializer }
    })
})
