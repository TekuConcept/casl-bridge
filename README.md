# casl-bridge

[![NPM Latest Release](https://img.shields.io/npm/v/casl-bridge.svg)]()
[![Coverage](https://img.shields.io/badge/coverage-100%25-purple)](https://nestjs.com/)

A query bridge between CASL rules and TypeORM


## Installation

This is a module available through the [npm registry](https://www.npmjs.com/package/casl-bridge).

```sh
$ npm install casl-bridge
```



## Example

A simple demonstration:

```ts
import { DataSource } from 'typeorm'

// Our TypeOrm database connection

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

async function main() {
    await source.initialize()

    // ...seed your database here

    const builder = new AbilityBuilder(createMongoAbility)

    builder.can('read', 'Book', { id: 1 })
    builder.can('read', 'Book', { id: 3 })

    const ability = builder.build()

    // link everything together with a bridge

    const bridge  = new CaslBridge(source, ability)
    const entries = await bridge
        .createQueryTo('read', 'Book')
        .getMany()
}
```
