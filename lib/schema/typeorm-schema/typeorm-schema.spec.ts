import 'mocha'
import { expect } from 'chai'
import { Brackets, Repository } from 'typeorm'
import { Book, TestDatabase } from '@/test-db'
import { TypeOrmQueryBuilder } from './typeorm-query-builder'
import { TypeOrmBrackets } from './typeorm-brackets'
import { describeTypeOrmTableInfo } from './typeorm-table-info.test'
import { describeTypeOrmColumnInfo } from './typeorm-column-info.test'
import { describeTypeOrmQueryBuilder } from './typeorm-query-builder.test'

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

    describeTypeOrmTableInfo({
        get db() { return db },
        get repo() { return repo }
    })

    describeTypeOrmColumnInfo({
        get db() { return db },
        get repo() { return repo }
    })

    describe('TypeOrmBrackets', () => {
        it('should create a new instance', () => {
            const bracketsData = new Brackets(() => {})
            const brackets = new TypeOrmBrackets(bracketsData)

            expect(brackets).to.be.instanceOf(TypeOrmBrackets)
        })
    })

    describe('TypeOrmSelectQueryBuilder', () => {
        it('should create a new instance', () => {
            const queryBuilderData = repo.createQueryBuilder()
            const queryBuilder = new TypeOrmQueryBuilder(queryBuilderData, null, null)

            expect(queryBuilder).to.be.instanceOf(TypeOrmQueryBuilder)
        })
    })

    describeTypeOrmQueryBuilder({
        get db() { return db },
        get repo() { return repo }
    })
})
