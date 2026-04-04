import { SelectQueryBuilder } from 'typeorm'
import { TypeOrmQueryBuilder } from './typeorm-query-builder'

export class TypeOrmSelectQueryBuilder extends TypeOrmQueryBuilder {
    declare data: SelectQueryBuilder<any>
}
