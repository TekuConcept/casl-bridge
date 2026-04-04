import 'mocha'
import { expect } from 'chai'
import { MongoQuery } from '@/condition/mongo-query'
import { shrink, SimpleSerializer_TestContext } from './types.test'
import { TypeOrmTableInfo } from '@/schema'
import { SimpleSerializer } from './simple-serializer'
import {
    PrimitiveCondition,
    PrimOp,
    ScopedCondition,
    ScopeOp,
} from '@/condition'

export function describeJsonPathConditions(
    ctx: SimpleSerializer_TestContext,
) {
    describe('JSON path conditions', () => {
        it('should serialize a direct two-level JSON path with $eq', () => {
            const query = new MongoQuery({ 'metadata.library.isbn': 'ISBN-1' })
            const tree  = query.build('__test__')
            const q     = ctx.serializer.serialize(tree)

            q.data.select([])
            const sql = shrink(q.data.getQuery())
            // TypeORM quotes alias.column patterns, so __test__.metadata → "..." 
            expect(sql).to.contain(
                `json_extract("__test__"."metadata", '$.library.isbn') = :param_0`
            )
        })

        it('should serialize a direct single-level JSON path', () => {
            const query = new MongoQuery({ 'metadata.isbn': 'X' })
            const tree  = query.build('__test__')
            const q     = ctx.serializer.serialize(tree)

            q.data.select([])
            const sql = shrink(q.data.getQuery())
            expect(sql).to.contain(
                `json_extract("__test__"."metadata", '$.isbn') = :param_0`
            )
        })

        it('should serialize a JSON path $in condition', () => {
            const query = new MongoQuery({
                'metadata.library.isbn': { $in: ['ISBN-1', 'ISBN-2'] }
            })
            const tree = query.build('__test__')
            const q    = ctx.serializer.serialize(tree)

            q.data.select([])
            const sql = shrink(q.data.getQuery())
            expect(sql).to.contain(
                `json_extract("__test__"."metadata", '$.library.isbn') IN (:...param_0)`
            )
        })

        it('should serialize a JSON path $ne condition', () => {
            const query = new MongoQuery({ 'metadata.library.isbn': { $ne: 'ISBN-1' } })
            const tree  = query.build('__test__')
            const q     = ctx.serializer.serialize(tree)

            q.data.select([])
            const sql = shrink(q.data.getQuery())
            expect(sql).to.contain(
                `json_extract("__test__"."metadata", '$.library.isbn') != :param_0`
            )
        })

        it('should serialize a JSON path through a relation (join + json_extract)', () => {
            const authorTable      = TypeOrmTableInfo.createFrom(ctx.db.source, 'Author')
            const authorSerializer = new SimpleSerializer(authorTable)

            const query = new MongoQuery({ 'books.metadata.library.isbn': 'ISBN-1' })
            const tree  = query.build('__test__')
            const q     = authorSerializer.serialize(tree)

            q.data.select([])
            const sql = shrink(q.data.getQuery())
            // Must JOIN books
            expect(sql).to.contain('LEFT JOIN')
            // Must use the books alias for json_extract
            expect(sql).to.contain(
                `json_extract("__test___books"."metadata", '$.library.isbn') = :param_0`
            )
        })

        it('should execute a JSON path query against SQLite without error', async () => {
            const query = new MongoQuery({ 'metadata.library.isbn': 'ISBN-1' })
            const tree  = query.build('__table__')
            const q     = ctx.serializer.serialize(tree)

            const results = await q.data.getMany()
            expect(results).to.be.an('array')
        })

        it('should execute a JSON path $in query against SQLite', async () => {
            const query = new MongoQuery({
                'metadata.library.isbn': { $in: ['ISBN-1', 'ISBN-2'] }
            })
            const tree = query.build('__table__')
            const q    = ctx.serializer.serialize(tree)

            const results = await q.data.getMany()
            expect(results).to.be.an('array')
        })

        it('should use condition.alias as fallback when jsonTableAlias is not set', () => {
            // Covers the `jsonTableAlias ?? condition.alias` fallback branch.
            const builder   = ctx.table.createQueryBuilder('__test__')
            const primCond  = new PrimitiveCondition({
                alias:      '__test__',
                column:     'isbn',
                operator:   PrimOp.EQUAL,
                operand:    'value',
                jsonColumn: 'metadata',
                jsonPath:   'isbn',
                // jsonTableAlias intentionally omitted → falls back to condition.alias
            })
            const root = new ScopedCondition({ alias: '__test__', scope: ScopeOp.AND })
            root.push(primCond)

            const scopeInfo: any = {
                shared: { counter: 0 },
                table: ctx.table,
                builder,
                where: builder.andWhere.bind(builder),
            }

            // Should succeed using condition.alias as the table reference
            expect(() => ctx.serializer.serializePrimCondition(scopeInfo, primCond))
                .to.not.throw()
        })

        it('should throw when a JSON column is not found on the table', () => {
            const builder   = ctx.table.createQueryBuilder('__test__')
            const primCond  = new PrimitiveCondition({
                alias:          '__test__',
                column:         'isbn',
                operator:       PrimOp.EQUAL,
                operand:        'value',
                jsonColumn:     'nonexistent',   // does not exist on Book
                jsonPath:       'library.isbn',
                jsonTableAlias: '__test__',
            })
            const root = new ScopedCondition({ alias: '__test__', scope: ScopeOp.AND })
            root.push(primCond)

            const scopeInfo: any = {
                shared: { counter: 0 },
                table: ctx.table,
                builder,
                where: builder.andWhere.bind(builder),
            }

            expect(() => ctx.serializer.serializePrimCondition(scopeInfo, primCond))
                .to.throw(`Column 'nonexistent' not found in table 'Book'`)
        })

        it('should throw for an unsafe JSON path segment in the filter key', () => {
            // '[0]' is not a valid identifier segment — assertSafeJsonPath rejects it.
            // We bypass the annotator and set jsonColumn/jsonPath directly so the
            // serializer's call to renderJsonExtract can surface the error.
            const builder    = ctx.table.createQueryBuilder('__test__')
            const primCond   = new PrimitiveCondition({
                alias:          '__test__',
                column:         'metadata',
                operator:       PrimOp.EQUAL,
                operand:        'value',
                jsonColumn:     'metadata',
                jsonPath:       '[0].isbn',   // unsafe — contains '['
                jsonTableAlias: '__test__',
            })
            // Build a minimal root scope so serializePrimCondition can be called
            const root = new ScopedCondition({ alias: '__test__', scope: ScopeOp.AND })
            root.push(primCond)

            const scopeInfo: any = {
                shared: { counter: 0 },
                table: ctx.table,
                builder,
                where: builder.andWhere.bind(builder),
            }

            expect(() => ctx.serializer.serializePrimCondition(scopeInfo, primCond))
                .to.throw('Unsafe JSON path')
        })
    })
}
