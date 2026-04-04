# CaslBridge API Reference

`CaslBridge` is the main class exported by `casl-bridge`.  It translates CASL
ability rules (and optional extra filters) into TypeORM `SelectQueryBuilder`
instances.

## Imports

```ts
import { CaslBridge } from 'casl-bridge'

// Supporting types (all exported from the root)
import type {
    FilterObject,
    FilterOptions,
    PathPolicy,
    PathPolicyRule,
    QueryOptions,
} from 'casl-bridge'
```

## Constructor

```ts
new CaslBridge(
    manager: DataSource | EntityManager,
    casl?: CaslGate | null,
    strict?: boolean,   // @deprecated — default false
): CaslBridge
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `manager` | `DataSource \| EntityManager` | *(required)* | The TypeORM data source or entity manager to query against. |
| `casl` | `CaslGate \| null` | `manage all` | A pre-built CASL `MongoAbility`. When omitted or `null` the bridge creates an ability that permits `manage all` (no restrictions). |
| `strict` | `boolean` | `false` | **Deprecated.** Has no effect in current versions. |

### Example

```ts
import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import { CaslBridge } from 'casl-bridge'

const { can, build } = new AbilityBuilder(createMongoAbility)
can('read', 'Book', { id: { $lte: 10 } })
const ability = build()

const bridge = new CaslBridge(dataSource, ability)
```

---

## `createQueryTo`

Returns a TypeORM `SelectQueryBuilder` constrained by the CASL rules for the
given action/subject.  Execute the returned builder with `.getMany()`,
`.getOne()`, `.getCount()`, etc.

### Overloads

```ts
// 1. Positional — action + subject only
createQueryTo(action: string, subject: SubjectType): SelectQueryBuilder<any>

// 2. Positional — action + subject + single field
createQueryTo(action: string, subject: SubjectType, field: string): SelectQueryBuilder<any>

// 3. Positional — action + subject + select pattern
createQueryTo(action: string, subject: SubjectType, selectPattern: SelectPattern): SelectQueryBuilder<any>

// 4. Positional — action + subject + select pattern + extra filters
createQueryTo(action: string, subject: SubjectType, selectPattern: SelectPattern, filters: FilterObject): SelectQueryBuilder<any>

// 5. Positional — action + subject + single field + select pattern + extra filters
createQueryTo(action: string, subject: SubjectType, field: string, selectPattern: SelectPattern, filters: FilterObject): SelectQueryBuilder<any>

// 6. Options object
createQueryTo(options: QueryOptions): SelectQueryBuilder<any>
```

### `QueryOptions`

```ts
interface QueryOptions {
    table?:         string          // table alias — default '__table__'
    action?:        string          // CASL action — default 'manage'
    subject:        SubjectType     // entity name or class (required)
    field?:         string          // single field override (overrides select)
    select?:        SelectPattern | null
    filters?:       MongoQueryObjects | null
    filterOptions?: FilterOptions | null
}
```

### `SelectPattern`

```ts
type SelectPattern =
    | '-'        // select only columns already in the query (no-op select)
    | '*'        // select all top-level (non-relation) columns  [default]
    | '**'       // select all columns including relations
    | SelectList // ['id', 'title', ['author', ['id', 'name']]]
    | object     // { id: 1, title: 1, author: { id: 1, name: 1 } }
```

### Examples

```ts
// Read all books (all top-level columns selected)
const books = await bridge.createQueryTo('read', 'Book').getMany()

// Read only the 'id' field
const ids = await bridge.createQueryTo('read', 'Book', 'id').getMany()

// Custom column selection
const select = ['id', 'title', ['author', ['name']]]
const named  = await bridge.createQueryTo('read', 'Book', select).getMany()

// Extra mongo-style filter applied on top of the CASL rules
const filter  = { id: { $gt: 1, $lte: 5 } }
const limited = await bridge
    .createQueryTo('read', 'Book', ['id', 'title'], filter)
    .getMany()

// Options-object form — fine-grained control
const results = await bridge
    .createQueryTo({
        action:  'read',
        subject: 'Book',
        select:  ['id', 'title'],
        filters: { 'author.name': 'Jane Austen' },
        filterOptions: { joinType: 'inner' },
    })
    .getMany()
