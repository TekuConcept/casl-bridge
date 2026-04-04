import 'mocha'
import { expect } from 'chai'
import { PrimitiveCondition, PrimOp } from '@/condition'
import { shrink, SimpleSerializer_TestContext } from './types.test'

export function describeSerializePrimCondition(
    ctx: Pick<SimpleSerializer_TestContext, 'table' | 'serializer'>,
) {
    describe('serializePrimCondition', () => {
        let scopeInfo: any
        let condition: PrimitiveCondition

        beforeEach(() => {
            const builder = ctx.table.createQueryBuilder('__test__')
            scopeInfo = {
                shared: { counter: 0 },
                table: ctx.table,
                builder,
                where: builder.andWhere.bind(builder)
            }
            builder.select([]) // clear the selection to 'SELECT *'

            condition = new PrimitiveCondition({
                alias: '__test__',
                column: 'title',
                operator: PrimOp.EQUAL,
                operand: ''
            })
        })

        it('should serialize empty result conditions', () => {
            condition.operator = PrimOp.EMPTY_RESULT

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink('SELECT * FROM "book" "__test__" WHERE FALSE')
            )
        })

        it('should throw an error for unknown columns', () => {
            const condition = new PrimitiveCondition({
                alias: '__test__',
                column: 'unknown',
                operator: PrimOp.EQUAL,
                operand: 42
            })

            expect(() => ctx.serializer.serializePrimCondition(scopeInfo, condition))
                .to.throw('Column \'unknown\' not found in table \'Book\'')
        })

        it('should serialize "equals"', () => {
            condition.operator = PrimOp.EQUAL

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" = :param_0
                `)
            )
        })

        it('should serialize "not equals"', () => {
            condition.operator = PrimOp.NOT_EQUAL

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" != :param_0
                `)
            )
        })

        it('should serialize "greater than"', () => {
            condition.operator = PrimOp.GREATER_THAN

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" > :param_0
                `)
            )
        })

        it('should serialize "greater than or equals"', () => {
            condition.operator = PrimOp.GREATER_OR_EQUAL

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" >= :param_0
                `)
            )
        })

        it('should serialize "less than"', () => {
            condition.operator = PrimOp.LESS_THAN

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" < :param_0
                `)
            )
        })

        it('should serialize "less than or equals"', () => {
            condition.operator = PrimOp.LESS_OR_EQUAL

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" <= :param_0
                `)
            )
        })

        it('should serialize "in"', () => {
            condition.operator = PrimOp.IN

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IN (:...param_0)
                `)
            )
        })

        it('should serialize "not in"', () => {
            condition.operator = PrimOp.NOT_IN

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT IN (:...param_0)
                `)
            )
        })

        it('should serialize "like"', () => {
            condition.operator = PrimOp.LIKE

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" LIKE :param_0
                `)
            )
        })

        it('should serialize "not like"', () => {
            condition.operator = PrimOp.NOT_LIKE

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT LIKE :param_0
                `)
            )
        })

        it('should serialize "ilike"', () => {
            condition.operator = PrimOp.ILIKE

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" ILIKE :param_0
                `)
            )
        })

        it('should serialize "not ilike"', () => {
            condition.operator = PrimOp.NOT_ILIKE

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT ILIKE :param_0
                `)
            )
        })

        it('should serialize "regex"', () => {
            condition.operator = PrimOp.REGEX

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" REGEXP :param_0
                `)
            )
        })

        it('should serialize "not regex"', () => {
            condition.operator = PrimOp.NOT_REGEX

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT REGEXP :param_0
                `)
            )
        })

        it('should serialize "iregex"', () => {
            condition.operator = PrimOp.IREGEX

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IREGEXP :param_0
                `)
            )
        })

        it('should serialize "not iregex"', () => {
            condition.operator = PrimOp.NOT_IREGEX

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT IREGEXP :param_0
                `)
            )
        })

        it('should serialize "between"', () => {
            condition.operator = PrimOp.BETWEEN
            condition.operand = [0, 42]

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" BETWEEN :aparam_0 AND :bparam_0
                `)
            )
        })

        it('should serialize "not between"', () => {
            condition.operator = PrimOp.NOT_BETWEEN
            condition.operand = [0, 42]

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" NOT BETWEEN :aparam_0 AND :bparam_0
                `)
            )
        })

        it('should serialize "size"', () => {
            condition.operator = PrimOp.SIZE

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE array_length("__test__"."title", 1) = :param_0
                `)
            )
        })

        it('should serialize "is null"', () => {
            condition.operator = PrimOp.IS
            condition.operand = null

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NULL
                `)
            )
        })

        it('should serialize "is true"', () => {
            condition.operator = PrimOp.IS
            condition.operand = true

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS TRUE
                `)
            )
        })

        it('should serialize "is false"', () => {
            condition.operator = PrimOp.IS
            condition.operand = false

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS FALSE
                `)
            )
        })

        it('should serialize "is not null"', () => {
            condition.operator = PrimOp.IS_NOT
            condition.operand = null

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NOT NULL
                `)
            )
        })

        it('should serialize "is not true"', () => {
            condition.operator = PrimOp.IS_NOT
            condition.operand = true

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NOT TRUE
                `)
            )
        })

        it('should serialize "is not false"', () => {
            condition.operator = PrimOp.IS_NOT
            condition.operand = false

            ctx.serializer.serializePrimCondition(scopeInfo, condition)
            expect(shrink(scopeInfo.builder.data.getQuery())).to.equal(
                shrink(`
                    SELECT * FROM "book" "__test__"
                    WHERE "__test__"."title" IS NOT FALSE
                `)
            )
        })

        it('should throw an error for unknown operators', () => {
            const condition = new PrimitiveCondition({
                alias: '__test__',
                column: 'title',
                operator: 'unknown' as any,
                operand: 42
            })

            expect(() => ctx.serializer.serializePrimCondition(scopeInfo, condition))
                .to.throw('Unknown operator unknown')
        })
    })
}
