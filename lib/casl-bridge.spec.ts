import 'mocha'
import { expect } from 'chai'
import { CaslBridge } from './casl-bridge'
import { Book, TestDatabase } from './test-db'
import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import { Repository } from 'typeorm'
import { QueryOptions } from './types'

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
                        "__table__"."title" AS "__table___title"
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
                        "__table__"."title" AS "__table___title"
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
                            ("__table__"."id" = 2))) AND
                            ("__table__"."id" > 1 AND
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
            expect(shrink(query.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"                  AS "__table___id",
                        "__table__"."Today's_Message"     AS "__table___Today's_Message",
                        "__table__"."$recycle$"           AS "__table___$recycle$",
                        "__table__"."id""_>_0_OR_1-1;_--" AS "__table___id""_>_0_OR_1-1;_--",
                        "__table__"."🤔"                  AS "__table___🤔"
                    FROM "sketchy" "__table__"
                    WHERE 1=1 AND
                        ("__table__"."$recycle$" = ? AND
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
    })

    describe('createFilterFor', () => {
        it('should create a query to select all books', async () => {
            const bridge = new CaslBridge(db.source)
            const filter = bridge.createFilterFor('Book', null)

            expect(shrink(filter.getSql())).to.equal(
                shrink(`
                    SELECT
                        "__table__"."id"    AS "__table___id",
                        "__table__"."title" AS "__table___title"
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
                        "__table__"."title" AS "__table___title"
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
    })

    describe('applyFilterTo', () => {
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
                        "__table__"."authorId" AS "__table___authorId"
                    FROM "book" "__table__"
                `)
            )
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
            delete options.subject
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
})
