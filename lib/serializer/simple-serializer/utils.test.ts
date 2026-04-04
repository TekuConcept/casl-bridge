import 'mocha'
import { expect } from 'chai'
import { ScopedCondition, ScopeOp } from '@/condition'
import { SimpleSerializer_TestContext, shrink } from './types.test'
import { Helpers } from './utils'

export function describeGetNextTable(
    ctx: Pick<SimpleSerializer_TestContext, 'table'>,
) {
    describe('getNextTable', () => {
        let root: ScopedCondition
        let scopeInfo: any

        beforeEach(() => {
            root = new ScopedCondition({
                alias: '__test__',
                scope: ScopeOp.AND,
            })

            const builder = ctx.table.createQueryBuilder('__test__')
            builder.select([]) // clear the selection to 'SELECT *'
            scopeInfo = {
                table: ctx.table,
                builder,
                shared: { counter: 0 },
                where: builder.andWhere.bind(builder),
            }
        })
        afterEach(() => root.unlink())

        it('should return the same table if no join is anticipated', () => {
            const condition = new ScopedCondition({ join: false })
            const nextTable = Helpers.getNextTable(scopeInfo, condition)
            expect(nextTable).to.equal(ctx.table)
        })

        it('should throw an error if column not found', () => {
            const scope = new ScopedCondition({
                column: 'unknown',
                scope: ScopeOp.AND,
                join: true
            })
            root.push(scope)

            expect(() => Helpers.getNextTable(scopeInfo, scope))
                .to.throw('Column \'unknown\' not found in Book')
        })

        it('should throw an error if column is not joinable', () => {
            const scope = new ScopedCondition({
                column: 'title',
                scope: ScopeOp.AND,
                join: true
            })
            root.push(scope)

            expect(() => Helpers.getNextTable(scopeInfo, scope))
                .to.throw('Column \'title\' is not joinable')
        })

        // NOTE: This should never happen, but it's good to check
        it('should throw an error if condition has no parent', () => {
            const scope = new ScopedCondition({
                column: 'author',
                scope: ScopeOp.AND,
                join: true
            })

            expect(() => Helpers.getNextTable(scopeInfo, scope))
                .to.throw('Parent condition not found')
        })

        it('should join the column and return its table', () => {
            const scope = new ScopedCondition({
                column: 'author',
                scope: ScopeOp.AND,
                join: true
            })
            root.push(scope)

            const nextTable = Helpers.getNextTable(scopeInfo, scope)
            expect(nextTable.classType()).to.equal('Author')

            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    LEFT JOIN "author" "__test__" ON "__test__"."id"="__test__"."authorId"
                `)
            )
        })
    })
}
