import 'mocha'
import * as sinon from 'sinon'
import { expect } from 'chai'
import { TypeOrmColumnInfo } from './typeorm-column-info'
import { Author } from '@/test-db'
import { TypeOrmSchema_TestContext } from './types.test'

export function describeTypeOrmColumnInfo(
    ctx: TypeOrmSchema_TestContext
) {
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
                const authorRepo = ctx.db.source.getRepository(Author)
                const column = authorRepo.metadata.relations
                    .find(r => r.propertyName === 'comments')
                const nextRepo = ctx.db.source.getRepository(column.type)
                const info = new TypeOrmColumnInfo(column, nop, nextRepo)

                const relation = info.getRelation()
                expect(relation).to.not.be.null
            })
        })

        describe('isJoinable', () => {
            it('should return true for joinable columns', () => {
                const authorRepo = ctx.db.source.getRepository(Author)
                const column = authorRepo.metadata.relations
                    .find(r => r.propertyName === 'comments')
                const nextRepo = ctx.db.source.getRepository(column.type)
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
}