```

---

## `createFilterFor`

Returns a `SelectQueryBuilder` built entirely from an explicit filter (no CASL
ability rules applied).  Useful when you need pure filter-to-SQL translation.

```ts
createFilterFor(
    subject:       SubjectType,
    filters:       FilterObject | null,
    selectPattern: SelectPattern = '*',
    alias:         string        = '__table__',
    filterOptions?: FilterOptions | null,
): SelectQueryBuilder<any>
```

### Example

```ts
const results = await bridge
    .createFilterFor('Book', {
        'author.name': 'Jane Austen',
        id: { $in: [1, 2, 3] },
    })
    .getMany()
```

---

## `applyFilterTo`

> **Experimental** — API and functionality may change.

Appends compiled filter conditions onto an existing `SelectQueryBuilder`.
The `aliasName` must match a join alias already present on the query.

```ts
applyFilterTo(
    query:         SelectQueryBuilder<any>,
    aliasName:     string,
    filters:       FilterObject | null,
    filterOptions?: FilterOptions | null,
): SelectQueryBuilder<any>
```

### Example

```ts
const query = bookRepo
    .createQueryBuilder('book')
    .leftJoinAndSelect('book.author', 'author')
    .where('book.genre = :genre', { genre: 'fantasy' })

bridge.applyFilterTo(query, 'author', { name: 'Tolkien' })

const books = await query.getMany()
```

---

## `FilterOptions`

All three query methods accept an optional `FilterOptions` object that controls
how **external** filter trees (filters you supply, not CASL ability rules) are
compiled.

```ts
interface FilterOptions {
    maxDepth?:    number                    // max relation hops — undefined = unlimited
    onViolation?: 'throw' | 'false' | 'strip'  // default 'throw'
    pathPolicy?:  PathPolicy                // allow/deny field paths
    joinType?:    'left' | 'inner'          // default 'left'
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `maxDepth` | `number` | `undefined` | Maximum relation hops in an external filter. Omit to allow any depth. |
| `onViolation` | `'throw' \| 'false' \| 'strip'` | `'throw'` | How to handle a `maxDepth` or `pathPolicy` violation. `'false'` replaces the violating branch with a literal-false; `'strip'` removes it entirely. |
| `pathPolicy` | `PathPolicy` | `undefined` | Allow/deny rules evaluated in order against each field path. |
| `joinType` | `'left' \| 'inner'` | `'left'` | SQL join type used for all joins generated by casl-bridge. Does not affect joins already on a user-supplied builder. |

### `PathPolicy`

```ts
interface PathPolicy {
    default?: 'allow' | 'deny'   // fallback — default 'allow'
    rules?:   PathPolicyRule[]
}

interface PathPolicyRule {
    path:     string              // e.g. 'author.name' or 'author.**'
    decision: 'allow' | 'deny'
}
```

Rules are evaluated in order; the **first matching rule wins**.  Use `'**'` as a
suffix to match any descendant path (e.g. `'author.**'` matches `author.name`,
`author.address.city`, etc.).

### `FilterOptions` examples

```ts
// Limit external filters to one relation hop; strip violations silently
const results = await bridge
    .createQueryTo('read', 'Book', '*', filter, {
        maxDepth:    1,
        onViolation: 'strip',
    })
    .getMany()

// Block author.** paths in external filters
const results2 = await bridge
    .createQueryTo({
        action:  'read',
        subject: 'Book',
        filters: { 'author.name': 'Tolkien' }, // ← will be blocked/stripped
        filterOptions: {
            pathPolicy:  { default: 'allow', rules: [{ path: 'author.**', decision: 'deny' }] },
            onViolation: 'strip',
        },
    })
    .getMany()

// Use INNER JOIN for all library-generated joins
const results3 = await bridge
    .createQueryTo({ action: 'read', subject: 'Book', filterOptions: { joinType: 'inner' } })
    .getMany()
```

---

## Public types summary

| Export | Kind | Description |
|---|---|---|
| `CaslBridge` | `class` | Main bridge class |
| `FilterObject` | `type` | Alias for `MongoQueryObjects` (mongo-style filter) |
| `FilterOptions` | `interface` | Controls external filter compilation |
| `PathPolicy` | `interface` | Allow/deny rules for field paths |
| `PathPolicyRule` | `interface` | Single path rule inside `PathPolicy` |
| `QueryOptions` | `interface` | Options-object form for `createQueryTo` |
| `CaslRule` | `type` | Raw CASL rule type |
| `CaslGate` | `type` | `MongoAbility` alias used throughout |
| `CaslGateBuilder` | `type` | `AbilityBuilder<CaslGate>` alias |
| `SelectPattern` | `type` | Field selection pattern |
