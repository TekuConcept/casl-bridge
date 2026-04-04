import { TypeOrmTableInfo } from '@/schema'
import { TestDatabase } from '@/test-db'
import { SimpleSerializer } from './simple-serializer'

export interface SimpleSerializer_TestContext {
    db: TestDatabase
    table: TypeOrmTableInfo
    serializer: SimpleSerializer
}

/** convinience function for comparing human-readable strings */
export function shrink(s: string) { return s.replace(/\s+/g, ' ').trim() }
