import 'mocha'
import { expect } from 'chai'
import * as sinon from 'sinon'
import { CaslBridge } from './casl-bridge'
import { Article, Book, TestDatabase } from './test-db'
import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import { Repository } from 'typeorm'
import { FilterOptions, PathPolicy, QueryOptions } from './types'

describe('CaslBridge', () => {
    let db: TestDatabase
    let bookRepo: Repository<Book>

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        await db.seed()

        bookRepo = db.source.manager.getRepository(Book)
    })
    after(async () => await db.disconnect())

    /** convinience function for comparing human-readable strings */
    function shrink(s: string) { return s.replace(/\s+/g, ' ').trim() }

    describe('createQueryTo', () => {
        it('should read all books', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book')
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book')

            const actualCount = await bookRepo.count()
            const count = await query.getCount()
            expect(shrink(query.getQuery())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"    AS "__table___id",
                        "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                    FROM "book" "__table__"
                `)
            )
            expect(count).to.equal(actualCount)
        })

        it('should read selected books', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            builder.can('read', 'Book', { id: 3 })
            const ability = builder.build()

            // NOTE: equivalent to `can('read', 'Book')`
            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book')
            expect(shrink(query.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"    AS "__table___id",
                        "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                    FROM "book" "__table__"
                    WHERE ((("__table__"."id" = 3) OR
                            ("__table__"."id" = 1)))
                `)
            )

            const entries = await query.getMany()
            expect(entries.length).to.equal(2)
        })

        it('should read book ID fields', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            builder.can('read', 'Book', { id: 3 })
            const ability = builder.build()

            // NOTE: equivalent to `can('read', 'Book', 'id')`
            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book', 'id')
            expect(shrink(query.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id" AS "__table___id"
                    FROM "book" "__table__"
                    WHERE ((("__table__"."id" = 3) OR
                            ("__table__"."id" = 1)))
                `)
            )

            const entries = await query.getMany()
            expect(entries).to.deep.equal([{ id: 1 }, { id: 3 }])
        })

        it('should read selected book IDs', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            builder.can('read', 'Book', { id: 3 })
            const ability = builder.build()

            // NOTE: equivalent to `can('read', 'Book')`
            //       but with only the ID field selected
            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book', ['id'])
            expect(shrink(query.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id" AS "__table___id"
                    FROM "book" "__table__"
                    WHERE ((("__table__"."id" = 3) OR
                            ("__table__"."id" = 1)))
                `)
            )

            const entries = await query.getMany()
            expect(entries).to.deep.equal([{ id: 1 }, { id: 3 }])
        })

        it('should read books with query filters', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 2 })
            builder.can('read', 'Book', { id: 8 })
            const ability = builder.build()

            // NOTE: equivalent to `can('read', 'Book')`
            //       but with only the ID field selected,
            //       and constrained between 1 and 5
            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo(
                'read', 'Book', { id: true },
                { id: { $gt: 1, $lt: 5 } }
            )
            expect(shrink(query.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id" AS "__table___id"
                    FROM "book" "__table__"
                    WHERE ((("__table__"."id" = 8) OR
                            ("__table__"."id" = 2)) AND
                            "__table__"."id" > 1 AND
                            "__table__"."id" < 5)
                `)
            )

            const entries = await query.getMany()
            expect(entries).to.deep.equal([{ id: 2 }])
        })

        it('should select all columns regardless of ability', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            const ability = builder.build()
            const bridge = new CaslBridge(db.source, ability)

            /**
             * If we only want to select columns under ability
             * conditoins, we simply add a '-' to the selection.
             */

            const query1 = bridge.createQueryTo('read', 'Book', '-')
            const entry1 = await query1.getOne()

            expect(entry1.id).to.equal(1)
            expect(entry1.title).to.be.undefined

            /**
             * If we need all non-joinable columns, we
             * simply add a wildcard to the selection.
             * 
             * NOTE: '**' will include joinable columns.
             */

            const query2 = bridge.createQueryTo('read', 'Book', '*')
            const entry2 = await query2.getOne()

            expect(entry2.id).to.equal(1)
            expect(entry2.title).to.not.be.undefined

            /**
             * Alternatively, set the table alias and use
             * `addSelect` to add your own selected columns.
             * 
             * NOTE: Aliases take the form of `${table}_${column},
             *       so for embedded columns, the alias will be
             *       `${table}_${embedded}.${column}`.
             * 
             * For example: `Book_author.name`
             */

            const query3 = bridge
                .createQueryTo({
                    table: 'Book',
                    action: 'read',
                    subject: 'Book',
                })
                .addSelect(['Book.title'])
            const entry3 = await query3.getOne()

            expect(entry3.id).to.equal(1)
            expect(entry3.title).to.not.be.undefined
        })

        it('should read sketchy columns', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Sketchy')
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo(
                'read',
                'Sketchy',
                '*', // select all columns
                {
                    '$recycle$': true,
                    'id""_>_0_OR_1-1;_--': { $isNot: null },
                    '🤔': { $gte: 1, $lte: 10 }
                }
            )
            
            // TypeORM assumes that column names do not contain
            // any of the following: `[' ', '=', '(', ')', ',']`.
            // TypeORM WILL NOT quote these column names!!!
            // With merge: empty CASL tree contributes nothing; the external
            // filter is the sole condition (no redundant '1=1').
            expect(shrink(query.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"                  AS "__table___id",
                        "__table__"."Today's_Message"     AS "__table___Today's_Message",
                        "__table__"."$recycle$"           AS "__table___$recycle$",
                        "__table__"."id""_>_0_OR_1-1;_--" AS "__table___id""_>_0_OR_1-1;_--",
                        "__table__"."🤔"                  AS "__table___🤔"
                    FROM "sketchy" "__table__"
                    WHERE ("__table__"."$recycle$" = ? AND
                           "__table__"."id""_>_0_OR_1-1;_--" IS NOT NULL AND
                           "__table__"."🤔" >= 1 AND
                           "__table__"."🤔" <= 10)
                `)
            )

            // const entries = await query.getMany()
            // expect(entries.length).to.equal(5)
        })

        it('should throw before malicious query can be executed', () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', {
                'id; DROP TABLE book; --': 1
            })
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            expect(() => bridge.createQueryTo('read', 'Book')).to.throw()
        })

        it('should pass filterOptions to compileExternalFilterTree', () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book')
            const ability = builder.build()
            const b = new CaslBridge(db.source, ability)
            const spy = sinon.spy(b as any, 'compileExternalFilterTree')
            const filterOpts: FilterOptions = {}

            b.createQueryTo({
                action: 'read',
                subject: 'Book',
                filters: { id: 1 },
                filterOptions: filterOpts,
            })

            expect(spy.calledOnce).to.be.true
            expect(spy.firstCall.args[2]).to.equal(filterOpts)
            spy.restore()
        })

        it('should produce unchanged SQL with filterOptions set', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book')
            const ability = builder.build()
            const b = new CaslBridge(db.source, ability)

            const query = b.createQueryTo({
                action: 'read',
                subject: 'Book',
                filterOptions: {},
            })

            expect(shrink(query.getQuery())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"    AS "__table___id",
                        "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                    FROM "book" "__table__"
                `)
            )
        })

        describe('pathPolicy', () => {
            it('should produce unchanged SQL when pathPolicy is undefined', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book')
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { id: 1 },
                })

                // With merge: empty CASL tree contributes no conditions;
                // the external filter is the sole WHERE clause (no '1=1').
                expect(shrink(query.getSql())).to.equal(
                    shrink(`
                        SELECT
                            "__table__"."id"    AS "__table___id",
                            "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                        FROM "book" "__table__"
                        WHERE ("__table__"."id" = 1)
                    `)
                )
            })

            it('should throw by default when pathPolicy onViolation is omitted', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book')
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                // onViolation omitted → defaults to 'throw'
                expect(() => b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { id: 1 },
                    filterOptions: { pathPolicy: policy },
                })).to.throw('Filter path "id" is not permitted by PathPolicy')
            })

            it('should strip a denied filter field when onViolation is strip', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book')
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { id: 1 },
                    filterOptions: { pathPolicy: policy, onViolation: 'strip' },
                })

                // With merge: both trees are empty after stripping →
                // merged tree is empty → no WHERE clause at all.
                expect(shrink(query.getSql())).to.equal(
                    shrink(`
                        SELECT
                            "__table__"."id"    AS "__table___id",
                            "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                        FROM "book" "__table__"
                    `)
                )
            })

            it('should replace a denied filter field with (1=0) when onViolation is false', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book')
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { id: 1 },
                    filterOptions: { pathPolicy: policy, onViolation: 'false' },
                })

                expect(shrink(query.getSql())).to.contain('1=0')
            })

            it('should not restrict CASL ability conditions', () => {
                // CASL-derived filters bypass compileExternalFilterTree
                // and must be unaffected by pathPolicy.
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { id: 1 })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                // deny 'id' in external filters — CASL condition must still appear
                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                expect(() => b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filterOptions: { pathPolicy: policy, onViolation: 'throw' },
                    // no 'filters' here — CASL condition is not external
                })).to.not.throw()
            })
        })

        describe('joinType', () => {
            it('should default to LEFT JOIN when joinType is undefined', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { 'author.id': { $gt: 0 } })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({ action: 'read', subject: 'Book' })
                expect(shrink(query.getSql())).to.contain('LEFT JOIN')
            })

            it('should use INNER JOIN for CASL rule joins when joinType is inner', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { 'author.id': { $gt: 0 } })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filterOptions: { joinType: 'inner' },
                })
                const sql = shrink(query.getSql())
                expect(sql).to.contain('INNER JOIN')
                expect(sql).to.not.contain('LEFT JOIN')
            })

            it('should use INNER JOIN for external filter joins when joinType is inner', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book')
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { author: { name: 'nobody' } },
                    filterOptions: { joinType: 'inner' },
                })
                const sql = shrink(query.getSql())
                expect(sql).to.contain('INNER JOIN')
                expect(sql).to.not.contain('LEFT JOIN')
            })

            it('should leave SQL unchanged with joinType left (same as default)', () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { 'author.id': { $gt: 0 } })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const withoutOpts = b.createQueryTo({ action: 'read', subject: 'Book' })
                const withLeft = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filterOptions: { joinType: 'left' },
                })
                expect(shrink(withoutOpts.getSql())).to.equal(shrink(withLeft.getSql()))
            })
        })

        describe('merge and dedupe', () => {
            it('should merge ability tree and external filter into one WHERE bracket', () => {
                // Both ability and filter have conditions → merged into one bracket.
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { id: 1 })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { title: 'test' },
                })

                const sql = shrink(query.getSql())
                // Both conditions appear inside a single outer bracket.
                expect(sql).to.contain('WHERE (')
                expect(sql).to.contain('"__table__"."id"')
                expect(sql).to.contain('"__table__"."title"')
                // The SQL should NOT have two separate AND-joined top-level brackets.
                // (old shape: WHERE (...) AND (...); new shape: WHERE (... AND ...))
                expect(sql).to.not.match(/WHERE \(.*\) AND \(/)
            })

            it('should dedupe when ability and external filter both add the same predicate', () => {
                // Ability: can('read', 'Book', { id: 1 }) produces $or: [{ id: 1 }].
                // External filter with the same $or structure → structurally identical
                // top-level OR scope → dedupe removes the duplicate.
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { id: 1 })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    // Supply the same $or structure that rulesToQuery generates
                    filters: { $or: [{ id: 1 }] },
                })

                const sql = shrink(query.getSql())
                // "id" = 1 should appear only once after dedup.
                const matches = sql.match(/"__table__"."id" = 1/g) ?? []
                expect(matches).to.have.length(1)
            })

            it('should produce equivalent results with and without dedupe for non-duplicate filters', async () => {
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { id: 2 })
                builder.can('read', 'Book', { id: 8 })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { id: { $gt: 1, $lt: 5 } },
                })

                const entries = await query.getMany()
                // Only id=2 satisfies both ability (id in [2,8]) and filter (1 < id < 5)
                expect(entries.length).to.equal(1)
                expect(entries[0].id).to.equal(2)
            })

            it('should produce no WHERE clause when both trees are empty after simplification', () => {
                // Ability: allow all (empty CASL tree)
                // Filter: path denied + strip → empty filter tree
                // → merged tree is empty → no WHERE
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book')
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { id: 1 },
                    filterOptions: {
                        pathPolicy: { rules: [{ path: 'id', decision: 'deny' }] },
                        onViolation: 'strip',
                    },
                })

                expect(shrink(query.getSql())).to.not.contain('WHERE')
            })

            it('should produce a clean WHERE clause when CASL is allow-all and filter has conditions', () => {
                // Ability: allow all → empty tree; external filter: id > 0
                // Merged: only filter conditions, no spurious "1=1".
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book')
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filters: { id: { $gt: 0 } },
                })

                const sql = shrink(query.getSql())
                // No spurious "1=1 AND" from empty CASL tree.
                expect(sql).to.not.contain('1=1')
                expect(sql).to.contain('"__table__"."id" > 0')
            })

            it('should produce serialisation equivalent to pre-merge semantics', async () => {
                // Smoke test: results must be the same as before the merge.
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { id: 2 })
                builder.can('read', 'Book', { id: 8 })
                const ability = builder.build()
                const b = new CaslBridge(db.source, ability)

                const query = b.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    select: { id: true },
                    filters: { id: { $gt: 1, $lt: 5 } },
                })
                const entries = await query.getMany()
                expect(entries).to.deep.equal([{ id: 2 }])
            })
        })
    })

    describe('createFilterFor', () => {
        let bridge: CaslBridge
        let compileSpy: sinon.SinonSpy

        beforeEach(() => {
            bridge = new CaslBridge(db.source)
            compileSpy = sinon.spy(bridge as any, 'compileExternalFilterTree')
        })
        afterEach(() => compileSpy.restore())

        it('should create a query to select all books', async () => {
            const bridge = new CaslBridge(db.source)
            const filter = bridge.createFilterFor('Book', null)

            expect(shrink(filter.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"    AS "__table___id",
                        "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                    FROM "book" "__table__"
                `)
            )
        })

        it('should create a query filter by id', async () => {
            const bridge = new CaslBridge(db.source)
            const filter = bridge.createFilterFor('Book', {
                id: { $gt: 1, $lt: 5 }
            })

            expect(shrink(filter.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"    AS "__table___id",
                        "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                    FROM "book" "__table__"
                    WHERE ("__table__"."id" > 1 AND
                           "__table__"."id" < 5)
                `)
            )
        })

        it('should create a query to filter and select title', async () => {
            const bridge = new CaslBridge(db.source)
            const filter = bridge.createFilterFor('Book', {
                id: { $gt: 1, $lt: 5 }
            }, ['title'])

            expect(shrink(filter.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."title" AS "__table___title"
                    FROM "book" "__table__"
                    WHERE ("__table__"."id" > 1 AND
                           "__table__"."id" < 5)
                `)
            )
        })

        it('should pass filterOptions to compileExternalFilterTree', () => {
            const filterOpts: FilterOptions = {}

            bridge.createFilterFor(
                'Book',
                { id: { $gt: 1, $lt: 5 } },
                '*',
                '__table__',
                filterOpts
            )

            expect(compileSpy.calledOnce).to.be.true
            expect(compileSpy.firstCall.args[2]).to.equal(filterOpts)
        })

        it('should produce unchanged SQL with filterOptions set', () => {
            const filter = bridge.createFilterFor(
                'Book',
                { id: { $gt: 1, $lt: 5 } },
                '*',
                '__table__',
                {}
            )

            expect(shrink(filter.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"    AS "__table___id",
                        "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                    FROM "book" "__table__"
                    WHERE ("__table__"."id" > 1 AND
                           "__table__"."id" < 5)
                `)
            )
        })

        describe('pathPolicy', () => {
            it('should produce unchanged SQL when pathPolicy is undefined', () => {
                const filter = bridge.createFilterFor(
                    'Book',
                    { id: { $gt: 1, $lt: 5 } },
                )

                expect(shrink(filter.getSql())).to.equal(
                    shrink(`
                        SELECT
                            "__table__"."id"    AS "__table___id",
                            "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                        FROM "book" "__table__"
                        WHERE ("__table__"."id" > 1 AND
                               "__table__"."id" < 5)
                    `)
                )
            })

            it('should throw when a filter field is denied by pathPolicy', () => {
                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                expect(() => bridge.createFilterFor(
                    'Book',
                    { id: { $gt: 1, $lt: 5 } },
                    '*',
                    '__table__',
                    { pathPolicy: policy, onViolation: 'throw' },
                )).to.throw('Filter path "id" is not permitted by PathPolicy')
            })

            it('should strip a denied field when onViolation is strip', () => {
                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                const filter = bridge.createFilterFor(
                    'Book',
                    { id: { $gt: 1, $lt: 5 } },
                    '*',
                    '__table__',
                    { pathPolicy: policy, onViolation: 'strip' },
                )

                expect(shrink(filter.getQuery())).to.equal(
                    shrink(`
                        SELECT
                            "__table__"."id"    AS "__table___id",
                            "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                        FROM "book" "__table__"
                    `)
                )
            })

            it('should replace a denied field with (1=0) when onViolation is false', () => {
                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                const filter = bridge.createFilterFor(
                    'Book',
                    { id: { $gt: 1, $lt: 5 } },
                    '*',
                    '__table__',
                    { pathPolicy: policy, onViolation: 'false' },
                )

                expect(shrink(filter.getSql())).to.contain('1=0')
            })
        })

        describe('joinType', () => {
            it('should default to LEFT JOIN when joinType is undefined', () => {
                const query = bridge.createFilterFor('Book', {
                    author: { name: 'nobody' },
                })
                expect(shrink(query.getSql())).to.contain('LEFT JOIN')
            })

            it('should use INNER JOIN when joinType is inner', () => {
                const query = bridge.createFilterFor(
                    'Book',
                    { author: { name: 'nobody' } },
                    '*',
                    '__table__',
                    { joinType: 'inner' },
                )
                const sql = shrink(query.getSql())
                expect(sql).to.contain('INNER JOIN')
                expect(sql).to.not.contain('LEFT JOIN')
            })

            it('should leave SQL unchanged with joinType left (same as default)', () => {
                const withoutOpts = bridge.createFilterFor('Book', { author: { name: 'nobody' } })
                const withLeft = bridge.createFilterFor(
                    'Book',
                    { author: { name: 'nobody' } },
                    '*',
                    '__table__',
                    { joinType: 'left' },
                )
                expect(shrink(withoutOpts.getSql())).to.equal(shrink(withLeft.getSql()))
            })
        })
    })

    describe('applyFilterTo', () => {
        let bridge: CaslBridge
        let compileSpy: sinon.SinonSpy

        beforeEach(() => {
            bridge = new CaslBridge(db.source)
            compileSpy = sinon.spy(bridge as any, 'compileExternalFilterTree')
        })
        afterEach(() => compileSpy.restore())

        it('should throw if alias not found', () => {
            const bridge = new CaslBridge(db.source)
            const query = bookRepo.createQueryBuilder('__table__')
            expect(() => bridge.applyFilterTo(query, 'Book', {}))
                .to.throw('"Book" alias was not found. Maybe you forgot to join it?')
        })

        it('should use main table alias', () => {
            const bridge = new CaslBridge(db.source)
            const query = bookRepo.createQueryBuilder('__table__')
            const filtered = bridge.applyFilterTo(query, '__table__', {
                id: { $gt: 1, $lt: 5 }
            })

            expect(shrink(filtered.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"       AS "__table___id",
                        "__table__"."title"    AS "__table___title",
                        "__table__"."metadata" AS "__table___metadata",
                        "__table__"."authorId" AS "__table___authorId"
                    FROM "book" "__table__"
                    WHERE ("__table__"."id" > 1 AND
                           "__table__"."id" < 5)
                `)
            )
        })

        it('should use joinable table alias', () => {
            const bridge = new CaslBridge(db.source)
            const query = bookRepo
                .createQueryBuilder('__table__')
                .leftJoin('__table__.author', '__table___author')
            const filtered = bridge.applyFilterTo(query, '__table___author', {
                id: { $gt: 1, $lt: 5 }
            })

            expect(shrink(filtered.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"       AS "__table___id",
                        "__table__"."title"    AS "__table___title",
                        "__table__"."metadata" AS "__table___metadata",
                        "__table__"."authorId" AS "__table___authorId"
                    FROM "book" "__table__"
                    LEFT JOIN "author" "__table___author"
                    ON "__table___author"."id"="__table__"."authorId"
                    WHERE ("__table___author"."id" > 1 AND
                           "__table___author"."id" < 5)
                `)
            )
        })

        it('should do nothing if no filter provided', () => {
            const bridge = new CaslBridge(db.source)
            const query = bookRepo.createQueryBuilder('__table__')
            const filtered = bridge.applyFilterTo(query, '__table__', null)

            expect(shrink(filtered.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"       AS "__table___id",
                        "__table__"."title"    AS "__table___title",
                        "__table__"."metadata" AS "__table___metadata",
                        "__table__"."authorId" AS "__table___authorId"
                    FROM "book" "__table__"
                `)
            )
        })

        it('should pass filterOptions to compileExternalFilterTree', () => {
            const query = bookRepo.createQueryBuilder('__table__')
            const filterOpts: FilterOptions = {}

            bridge.applyFilterTo(
                query,
                '__table__',
                { id: { $gt: 1, $lt: 5 } },
                filterOpts
            )

            expect(compileSpy.calledOnce).to.be.true
            expect(compileSpy.firstCall.args[2]).to.equal(filterOpts)
        })

        it('should produce unchanged SQL with filterOptions set', () => {
            const query = bookRepo.createQueryBuilder('__table__')
            const filtered = bridge.applyFilterTo(
                query,
                '__table__',
                { id: { $gt: 1, $lt: 5 } },
                {}
            )

            expect(shrink(filtered.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"       AS "__table___id",
                        "__table__"."title"    AS "__table___title",
                        "__table__"."metadata" AS "__table___metadata",
                        "__table__"."authorId" AS "__table___authorId"
                    FROM "book" "__table__"
                    WHERE ("__table__"."id" > 1 AND
                           "__table__"."id" < 5)
                `)
            )
        })

        describe('pathPolicy', () => {
            it('should produce unchanged SQL when pathPolicy is undefined', () => {
                const query = bookRepo.createQueryBuilder('__table__')
                const filtered = bridge.applyFilterTo(
                    query,
                    '__table__',
                    { id: { $gt: 1, $lt: 5 } },
                )

                expect(shrink(filtered.getSql())).to.equal(
                    shrink(`
                        SELECT
                            "__table__"."id"       AS "__table___id",
                            "__table__"."title"    AS "__table___title",
                        "__table__"."metadata" AS "__table___metadata",
                            "__table__"."authorId" AS "__table___authorId"
                        FROM "book" "__table__"
                        WHERE ("__table__"."id" > 1 AND
                               "__table__"."id" < 5)
                    `)
                )
            })

            it('should throw when a filter field is denied by pathPolicy', () => {
                const query = bookRepo.createQueryBuilder('__table__')
                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                expect(() => bridge.applyFilterTo(
                    query,
                    '__table__',
                    { id: { $gt: 1, $lt: 5 } },
                    { pathPolicy: policy, onViolation: 'throw' },
                )).to.throw('Filter path "id" is not permitted by PathPolicy')
            })

            it('should strip a denied field when onViolation is strip', () => {
                const query = bookRepo.createQueryBuilder('__table__')
                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                const filtered = bridge.applyFilterTo(
                    query,
                    '__table__',
                    { id: { $gt: 1, $lt: 5 } },
                    { pathPolicy: policy, onViolation: 'strip' },
                )

                // denied field stripped → no WHERE clause added by applyFilterTo
                expect(shrink(filtered.getQuery())).to.equal(
                    shrink(`
                        SELECT
                            "__table__"."id"       AS "__table___id",
                            "__table__"."title"    AS "__table___title",
                        "__table__"."metadata" AS "__table___metadata",
                            "__table__"."authorId" AS "__table___authorId"
                        FROM "book" "__table__"
                    `)
                )
            })

            it('should replace a denied field with (1=0) when onViolation is false', () => {
                const query = bookRepo.createQueryBuilder('__table__')
                const policy: PathPolicy = {
                    rules: [{ path: 'id', decision: 'deny' }],
                }

                const filtered = bridge.applyFilterTo(
                    query,
                    '__table__',
                    { id: { $gt: 1, $lt: 5 } },
                    { pathPolicy: policy, onViolation: 'false' },
                )

                expect(shrink(filtered.getSql())).to.contain('1=0')
            })
        })

        describe('joinType', () => {
            it('should default to LEFT JOIN when joinType is undefined', () => {
                const query = bookRepo
                    .createQueryBuilder('__table__')
                const filtered = bridge.applyFilterTo(query, '__table__', {
                    author: { name: 'nobody' },
                })
                expect(shrink(filtered.getSql())).to.contain('LEFT JOIN')
            })

            it('should use INNER JOIN when joinType is inner', () => {
                const query = bookRepo.createQueryBuilder('__table__')
                const filtered = bridge.applyFilterTo(
                    query,
                    '__table__',
                    { author: { name: 'nobody' } },
                    { joinType: 'inner' },
                )
                const sql = shrink(filtered.getSql())
                expect(sql).to.contain('INNER JOIN')
                expect(sql).to.not.contain('LEFT JOIN')
            })

            it('should leave SQL unchanged with joinType left (same as default)', () => {
                const q1 = bookRepo.createQueryBuilder('__table__')
                bridge.applyFilterTo(q1, '__table__', { author: { name: 'nobody' } })

                const q2 = bookRepo.createQueryBuilder('__table__')
                bridge.applyFilterTo(q2, '__table__', { author: { name: 'nobody' } }, { joinType: 'left' })

                expect(shrink(q1.getSql())).to.equal(shrink(q2.getSql()))
            })

            it('should not rewrite existing joins on a user-supplied query builder', () => {
                // User pre-joins with leftJoin; setting joinType: inner must not
                // change the type of that existing join — only new joins by the
                // library (here there are none because the alias is already joined).
                const query = bookRepo
                    .createQueryBuilder('__table__')
                    .leftJoin('__table__.author', '__table___author')
                const filtered = bridge.applyFilterTo(
                    query,
                    '__table___author',
                    { name: 'nobody' },
                    { joinType: 'inner' },
                )
                // The existing leftJoin must remain unchanged.
                expect(shrink(filtered.getSql())).to.contain('LEFT JOIN')
            })
        })
    })

    describe('checkOptions', () => {
        let bridge: CaslBridge
        let options: QueryOptions

        beforeEach(() => {
            bridge = new CaslBridge(db.source, null)
            options = {
                table: undefined,
                action: undefined,
                subject: 'Book',
                field: undefined,
                select: undefined,
                filters: undefined,
            }
        })

        it('should throw if no subject provided', () => {
            options.subject = undefined as any
            expect(() => bridge['getOptions'](options)).to.throw()
        })

        // it('should throw if table name is invalid', () => {
        //     options.table = '; DROP TABLE book; --'
        //     expect(() => bridge['checkOptions'](options))
        //         .to.throw('Invalid table name: ; DROP TABLE book; --')
        // })

        it('should treat invalis select values as "*"', () => {
            delete options.select // undefined
            bridge['checkOptions'](options)
            expect(options.select).to.equal('*')

            options.select = null
            bridge['checkOptions'](options)
            expect(options.select).to.equal('*')

            options.select = 42 as any
            bridge['checkOptions'](options)
            expect(options.select).to.equal('*')

            options.select = '**.*' as any
            bridge['checkOptions'](options)
            expect(options.select).to.equal('*')
        })

        it('should treat object select as-is', () => {
            options.select = { title: true }
            bridge['checkOptions'](options)
            expect(options.select).to.deep.equal({ title: true })

            options.select = ['title']
            bridge['checkOptions'](options)
            expect(options.select).to.deep.equal(['title'])
        })

        it('should treat non-object filters as undefined', () => {
            options.filters = 42 as any
            bridge['checkOptions'](options)
            expect(options.filters).to.be.undefined
        })

        it('should treat null filters as undefined', () => {
            options.filters = null
            bridge['checkOptions'](options)
            expect(options.filters).to.be.undefined
        })

        it('should treat non-string field as undefined', () => {
            options.field = 42 as any
            bridge['checkOptions'](options)
            expect(options.field).to.be.undefined
        })

        it('should select field when provided', () => {
            options.field = 'title'
            bridge['checkOptions'](options)
            expect(options.select).to.deep.equal(['title'])
        })
    })

    describe('getOptions', () => {
        let bridge: CaslBridge
        let expected: QueryOptions

        beforeEach(() => {
            bridge = new CaslBridge(db.source, null)
            expected = {
                table: '__table__',
                action: 'manage',
                subject: 'Book',
                field: undefined,
                filters: undefined,
                select: '*',
            }
        })

        it('should merge options object', () => {
            const nextOptions: QueryOptions = { subject: 'Book' }
            const merged = bridge['getOptions'](nextOptions)

            expected.subject = 'Book'
            expect(merged).to.deep.equal(expected)
        })

        it('should use managed action for null', () => {
            const merged = bridge['getOptions'](null, 'Book')

            expected.subject = 'Book'
            expected.action = 'manage'
            expect(merged).to.deep.equal(expected)
        })

        it('should use action as-is', () => {
            const merged = bridge['getOptions']('read', 'Book')

            expected.subject = 'Book'
            expected.action = 'read'
            expect(merged).to.deep.equal(expected)
        })

        it('should shift args if field is ommitted', () => {
            const merged = bridge['getOptions'](
                'read',
                'Book',
                { title: true },
                { id: { $ge: 1 } }
            )

            expected.subject = 'Book'
            expected.action = 'read'
            expected.select = { title: true }
            expected.filters = { id: { $ge: 1 } }
            expect(merged).to.deep.equal(expected)
        })

        it('should handle null field', () => {
            const merged = bridge['getOptions'](
                'read',
                'Book',
                null,
                { title: true }
            )

            expected.subject = 'Book'
            expected.action = 'read'
            expected.select = { title: true }
            expected.field = undefined
            expect(merged).to.deep.equal(expected)
        })
    })

    describe('rulesToQuery', () => {
        it('should create for all access', () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book')
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge['rulesToQuery'](ability, 'read', 'Book')

            expect(query).toMatchSnapshot()
        })

        it('should create for no access', () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.cannot('read', 'Book')
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge['rulesToQuery'](ability, 'read', 'Book')

            expect(query).toMatchSnapshot()
        })

        it('should create for conditional access', () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { title: 'The Book' })
            builder.can('read', 'Book', { author: { name: 'John Doe' } })
            builder.cannot('read', 'Book', { title: 'Magic Incantation' })
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge['rulesToQuery'](ability, 'read', 'Book')

            expect(query).toMatchSnapshot()
        })
    })

    // -- Type Testing --

    describe('filterOptions', () => {
        it('FilterOptions type should be assignable to an empty object', () => {
            const opts: FilterOptions = {}
            expect(opts).to.deep.equal({})
        })

        it('QueryOptions should accept filterOptions', () => {
            const opts: QueryOptions = {
                subject: 'Book',
                filterOptions: {},
            }
            expect(opts.filterOptions).to.deep.equal({})
        })

        it('FilterOptions should accept maxDepth and onViolation', () => {
            const opts: FilterOptions = {
                maxDepth: 2,
                onViolation: 'false',
            }
            expect(opts.maxDepth).to.equal(2)
            expect(opts.onViolation).to.equal('false')
        })

        it('FilterOptions should accept joinType', () => {
            const left: FilterOptions = { joinType: 'left' }
            const inner: FilterOptions = { joinType: 'inner' }
            expect(left.joinType).to.equal('left')
            expect(inner.joinType).to.equal('inner')
        })
    })

    describe('compileExternalFilterTree', () => {
        describe('maxDepth', () => {
            it('should not limit filters when maxDepth is undefined', async () => {
                // A join-depth filter must succeed when filterOptions.maxDepth
                // is not set.  The relation-ID rewriter optimises author.id
                // conditions to use the FK column directly (no JOIN needed).
                const bridge = new CaslBridge(db.source)
                const query = bridge.createFilterFor('Book', {
                    author: { id: { $gt: 0 } }
                })

                // The rewriter eliminates the join; FK column used directly.
                expect(shrink(query.getSql())).to.not.contain('LEFT JOIN')
                expect(shrink(query.getSql())).to.contain('"authorId"')
            })

            it('should not limit CASL ability filters even when maxDepth=0', async () => {
                // CASL rules that reference relations must work regardless
                // of the external-filter maxDepth setting.
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { 'author.id': { $gt: 0 } })
                const ability = builder.build()

                const bridge = new CaslBridge(db.source, ability)

                // With maxDepth=0 on the *external* filter channel, the
                // CASL query must still work and the deep join in the
                // ability must survive serialisation.
                expect(() => bridge.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                    filterOptions: { maxDepth: 0, onViolation: 'throw' },
                })).to.not.throw()
            })

            describe('createQueryTo', () => {
                it('should throw for deep external filter when onViolation=throw', () => {
                    const bridge = new CaslBridge(db.source)
                    expect(() => bridge.createQueryTo({
                        action: 'read',
                        subject: 'Book',
                        filters: { author: { id: { $gt: 0 } } },
                        filterOptions: { maxDepth: 0, onViolation: 'throw' },
                    })).to.throw('Filter query exceeds maximum join depth of 0')
                })

                it('should default onViolation to throw when only maxDepth is set', () => {
                    const bridge = new CaslBridge(db.source)
                    expect(() => bridge.createQueryTo({
                        action: 'read',
                        subject: 'Book',
                        filters: { author: { id: { $gt: 0 } } },
                        filterOptions: { maxDepth: 0 },
                    })).to.throw('Filter query exceeds maximum join depth of 0')
                })

                it('should replace deep branch with (1=0) when onViolation=false', () => {
                    const bridge = new CaslBridge(db.source)
                    const query = bridge.createQueryTo({
                        action: 'read',
                        subject: 'Book',
                        filters: { author: { id: { $gt: 0 } } },
                        filterOptions: { maxDepth: 0, onViolation: 'false' },
                    })

                    expect(shrink(query.getSql())).to.contain('(1=0)')
                })

                it('should strip deep branch and produce no WHERE when onViolation=strip', () => {
                    const builder = new AbilityBuilder(createMongoAbility)
                    builder.can('read', 'Book')
                    const ability = builder.build()

                    const bridge = new CaslBridge(db.source, ability)
                    const query = bridge.createQueryTo({
                        action: 'read',
                        subject: 'Book',
                        filters: { author: { id: { $gt: 0 } } },
                        filterOptions: { maxDepth: 0, onViolation: 'strip' },
                    })

                    // The join filter is stripped; no WHERE clause from
                    // the external filter (the CASL "allow all" query
                    // also contributes no WHERE clause).
                    expect(shrink(query.getSql())).to.not.contain('LEFT JOIN')
                })

                it('should preserve non-deep external filter when onViolation=false', () => {
                    const builder = new AbilityBuilder(createMongoAbility)
                    builder.can('read', 'Book')
                    const ability = builder.build()

                    const bridge = new CaslBridge(db.source, ability)
                    const query = bridge.createQueryTo({
                        action: 'read',
                        subject: 'Book',
                        filters: {
                            $or: [
                                { author: { id: { $gt: 0 } } }, // deep → false
                                { id: { $gt: 0 } },              // shallow → kept
                            ]
                        },
                        filterOptions: { maxDepth: 0, onViolation: 'false' },
                    })

                    // author branch becomes false; OR(false, id>0) = id>0
                    const sql = shrink(query.getSql())
                    expect(sql).to.not.contain('(1=0)')
                    expect(sql).to.contain('"id" > 0')
                })

                it('should leave SQL unchanged when maxDepth is not set', async () => {
                    const builder = new AbilityBuilder(createMongoAbility)
                    builder.can('read', 'Book')
                    const ability = builder.build()

                    const bridge = new CaslBridge(db.source, ability)

                    const withoutOpts = bridge.createQueryTo({
                        action: 'read',
                        subject: 'Book',
                        filters: { id: { $gt: 0 } },
                    })
                    const withEmptyOpts = bridge.createQueryTo({
                        action: 'read',
                        subject: 'Book',
                        filters: { id: { $gt: 0 } },
                        filterOptions: {},
                    })

                    expect(shrink(withoutOpts.getSql()))
                        .to.equal(shrink(withEmptyOpts.getSql()))
                })
            })

            describe('createFilterFor', () => {
                it('should throw for deep filter when onViolation=throw', () => {
                    const bridge = new CaslBridge(db.source)
                    expect(() => bridge.createFilterFor(
                        'Book',
                        { author: { id: { $gt: 0 } } },
                        '*',
                        '__table__',
                        { maxDepth: 0, onViolation: 'throw' },
                    )).to.throw('Filter query exceeds maximum join depth of 0')
                })

                it('should emit (1=0) for all-deep filter when onViolation=false', () => {
                    const bridge = new CaslBridge(db.source)
                    const query = bridge.createFilterFor(
                        'Book',
                        { author: { id: { $gt: 0 } } },
                        '*',
                        '__table__',
                        { maxDepth: 0, onViolation: 'false' },
                    )

                    expect(shrink(query.getSql())).to.contain('(1=0)')
                })

                it('should produce no WHERE for all-deep filter when onViolation=strip', () => {
                    const bridge = new CaslBridge(db.source)
                    const query = bridge.createFilterFor(
                        'Book',
                        { author: { id: { $gt: 0 } } },
                        '*',
                        '__table__',
                        { maxDepth: 0, onViolation: 'strip' },
                    )

                    expect(shrink(query.getSql())).to.equal(
                        shrink(`
                            SELECT
                                "__table__"."id"    AS "__table___id",
                                "__table__"."title" AS "__table___title", "__table__"."metadata" AS "__table___metadata"
                            FROM "book" "__table__"
                        `)
                    )
                })

                it('should leave SQL unchanged when maxDepth is not set', () => {
                    const bridge = new CaslBridge(db.source)

                    const without = bridge.createFilterFor('Book', { id: { $gt: 1 } })
                    const withEmpty = bridge.createFilterFor('Book', { id: { $gt: 1 } }, '*', '__table__', {})

                    expect(shrink(without.getSql())).to.equal(shrink(withEmpty.getSql()))
                })
            })

            describe('applyFilterTo', () => {
                it('should throw for deep filter when onViolation=throw', () => {
                    const bridge = new CaslBridge(db.source)
                    const query = bookRepo.createQueryBuilder('__table__')

                    expect(() => bridge.applyFilterTo(
                        query,
                        '__table__',
                        { author: { id: { $gt: 0 } } },
                        { maxDepth: 0, onViolation: 'throw' },
                    )).to.throw('Filter query exceeds maximum join depth of 0')
                })

                it('should emit (1=0) when onViolation=false', () => {
                    const bridge = new CaslBridge(db.source)
                    const query = bookRepo.createQueryBuilder('__table__')

                    bridge.applyFilterTo(
                        query,
                        '__table__',
                        { author: { id: { $gt: 0 } } },
                        { maxDepth: 0, onViolation: 'false' },
                    )

                    expect(shrink(query.getSql())).to.contain('(1=0)')
                })

                it('should produce no WHERE for all-deep filter when onViolation=strip', () => {
                    const bridge = new CaslBridge(db.source)
                    const query = bookRepo.createQueryBuilder('__table__')

                    bridge.applyFilterTo(
                        query,
                        '__table__',
                        { author: { id: { $gt: 0 } } },
                        { maxDepth: 0, onViolation: 'strip' },
                    )

                    expect(shrink(query.getSql())).to.equal(
                        shrink(`
                            SELECT
                                "__table__"."id"       AS "__table___id",
                                "__table__"."title"    AS "__table___title",
                        "__table__"."metadata" AS "__table___metadata",
                                "__table__"."authorId" AS "__table___authorId"
                            FROM "book" "__table__"
                        `)
                    )
                })

                it('should leave SQL unchanged when maxDepth is not set', () => {
                    const bridge = new CaslBridge(db.source)

                    const q1 = bookRepo.createQueryBuilder('__table__')
                    bridge.applyFilterTo(q1, '__table__', { id: { $gt: 1 } })

                    const q2 = bookRepo.createQueryBuilder('__table__')
                    bridge.applyFilterTo(q2, '__table__', { id: { $gt: 1 } }, {})

                    expect(shrink(q1.getSql())).to.equal(shrink(q2.getSql()))
                })
            })
        })

        // ─────────────────────────────────────────────────────────────────
        describe('relation-id rewrite', () => {
            it('must remove JOIN when external filter is only on the relation PK', async () => {
                const bridge = new CaslBridge(db.source)
                const query = bridge.createFilterFor('Book', {
                    author: { id: { $gt: 0 } },
                })
                const sql = shrink(query.getSql())

                expect(sql).to.not.contain('LEFT JOIN')
                // FK column used directly instead of the join
                expect(sql).to.contain('"authorId"')
            })

            it('must return correct results after rewrite', async () => {
                // Seed gives authors with id > 0 for all books, so all books match.
                const bridge = new CaslBridge(db.source)
                const books = await bridge
                    .createFilterFor('Book', { author: { id: { $gt: 0 } } })
                    .getMany()

                const total = await bookRepo.count()
                expect(books.length).to.equal(total)
            })

            it('must retain JOIN when external filter references a non-PK relation field', async () => {
                const bridge = new CaslBridge(db.source)
                const query = bridge.createFilterFor('Book', {
                    author: { name: 'nobody' },
                })
                const sql = shrink(query.getSql())

                expect(sql).to.contain('LEFT JOIN')
            })

            it('must retain JOIN when filter references both PK and non-PK relation fields', async () => {
                const bridge = new CaslBridge(db.source)
                const query = bridge.createFilterFor('Book', {
                    author: { id: 1, name: 'nobody' },
                })
                const sql = shrink(query.getSql())

                expect(sql).to.contain('LEFT JOIN')
            })

            it('must use TypeORM metadata for non-id PK and non-standard FK property', async () => {
                // Article.primaryTag has PK = 'code' (not 'id')
                // FK column = 'tagCode' (non-standard name)
                // The rewriter must consult metadata, not guess the name.
                const bridge = new CaslBridge(db.source)
                const query = bridge.createFilterFor('Article', {
                    primaryTag: { code: 'TECH' },
                })
                const sql = shrink(query.getSql())

                // Join to 'tag' table must NOT appear
                expect(sql).to.not.contain('LEFT JOIN')
                // The FK column 'tagCode' must appear in the WHERE clause
                expect(sql).to.contain('"tagCode"')
            })

            it('must return correct results for non-id PK rewrite', async () => {
                const bridge = new CaslBridge(db.source)
                const articles = await bridge
                    .createFilterFor('Article', { primaryTag: { code: 'TECH' } })
                    .getMany()

                expect(articles.length).to.be.greaterThan(0)

                // Cross-check: direct query using JOIN must return same count
                const articleRepo = db.source.getRepository(Article)
                const expected = await articleRepo
                    .createQueryBuilder('a')
                    .leftJoin('a.primaryTag', 'tag')
                    .where('tag.code = :code', { code: 'TECH' })
                    .getCount()

                expect(articles.length).to.equal(expected)
            })

            it('must NOT rewrite CASL ability-derived filters (joins are preserved)', async () => {
                // CASL rules that reference relations must still produce the
                // join when the ability query is serialised; the rewriter only
                // operates on the external-filter pipeline, never on ability rules.
                const builder = new AbilityBuilder(createMongoAbility)
                builder.can('read', 'Book', { 'author.id': { $gt: 0 } })
                const ability = builder.build()

                const bridge = new CaslBridge(db.source, ability)
                const query = bridge.createQueryTo({
                    action: 'read',
                    subject: 'Book',
                })
                const sql = shrink(query.getSql())

                // The CASL ability path uses a join – it must remain.
                expect(sql).to.contain('LEFT JOIN')
            })

            it('must work with createQueryTo external filters', async () => {
                const bridge = new CaslBridge(db.source)
                const query = bridge.createQueryTo({
                    action: 'manage',
                    subject: 'Book',
                    filters: { author: { id: { $gt: 0 } } },
                })
                const sql = shrink(query.getSql())

                expect(sql).to.not.contain('LEFT JOIN')
                expect(sql).to.contain('"authorId"')
            })

            it('must work with applyFilterTo external filters', async () => {
                const bridge = new CaslBridge(db.source)
                const query = bookRepo.createQueryBuilder('__table__')
                bridge.applyFilterTo(query, '__table__', {
                    author: { id: { $gt: 0 } },
                })

                const sql = shrink(query.getSql())

                expect(sql).to.not.contain('LEFT JOIN')
                expect(sql).to.contain('"authorId"')
            })

            it('must retain JOIN for a one-to-many (inverse-side) relation — empty joinColumns', async () => {
                // Author.books is one-to-many (inverse side).  TypeORM returns
                // joinColumns = [] for this relation because the FK lives on Book,
                // not on Author.  makeRelationMetaProvider returns null at the
                // joinColumns.length === 0 guard → no rewrite → JOIN retained.
                const bridge = new CaslBridge(db.source)
                const query = bridge.createFilterFor('Author', {
                    books: { title: 'The Book' },
                })
                const sql = shrink(query.getSql())

                expect(sql).to.contain('LEFT JOIN')
            })

            it('must retain JOIN for a many-to-many relation — join-table FK not on entity', async () => {
                // Author.comments is many-to-many (owning side).  TypeORM populates
                // joinColumns with the join-table column 'author_id', which does NOT
                // exist as a property on Author.  The hasColumn guard filters all
                // joinColumns out → empty fkMapping → makeRelationMetaProvider returns null
                // → no rewrite → JOIN retained.
                const bridge = new CaslBridge(db.source)
                const query = bridge.createFilterFor('Author', {
                    comments: { id: 5 },
                })
                const sql = shrink(query.getSql())

                expect(sql).to.contain('LEFT JOIN')
            })

            it('must retain JOIN when the filter relation does not exist on the entity', async () => {
                // If a join scope's column name is not a relation on the entity,
                // makeRelationMetaProvider returns null → join scope is left for the
                // serializer to handle.  The serializer then throws because the
                // column is not joinable.
                const bridge = new CaslBridge(db.source)
                expect(() => bridge.createFilterFor('Book', {
                    author: { name: { nested: 'x' } },
                } as any)).to.throw()
            })
        })
    })
})

