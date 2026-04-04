import { Brackets } from 'typeorm'
import { IBrackets } from '../types'

export class TypeOrmBrackets implements IBrackets {
    constructor(public readonly data: Brackets) {}
}
