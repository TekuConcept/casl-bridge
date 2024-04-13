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
import { CaslGate, MongoFields, QueryContext } from './types'

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
            parameter: 0,
            table: '__table__',
            join: null,
            mongoQuery: null,
            builder: null,
            aliases: ['__table__'],
            columns: [],
            stack: [],
            currentState: {
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
            builder.can('read', 'Book')
            ability = builder.build()

            bridge = new CaslBridge(db.source, ability)
            insertOperations = sinon.stub(bridge, <any>'insertOperations')
        })

        it('should create a query that returns no results', async () => {
            const query = bridge.createQueryTo('write', 'Book')
            expect(query.getQuery()).toMatchSnapshot()
        })

        it('should select left-join by default', () => {
            bridge.createQueryTo('read', 'Book')
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].join.name).to.equal('bound leftJoin')
        })

        it('should select left-join if field provided', () => {
            const query = bridge.createQueryTo('read', 'Book', 'title', /*selectJoin=*/true)
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].join.name).to.equal('bound leftJoin')
        })

        it('should select left-join-and-select', () => {
            const query = bridge.createQueryTo('read', 'Book', null, /*selectJoin=*/true)
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].join.name).to.equal('bound leftJoinAndSelect')
        })

        it('should protect against field SQL injection', () => {
            // See also test for `selectField`
            expect(() => bridge.createQueryTo('read', 'Book', "id; DROP TABLE book; --")).to.throw()
        })

        it('should maintain table alias name', () => {
            bridge.createQueryTo('read', 'Book')
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].table).to.equal('__table__')
        })
    })

    describe('setup functions', () => {
        describe('selectField', () => {
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
                bridge['selectField'](context)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should throw if field is invalid', () => {
                context.field = '; DROP TABLE book; --'
                expect(() => bridge['selectField'](context)).to.throw()
            })

            it('should select a field', () => {
                context.field = 'title'
                bridge['selectField'](context)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should select a relative field', () => {
                context.field = 'author'
                bridge['selectField'](context)
                expect(context.builder.getQuery()).toMatchSnapshot()
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___author'
                ])
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

    describe('access functions', () => {
        describe('checkColumn', () => {
            it('should throw if column is null or empty', () => {
                const bridge = new CaslBridge(null, null)
                expect(() => bridge['checkColumn'](null, repo)).to.throw()
                expect(() => bridge['checkColumn']('', repo)).to.throw()
            })

            it('should throw if column is not a valid column key', () => {
                const bridge = new CaslBridge(null, null)
                const sqlinjection = "id; DROP TABLE book; --"
                expect(() => bridge['checkColumn'](sqlinjection, repo)).to.throw()
            })

            it('should return valid column metadata', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(
                    bridge['checkColumn']('title', repo).propertyName
                ).to.equal('title')
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
                context.columns = [{ propertyName: 'title' } as any]
                context.currentState.columnID = 0

                const id = bridge['createAliasFrom'](context)
                expect(id).to.equal(1)
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___title'
                ])
            })

            it('should create a new alias from columnID', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = [
                    { propertyName: 'title' } as any,
                    { propertyName: 'author' } as any
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
                        { propertyName: 'title' } as any,
                        { propertyName: 'author' } as any
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
                expect(context.columns[0].propertyName).to.equal('title')
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
                        { propertyName: 'title' } as any,
                        { propertyName: 'author' } as any
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

        describe('isColumnJoinable', () => {
            beforeEach(() => {
                _.merge(context, {
                    columns: [
                        { propertyName: 'title' } as any,
                        {
                            propertyName: 'author',
                            relationMetadata: {}
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
                        { propertyName: 'title' } as any,
                        {
                            propertyName: 'author',
                            relationMetadata: { type: 'Author' }
                        } as any
                    ],
                    currentState: { columnID: 1 }
                })
            })

            it('should throw if the columnID is not set', () => {
                const bridge = new CaslBridge(db.source, null)
                delete context.currentState.columnID
                expect(() => bridge['getJoinableType'](context))
                    .to.throw('Column undefined not found in context')
            })

            it('should throw if the id is invalid', () => {
                const bridge = new CaslBridge(db.source, null)
                context.columns = []
                expect(() => bridge['getJoinableType'](context))
                    .to.throw('Column 1 not found in context')
            })

            it('should throw if the column is not joinable', () => {
                const bridge = new CaslBridge(db.source, null)
                expect(() => bridge['getJoinableType'](context, 0))
                    .to.throw('Column 0 has no relational data')
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
                bridge['insertField'](context, 'title', null)

                expect(setColumn.calledOnce).to.be.true
                expect(setColumn.calledWith(context, 'title')).to.be.true
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
                const fields: MongoFields = { $ge: 1, $le: 10 }
                bridge['insertField'](context, 'id', fields)

                expect(insertObject.calledOnce).to.be.true
                expect(insertObject.calledWith(context, fields)).to.be.true
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
                        { propertyName: 'id' } as any,
                        { propertyName: 'title' } as any,
                        {
                            propertyName: 'author',
                            relationMetadata: { type: 'Author' }
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
                        { propertyName: 'id' } as any,
                        { propertyName: 'title' } as any,
                        {
                            propertyName: 'author',
                            relationMetadata: { type: 'Author' }
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
            expect(count).to.equal(actualCount)
        })

        it('should read select books', async () => {
            const builder = new AbilityBuilder(createMongoAbility)
            builder.can('read', 'Book', { id: 1 })
            builder.can('read', 'Book', { id: 3 })
            const ability = builder.build()

            const bridge = new CaslBridge(db.source, ability)
            const query = bridge.createQueryTo('read', 'Book')
            const entries = await query.getMany()

            expect(entries.length).to.equal(2)
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
