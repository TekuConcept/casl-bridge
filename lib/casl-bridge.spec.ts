import 'mocha'
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

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        await db.seed()
    })
    after(async () => await db.disconnect())

    describe('createQuery', () => {
        let repo: Repository<Book>
        let builder: CaslBridge<Book>
        let ability: CaslGate
        let insertOperations: sinon.SinonStub

        beforeEach(() => {
            repo = db.source.getRepository(BookSchema)

            const abilityBuilder = new AbilityBuilder(createMongoAbility)
            abilityBuilder.can('read', 'Book')
            ability = abilityBuilder.build()

            builder = new CaslBridge(repo, ability)
            insertOperations = sinon.stub(builder, <any>'insertOperations')
        })

        it('should create a query that returns no results', async () => {
            const query = builder.createQuery('write')
            expect(query.getQuery()).toMatchSnapshot()
        })

        it('should select left-join by default', () => {
            builder.createQuery('read')
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].join.name).to.equal('bound leftJoin')
        })

        it('should select left-join if field provided', () => {
            builder.createQuery('read', 'title', /*selectJoin=*/true)
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].join.name).to.equal('bound leftJoin')
        })

        it('should select left-join-and-select', () => {
            builder.createQuery('read', null, /*selectJoin=*/true)
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].join.name).to.equal('bound leftJoinAndSelect')
        })

        it('should protect against field SQL injection', () => {
            // See also test for `selectField`
            expect(() => builder.createQuery('read', "id; DROP TABLE book; --")).to.throw()
        })

        it('should maintain table alias name', () => {
            builder.createQuery('read')
            expect(insertOperations.calledOnce).to.be.true
            expect(insertOperations.args[0][0].table).to.equal('__table__')
        })
    })

    describe('setup functions', () => {
        describe('selectField', () => {
            let repo: Repository<Book>
            let builder: CaslBridge<Book>
            let context: QueryContext

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
                builder = new CaslBridge(repo, null)
                const queryBuilder = repo.createQueryBuilder('__table__')
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: queryBuilder,
                    aliases: ['__table__'],
                    stack: [],
                    currentState: {
                        builder: queryBuilder,
                        and: false,
                        where: null,
                        aliasID: 0,
                        repo,
                    }
                }
            })

            it('should not select field if none provided', () => {
                builder['selectField'](context, null)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should throw if field is invalid', () => {
                expect(() => builder['selectField'](context, '; DROP TABLE book; --')).to.throw()
            })

            it('should select a field', () => {
                builder['selectField'](context, 'title')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should select a relative field', () => {
                builder['selectField'](context, 'author')
                expect(context.builder.getQuery()).toMatchSnapshot()
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___author'
                ])
            })
        })

        describe('rulesToQuery', () => {
            let repo: Repository<Book>

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
            })

            it('should create for all access', () => {
                const abilityBuilder = new AbilityBuilder(createMongoAbility)
                abilityBuilder.can('read', 'Book')
                const ability = abilityBuilder.build()

                const builder = new CaslBridge(repo, ability)
                const query = builder['rulesToQuery'](ability, 'read', 'Book')

                expect(query).toMatchSnapshot()
            })

            it('should create for no access', () => {
                const abilityBuilder = new AbilityBuilder(createMongoAbility)
                abilityBuilder.cannot('read', 'Book')
                const ability = abilityBuilder.build()

                const builder = new CaslBridge(repo, ability)
                const query = builder['rulesToQuery'](ability, 'read', 'Book')

                expect(query).toMatchSnapshot()
            })

            it('should create for conditional access', () => {
                const abilityBuilder = new AbilityBuilder(createMongoAbility)
                abilityBuilder.can('read', 'Book', { title: 'The Book' })
                abilityBuilder.can('read', 'Book', { author: { name: 'John Doe' } })
                abilityBuilder.cannot('read', 'Book', { title: 'Magic Incantation' })
                const ability = abilityBuilder.build()

                const builder = new CaslBridge(repo, ability)
                const query = builder['rulesToQuery'](ability, 'read', 'Book')

                expect(query).toMatchSnapshot()
            })
        })
    })

    describe('access functions', () => {
        let repo: Repository<Book>

        beforeEach(() => {
            repo = db.source.getRepository(BookSchema)
        })

        describe('isColumnKey', () => {
            let builder: CaslBridge<Book>
            let ability: CaslGate

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
                ability = new AbilityBuilder(createMongoAbility).build()
                builder = new CaslBridge(repo, ability)
            })

            it('should return true for a valid column key', () => {
                expect(builder['isColumnKey']('title', repo)).to.be.true
            })

            it('should return false for an invalid column key', () => {
                const sqlinjection = "id; DROP TABLE book; --"
                expect(builder['isColumnKey'](sqlinjection, repo)).to.be.false
            })
        })

        describe('checkColumn', () => {
            it('should throw if column is null or empty', () => {
                const builder = new CaslBridge(null, null)
                expect(() => builder['checkColumn'](null, repo)).to.throw()
                expect(() => builder['checkColumn']('', repo)).to.throw()
            })

            it('should throw if column is not a valid column key', () => {
                const builder = new CaslBridge(null, null)
                const sqlinjection = "id; DROP TABLE book; --"
                expect(() => builder['checkColumn'](sqlinjection, repo)).to.throw()
            })

            it('should return the column key', () => {
                const repo = db.source.getRepository(BookSchema)
                const builder = new CaslBridge(repo, null)
                expect(builder['checkColumn']('title', repo)).to.equal('title')
            })
        })

        describe('createAliasFrom', () => {
            it('should throw if column is not valid', () => {
                const builder = new CaslBridge(repo, null)
                const sqlinjection = "id; DROP TABLE book; --"
                const context: QueryContext = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: ['__table__'],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 0,
                        repo,
                    }
                }

                expect(() => builder['createAliasFrom'](
                    context,
                    sqlinjection,
                )).to.throw()
            })

            it('should throw if alias unavailable', () => {
                const builder = new CaslBridge(repo, null)
                const context: QueryContext = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: [],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 0,
                        repo,
                    }
                }

                expect(() => builder['createAliasFrom'](
                    context,
                    'author',
                )).to.throw()
            })

            it('should create a new alias', () => {
                const builder = new CaslBridge(repo, null)
                const context: QueryContext = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: ['__table__'],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 0,
                        repo,
                    }
                }

                const id = builder['createAliasFrom'](context, 'author')
                expect(id).to.equal(1)
                expect(context.aliases).to.deep.equal([
                    '__table__',
                    '__table___author'
                ])
            })
        })

        describe('findAliasFor', () => {
            let context: QueryContext

            beforeEach(() => {
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
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

            it('should return true if the alias exists', () => {
                const builder = new CaslBridge(repo, null)
                expect(builder['findAliasFor'](context, 'author')).to.equal(1)
            })

            it('should return false if the alias does not exist', () => {
                const builder = new CaslBridge(repo, null)
                expect(builder['findAliasFor'](context, 'book')).to.equal(-1)
            })
        })

        describe('getAliasName', () => {
            let context: QueryContext

            beforeEach(() => {
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 1,
                        repo,
                    }
                }
            })

            it('should throw if the id is invalid', () => {
                const builder = new CaslBridge(repo, null)
                expect(() => builder['getAliasName'](context, -1)).to.throw()
            })

            it('should return the alias name of the given id', () => {
                const builder = new CaslBridge(repo, null)
                expect(builder['getAliasName'](context, 0)).to.equal('__table__')
            })

            it('should return the alias name of the current state', () => {
                const builder = new CaslBridge(repo, null)
                expect(builder['getAliasName'](context)).to.equal('__table___author')
            })
        })

        describe('setColumn', () => {
            let context: QueryContext

            beforeEach(() => {
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 1,
                        repo,
                    }
                }
            })

            it('should throw if column is invalid', () => {
                const builder = new CaslBridge(repo, null)
                const sqlinjection = "id; DROP TABLE book; --"
                expect(() => builder['setColumn'](context, sqlinjection)).to.throw()
            })

            it('should set the column', () => {
                const builder = new CaslBridge(repo, null)
                builder['setColumn'](context, 'title')
                expect(context.currentState.column).to.equal('title')
            })
        })

        describe('getColumn', () => {
            it('should throw if column is not set', () => {
                const builder = new CaslBridge(repo, null)
                const context: QueryContext = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 1,
                        repo,
                    }
                }

                expect(() => builder['getColumn'](context)).to.throw()
            })

            it('should get the current column', () => {
                const builder = new CaslBridge(repo, null)
                const context: QueryContext = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 1,
                        column: 'title',
                        repo,
                    }
                }

                expect(builder['getColumn'](context)).to.equal('title')
            })
        })

        describe('getParamName', () => {
            let context: QueryContext

            beforeEach(() => {
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: null,
                    aliases: [
                        '__table__',
                        '__table___author'
                    ],
                    stack: [],
                    currentState: {
                        builder: null,
                        and: false,
                        where: null,
                        aliasID: 1,
                        repo,
                    }
                }
            })

            it('should return the parameter name', () => {
                const builder = new CaslBridge(repo, null)
                expect(builder['getParamName'](context)).to.equal('param_0')
                expect(builder['getParamName'](context)).to.equal('param_1')
                expect(builder['getParamName'](context)).to.equal('param_2')
            })

            it('should throw if parameter is invalid', () => {
                const builder = new CaslBridge(repo, null)
                context.parameter = -1
                expect(() => builder['getParamName'](context)).to.throw()
                context.parameter = 'invalid' as any
                expect(() => builder['getParamName'](context)).to.throw()
            })
        })
    })

    describe('query builder functions', () => {
        describe('scopedInvoke', () => {
            let repo: Repository<Book>
            let context: QueryContext
            let builder: CaslBridge<Book>

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
                const queryBuilder = repo.createQueryBuilder('__table__')
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: null,
                    mongoQuery: null,
                    builder: queryBuilder,
                    aliases: ['__table__'],
                    stack: [],
                    currentState: {
                        builder: queryBuilder,
                        and: false,
                        where: queryBuilder.andWhere.bind(queryBuilder),
                        aliasID: 0,
                        repo,
                    }
                }
                builder = new CaslBridge(repo, null)
            })

            it('should invoke callback within new scope', () => {
                const stub = sinon.stub()
                context.currentState.column = ''

                builder['scopedInvoke'](context, (ctx, build) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(context.currentState.builder).to.equal(build)
                    expect(context.currentState.aliasID).to.equal(0)
                    expect(context.currentState.column).to.be.empty
                    expect(context.currentState.and).to.be.true
                    expect(context.currentState.where.name).to.equal('bound andWhere')
                    stub()
                })

                expect(context.stack.length).to.equal(0)
                expect(stub.calledOnce).to.be.true
            })

            it('should configure next state', () => {
                const stub = sinon.stub()

                builder['scopedInvoke'](context, (ctx, build) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(context.currentState.builder).to.equal(build)
                    expect(context.currentState.aliasID).to.equal(1)
                    expect(context.currentState.column).to.be.empty
                    expect(context.currentState.and).to.be.false
                    expect(context.currentState.where.name).to.equal('bound orWhere')
                    stub()
                }, { aliasID: 1, repo, and: false, column: '' })

                expect(context.stack.length).to.equal(0)
                expect(stub.calledOnce).to.be.true
            })

            it('should create a scoped query', () => {
                builder['scopedInvoke'](context, (_ctx, build) => {
                    build.where('table.id = :id', { id: 1 })
                }, { aliasID: 0, repo })

                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should create an inverted scoped query', () => {
                builder['scopedInvoke'](context, (_ctx, build) => {
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
                const repo = db.source.getRepository(BookSchema)
                const builder = new CaslBridge(repo, null)
                const context: QueryContext = {} as any
                const insertField = sinon.stub(builder, <any>'insertField')
                const fields: MongoFields = {
                    id: 1,
                    title: 'A Book Title',
                }

                builder['insertFields'](context, fields)

                expect(insertField.calledTwice).to.be.true
                expect(insertField.firstCall.calledWith(context, 'id', 1)).to.be.true
                expect(insertField.secondCall.calledWith(context, 'title', 'A Book Title')).to.be.true
            })
        })

        describe('insertField', () => {
            let insertOperation: sinon.SinonStub
            let insertObject: sinon.SinonStub
            let repo: Repository<Book>
            let builder: CaslBridge<Book>

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
                builder = new CaslBridge(repo, null)
                insertOperation = sinon.stub(builder, <any>'insertOperation')
                insertObject = sinon.stub(builder, <any>'insertObject')
            })

            it('uses setColumn to set the column', () => {
                const context: QueryContext = {
                    currentState: {}
                } as any
                const setColumn = sinon.stub(builder, <any>'setColumn')
                builder['insertField'](context, 'title', null)

                expect(setColumn.calledOnce).to.be.true
                expect(setColumn.calledWith(context, 'title')).to.be.true
            })

            it('should use `is` operation for null value', () => {
                const context: QueryContext = {
                    currentState: { repo }
                } as any
                builder['insertField'](context, 'title', null)

                expect(insertOperation.calledOnce).to.be.true
                expect(insertOperation.calledWith(context, '$is', null)).to.be.true
            })

            it('should use `in` operation for array value', () => {
                const context: QueryContext = {
                    currentState: { repo }
                } as any
                builder['insertField'](context, 'id', [1, 2, 3])

                expect(insertOperation.calledOnce).to.be.true
                expect(insertOperation.calledWith(context, '$in', [1, 2, 3])).to.be.true
            })

            it('should use `eq` operation for single value', () => {
                const context: QueryContext = {
                    currentState: { repo }
                } as any
                builder['insertField'](context, 'title', 'A Book Title')

                expect(insertOperation.calledOnce).to.be.true
                expect(insertOperation.calledWith(context, '$eq', 'A Book Title')).to.be.true
            })

            it('should insert object', () => {
                const context: QueryContext = {
                    currentState: { repo }
                } as any
                const fields: MongoFields = { $ge: 1, $le: 10 }
                builder['insertField'](context, 'id', fields)

                expect(insertObject.calledOnce).to.be.true
                expect(insertObject.calledWith(context, fields)).to.be.true
            })
        })

        describe('insertObject', () => {
            let insertFields: sinon.SinonStub
            let insertOperations: sinon.SinonStub
            let repo: Repository<Book>
            let builder: CaslBridge<Book>
            let context: QueryContext

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
                builder = new CaslBridge(repo, null)
                insertFields = sinon.stub(builder, <any>'insertFields')
                insertOperations = sinon.stub(builder, <any>'insertOperations')

                const queryBuilder = repo.createQueryBuilder('__table__')
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: queryBuilder.leftJoin.bind(queryBuilder),
                    mongoQuery: null,
                    builder: queryBuilder,
                    aliases: ['__table__'],
                    stack: [],
                    currentState: {
                        builder: queryBuilder,
                        and: false,
                        where: queryBuilder.andWhere.bind(queryBuilder),
                        aliasID: 0,
                        column: 'title',
                        repo,
                    }
                }
            })

            it('should throw if current column is not found', () => {
                context.currentState.column = 'unknown'
                expect(() => builder['insertObject'](context, {}))
                    .to.throw('Column unknown not found')
            })

            it('should throw if expecting relational data', () => {
                // _enforced_ call will throw an error (enforced by default)
                context.currentState.column = 'title'
                expect(() => builder['insertObject'](context, { name: '' }))
                    .to.throw('Column title has no relational data')
            })

            it('should invoke non-relational insertOperations', () => {
                context.currentState.column = 'id'
                const fields: MongoFields = { $ge: 1, $le: 10 }

                builder['insertObject'](context, fields)
                expect(insertOperations.calledOnce).to.be.true
                expect(insertOperations.calledWith(context, fields)).to.be.true
            })

            it('should invoke non-relational insertFields', () => {
                context.currentState.column = ''
                const fields: MongoFields = { id: 2 }

                builder['insertObject'](context, fields, 'no-column')
                expect(insertFields.calledOnce).to.be.true
                expect(insertFields.calledWith(context, fields)).to.be.true
            })

            it('should join columns if not already aliased', () => {
                const join = sinon.stub()
                const fields: MongoFields = { name: 'Author Name' }
                context.currentState.column = 'author'
                context.join = join

                insertFields.callsFake((ctx, fields) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(ctx.currentState.aliasID).to.equal(1)
                    expect(fields).to.equal(fields)
                })

                builder['insertObject'](context, fields)
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
                context.currentState.column = 'author'
                context.join = join

                insertOperations.callsFake((ctx, fields) => {
                    expect(ctx.stack.length).to.equal(1)
                    expect(ctx.currentState.aliasID).to.equal(1)
                    expect(fields).to.equal(fields)
                })

                builder['insertObject'](context, fields)
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
                const repo = db.source.getRepository(BookSchema)
                const builder = new CaslBridge(repo, null)
                const context: QueryContext = {} as any
                const insertOperation = sinon.stub(builder, <any>'insertOperation')
                const fields: MongoFields = { $ge: 1, $le: 10 }

                builder['insertOperations'](context, fields)

                expect(insertOperation.calledTwice).to.be.true
                expect(insertOperation.firstCall.calledWith(context, '$ge', 1)).to.be.true
                expect(insertOperation.secondCall.calledWith(context, '$le', 10)).to.be.true
            })
        })

        describe('insertOperation', () => {
            let repo: Repository<Book>
            let builder: CaslBridge<Book>
            let context: QueryContext

            beforeEach(() => {
                repo = db.source.getRepository(BookSchema)
                builder = new CaslBridge(repo, null)
                const queryBuilder = repo.createQueryBuilder('__table__')
                context = {
                    parameter: 0,
                    table: '__table__',
                    join: queryBuilder.leftJoin.bind(queryBuilder),
                    mongoQuery: null,
                    builder: queryBuilder,
                    aliases: ['__table__'],
                    stack: [],
                    currentState: {
                        builder: queryBuilder,
                        and: false,
                        where: queryBuilder.andWhere.bind(queryBuilder),
                        aliasID: 0,
                        column: '',
                        repo,
                    }
                }
            })

            it('should throw if operand isn\'t an object', () => {
                expect(() => builder['insertOperation'](context, '$and', true))
                    .to.throw('Invalid operand for $and operation')
            })

            it('should throw for invalid operation', () => {
                context.currentState.column = 'title'
                expect(() => builder['insertOperation'](context, '$invalid', 'value'))
                    .to.throw('Unknown operator $invalid')
            })

            it('should insert $eq operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$eq', 'A Book Title')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $ne operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$ne', 'A Book Title')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $gte operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$gte', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $gt operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$gt', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $lte operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$lte', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $lt operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$lt', 1)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $not operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$not', { $eq: 1 })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $not operation with fields', () => {
                builder['insertField'](context, 'author', {
                    $not: { id: 1, name: 'John Doe' }
                })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $is null operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$is', null)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $is true operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$is', true)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $is false operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$is', false)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $isNot null operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$isNot', null)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $isNot true operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$isNot', true)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $isNot false operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$isNot', false)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $in operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$in', [1, 2, 3])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notIn operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$notIn', [1, 2, 3])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $like operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$like', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notLike operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$notLike', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $iLike operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$iLike', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notILike operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$notILike', '%The Fox & The Hound%')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $regex operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$regex', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $regexp operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$regexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notRegex operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$notRegex', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notRegexp operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$notRegexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $iRegexp operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$iRegexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notIRegexp operation', () => {
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$notIRegexp', '^The Fox')
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $between operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$between', [1, 10])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $notBetween operation', () => {
                context.currentState.column = 'id'
                builder['insertOperation'](context, '$notBetween', [1, 10])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $and operation with object', () => {
                context.currentState.column = ''
                builder['insertOperation'](context, '$and', { id: 1, title: 'The Book' })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $and operation with array', () => {
                context.currentState.column = ''
                builder['insertOperation'](context, '$and', [{ id: 1 }, { id: 1, title: 'The Book' }])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $or operation with object', () => {
                context.currentState.column = ''
                builder['insertOperation'](context, '$or', { id: 1, title: 'The Book' })
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $or operation with array', () => {
                context.currentState.column = ''
                builder['insertOperation'](context, '$or', [{ id: 1 }, { id: 2, title: 'The Book' }])
                expect(context.builder.getQuery()).toMatchSnapshot()
            })

            it('should insert $size operation', () => {
                // NOTE: this operation is not supported by
                //       MySQL, SQLite, or similar databases
                context.currentState.column = 'title'
                builder['insertOperation'](context, '$size', 10)
                expect(context.builder.getQuery()).toMatchSnapshot()
            })
        })
    })

    describe('example queries', () => {
        let repo: Repository<Book>

        before(() => repo = db.source.getRepository(BookSchema))

        it('should read all books', async () => {
            const abilityBuilder = new AbilityBuilder(createMongoAbility)
            abilityBuilder.can('read', 'Book')
            const ability = abilityBuilder.build()

            const builder = new CaslBridge(repo, ability)
            const query = builder.createQuery('read')

            const actualCount = await repo.count()
            const count = await query.getCount()
            expect(count).to.equal(actualCount)
        })

        it('should read select books', async () => {
            const abilityBuilder = new AbilityBuilder(createMongoAbility)
            abilityBuilder.can('read', 'Book', { id: 1 })
            abilityBuilder.can('read', 'Book', { id: 3 })
            const ability = abilityBuilder.build()

            const builder = new CaslBridge(repo, ability)
            const query = builder.createQuery('read')
            const entries = await query.getMany()

            expect(entries.length).to.equal(2)
        })

        it('should throw before malicious query can be executed', () => {
            const abilityBuilder = new AbilityBuilder(createMongoAbility)
            abilityBuilder.can('read', 'Book', {
                'id; DROP TABLE book; --': 1
            })
            const ability = abilityBuilder.build()

            const builder = new CaslBridge(repo, ability)
            expect(() => builder.createQuery('read')).to.throw()
        })
    })
})
