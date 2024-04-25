
import * as _ from 'lodash'
import { faker } from '@faker-js/faker'
import { DataSource, DataSourceOptions, EntitySchema } from 'typeorm'

export class Author {
    constructor(partial?: Partial<Author>) {
        Object.assign(this, partial ?? {})
    }

    id: number
    name: string
    comments: Comment[] // many-to-many relation
}

export class Book {
    constructor(partial?: Partial<Book>) {
        Object.assign(this, partial ?? {})
    }

    id: number
    title: string
    author: Author // many-to-one relation
}

export class Comment {
    constructor(partial?: Partial<Comment>) {
        Object.assign(this, partial ?? {})
    }

    id: number
    text: string
}

export class Sketchy {
    constructor(partial?: Partial<Sketchy>) {
        Object.assign(this, partial ?? {})
    }

    id: number
    'Today\'s_Message': string
    '$recycle$': boolean

    // NOTE: TypeORM qoutes column names with quote characters and
    //       assumes the developer is using safe column names, so
    //       quoting characters need to be escaped when the schema
    //       is defined.
    //
    //       TypeORM also assumes that column names do not contain
    //       any of the following: `[' ', '=', '(', ')', ',']`.
    //       TypeORM WILL NOT quote these column names!!!
    'id""_>_0_OR_1-1;_--': string
    '🤔': number

    "my_comment.": Comment
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
    relations: {
        comments: {
            type: 'many-to-many',
            target: 'Comment',
            eager: true,
            cascade: false,
            nullable: false,
            joinColumn: false,
            // NOTE: A join table is required for many-to-many relations
            joinTable: {
                name: 'author_comment',
                joinColumn: {
                    name: 'author_id',
                    referencedColumnName: 'id',
                },
                inverseJoinColumn: {
                    name: 'comment_id',
                    referencedColumnName: 'id',
                },
            },
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

export const CommentSchema = new EntitySchema<Comment>({
    name: 'Comment',
    tableName: 'comment',
    target: Comment,
    columns: {
        id: {
            type: 'int',
            primary: true,
            generated: true,
        },
        text: {
            type: 'varchar',
            length: 256,
            nullable: false,
        },
    },
})

export const SketchySchema = new EntitySchema<Sketchy>({
    name: 'Sketchy',
    tableName: 'sketchy',
    target: Sketchy,
    columns: {
        id: {
            type: 'int',
            primary: true,
            generated: true,
        },
        'Today\'s_Message': {
            type: 'varchar',
            length: 256,
            nullable: false,
        },
        '$recycle$': {
            type: 'boolean',
            nullable: false,
        },
        'id""_>_0_OR_1-1;_--': {
            type: 'varchar',
            length: 32,
            nullable: true,
        },
        '🤔': {
            type: 'int',
            nullable: false,
        },
    },
    relations: {
        'my_comment.': {
            type: 'many-to-one',
            target: 'Comment',
            eager: true,
            cascade: false,
            nullable: true,
            joinColumn: false,
        },
    },
})

export const tables = [
    AuthorSchema,
    BookSchema,
    CommentSchema,
    SketchySchema,
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
        await this.seedComments()
        await this.seedAuthors()
        await this.seedSketchy()
    }

    private async seedComments() {
        for (let i = 0; i < 20; i++) {
            const comment = new Comment({
                text: faker.lorem.sentence().slice(0, 256),
            })
            await this.source.manager.save(comment)
        }
    }

    private async seedAuthors() {
        const comments = this.source.manager.find(Comment)

        for (let i = 0; i < 10; i++) {
            const author = new Author({
                name: faker.person.fullName(),
                comments: [
                    comments[i * 2],
                    comments[i * 2 + 1],
                ],
            })
            await this.source.manager.save(author)
            await this.seedBooks(author)
        }
    }

    private async seedBooks(author: Author) {
        const rand = Math.floor(Math.random() * 5) + 5
        for (let i = 0; i < rand; i++) {
            const book = new Book({
                title: faker.music.songName(),
                author,
            })
            await this.source.manager.save(book)
        }
    }

    private async seedSketchy() {
        const comments = this.source.manager.find(Comment)

        for (let i = 0; i < 10; i++) {
            const sketchy = new Sketchy({
                'Today\'s_Message': faker.lorem.sentence().substring(0, 256),
                '$recycle$': !!(i % 2),
                'id""_>_0_OR_1-1;_--': faker.lorem.word().substring(0, 32),
                '🤔': i,
                'my_comment.': comments[i],
            })
            await this.source.manager.save(sketchy)
        }
    }
}
