import 'mocha'
import { expect } from 'chai'
import { SimpleUtils } from './simple-utils'
import { TestDatabase } from '@/test-db'
import { TypeOrmTableInfo } from '@/schema'

describe('SimpleUtils', () => {
    // IMPORTANT: Not yet supported by TypeORM
    describe('getQuotedAlias', () => {
        let db: TestDatabase
        let table: TypeOrmTableInfo

        before(async () => {
            db = new TestDatabase()
            await db.connect()
            await db.seed()

            table = TypeOrmTableInfo.createFrom(db.source, 'Book')
        })
        after(async () => await db.disconnect())

        it('should quote aliases', () => {
            // expect(SimpleUtils.getQuotedAlias(table, 'id'))
            //     .to.equal('"id"')
            expect(SimpleUtils.getQuotedAlias(table, 'id'))
                .to.equal('id')
        })

        it('should encode aliases', () => {
            SimpleUtils.encodeAliases = true
            // expect(SimpleUtils.getQuotedAlias(table, 'Hello, World!'))
            //     .to.equal('"Hello2c20World21"')
            expect(SimpleUtils.getQuotedAlias(table, 'Hello, World!'))
                .to.equal('Hello2c20World21')
            SimpleUtils.encodeAliases = false
        })
    })

    describe('encodeName', () => {
        it('should leave alphanumeric strings unchanged', () => {
            expect(SimpleUtils.encodeName('Column_Name_22'))
                .to.equal('Column_Name_22')
        })

        it('should escape special characters', () => {
            expect(SimpleUtils.encodeName('id\' > 0 OR 1=1; --'))
                .to.equal('id27203e20020OR2013d13b202d2d')
        })

        it('should escape first numeric character', () => {
            expect(SimpleUtils.encodeName('1id'))
                .to.equal('_1id')
        })

        it('should escape first numeric hex value', () => {
            expect(SimpleUtils.encodeName(' id'))
                .to.equal('_20id')
        })

        it('should 0-pad hex values', () => {
            expect(SimpleUtils.encodeName('id\x00'))
                .to.equal('id00')
        })
    })
})
