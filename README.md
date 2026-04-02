# casl-bridge

[![NPM Latest Release](https://img.shields.io/npm/v/casl-bridge.svg)]()
[![Coverage](https://img.shields.io/badge/coverage-100%25-purple)]()

A query bridge between CASL rules and TypeORM


## Installation

This is a module available through the [npm registry](https://www.npmjs.com/package/casl-bridge).

```sh
$ npm install casl-bridge
```



## Examples

A simple demonstration...

```ts
async function main() {
    const source = getTypeOrmSource()
    const builder = new AbilityBuilder(createMongoAbility)

    builder.can('read', 'Book', { id: 1 })
    builder.can('read', 'Book', { 'author.id': 3 })

    const ability = builder.build()

    /* --------------------------------------
     * link everything together with a bridge
     */

    const bridge = new CaslBridge(source, ability)
}
```

### Basic Calls

```ts
/* --------------------------------------
 * query all entries
 */

const books = await bridge
    .createQueryTo('read', 'Book')
    .getMany()

/* --------------------------------------
 * query a single field
 */

const ids = await bridge
    .createQueryTo('read', 'Book', 'id')
    .getMany()

/* --------------------------------------
 * select specific fields
 */

const select = ['id', 'title', ['author', ['name']]]
const names = await bridge
    .createQueryTo('read', 'Book', select)
    .limit(3)
    .getMany()

/* --------------------------------------
 * add extra mongo-like query filters
 */

const filter = { id: { $ge: 10, $le: 20 } }
const limited = await bridge
    .createQueryTo('read', 'Book', select, filter)
    .limit(3)
    .getMany()

/* --------------------------------------
 * using just the filter feature
 */

const filtered = await bridge
    .createFilterFor('Book', {
        'author.name': 'Jane Austen',
        id: { $in: [2, 3, 5] },
    })
    .getMany()

/* --------------------------------------
 * [experimental] apply filter to query
 */

const query = bookRepo
    .createQueryBuilder('book')
    .leftJoin('book.author', 'author')
    .where('book.id > :bookId', { bookId: 3 })

bridge.applyFilterTo(query, 'author', {
    name: 'Jane Austen'
})

const moreBooks = await query.getOne()

```

### Database Setup

```ts
import { DataSource } from 'typeorm'

/* --------------------------------------
 * Our TypeOrm database connection
 */

const source = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    dropSchema: true,
    synchronize: true,
    entities: [
        AuthorSchema,
        BookSchema
    ],
})

async function connect() {
    await source.initialize()

    /* --------------------------------------
     * ...seed your database here
     */
}
```
