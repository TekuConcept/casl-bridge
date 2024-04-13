
import * as _ from 'lodash'
import { faker } from '@faker-js/faker'
import { DataSource, DataSourceOptions, EntitySchema } from 'typeorm'

export class Author {
    constructor(partial?: Partial<Author>) {
        Object.assign(this, partial ?? {})
    }

    id: number
    name: string
}

export class Book {
    constructor(partial?: Partial<Book>) {
        Object.assign(this, partial ?? {})
    }

    id: number
    title: string
    author: Author
}

export const AuthorSchema = new EntitySchema<Author>({
    name: 'Author',
    tableName: 'author',
    target: Author,
    columns: {
        id: {
            type: 'int',
            primary: true,
            generated: true,
        },
        name: {
            type: 'varchar',
            length: 128,
            nullable: false,
        },
    },
})

export const BookSchema = new EntitySchema<Book>({
    name: 'Book',
    tableName: 'book',
    target: Book,
    columns: {
        id: {
            type: 'int',
            primary: true,
            generated: true,
        },
        title: {
            type: 'varchar',
            length: 256,
            nullable: false,
        },
    },
    relations: {
        author: {
            type: 'many-to-one',
            target: 'Author',
            eager: true,
            cascade: false,
            nullable: false,
            joinColumn: false,
        },
    },
})

export const tables = [
    AuthorSchema,
    BookSchema,
]

export class TestDatabase {
    readonly source: DataSource

    constructor() {
        const options = this.createTestOptions()
        this.source = new DataSource(options)
    }

    async connect() { return await this.source.initialize() }
    async disconnect() { return await this.source.destroy() }
    isConnected() { return this.source.isInitialized }

    private createTestOptions(): DataSourceOptions {
        const sqliteTables = _.cloneDeep(tables)

        /** Compatibility conversion to use SQLite in unit tests. */
        // sqliteTables.forEach(table => {
        //     Object.keys(table.options.columns).forEach(key => {
        //         const column = table.options.columns[key]
        //         switch (column.type) {
        //         case 'enum': {
        //             column.type = 'varchar'
        //             column.length = 32
        //             delete column.enum
        //         } break
        //         case 'char': { column.type = 'text' } break
        //         }
        //     })
        // })

        return {
            type: 'better-sqlite3', // sqlite
            database: ':memory:',
            dropSchema: true,
            entities: sqliteTables,
            subscribers: [],
            migrations: [],
            synchronize: true,
        }
    }

    async seed() {
        await this.seedAuthors()
    }

    private async seedAuthors() {
        for (let i = 0; i < 10; i++) {
            const author = new Author({
                name: faker.person.fullName(),
            })
            await this.source.manager.save(author)
            await this.seedBooks(author)
        }
    }

    private async seedBooks(author: Author) {
        const rand = Math.floor(Math.random() * 10)
        for (let i = 0; i < rand; i++) {
            const book = new Book({
                title: faker.music.songName(),
                author,
            })
            await this.source.manager.save(book)
        }
    }
}
