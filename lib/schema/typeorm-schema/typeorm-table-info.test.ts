import * as sinon from 'sinon'
import { describe, it } from 'mocha'
import { expect } from 'chai'
import { Repository } from 'typeorm'
import { Author, Book } from '@/test-db'
import { TypeOrmSchema_TestContext } from './types.test'
import { TypeOrmTableInfo } from './typeorm-table-info'
import { TypeOrmQueryBuilder } from './typeorm-query-builder'

export function describeTypeOrmTableInfo(
    ctx: TypeOrmSchema_TestContext
) {
    /** convinience function for comparing human-readable strings */
    function shrink(s: string) { return s.replace(/\s+/g, ' ').trim() }

    describe('TypeOrmTableInfo', () => {
        describe('hasColumn', () => {
            let authorRepo: Repository<Author>

            before(() => authorRepo = ctx.db.source.getRepository(Author))

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
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const columnInfo = tableInfo.getColumn('title')
                expect(columnInfo).to.not.be.null
                expect(columnInfo!.getName()).to.equal('title')
            })

            it('should get relation info', () => {
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const columnInfo = tableInfo.getColumn('author')
                expect(columnInfo).to.not.be.null
                expect(columnInfo!.getName()).to.equal('author')
            })

            it('should get many-to-many relation info', () => {
                let authorRepo = ctx.db.source.getRepository(Author)
                const tableInfo = new TypeOrmTableInfo(authorRepo)
                const columnInfo = tableInfo.getColumn('comments')
                expect(columnInfo).to.not.be.null
                expect(columnInfo!.getName()).to.equal('comments')
            })

            it('should return null for non-existing column', () => {
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const columnInfo = tableInfo.getColumn('not-a-column')
                expect(columnInfo).to.be.null
            })
        })

        describe('forEach', () => {
            it('should iterate over columns', () => {
                const expected = [ 'id', 'title', 'metadata', 'author' ]

                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const callback = sinon.stub().callsFake(info => {
                    expect(expected).to.include(info.getName())
                })

                tableInfo.forEach(callback)
                expect(callback.callCount).to.equal(4)
            })

            it('should break on column callback return', () => {
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const callback = sinon.stub().returns(true)

                tableInfo.forEach(callback)
                expect(callback.callCount).to.equal(1)
            })

            it('should break on relation callback return', () => {
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const callback = sinon.stub().callsFake(info => {
                    if (info.getName() === 'author') return true
                })

                tableInfo.forEach(callback)
                expect(callback.callCount).to.equal(4)
                // coverage test will be 100% if this passes
            })
        })

        describe('classType', () => {
            it('should get the class name', () => {
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
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
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const builder = tableInfo.createQueryBuilder('alias')
                expect(builder).to.be.instanceOf(TypeOrmQueryBuilder)
            })

            it('should use left join by default', () => {
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const builder = tableInfo.createQueryBuilder('book')
                builder.join('book.author', 'author')
                expect(shrink(builder.data.getQuery())).to.contain('LEFT JOIN')
            })

            it('should use INNER JOIN when direction is inner', () => {
                const tableInfo = new TypeOrmTableInfo(ctx.repo)
                const builder = tableInfo.createQueryBuilder('book', 'inner')
                builder.join('book.author', 'author')
                const sql = shrink(builder.data.getQuery())
                expect(sql).to.contain('INNER JOIN')
                expect(sql).to.not.contain('LEFT JOIN')
            })
        })

        describe('createFrom', () => {
            it('should create a new instance', () => {
                const tableInfo = TypeOrmTableInfo.createFrom(ctx.db.source, Book)
                expect(tableInfo).to.be.instanceOf(TypeOrmTableInfo)
            })
        })

        describe('createJoinFunction', () => {
            it('should create left join function', () => {
                const query = ctx.repo.createQueryBuilder('book')
                const join = TypeOrmTableInfo.createJoinFunction(query, 'left')

                join('book.author', 'author')

                expect(shrink(query.getQuery())).to.equal(
                    shrink(`
                        SELECT "book"."id" AS "book_id",
                                "book"."title" AS "book_title",
                                "book"."metadata" AS "book_metadata",
                                "book"."authorId" AS "book_authorId"
                        FROM "book" "book"
                        LEFT JOIN "author" "author"
                        ON "author"."id"="book"."authorId"
                    `)
                )
            })

            it('should create inner join function', () => {
                const query = ctx.repo.createQueryBuilder('book')
                const join = TypeOrmTableInfo.createJoinFunction(query, 'inner')

                join('book.author', 'author')

                expect(shrink(query.getQuery())).to.equal(
                    shrink(`
                        SELECT "book"."id" AS "book_id",
                                "book"."title" AS "book_title",
                                "book"."metadata" AS "book_metadata",
                                "book"."authorId" AS "book_authorId"
                        FROM "book" "book"
                        INNER JOIN "author" "author"
                        ON "author"."id"="book"."authorId"
                    `)
                )
            })

            it('should not join already joined columns', () => {
                const query = ctx.repo.createQueryBuilder('book')
                const join = TypeOrmTableInfo.createJoinFunction(query, 'inner')

                join('book.author', 'author')
                join('book.author', 'author')

                expect(shrink(query.getQuery())).to.equal(
                    shrink(`
                        SELECT "book"."id" AS "book_id",
                                "book"."title" AS "book_title",
                                "book"."metadata" AS "book_metadata",
                                "book"."authorId" AS "book_authorId"
                        FROM "book" "book"
                        INNER JOIN "author" "author"
                        ON "author"."id"="book"."authorId"
                    `)
                )
            })
        })
    })
}
