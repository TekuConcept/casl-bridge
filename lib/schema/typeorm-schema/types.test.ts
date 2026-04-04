import { Repository } from 'typeorm'
import { Book, TestDatabase } from '@/test-db'

export interface TypeOrmSchema_TestContext {
    db: TestDatabase
    repo: Repository<Book>
}
