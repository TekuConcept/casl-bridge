
import 'mocha'
import { expect } from 'chai'
import { TestDatabase } from '@/test-db'
import { TypeOrmTableInfo } from '@/schema'
import { MongoQuery, PrimOp, PrimitiveCondition, ScopedCondition } from '@/condition'
import { JsonPathAnnotator } from './json-path-annotator'

describe('JsonPathAnnotator', () => {
    let db: TestDatabase
    let bookTable: TypeOrmTableInfo
    let authorTable: TypeOrmTableInfo

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        bookTable   = TypeOrmTableInfo.createFrom(db.source, 'Book')
        authorTable = TypeOrmTableInfo.createFrom(db.source, 'Author')
    })
    after(async () => await db.disconnect())

    /** Collect all PrimitiveCondition leaf nodes in the tree */
    function collectPrimitives(condition: any): PrimitiveCondition[] {
        if (condition.type === 'primitive') return [condition]
        if (condition.type === 'scoped') {
            return condition.conditions.flatMap(
                (c: any) => collectPrimitives(c)
            )
        }
        return []
    }

    describe('apply', () => {
        it('should not annotate a plain (non-JSON) path', () => {
            const tree = new MongoQuery({ id: 1 }).build('__test__')
            new JsonPathAnnotator(bookTable).apply(tree)

            const prims = collectPrimitives(tree)
            expect(prims.length).to.equal(1)
            expect(prims[0].jsonColumn).to.be.undefined
            expect(prims[0].jsonPath).to.be.undefined
            expect(prims[0].jsonTableAlias).to.be.undefined
        })

        it('should annotate a direct single-level JSON path', () => {
            // { 'metadata.isbn': 'value' } - one level deep
            const tree = new MongoQuery({ 'metadata.isbn': 'value' }).build('__test__')
            new JsonPathAnnotator(bookTable).apply(tree)

            const prims = collectPrimitives(tree)
            expect(prims.length).to.equal(1)

            const prim = prims[0]
            expect(prim.jsonColumn).to.equal('metadata')
            expect(prim.jsonPath).to.equal('isbn')
            expect(prim.jsonTableAlias).to.equal('__test__')
        })

        it('should annotate a direct two-level JSON path', () => {
            // { 'metadata.library.isbn': 'value' }
            const tree = new MongoQuery({ 'metadata.library.isbn': 'value' }).build('__test__')
            new JsonPathAnnotator(bookTable).apply(tree)

            const prims = collectPrimitives(tree)
            expect(prims.length).to.equal(1)

            const prim = prims[0]
            expect(prim.jsonColumn).to.equal('metadata')
            expect(prim.jsonPath).to.equal('library.isbn')
            expect(prim.jsonTableAlias).to.equal('__test__')
        })

        it('should mark JSON ScopedConditions as isJsonTraversal', () => {
            const tree = new MongoQuery({ 'metadata.library.isbn': 'value' }).build('__test__')
            new JsonPathAnnotator(bookTable).apply(tree)

            const root         = tree as ScopedCondition
            const metadataScope = root.conditions[0] as ScopedCondition
            const libraryScope  = metadataScope.conditions[0] as ScopedCondition

            expect(metadataScope.isJsonTraversal).to.be.true
            expect(libraryScope.isJsonTraversal).to.be.true
        })

        it('should not mark a real relation JOIN as isJsonTraversal', () => {
            const tree = new MongoQuery({ author: { name: 'Alice' } }).build('__test__')
            new JsonPathAnnotator(bookTable).apply(tree)

            const root       = tree as ScopedCondition
            const authorScope = root.conditions[0] as ScopedCondition

            expect(authorScope.isJsonTraversal).to.be.undefined
        })

        it('should annotate a JSON path through a relation (join + json)', () => {
            // books.metadata.library.isbn on Author table
            const tree = new MongoQuery({ 'books.metadata.library.isbn': 'value' }).build('__test__')
            new JsonPathAnnotator(authorTable).apply(tree)

            const prims = collectPrimitives(tree)
            expect(prims.length).to.equal(1)

            const prim = prims[0]
            expect(prim.jsonColumn).to.equal('metadata')
            expect(prim.jsonPath).to.equal('library.isbn')
            // alias of the books join scope
            expect(prim.jsonTableAlias).to.equal('__test___books')
        })

        it('should be idempotent when applied twice', () => {
            const tree = new MongoQuery({ 'metadata.library.isbn': 'value' }).build('__test__')
            const annotator = new JsonPathAnnotator(bookTable)
            annotator.apply(tree)
            annotator.apply(tree)  // second call should be safe

            const prims = collectPrimitives(tree)
            expect(prims[0].jsonPath).to.equal('library.isbn')
        })

        it('should annotate a JSON scope with no parent (root scope)', () => {
            // Create a JSON scope directly as the root (no parent) - covers the
            // `scoped.parent ? ... : scoped.alias` fallback branch.
            const metaScope = new ScopedCondition({
                alias: '__root__',
                join: true,
                column: 'metadata',
            })
            const prim = new PrimitiveCondition({
                column: 'isbn',
                alias: '__root__',
                operator: PrimOp.EQUAL,
                operand: 'x',
            })
            metaScope.push(prim)
            // metaScope.parent is null — applied as root

            new JsonPathAnnotator(bookTable).apply(metaScope)

            expect(metaScope.isJsonTraversal).to.be.true
            // tableAlias falls back to metaScope.alias since parent is null
            expect(prim.jsonTableAlias).to.equal('__root__')
            expect(prim.jsonColumn).to.equal('metadata')
            expect(prim.jsonPath).to.equal('isbn')
        })

        it('should leave an unknown join-scope column unannotated', () => {
            // A join scope whose column is not on the table — falls to the
            // else branch (not JSON, not joinable).
            const tree = new MongoQuery({ 'nonexistent.isbn': 'value' }).build('__test__')
            new JsonPathAnnotator(bookTable).apply(tree)

            const prims = collectPrimitives(tree)
            expect(prims.length).to.equal(1)
            expect(prims[0].jsonColumn).to.be.undefined
        })
    })
})
