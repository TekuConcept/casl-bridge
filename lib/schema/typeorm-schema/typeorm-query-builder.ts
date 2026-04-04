import { Brackets, NotBrackets, WhereExpressionBuilder } from 'typeorm'
import { BracketsCallback, IBrackets, IQueryBuilder } from '../types'
import { JoinFunction, SelectFunction } from './types'
import { TypeOrmBrackets } from './typeorm-brackets'

/** Wraps a TypeORM query builder object */
export class TypeOrmQueryBuilder implements IQueryBuilder {
    constructor(
        public readonly data: WhereExpressionBuilder,
        private readonly _join: JoinFunction,
        private readonly _select: SelectFunction,
        private readonly _params: object = {}
    ) {}

    /**
     * This helps to generate unique parameter names.
     * Each key in the `_params` object is a parameter
     * name that has already been added to the builder.
     */
    nextParamId(): number {
        const pattern = /^param_(\d+)$/
        const keys = Object
            .keys(this._params)
            .filter(k => pattern.test(k))
            .sort()
        if (keys.length === 0) return 0
        return parseInt(keys[keys.length - 1].match(pattern)![1]) + 1
    }

    join(relation: string, alias: string): TypeOrmQueryBuilder {
        this._join(relation, alias)
        return this
    }

    select(columns: string[]): TypeOrmQueryBuilder {
        this._select(columns)
        return this
    }

    where(
        condition: string | IBrackets,
        parameters?: object
    ): TypeOrmQueryBuilder {
        if (typeof condition === 'string')
            this.data.where(condition, parameters)
        else this.data.where(condition.data, parameters)
        return this
    }

    andWhere(
        condition: string | IBrackets,
        parameters?: object
    ): TypeOrmQueryBuilder {
        if (typeof condition === 'string')
            this.data.andWhere(condition, parameters)
        else this.data.andWhere(condition.data, parameters)
        return this
    }

    orWhere(
        condition: string | IBrackets,
        parameters?: object
    ): TypeOrmQueryBuilder {
        if (typeof condition === 'string')
            this.data.orWhere(condition, parameters)
        else this.data.orWhere(condition.data, parameters)
        return this
    }

    createBrackets(callback: BracketsCallback): TypeOrmBrackets {
        const brackets = new Brackets(qb => {
            const builder = new TypeOrmQueryBuilder(
                qb,
                this._join,
                this._select,
                this._params
            )
            callback(builder)
        })

        return new TypeOrmBrackets(brackets)
    }

    createNotBrackets(callback: BracketsCallback): TypeOrmBrackets {
        const brackets = new NotBrackets(qb => {
            const builder = new TypeOrmQueryBuilder(
                qb,
                this._join,
                this._select,
                this._params
            )
            callback(builder)
        })

        return new TypeOrmBrackets(brackets)
    }
}
