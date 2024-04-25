# casl-bridge

[![NPM Latest Release](https://img.shields.io/npm/v/casl-bridge.svg)]()
[![Coverage](https://img.shields.io/badge/coverage-100%25-purple)]()

A query bridge between CASL rules and TypeORM


## Installation

This is a module available through the [npm registry](https://www.npmjs.com/package/casl-bridge).

```sh
$ npm install casl-bridge
```



## Example

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

const names = await bridge
    .createQueryTo('read', 'Book', [
        'title',
        [ 'author', [ 'name' ] ]
    ])
    .limit(3)
    .getMany()

/* --------------------------------------
 * add extra mongo-like query filters
 */

const names = await bridge
    .createQueryTo('read', 'Book', [
        'title',
        [ 'author', [ 'name' ] ]
    ], { id: { $ge: 10, $le: 20 } })
    .limit(3)
    .getMany()
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
