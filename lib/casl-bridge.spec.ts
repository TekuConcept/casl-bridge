import 'mocha'
import * as _ from 'lodash'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { CaslBridge } from './casl-bridge'
import { Book, BookSchema, TestDatabase } from './test-db'
import {
    AbilityBuilder,
    createMongoAbility
} from '@casl/ability'
import { Repository } from 'typeorm'
import {
    CaslGate,
    InternalQueryOptions,
    MongoFields,
    QueryContext,
    QueryOptions
} from './types'

describe('CaslTypeOrmQuery', () => {
    let db: TestDatabase
    let context: QueryContext
    let repo: Repository<Book>

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        await db.seed()
        repo = db.source.getRepository(BookSchema)
    })
    after(async () => await db.disconnect())

    beforeEach(() => {
        context = {
            options: {
                table: '__table__',
                subject: '',
                selectAll: false,
                strict: true,
            },
            parameter: 0,
            join: null,
            selectMap: false,
            selected: new Set(),
            builder: null,
            aliases: ['__table__'],
            columns: [],
            stack: [],
            currentState: {
                selectMap: false,
                builder: null,
                and: false,
                where: null,
                aliasID: 0,
                repo,
            }
        }
    })

    describe('createQuery', () => {
        let bridge: CaslBridge
        let ability: CaslGate
        let insertOperations: sinon.SinonStub

        beforeEach(() => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            ability = builder.build()

            bridge = new CaslBridge(db.source, ability)
            insertOperations = sinon.stub(bridge, <any>'insertOperations')
        })

        it('should create a query that returns no results', async () => {
            const query = bridge.createQueryTo('write', 'Book')
            expect(query.getQuery()).toMatchSnapshot()
        })

        it('should protect against field SQL injection', () => {
            // See also test for `selectPrimaryField`
            expect(() => bridge.createQueryTo('read', 'Book', "id; DROP TABLE book; --")).to.throw()
        })

        it('should maintain table alias name', () => {
            bridge.createQueryTo('read', 'Book', 'id')
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].options.table).to.equal('__table__')
        })
    })

    describe('setup functions', () => {
        describe('checkOptions', () => {
            let bridge: CaslBridge
            let options: InternalQueryOptions

            beforeEach(() => {
                bridge = new CaslBridge(db.source, null)
                options = {
                    table: undefined,
                    action: undefined,
                    subject: 'Book',
                    field: undefined,
                    select: undefined,
                    filters: undefined,
                    selectAll: false,
                    strict: true,
                }
            })

            it('should throw if no subject provided', () => {
                delete options.subject
                expect(() => bridge['getOptions'](options)).to.throw()
            })

            it('should throw if table name is invalid', () => {
                options.table = '; DROP TABLE book; --'
                expect(() => bridge['checkOptions'](options))
                    .to.throw('Invalid table name: ; DROP TABLE book; --')
            })

            it('should select all for "*" select', () => {
                options.select = '*'
                bridge['checkOptions'](options)
                expect(options.selectAll).to.be.true
                expect(options.select).to.be.true
            })

            it('should treat boolean select as-is', () => {
                options.select = true
                bridge['checkOptions'](options)
                expect(options.selectAll).to.be.false
                expect(options.select).to.be.true
            })

            it('should treat undefined select as true', () => {
                delete options.select
                bridge['checkOptions'](options)
                expect(options.selectAll).to.be.false
                expect(options.select).to.be.true
            })

            it('should treat null select as false', () => {
                options.select = null
                bridge['checkOptions'](options)
                expect(options.selectAll).to.be.false
                expect(options.select).to.be.false
            })

            it('should treat object select as-is', () => {
                options.select = { title: true }
                bridge['checkOptions'](options)
                expect(options.selectAll).to.be.false
                expect(options.select).to.deep.equal({ title: true })
            })

            it('should treat all other select types as truthy', () => {
                options.select = 42 as any
                bridge['checkOptions'](options)
                expect(options.selectAll).to.be.false
                expect(options.select).to.be.true
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

            it('should assign non-boolean strict as global strict', () => {
                options.strict = 42 as any
                bridge['checkOptions'](options)
                expect(options.strict).to.be.true // default
            })
        })

        describe('getOptions', () => {
            let bridge: CaslBridge
            let expected: InternalQueryOptions

            beforeEach(() => {
                bridge = new CaslBridge(db.source, null)
                expected = {
                    table: '__table__',
                    action: 'manage',
                    subject: 'Book',
                    field: undefined,
                    filters: undefined,
                    select: true,
                    selectAll: false,
                    strict: true,
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

            it('should convert "*" field to select all', () => {
                const merged = bridge['getOptions'](
                    'read',
                    'Book',
                    '*',
                    { id: { $ge: 1 } }
                )

                expected.subject = 'Book'
                expected.action = 'read'
                expected.field = undefined
                expected.selectAll = true
                expected.select = true
                expected.filters = { id: { $ge: 1 } }
                expect(merged).to.deep.equal(expected)
            })
        })

        describe('selectAll', () => {
            let bridge: CaslBridge

            before(() => bridge = new CaslBridge(db.source, null))

            it('should select all fields', () => {
                const selected = bridge['selectAll'](repo)
                expect(selected).to.deep.equal([
                    'id',
                    'title',
                    'author',
                ])
            })

            it('should select all fields with a prefix', () => {
                const selected = bridge['selectAll'](repo, 'table')
                expect(selected).to.deep.equal([
                    'table.id',
                    'table.title',
                    'table.author',
                ])
            })

            it('should drop fields in strict mode', () => {
                const sketchyRepo = db.source.getRepository('Sketchy')
                const selected = bridge['selectAll'](sketchyRepo)
                expect(selected).to.deep.equal(['id'])
            })

            it('should include all fields in non-strict mode', () => {
                const strict = true
                const sketchyRepo = db.source.getRepository('Sketchy')
                const selected = bridge['selectAll'](
                    sketchyRepo,
                    undefined,
                    !strict
                )

                // NOTE: better-sqlite3 (used for these tests) uses double quotes
                expect(selected).to.deep.equal([
                    'id',
                    '"Today\'s Message"',
                    '"$recycle$"',
                    '"id"" > 0 OR 1=1; --"',
                    '"🤔"',
                ])
            })
        })

        describe('selectPrimaryField', () => {
            let bridge: CaslBridge

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
                bridge = new CaslBridge(db.source, null)
                const builder = repo.createQueryBuilder('__table__')
                _.merge(context, {
                    builder,
                    currentState: {
                        builder,
                        where: builder.andWhere.bind(builder),
                    }
                })
            })

            it('should not select field if none provided', () => {
                bridge['selectPrimaryField'](context)
                const selected = Array.from(context.selected)
                expect(selected).to.deep.equal([])
            })

            it('should throw if field is invalid', () => {
                context.options.field = 'id OR 1=1; --'
                expect(() => bridge['selectPrimaryField'](context)).to.throw()
            })

            it('should throw if field not allowed in strict mode', () => {
                const sketchyRepo = db.source.getRepository('Sketchy')
                context.options.field = 'Today\'s Message'
                context.currentState.repo = sketchyRepo
                expect(() => bridge['selectPrimaryField'](context)).to.throw()
            })

            it('should select a field', () => {
                context.options.field = 'title'
                bridge['selectPrimaryField'](context)
                const selected = Array.from(context.selected)
                expect(selected).to.deep.equal(['__table__.title'])
            })

            it('should select a field in non-strict mode', () => {
                const sketchyRepo = db.source.getRepository('Sketchy')
                context.options.field = 'Today\'s Message'
                context.options.strict = false

                // -- query setup --
                context.builder = sketchyRepo.createQueryBuilder('__table__')
                context.join = context.builder.leftJoin.bind(context.builder)
                context.currentState.builder = context.builder
                context.currentState.where = context.builder.andWhere.bind(context.builder)
                context.currentState.repo = sketchyRepo
                // -- end query setup --

                // NOTE: better-sqlite3 (used for these tests) uses double quotes
                bridge['selectPrimaryField'](context)
                const selected = Array.from(context.selected)
                expect(selected).to.deep.equal(['__table__."Today\'s Message"'])
            })

            it('should select a relative field', () => {
                context.options.field = 'author'
                bridge['selectPrimaryField'](context)
                const selected = Array.from(context.selected)
                expect(selected).to.deep.equal([
                    '__table__.author',
                    '__table___author.id',
                    '__table___author.name',
                ])
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___author'
                ])
            })
        })

        describe('selectAllImmediateFields', () => {
            let bridge: CaslBridge

            before(() => bridge = new CaslBridge(db.source, null))

            it('should select all immediate fields', () => {
                const builder = repo.createQueryBuilder('__table__')
                context.join = builder.leftJoin.bind(builder)
                context.currentState.where = builder.andWhere.bind(builder)
                context.currentState.selectMap = true

                bridge['selectAllImmediateFields'](context)

                expect(Array.from(context.selected)).to.deep.equal([
                    '__table__.id',
                    '__table__.title',
                    '__table__.author',
                    '__table___author.id',
                    '__table___author.name',
                ])
            })

            it('should drop fields in strict mode', () => {
                const sketchyRepo = db.source.getRepository('Sketchy')
                const builder = sketchyRepo.createQueryBuilder('__table__')
                context.join = builder.leftJoin.bind(builder)
                context.currentState.where = builder.andWhere.bind(builder)
                context.currentState.selectMap = true
                context.currentState.repo = sketchyRepo

                bridge['selectAllImmediateFields'](context)

                expect(Array.from(context.selected)).to.deep.equal([
                    '__table__.id',
                ])
            })

            it('should drop embedded fields in strict mode', () => {
                // pretend the author table has "relaxed" fields
                const getInfoFromColumnMetadata = sinon.stub(bridge, <any>'getInfoFromColumnMetadata')

                getInfoFromColumnMetadata.callsFake((_repo, metadata: any, strict) => {
                    const workingName = metadata.propertyName
                    if (strict && workingName === 'name') return null
                    return { workingName, metadata }
                })

                const builder = repo.createQueryBuilder('__table__')
                context.join = builder.leftJoin.bind(builder)
                context.currentState.where = builder.andWhere.bind(builder)
                context.currentState.selectMap = true

                bridge['selectAllImmediateFields'](context)

                expect(Array.from(context.selected)).to.deep.equal([
                    '__table__.id',
                    '__table__.title',
                    '__table__.author',
                    '__table___author.id',
                    // name is dropped
                ])

                getInfoFromColumnMetadata.restore()
            })

            it('should include fields in non-strict mode', () => {
                const sketchyRepo = db.source.getRepository('Sketchy')
                const builder = sketchyRepo.createQueryBuilder('__table__')
                context.join = builder.leftJoin.bind(builder)
                context.currentState.where = builder.andWhere.bind(builder)
                context.currentState.selectMap = true
                context.currentState.repo = sketchyRepo
                context.options.strict = false

                bridge['selectAllImmediateFields'](context)

                expect(Array.from(context.selected)).to.deep.equal([
                    '__table__.id',
                    "__table__.\"Today's Message\"",
                    "__table__.\"$recycle$\"",
                    "__table__.\"id\"\" > 0 OR 1=1; --\"",
                    "__table__.\"🤔\""
                ])
            })

            // NOTE: aliases are encoded in `createAliasFrom`
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

    describe('access functions', () => {
        describe('getInfoFromColumnMetadata', () => {
            const strict = true
            let sketchyRepo: Repository<any>

            before(() => sketchyRepo = db.source.getRepository('Sketchy'))

            it('should return info if simple column', () => {
                const bridge = new CaslBridge(db.source, null)
                const metadata = sketchyRepo.metadata.columns
                    .find(c => c.propertyName === 'id')
                const info = bridge['getInfoFromColumnMetadata'](
                    repo, metadata, strict)

                expect(info.workingName).to.equal('id')
                expect(info.metadata).to.equal(metadata)
            })

            it('should return null if not simple and strict', () => {
                const bridge = new CaslBridge(db.source, null)
                const metadata = sketchyRepo.metadata.columns
                    .find(c => c.propertyName === 'Today\'s Message')
                const info = bridge['getInfoFromColumnMetadata'](
                    sketchyRepo, metadata, strict)

                expect(info).to.be.null
            })

            it('should return info with quoted name if not simple', () => {
                const bridge = new CaslBridge(db.source, null)
                const metadata = sketchyRepo.metadata.columns
                    .find(c => c.propertyName === 'id"" > 0 OR 1=1; --')
                const info = bridge['getInfoFromColumnMetadata'](
                    sketchyRepo, metadata, !strict)

                // NOTE: better-sqlite3 (used for these tests) uses double quotes
                expect(info.workingName).to.equal('"id"" > 0 OR 1=1; --"')
                expect(info.metadata).to.equal(metadata)
            })
        })

        describe('checkColumn', () => {
            it('should throw if column is null or empty', () => {
                const bridge = new CaslBridge(null, null)
                expect(() => bridge['checkColumn'](null, repo, true)).to.throw()
                expect(() => bridge['checkColumn']('', repo, true)).to.throw()
            })

            it('should throw if column is not a valid column key', () => {
                const bridge = new CaslBridge(null, null)
                const sqlinjection = "id; DROP TABLE book; --"
                expect(() => bridge['checkColumn'](sqlinjection, repo, true)).to.throw()
            })

            it('should throw if column is not simple in strict mode', () => {
                const bridge = new CaslBridge(null, null, /*strict=*/true)
                const sketchyRepo = db.source.getRepository('Sketchy')
                expect(() => bridge['checkColumn']('id', sketchyRepo, true)).to.not.throw()
                expect(() => bridge['checkColumn']('Today\'s Message', sketchyRepo, true))
                    .to.throw('Column "Today\'s Message" not allowed in strict mode')
            })

            it('should return valid column info', () => {
                const strict = true
                const sketchyRepo = db.source.getRepository('Sketchy')
                const bridge = new CaslBridge(db.source, null)
                const info = bridge['checkColumn']('id"" > 0 OR 1=1; --', sketchyRepo, !strict)
                const info2 = bridge['checkColumn']('id', repo, strict)

                // NOTE: better-sqlite3 (used for these tests) uses double quotes
                expect(info.metadata.propertyName).to.equal('id"" > 0 OR 1=1; --')
                expect(info.workingName).to.equal('"id"" > 0 OR 1=1; --"')

                // simple identifiers shouldn't need to be quoted
                expect(info2.metadata.propertyName).to.equal('id')
                expect(info2.workingName).to.equal('id')
            })
        })

        describe('createAliasFrom', () => {
            it('should throw if column not set', () => {
                const bridge = new CaslBridge(db.source, null)
                delete context.currentState.columnID
                expect(() => bridge['createAliasFrom'](context)).to.throw()
            })

            it('should throw if column unavailable', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = []
                context.currentState.columnID = 1
                expect(() => bridge['createAliasFrom'](context)).to.throw()
            })

            it('should throw if alias unavailable', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = [{ propertyName: 'title' } as any]
                context.currentState.columnID = 0
                context.currentState.aliasID = 1
                context.aliases = []

                expect(() => bridge['createAliasFrom'](context)).to.throw()
            })

            it('should create a new alias', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = [
                    { workingName: 'title' } as any,
                    { workingName: '"id"" > 0 OR 1=1; --"' } as any
                ]

                context.currentState.columnID = 0
                expect(bridge['createAliasFrom'](context)).to.equal(1)
                context.currentState.columnID = 1
                expect(bridge['createAliasFrom'](context)).to.equal(2)

                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___title',
                    '__table____22id2222203e20020OR2013d13b202d2d22'
                ])
            })

            it('should create a new alias from columnID', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = [
                    { workingName: 'title' } as any,
                    { workingName: 'author' } as any
                ]
                context.currentState.columnID = 0

                const id = bridge['createAliasFrom'](context, 1)
                expect(id).to.equal(1)
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___author'
                ])
            })
        })

        describe('findAliasIDFor', () => {
            beforeEach(() => {
                _.merge(context, {
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
                    columns: [
                        { workingName: 'title' } as any,
                        { workingName: 'author' } as any
                    ],
                })
            })

            it('should return the alias ID if the alias exists', () => {
                const bridge = new CaslBridge(db.source, null)
                context.currentState.columnID = 1
                expect(bridge['findAliasIDFor'](context)).to.equal(1)
            })

            it('should return -1 if the alias does not exist', () => {
                const bridge = new CaslBridge(db.source, null)
                context.currentState.columnID = 0
                expect(bridge['findAliasIDFor'](context)).to.equal(-1)
            })
        })

        describe('getQuoteChars', () => {
            let fakeRepo: Repository<any>
            let options: { type: string }
            let bridge: CaslBridge

            beforeEach(() => {
                bridge = new CaslBridge(db.source, null)
                options = { type: 'mysql' }
                fakeRepo = { manager: { connection: { options } } } as any
            })

            it('should return backticks for MySQL-like databases', () => {
                const types = [
                    'mysql',
                    'aurora-mysql',
                    'mariadb',
                ]

                types.forEach(type => {
                    options.type = type
                    expect(bridge['getQuoteChars'](fakeRepo)).to.deep.equal(['`'])
                })
            })

            it('should return double quotes for standard-SQL databases', () => {
                const types = [
                    'sqljs',
                    'sqlite',
                    'better-sqlite3',
                    'postgres',
                    'aurora-postgres',
                    'oracle',
                ]

                types.forEach(type => {
                    options.type = type
                    expect(bridge['getQuoteChars'](fakeRepo)).to.deep.equal(['"'])
                })
            })

            it('should return square brackets for SQL Server databases', () => {
                const types = [ 'mssql' ]

                types.forEach(type => {
                    options.type = type
                    expect(bridge['getQuoteChars'](fakeRepo)).to.deep.equal(['[', ']'])
                })
            })

            it('should throw for unsupported databases', () => {
                options.type = 'unsupported'
                expect(() => bridge['getQuoteChars'](fakeRepo)).to.throw()
            })
        })

        describe('getQuotedName', () => {
            let fakeRepo: Repository<any>
            let options: { type: string }
            let bridge: CaslBridge

            beforeEach(() => {
                bridge = new CaslBridge(db.source, null)

                options = { type: 'mysql' }
                fakeRepo = { manager: { connection: { options } } } as any
            })

            it('should double-up quote characters', () => {
                options.type = 'mysql' // backticks
                expect(bridge['getQuotedName'](fakeRepo, 'De`Brian\'s'))
                    .to.equal("`De``Brian's`")

                options.type = 'postgres' // double quotes
                expect(bridge['getQuotedName'](fakeRepo, 'They say "yes"'))
                    .to.equal('"They say ""yes"""')

                options.type = 'mssql' // square brackets
                expect(bridge['getQuotedName'](fakeRepo, 'Obj[$embed$].prop = "s"'))
                    .to.equal('[Obj[[$embed$]].prop = "s"]')

                options.type = 'better-sqlite3' // double quotes (plain name)
                expect(bridge['getQuotedName'](fakeRepo, 'name'))
                    .to.equal('"name"')
            })

            it('should throw if incorrect number of quote characters', () => {
                const getQuoteChars = sinon.stub(bridge, <any>'getQuoteChars')

                getQuoteChars.returns([])
                expect(() => bridge['getQuotedName'](fakeRepo, 'name')).to.throw()

                getQuoteChars.returns(['`', '"', "'"]) // pick one and stick with it
                expect(() => bridge['getQuotedName'](fakeRepo, 'name')).to.throw()

                getQuoteChars.restore()
            })

            it('should throw if quote characters identical', () => {
                const getQuoteChars = sinon.stub(bridge, <any>'getQuoteChars')

                getQuoteChars.returns(['[', '[']) // typo
                expect(() => bridge['getQuotedName'](fakeRepo, 'name')).to.throw()

                getQuoteChars.restore()
            })
        })

        describe('aliasEncode', () => {
            let bridge: CaslBridge

            before(() => bridge = new CaslBridge(db.source, null))

            it('should leave alphanumeric strings unchanged', () => {
                expect(bridge['aliasEncode']('Column_Name_22'))
                    .to.equal('Column_Name_22')
            })

            it('should escape special characters', () => {
                expect(bridge['aliasEncode']('id\' > 0 OR 1=1; --'))
                    .to.equal('id27203e20020OR2013d13b202d2d')
            })

            it('should escape first numeric character', () => {
                expect(bridge['aliasEncode']('1id'))
                    .to.equal('_1id')
            })

            it('should escape first numeric hex value', () => {
                expect(bridge['aliasEncode'](' id'))
                    .to.equal('_20id')
            })

            it('should 0-pad hex values', () => {
                expect(bridge['aliasEncode']('id\x00'))
                    .to.equal('id00')
            })
        })

        describe('getAliasName', () => {
            beforeEach(() => {
                _.merge(context, {
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
                    currentState: { aliasID: 1 }
                })
            })

            it('should throw if the id is invalid', () => {
                const bridge = new CaslBridge(db.source, null)
                context.aliases = []
                expect(() => bridge['getAliasName'](context)).to.throw()
            })

            it('should return the alias name of the given id', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['getAliasName'](context, 0)).to.equal('__table__')
            })

            it('should return the alias name of the current state', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['getAliasName'](context)).to.equal('__table___author')
            })
        })

        describe('setColumn', () => {
            it('should throw if column is invalid', () => {
                const bridge = new CaslBridge(db.source, null)
                const sqlinjection = "id; DROP TABLE book; --"
                expect(() => bridge['setColumn'](context, sqlinjection)).to.throw()
            })

            it('should set the column', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = []
                bridge['setColumn'](context, 'title')
                expect(context.currentState.columnID).to.equal(0)
                expect(context.columns[0].metadata.propertyName).to.equal('title')
            })

            it('should not add metadata if already added', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = []
                bridge['setColumn'](context, 'title')
                bridge['setColumn'](context, 'title')
                expect(context.columns.length).to.equal(1)
            })
        })

        describe('getColumnName', () => {
            beforeEach(() => {
                _.merge(context, {
                    columns: [
                        { workingName: 'title' } as any,
                        { workingName: 'author' } as any
                    ],
                    currentState: { columnID: 1 }
                })
            })

            it('should throw if the columnID is not set', () => {
                const bridge = new CaslBridge(db.source, null)
                delete context.currentState.columnID
                expect(() => bridge['getColumnName'](context)).to.throw()
            })

            it('should throw if the id is invalid', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = []
                expect(() => bridge['getColumnName'](context)).to.throw()
            })

            it('should return the column name of the given id', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['getColumnName'](context, 0)).to.equal('title')
            })

            it('should return the column name of the current state', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['getColumnName'](context)).to.equal('author')
            })
        })

        describe('throwBadColumnId', () => {
            it('should throw an error', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(() => bridge['throwBadColumnId'](2)).to.throw(
                    'Column ID [ 2 ] not found in context. ' +
                    'This may be do to using query functions ' +
                    'where column names are expected.'
                )
            })
        })

        describe('isColumnJoinable', () => {
            beforeEach(() => {
                _.merge(context, {
                    columns: [
                        {
                            workingName: 'title',
                            metadata: {}
                        } as any,
                        {
                            workingName: 'author',
                            metadata: { relationMetadata: {} }
                        } as any
                    ],
                    currentState: { columnID: 1 }
                })
            })

            it('may return false if the columnID is not set', () => {
                const bridge = new CaslBridge(db.source, null)
                delete context.currentState.columnID
                expect(bridge['isColumnJoinable'](context)).to.be.false
            })

            it('may return false if the id is invalid', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = []
                expect(bridge['isColumnJoinable'](context)).to.be.false
            })

            it('should return the status of the given id', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['isColumnJoinable'](context, 0)).to.be.false
            })

            it('should return the status of the current state', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['isColumnJoinable'](context)).to.be.true
            })
        })

        describe('getJoinableType', () => {
            beforeEach(() => {
                _.merge(context, {
                    columns: [
                        {
                            workingName: 'title',
                            metadata: {}
                        } as any,
                        {
                            workingName: 'author',
                            metadata: { relationMetadata: { type: 'Author' } }
                        } as any
                    ],
                    currentState: { columnID: 1 }
                })
            })

            it('should throw if the columnID is not set', () => {
                const bridge = new CaslBridge(db.source, null)
                delete context.currentState.columnID
                expect(() => bridge['getJoinableType'](context)).to.throw(
                    'Column ID [ undefined ] not found in context. ' +
                    'This may be do to using query functions ' +
                    'where column names are expected.'
                )
            })

            it('should throw if the id is invalid', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = []
                expect(() => bridge['getJoinableType'](context)).to.throw(
                    'Column ID [ 1 ] not found in context. ' +
                    'This may be do to using query functions ' +
                    'where column names are expected.'
                )
            })

            it('should throw if the column is not joinable', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(() => bridge['getJoinableType'](context, 0))
                    .to.throw('Column title has no relational data')
            })

            it('should return the status of the given id', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['getJoinableType'](context, 1)).to.equal('Author')
            })

            it('should return the status of the current state', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['getJoinableType'](context)).to.equal('Author')
            })
        })

        describe('selectField', () => {
            beforeEach(() => {
                _.merge(context, {
                    columns: [{ workingName: 'id' } as any],
                    currentState: {
                        aliasID: 0,
                        columnID: 0,
                    }
                })
            })

            it('should not select if primary field is already selected', () => {
                const bridge = new CaslBridge(null, null)
                context.options.field = 'id'
                bridge['selectField'](context)
                expect(context.selected.size).to.equal(0)
            })

            it('should not select if false selectMap', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = false
                bridge['selectField'](context)
                expect(context.selected.size).to.equal(0)
            })

            it('should select if true selectMap', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = true
                bridge['selectField'](context)
                expect(Array.from(context.selected))
                    .to.deep.equal(['__table__.id'])
            })

            it('should not select if false selectMap property', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = { id: false }
                bridge['selectField'](context)
                expect(context.selected.size).to.equal(0)
            })

            it('should select if true selectMap property', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = { id: true }
                bridge['selectField'](context)
                expect(Array.from(context.selected))
                    .to.deep.equal(['__table__.id'])
            })

            it('should not select for unsupported selectMap type', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = 42 as any
                bridge['selectField'](context)
                expect(context.selected.size).to.equal(0)
            })
        })

        describe('nextSelectMap', () => {
            it('should return a boolean value for non-objects', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = 42 as any
                expect(bridge['nextSelectMap'](context, 'title')).to.be.true

                context.currentState.selectMap = '' as any
                expect(bridge['nextSelectMap'](context, 'title')).to.be.false
            })

            it('should return false for non-existen properties', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = { title: true }
                expect(bridge['nextSelectMap'](context, 'author')).to.be.false
            })

            it('should return a boolean value for non-object property values', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = {
                    title: 'yes',
                    author: ''
                } as any
                expect(bridge['nextSelectMap'](context, 'title')).to.be.true
                expect(bridge['nextSelectMap'](context, 'author')).to.be.false
            })

            it('should return object property values', () => {
                const bridge = new CaslBridge(null, null)
                context.currentState.selectMap = {
                    author: { name: true },
                }
                expect(bridge['nextSelectMap'](context, 'author'))
                    .to.deep.equal({ name: true })
            })
        })

        describe('getParamName', () => {
            it('should return the parameter name', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(bridge['getParamName'](context)).to.equal('param_0')
                expect(bridge['getParamName'](context)).to.equal('param_1')
                expect(bridge['getParamName'](context)).to.equal('param_2')
            })

            it('should throw if parameter is invalid', () => {
                const bridge = new CaslBridge(db.source, null)
                context.parameter = -1
                expect(() => bridge['getParamName'](context)).to.throw()
                context.parameter = 'invalid' as any
                expect(() => bridge['getParamName'](context)).to.throw()
            })

            it('should return names with integer suffixes', () => {
                const bridge = new CaslBridge(db.source, null)
                context.parameter = 0.5
                expect(bridge['getParamName'](context)).to.equal('param_0')
                expect(bridge['getParamName'](context)).to.equal('param_1')
                expect(bridge['getParamName'](context)).to.equal('param_2')
            })
        })
    })

    describe('query builder functions', () => {
        describe('scopedInvoke', () => {
            let bridge: CaslBridge

            beforeEach(() => {
                const builder = repo.createQueryBuilder('__table__')
                _.merge(context, {
                    builder,
                    currentState: {
                        builder,
                        where: builder.andWhere.bind(builder),
                    }
                })
                bridge = new CaslBridge(db.source, null)
            })

            it('should invoke callback within new scope', () => {
                const stub = sinon.stub()
                context.currentState.columnID = null

                bridge['scopedInvoke'](context, (ctx, build) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(context.currentState.builder).to.equal(build)
                    expect(context.currentState.aliasID).to.equal(0)
                    expect(context.currentState.columnID).to.be.null
                    expect(context.currentState.and).to.be.true
                    expect(context.currentState.where.name).to.equal('bound andWhere')
                    stub()
                })

                expect(context.stack.length).to.equal(0)
                expect(stub.calledOnce).to.be.true
            })

            it('should configure next state', () => {
                const stub = sinon.stub()

                bridge['scopedInvoke'](context, (ctx, build) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(context.currentState.builder).to.equal(build)
                    expect(context.currentState.aliasID).to.equal(1)
                    expect(context.currentState.columnID).to.be.null
                    expect(context.currentState.and).to.be.false
                    expect(context.currentState.where.name).to.equal('bound orWhere')
                    stub()
                }, { aliasID: 1, repo, and: false, columnID: null })

                expect(context.stack.length).to.equal(0)
                expect(stub.calledOnce).to.be.true
            })

            it('should create a scoped query', () => {
                bridge['scopedInvoke'](context, (_ctx, build) => {
                    build.where('table.id = :id', { id: 1 })
                }, { aliasID: 0, repo })

                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should create an inverted scoped query', () => {
                bridge['scopedInvoke'](context, (_ctx, build) => {
                    build.where('table.id = :id', { id: 1 })
                }, {
                    aliasID: 0,
                    repo,
                    and: false,
                    not: true
                })

                expect(context.builder.getQuery()).toMatchSnapshot()
            })
        })

        describe('insertFields', () => {
            it('should insert multiple fields', () => {
                const bridge = new CaslBridge(db.source, null)
                const insertField = sinon.stub(bridge, <any>'insertField')
                const fields: MongoFields = {
                    id: 1,
                    title: 'A Book Title',
                }

                bridge['insertFields'](context, fields)

                expect(insertField.calledTwice).to.be.true
                expect(insertField.firstCall.calledWith(context, 'id', 1)).to.be.true
                expect(insertField.secondCall.calledWith(context, 'title', 'A Book Title')).to.be.true
            })
        })

        describe('insertField', () => {
            let insertOperation: sinon.SinonStub
            let insertObject: sinon.SinonStub
            let bridge: CaslBridge

            beforeEach(() => {
                bridge = new CaslBridge(db.source, null)
                insertOperation = sinon.stub(bridge, <any>'insertOperation')
                insertObject = sinon.stub(bridge, <any>'insertObject')
            })

            it('uses setColumn to set the column', () => {
                const setColumn = sinon.stub(bridge, <any>'setColumn')
                const selectField = sinon.stub(bridge, <any>'selectField')

                bridge['insertField'](context, 'title', null)

                expect(setColumn.calledOnce).to.be.true
                expect(setColumn.calledWith(context, 'title')).to.be.true
                expect(selectField.calledOnce).to.be.true
                expect(selectField.calledWith(context)).to.be.true
            })

            it('should use `is` operation for null value', () => {
                bridge['insertField'](context, 'title', null)

                expect(insertOperation.calledOnce).to.be.true
                expect(insertOperation.calledWith(context, '$is', null)).to.be.true
            })

            it('should use `in` operation for array value', () => {
                bridge['insertField'](context, 'id', [1, 2, 3])

                expect(insertOperation.calledOnce).to.be.true
                expect(insertOperation.calledWith(context, '$in', [1, 2, 3])).to.be.true
            })

            it('should use `eq` operation for single value', () => {
                bridge['insertField'](context, 'title', 'A Book Title')

                expect(insertOperation.calledOnce).to.be.true
                expect(insertOperation.calledWith(context, '$eq', 'A Book Title')).to.be.true
            })

            it('should insert object', () => {
                context.currentState.selectMap = true
                const fields: MongoFields = { $ge: 1, $le: 10 }
                bridge['insertField'](context, 'id', fields)

                expect(insertObject.calledOnce).to.be.true
                expect(insertObject.calledWith(context, fields)).to.be.true

                expect(Array.from(context.selected)).to.deep.equal(['__table__.id'])
            })
        })

        describe('insertObject', () => {
            let insertFields: sinon.SinonStub
            let insertOperations: sinon.SinonStub
            let bridge: CaslBridge

            beforeEach(() => {
                bridge = new CaslBridge(db.source, null)
                insertFields = sinon.stub(bridge, <any>'insertFields')
                insertOperations = sinon.stub(bridge, <any>'insertOperations')

                const builder = repo.createQueryBuilder('__table__')
                _.merge(context, {
                    join: builder.leftJoin.bind(builder),
                    builder,
                    columns: [
                        {
                            workingName: 'id',
                            metadata: {}
                        } as any,
                        {
                            workingName: 'title',
                            metadata: {}
                        } as any,
                        {
                            workingName: 'author',
                            metadata: { relationMetadata: { type: 'Author' } }
                        } as any
                    ],
                    currentState: {
                        builder,
                        where: builder.andWhere.bind(builder),
                    }
                })
            })

            it('should throw if expecting relational data', () => {
                // non-queryable object with non-relational data
                context.currentState.columnID = 1
                expect(() => bridge['insertObject'](context, { name: '' }))
                    .to.throw('Column title has no relational data')
            })

            it('should invoke non-relational insertOperations', () => {
                context.currentState.columnID = 0
                const fields: MongoFields = { $ge: 1, $le: 10 }

                bridge['insertObject'](context, fields)
                expect(insertOperations.calledOnce).to.be.true
                expect(insertOperations.calledWith(context, fields)).to.be.true
            })

            it('should invoke non-relational insertFields', () => {
                context.currentState.columnID = 0
                const fields: MongoFields = { id: 2 }

                bridge['insertObject'](context, fields, 'no-column')
                expect(insertFields.calledOnce).to.be.true
                expect(insertFields.calledWith(context, fields)).to.be.true
            })

            it('should join columns if not already aliased', () => {
                const join = sinon.stub()
                const fields: MongoFields = { name: 'Author Name' }
                context.currentState.columnID = 2
                context.join = join

                insertFields.callsFake((ctx, fields) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(ctx.currentState.aliasID).to.equal(1)
                    expect(fields).to.equal(fields)
                })

                bridge['insertObject'](context, fields)
                expect(insertFields.calledOnce).to.be.true
                expect(insertFields.calledWith(context, fields)).to.be.true
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___author'
                ])
                expect(join.calledOnce).to.be.true
                expect(join.calledWith('__table__.author', '__table___author')).to.be.true
            })

            it('should not join columns if already aliased', () => {
                const join = sinon.stub()
                const fields: MongoFields = { $eq: 'Author Name' }
                context.aliases = ['__table__', '__table___author']
                context.currentState.columnID = 2
                context.join = join

                insertOperations.callsFake((ctx, fields) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(ctx.currentState.aliasID).to.equal(1)
                    expect(fields).to.equal(fields)
                })

                bridge['insertObject'](context, fields)
                expect(insertOperations.calledOnce).to.be.true
                expect(insertOperations.calledWith(context, fields)).to.be.true
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___author'
                ])
                expect(join.called).to.be.false
            })
        })

        describe('insertOperations', () => {
            it('should insert multiple operations', () => {
                const bridge = new CaslBridge(db.source, null)
                const insertOperation = sinon.stub(bridge, <any>'insertOperation')
                const fields: MongoFields = { $ge: 1, $le: 10 }

                bridge['insertOperations'](context, fields)

                expect(insertOperation.calledTwice).to.be.true
                expect(insertOperation.firstCall.calledWith(context, '$ge', 1)).to.be.true
                expect(insertOperation.secondCall.calledWith(context, '$le', 10)).to.be.true
            })
        })

        describe('insertOperation', () => {
            let bridge: CaslBridge

            beforeEach(() => {
                bridge = new CaslBridge(db.source, null)
                const builder = repo.createQueryBuilder('__table__')
                _.merge(context, {
                    join: builder.leftJoin.bind(builder),
                    builder,
                    columns: [
                        {
                            workingName: 'id',
                            metadata: {}
                        } as any,
                        {
                            workingName: 'title',
                            metadata: {}
                        } as any,
                        {
                            workingName: 'author',
                            metadata: { relationMetadata: { type: 'Author' } }
                        } as any
                    ],
                    currentState: {
                        builder,
                        where: builder.andWhere.bind(builder),
                    }
                })
            })

            it('should throw if operand isn\'t an object', () => {
                expect(() => bridge['insertOperation'](context, '$and', true))
                    .to.throw('Invalid operand for $and operation')
            })

            it('should throw for invalid operation', () => {
                context.currentState.columnID = 1
                expect(() => bridge['insertOperation'](context, '$invalid', 'value'))
                    .to.throw('Unknown operator $invalid')
            })

            it('should insert $eq operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$eq', 'A Book Title')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $ne operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$ne', 'A Book Title')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $ge operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$ge', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $gte operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$gte', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $gt operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$gt', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $le operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$le', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $lte operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$lte', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $lt operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$lt', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $not operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$not', { $eq: 1 })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $not operation with fields', () => {
                bridge['insertField'](context, 'author', {
                    $not: { id: 1, name: 'John Doe' }
                })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $is null operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$is', null)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $is true operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$is', true)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $is false operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$is', false)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $isNot null operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$isNot', null)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $isNot true operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$isNot', true)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $isNot false operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$isNot', false)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $in operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$in', [1, 2, 3])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notIn operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$notIn', [1, 2, 3])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $like operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$like', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notLike operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$notLike', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $iLike operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$iLike', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notILike operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$notILike', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $regex operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$regex', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $regexp operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$regexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notRegex operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$notRegex', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notRegexp operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$notRegexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $iRegexp operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$iRegexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notIRegexp operation', () => {
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$notIRegexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $between operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$between', [1, 10])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notBetween operation', () => {
                context.currentState.columnID = 0
                bridge['insertOperation'](context, '$notBetween', [1, 10])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $and operation with object', () => {
                bridge['insertOperation'](context, '$and', { id: 1, title: 'The Book' })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $and operation with array', () => {
                bridge['insertOperation'](context, '$and', [{ id: 1 }, { id: 1, title: 'The Book' }])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $or operation with object', () => {
                bridge['insertOperation'](context, '$or', { id: 1, title: 'The Book' })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $or operation with array', () => {
                bridge['insertOperation'](context, '$or', [{ id: 1 }, { id: 2, title: 'The Book' }])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $size operation', () => {
                // NOTE: this operation is not supported by
                //       MySQL, SQLite, or similar databases
                context.currentState.columnID = 1
                bridge['insertOperation'](context, '$size', 10)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })
        })
    })

    describe('example queries', () => {
        it('should read all books', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book')
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book')

            const actualCount = await repo.count()
            const count = await query.getCount()
            expect(query.getQuery()).toMatchSnapshot()
            expect(count).to.equal(actualCount)
        })

        it('should read selected books', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            builder.can('read', 'Book', { id: 3 })
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book')
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
            const entries = await query.getMany()

            expect(entries).to.deep.equal([
                { id: 1 },
                { id: 3 }
            ])
        })

        it('should read selected book IDs', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            builder.can('read', 'Book', { id: 3 })
            const ability = builder.build()

            // NOTE: equivalent to `can('read', 'Book')`
            //       with only the ID field selected
            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book', { id: true })
            const entries = await query.getMany()

            expect(entries).to.deep.equal([
                { id: 1 },
                { id: 3 }
            ])
        })

        it('should read books with query filters', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 2 })
            builder.can('read', 'Book', { id: 8 })
            const ability = builder.build()

            // NOTE: equivalent to `can('read', 'Book')`
            //       with only the ID field selected, but
            //       the id is constrained between 1 and 5
            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo(
                'read', 'Book', { id: true },
                { id: { $gt: 1, $lt: 5 } }
            )
            const entries = await query.getMany()

            expect(query.getQuery()).toMatchSnapshot()
            expect(entries).to.deep.equal([{ id: 2 }])
        })

        it('should select all columns regardless of ability', async () => {
            /**
             * NOTE: Ability is only used as a filter for entries in
             *       this case and will not omit columns with respect
             *       to the rules.
             * 
             * If the rules are setup to permit "reading all"
             * (with no column conditions), then all columns
             * will automatically be selected.
             */

            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            const ability = builder.build()
            const bridge = new CaslBridge(db.source, ability)

            const query1 = bridge.createQueryTo('read', 'Book')
            const entry1 = await query1.getOne()

            /**
             * Notice that a column condition is set for the
             * ability, so only the conditional columns are
             * selected. `title` is not part of the conditions.
             */

            expect(entry1.id).to.equal(1)
            expect(entry1.title).to.be.undefined

            /**
             * If we need all columns regardless of the ability,
             * we simply add a wildcard to the selection.
             */

            const query2 = bridge.createQueryTo('read', 'Book', '*')
            const entry2 = await query2.getOne()

            expect(entry2.id).to.equal(1)
            expect(entry2.title).to.not.be.undefined

            /**
             * Alternatively, set the table alias and use
             * `addSelect` to add selected columns of your own.
             * 
             * NOTE: Aliases take the form of `${table}_${column},
             *       so for embedded columns, the alias will be
             *       `${table}_${embedded}_${column}`.
             * 
             * For example: `Book_author_name`
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

            const strict = true
            const bridge = new CaslBridge(db.source, ability, !strict)
            const query = bridge.createQueryTo(
                'read',
                'Sketchy',
                '*', // select all columns
                {
                    '$recycle$': true,
                    'id"" > 0 OR 1=1; --': { $isNot: null },
                    '🤔': { $gte: 1, $lte: 10 }
                }
            )

            console.log('read sketchy columns')
            const entries = await query.getMany()

            expect(query.getQuery()).toMatchSnapshot()
            expect(entries.length).to.equal(5)
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
})
