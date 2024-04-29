import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { Brackets, Repository } from 'typeorm'
import { Author, Book, TestDatabase } from '@/test-db'
import {
    TypeOrmBrackets,
    TypeOrmColumnInfo,
    TypeOrmQueryBuilder,
    TypeOrmTableInfo
} from './typeorm-schema'

describe('TypeOrmSchema', () => {
    let db: TestDatabase
    let repo: Repository<Book>

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        await db.seed()

        repo = db.source.getRepository(Book)
    })

    after(async () => await db.disconnect())

    /** convinience function for comparing human-readable strings */
    function shrink(s: string) { return s.replace(/\s+/g, ' ').trim() }

    describe('TypeOrmTableInfo', () => {
        describe('hasColumn', () => {
            let authorRepo: Repository<Author>

            before(() => authorRepo = db.source.getRepository(Author))

            it('should return true for existing column', () => {
                const tableInfo = new TypeOrmTableInfo(authorRepo)
                expect(tableInfo.hasColumn('name')).to.be.true
            })

            it('should return false for non-existing column', () => {
                const tableInfo = new TypeOrmTableInfo(authorRepo)
                expect(tableInfo.hasColumn('not-a-column')).to.be.false
            })

            it('should return true for many-to-many column', () => {
                const tableInfo = new TypeOrmTableInfo(authorRepo)
                expect(tableInfo.hasColumn('comments')).to.be.true
            })
        })

        describe('getColumn', () => {
            it('should get column info', () => {
                const tableInfo = new TypeOrmTableInfo(repo)
                const columnInfo = tableInfo.getColumn('title')
                expect(columnInfo).to.not.be.null
                expect(columnInfo!.getName()).to.equal('title')
            })

            it('should get relation info', () => {
                const tableInfo = new TypeOrmTableInfo(repo)
                const columnInfo = tableInfo.getColumn('author')
                expect(columnInfo).to.not.be.null
                expect(columnInfo!.getName()).to.equal('author')
            })

            it('should get many-to-many relation info', () => {
                let authorRepo = db.source.getRepository(Author)
                const tableInfo = new TypeOrmTableInfo(authorRepo)
                const columnInfo = tableInfo.getColumn('comments')
                expect(columnInfo).to.not.be.null
                expect(columnInfo!.getName()).to.equal('comments')
            })

            it('should return null for non-existing column', () => {
                const tableInfo = new TypeOrmTableInfo(repo)
                const columnInfo = tableInfo.getColumn('not-a-column')
                expect(columnInfo).to.be.null
            })
        })

        describe('forEach', () => {
            it('should iterate over columns', () => {
                const expected = [ 'id', 'title', 'author' ]

                const tableInfo = new TypeOrmTableInfo(repo)
                const callback = sinon.stub().callsFake(info => {
                    expect(expected).to.include(info.getName())
                })

                tableInfo.forEach(callback)
                expect(callback.callCount).to.equal(3)
            })

            it('should break on column callback return', () => {
                const tableInfo = new TypeOrmTableInfo(repo)
                const callback = sinon.stub().returns(true)

                tableInfo.forEach(callback)
                expect(callback.callCount).to.equal(1)
            })

            it('should break on relation callback return', () => {
                const tableInfo = new TypeOrmTableInfo(repo)
                const callback = sinon.stub().callsFake(info => {
                    if (info.getName() === 'author') return true
                })

                tableInfo.forEach(callback)
                expect(callback.callCount).to.equal(3)
                // coverage test will be 100% if this passes
            })
        })

        describe('classType', () => {
            it('should get the class name', () => {
                const tableInfo = new TypeOrmTableInfo(repo)
                expect(tableInfo.classType()).to.equal('Book')
            })
        })

        describe('quotedName', () => {
            let fakeRepo: Repository<any>
            let options: { type: string }
            let info: TypeOrmTableInfo

            beforeEach(() => {
                options = { type: 'mysql' }
                fakeRepo = { manager: { connection: { options } } } as any
                info = new TypeOrmTableInfo(fakeRepo)
            })

            // IMPORTANT: Not yet supported by TypeORM
            it('should double-up quote characters', () => {
                TypeOrmTableInfo.extraStrict = true
                options.type = 'mysql' // backticks ('`')
                // expect(info.quotedName('De`Brian\'s'))
                //     .to.equal("`De``Brian's`")
                expect(info.quotedName('De`Brian\'s'))
                    .to.equal("De``Brian's")

                options.type = 'postgres' // double quotes ('"')
                // expect(info.quotedName('They say "yes"'))
                //     .to.equal('"They say ""yes"""')
                expect(info.quotedName('They say "yes"'))
                    .to.equal('They say ""yes""')

                options.type = 'mssql' // square brackets ('[', ']')
                // expect(info.quotedName('Obj[$embed$].prop = "s"'))
                //     .to.equal('[Obj[[$embed$]].prop = "s"]')
                expect(info.quotedName('Obj[$embed$].prop = "s"'))
                    .to.equal('Obj[[$embed$]].prop = "s"')

                options.type = 'sqlite' // double quotes ('"', plain name)
                // expect(info.quotedName('name')).to.equal('"name"')
                expect(info.quotedName('name')).to.equal('name')
                TypeOrmTableInfo.extraStrict = false
            })

            it('should throw if incorrect number of quote characters', () => {
                const quoteChars = sinon.stub(info, 'getQuoteChars')

                quoteChars.returns([])
                expect(() => info.quotedName('name')).to.throw()

                quoteChars.returns(['`', '"', "'"]) // pick one and stick with it :)
                expect(() => info.quotedName('name')).to.throw()

                quoteChars.restore()
            })

            it('should throw if quote characters identical', () => {
                const quoteChars = sinon.stub(info, 'getQuoteChars')

                quoteChars.returns(['[', '[']) // typo
                expect(() => info.quotedName('name')).to.throw()

                quoteChars.restore()
            })
        })

        describe('getQuoteChars', () => {
            let fakeRepo: Repository<any>
            let options: { type: string }
            let info: TypeOrmTableInfo

            beforeEach(() => {
                options = { type: 'mysql' }
                fakeRepo = { manager: { connection: { options } } } as any
                info = new TypeOrmTableInfo(fakeRepo)
            })

            it('should return backticks for MySQL-like databases', () => {
                const types = [
                    'mysql',
                    'aurora-mysql',
                    'mariadb',
                ]

                types.forEach(type => {
                    options.type = type
                    expect(info.getQuoteChars()).to.deep.equal(['`'])
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
                    expect(info.getQuoteChars()).to.deep.equal(['"'])
                })
            })

            it('should return square brackets for SQL Server databases', () => {
                const types = [ 'mssql' ]

                types.forEach(type => {
                    options.type = type
                    expect(info.getQuoteChars()).to.deep.equal(['[', ']'])
                })
            })

            it('should throw for unsupported databases', () => {
                options.type = 'unsupported'
                expect(() => info.getQuoteChars()).to.throw()
            })
        })

        describe('createQueryBuilder', () => {
            it('should create a new instance', () => {
                const tableInfo = new TypeOrmTableInfo(repo)
                const builder = tableInfo.createQueryBuilder('alias')
                expect(builder).to.be.instanceOf(TypeOrmQueryBuilder)
            })
        })

        describe('createFrom', () => {
            it('should create a new instance', () => {
                const tableInfo = TypeOrmTableInfo.createFrom(db.source, Book)
                expect(tableInfo).to.be.instanceOf(TypeOrmTableInfo)
            })
        })

        describe('createJoinFunction', () => {
            it('should create left join function', () => {
                const query = repo.createQueryBuilder('book')
                const join = TypeOrmTableInfo.createJoinFunction(query, 'left')

                join('book.author', 'author')

                expect(shrink(query.getQuery())).to.equal(
                    shrink(`
                        SELECT "book"."id" AS "book_id",
                               "book"."title" AS "book_title",
                               "book"."authorId" AS "book_authorId"
                        FROM "book" "book"
                        LEFT JOIN "author" "author"
                        ON "author"."id"="book"."authorId"
                    `)
                )
            })

            it('should create inner join function', () => {
                const query = repo.createQueryBuilder('book')
                const join = TypeOrmTableInfo.createJoinFunction(query, 'inner')

                join('book.author', 'author')

                expect(shrink(query.getQuery())).to.equal(
                    shrink(`
                        SELECT "book"."id" AS "book_id",
                               "book"."title" AS "book_title",
                               "book"."authorId" AS "book_authorId"
                        FROM "book" "book"
                        INNER JOIN "author" "author"
                        ON "author"."id"="book"."authorId"
                    `)
                )
            })

            it('should not join already joined columns', () => {
                const query = repo.createQueryBuilder('book')
                const join = TypeOrmTableInfo.createJoinFunction(query, 'inner')

                join('book.author', 'author')
                join('book.author', 'author')

                expect(shrink(query.getQuery())).to.equal(
                    shrink(`
                        SELECT "book"."id" AS "book_id",
                               "book"."title" AS "book_title",
                               "book"."authorId" AS "book_authorId"
                        FROM "book" "book"
                        INNER JOIN "author" "author"
                        ON "author"."id"="book"."authorId"
                    `)
                )
            })
        })
    })
    
    describe('TypeOrmColumnInfo', () => {
        const nop = () => ''

        describe('getName', () => {
            it('should return the column name', () => {
                const metadata = { propertyName: 'name' } as any
                const info = new TypeOrmColumnInfo(metadata, nop)

                expect(info.getName()).to.equal('name')
            })
        })

        describe('getQuotedName', () => {
            it('should invoke table.quoteName() on column', () => {
                const metadata = { propertyName: 'name' } as any
                const quotedName = sinon.stub().returns('quotedName')
                const info = new TypeOrmColumnInfo(metadata, quotedName)

                const result = info.getQuotedName()
                expect(result).to.equal('quotedName')
                expect(quotedName.calledOnceWith('name')).to.be.true
            })

            it('should invoke table.quoteName() on name', () => {
                const metadata = { propertyName: 'column-name' } as any
                const quotedName = sinon.stub().returns('quotedName')
                const info = new TypeOrmColumnInfo(metadata, quotedName)

                const result = info.getQuotedName('name')
                expect(result).to.equal('quotedName')
                expect(quotedName.calledOnceWith('name')).to.be.true
            })
        })

        describe('getRelation', () => {
            it('should return null for non-relation columns', () => {
                const metadata = { propertyName: 'name' } as any
                const info = new TypeOrmColumnInfo(metadata, nop)

                expect(info.getRelation()).to.be.null
            })

            it('should return relation info for relation columns', () => {
                const authorRepo = db.source.getRepository(Author)
                const column = authorRepo.metadata.relations
                    .find(r => r.propertyName === 'comments')
                const nextRepo = db.source.getRepository(column.type)
                const info = new TypeOrmColumnInfo(column, nop, nextRepo)

                const relation = info.getRelation()
                expect(relation).to.not.be.null
            })
        })

        describe('isJoinable', () => {
            it('should return true for joinable columns', () => {const authorRepo = db.source.getRepository(Author)
                const column = authorRepo.metadata.relations
                    .find(r => r.propertyName === 'comments')
                const nextRepo = db.source.getRepository(column.type)
                const info = new TypeOrmColumnInfo(column, nop, nextRepo)

                expect(info.isJoinable()).to.be.true
            })

            it('should return false for non-joinable columns', () => {
                const metadata = { propertyName: 'name' } as any
                const info = new TypeOrmColumnInfo(metadata, nop)

                expect(info.isJoinable()).to.be.false
            })
        })

        describe('isIdentifier', () => {
            let info: TypeOrmColumnInfo

            it('should turn true for identifier columns', () => {
                const fakeColumn = { propertyName: 'id' } as any
                info = new TypeOrmColumnInfo(fakeColumn, nop)

                expect(info.isIdentifier()).to.be.true
            })

            it('should return false for non-identifier columns', () => {
                const fakeColumn = { propertyName: 'Hello = World' } as any
                info = new TypeOrmColumnInfo(fakeColumn, nop)

                expect(info.isIdentifier()).to.be.false
            })
        })
    })

    describe('TypeOrmBrackets', () => {
        it('should create a new instance', () => {
            const bracketsData = new Brackets(() => {})
            const brackets = new TypeOrmBrackets(bracketsData)

            expect(brackets).to.be.instanceOf(TypeOrmBrackets)
        })
    })

    describe('TypeOrmQueryBuilder', () => {
        describe('nextParamId', () => {
            it('should return 0 if no parameters', () => {
                const builder = new TypeOrmQueryBuilder(null, null, null, {})
                expect(builder.nextParamId()).to.equal(0)
            })

            it('should return the next parameter ID', () => {
                const builder = new TypeOrmQueryBuilder(
                    null, null, null,
                    {
                        param_1: 0,
                        param_3: 0,
                        param_2: 0,
                        param_0: 0,
                    }
                )
                expect(builder.nextParamId()).to.equal(4)
            })
        })

        describe('join', () => {
            it('should call base join function', () => {
                const joinStub = sinon.stub()
                const builder = new TypeOrmQueryBuilder(null, joinStub, null)

                builder.join('relation', 'alias')
                expect(joinStub.calledOnceWith('relation', 'alias')).to.be.true
            })
        })

        describe('select', () => {
            it('should call base select function', () => {
                const selectStub = sinon.stub()
                const builder = new TypeOrmQueryBuilder(null, null, selectStub)
                const params = ['column']

                builder.select(params)
                expect(selectStub.calledOnceWith(params)).to.be.true
            })
        })

        describe('where', () => {
            it('should call base where function', () => {
                const where = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ where } as any, null, null)
                const params = { param: 'value' }

                builder.where('condition', params)
                expect(where.calledOnceWith('condition', params)).to.be.true
            })

            it('should call base where function with brackets', () => {
                const where = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ where } as any, null, null)
                const params = { param: 'value' }
                const brackets = { data: {} }

                builder.where(brackets, params)
                expect(where.calledOnceWith(brackets.data, params)).to.be.true
            })
        })

        describe('andWhere', () => {
            it('should call base andWhere function', () => {
                const andWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ andWhere } as any, null, null)
                const params = { param: 'value' }

                builder.andWhere('condition', params)
                expect(andWhere.calledOnceWith('condition', params)).to.be.true
            })

            it('should call base andWhere function with brackets', () => {
                const andWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ andWhere } as any, null, null)
                const params = { param: 'value' }
                const brackets = { data: {} }

                builder.andWhere(brackets, params)
                expect(andWhere.calledOnceWith(brackets.data, params)).to.be.true
            })
        })

        describe('orWhere', () => {
            it('should call base orWhere function', () => {
                const orWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ orWhere } as any, null, null)
                const params = { param: 'value' }

                builder.orWhere('condition', params)
                expect(orWhere.calledOnceWith('condition', params)).to.be.true
            })

            it('should call base orWhere function with brackets', () => {
                const orWhere = sinon.stub()
                const builder = new TypeOrmQueryBuilder({ orWhere } as any, null, null)
                const params = { param: 'value' }
                const brackets = { data: {} }

                builder.orWhere(brackets, params)
                expect(orWhere.calledOnceWith(brackets.data, params)).to.be.true
            })
        })

        describe('createBrackets', () => {
            it('should create a new instance', () => {
                const builder = new TypeOrmQueryBuilder(null, null, null)
                const bracketsCallback = sinon.stub()

                const bracketsInstance = builder.createBrackets(bracketsCallback)
                expect(bracketsInstance).to.be.instanceOf(TypeOrmBrackets)
            })
        })

        describe('createNotBrackets', () => {
            it('should create a new instance', () => {
                const builder = new TypeOrmQueryBuilder(null, null, null)
                const bracketsCallback = sinon.stub()

                const bracketsInstance = builder.createNotBrackets(bracketsCallback)
                expect(bracketsInstance).to.be.instanceOf(TypeOrmBrackets)
            })
        })
    })
})
