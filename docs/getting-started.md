# Getting Started

This guide walks you through connecting CASL rules to a TypeORM database using
`casl-bridge`.

## Prerequisites

- **CASL** `@casl/ability ^6.8` – you need a `MongoAbility` instance (or the
  helpers to build one).
- **TypeORM** `^0.3` – you need an initialized `DataSource` **or** an active
  `EntityManager`.

Both peer dependencies must be installed separately:

```sh
npm install @casl/ability typeorm casl-bridge
```

## Mental model

```
CASL rules   ──┐
               ├──▶  CaslBridge  ──▶  TypeORM SelectQueryBuilder
extra filter ──┘
```

`CaslBridge` reads the CASL ability rules for a given action/subject pair,
translates them into SQL WHERE clauses, and returns a fully configured TypeORM
`SelectQueryBuilder` ready for you to call `.getMany()`, `.getOne()`, etc.

## Minimal setup

```ts
import { DataSource } from 'typeorm'
import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import { CaslBridge } from 'casl-bridge'

// 1. Build your CASL ability (typically per-request from the logged-in user)
const { can, build } = new AbilityBuilder(createMongoAbility)
can('read', 'Book')              // allow reading all books
can('read', 'Book', { id: 1 })  // or only the book with id 1

const ability = build()

// 2. Point at your TypeORM source
const source = getDataSource()  // your initialized DataSource

// 3. Create the bridge
const bridge = new CaslBridge(source, ability)

// 4. Build and execute the query
const books = await bridge.createQueryTo('read', 'Book').getMany()
```

## Common patterns

### Per-request bridge

In web applications the ability is typically rebuilt for each request from the
authenticated user's roles/permissions.  Create a new `CaslBridge` per request
so it always reflects the current ability:

```ts
// Express middleware example
app.get('/books', async (req, res) => {
    const ability = buildAbilityFor(req.user)          // your factory
    const bridge  = new CaslBridge(dataSource, ability)

    const books = await bridge.createQueryTo('read', 'Book').getMany()
    res.json(books)
})
```

You can also pass an `EntityManager` (e.g. inside a transaction):

```ts
await dataSource.transaction(async (manager) => {
    const bridge = new CaslBridge(manager, ability)
    const books  = await bridge.createQueryTo('read', 'Book').getMany()
})
```

### Choosing the subject

The subject string must match the name registered in your TypeORM
`EntitySchema` (or the class name of the entity).  It is the same string you
use in your CASL `can()` calls:

```ts
// EntitySchema name: 'Book'  ───▶  subject: 'Book'
bridge.createQueryTo('read', 'Book')

// Also works with the entity class directly (if registered by class)
import { Book } from './entities'
bridge.createQueryTo('read', Book)
```

### Selecting fields

By default `createQueryTo` selects all top-level (non-relation) columns.
You can control this with the `select` / `field` parameters:

```ts
// Only the 'id' field
bridge.createQueryTo('read', 'Book', 'id')

// All top-level columns (default)
bridge.createQueryTo('read', 'Book', '*')

// All columns including joined relations
bridge.createQueryTo('read', 'Book', '**')

// Specific subset
bridge.createQueryTo('read', 'Book', ['id', 'title'])

// Nested selection (book + author.name)
bridge.createQueryTo('read', 'Book', ['id', 'title', ['author', ['name']]])
```

### No ability — filter only

Use `createFilterFor` when you don't need ability-gating but still want
mongo-style filter syntax translated to SQL:

```ts
const results = await bridge
    .createFilterFor('Book', { 'author.name': 'Jane Austen', id: { $in: [1, 2, 3] } })
    .getMany()
```

### Applying a filter to an existing query

Use `applyFilterTo` to append casl-bridge-compiled conditions onto a query
builder you already own (e.g. one that has its own JOINs):

```ts
const query = bookRepo
    .createQueryBuilder('book')
    .leftJoinAndSelect('book.author', 'author')
    .where('book.genre = :genre', { genre: 'fantasy' })

bridge.applyFilterTo(query, 'author', { name: 'Tolkien' })

const books = await query.getMany()
```

## Quick in-memory database setup

The snippet below is all you need to start experimenting without any external
database or boilerplate:

```ts
import { DataSource, EntitySchema } from 'typeorm'

const AuthorSchema = new EntitySchema({
    name: 'Author',
    tableName: 'author',
    target: Author,
    columns: {
        id:   { type: 'int', primary: true, generated: true },
        name: { type: 'varchar' },
    },
})

const BookSchema = new EntitySchema({
    name: 'Book',
    tableName: 'book',
    target: Book,
    columns: {
        id:    { type: 'int', primary: true, generated: true },
        title: { type: 'varchar' },
    },
    relations: {
        author: { type: 'many-to-one', target: 'Author', joinColumn: true },
    },
})

const source = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    dropSchema: true,
    synchronize: true,
    entities: [AuthorSchema, BookSchema],
})

await source.initialize()
// seed your data here, then use CaslBridge
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Query returns nothing when rules exist | Subject string doesn't match entity name | Ensure the string passed to `can()` and `createQueryTo()` matches the `EntitySchema` `name` |
| Relation path causes an error | Join column not included in schema | Add a `relations` entry in your `EntitySchema` |
| `maxDepth` violation thrown | External filter has more hops than `maxDepth` | Increase `maxDepth`, or set `onViolation: 'strip'` |
| Path policy violation thrown | A field path is denied by `pathPolicy` | Adjust rules or set `onViolation: 'false'` |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | Attempted deep import | Import only from `'casl-bridge'` (root entry) |
