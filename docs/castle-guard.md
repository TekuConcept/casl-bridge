# CastleGuard API Reference

`CastleGuard` is a lightweight, schema-optional validator for Mongo-style
filter objects.  It lets you inspect, validate, or sanitize an incoming filter
**before** passing it to `CaslBridge` — without requiring a database connection.

## Imports

```ts
import { CastleGuard } from 'casl-bridge'

// Supporting types
import type { FilterAnalysisResult, FilterIssue } from 'casl-bridge'
import type { FilterOptions } from 'casl-bridge'
```

---

## Overview

`CastleGuard` has four static methods, each serving a different use-case:

| Method | Throws? | Returns | Best for |
|---|---|---|---|
| `validates` | Yes (first problem) | `void` | Asserting a filter is safe before use |
| `inspects` | No | `FilterAnalysisResult` | Collecting all problems for logging/display |
| `scrubs` | No* | sanitized `FilterObject` | Stripping/replacing policy-violating branches |
| `validatesForSubject` | Yes (first problem) | `void` | Schema-aware validation against a real entity |

\* `scrubs` throws only for **unknown operators**, regardless of `onViolation`.

---

## `validates`

Validates the filter, throwing an `Error` on the first problem found.

```ts
static validates(
    filter:        FilterObject,
    filterOptions?: FilterOptions,
): void
```

### What is checked

- **Unknown operators** — any key starting with `$` that is not in the
  supported set throws immediately.
- **Operator shape** — `$and`/`$or` must be arrays; `$not` must be an object;
  `$in`/`$nin`/`$notIn` must be arrays; `$between`/`$notBetween` must be
  exactly two-element arrays.
- **Prototype-pollution keys** — `__proto__`, `prototype`, `constructor`.
- **Unsafe path characters** — only `[A-Za-z_][A-Za-z0-9_]*` segments are
  allowed in field paths; array-indexing notation (`[0]`) is rejected.
- **`maxDepth`** — if set in `filterOptions`, filters with more relation hops
  than `maxDepth` cause a throw.
- **`pathPolicy`** — if set in `filterOptions`, filters that violate the
  allow/deny rules cause a throw.

### Example

```ts
import { CastleGuard } from 'casl-bridge'

// Throws for unknown operator
CastleGuard.validates({ id: { $bad: 1 } })
// Error: Unknown operator "$bad"

// Throws for prototype-pollution key
CastleGuard.validates({ __proto__: { polluted: true } })
// Error: Unsafe key "__proto__"

// Passes — all checks clear
CastleGuard.validates({ id: { $gt: 0 }, 'author.name': 'Tolkien' })

// With policy: deny all author.** paths
CastleGuard.validates(
    { 'author.name': 'Tolkien' },
    { pathPolicy: { default: 'allow', rules: [{ path: 'author.**', decision: 'deny' }] } },
)
// Error: path 'author.name' is denied by pathPolicy
```

---

## `inspects`

Analyses the filter and returns a `FilterAnalysisResult` describing **all**
problems found.  Never throws (unless an unexpected internal error occurs).

```ts
static inspects(
    filter:        FilterObject,
    filterOptions?: FilterOptions,
): FilterAnalysisResult
```

### `FilterAnalysisResult`

```ts
interface FilterAnalysisResult {
    ok:     boolean        // true when no issues found
    issues: FilterIssue[]  // empty when ok is true
}
```

### `FilterIssue`

```ts
interface FilterIssue {
    code:      string           // machine-readable error code
    message:   string           // human-readable description
    path?:     string           // dot-separated field path (if applicable)
    operator?: string           // operator involved (if applicable)
}
```

### Known issue codes

| Code | Meaning |
|---|---|
| `UNKNOWN_OPERATOR` | An unrecognized `$`-prefixed operator was used |
| `INVALID_OPERAND` | An operator received the wrong type (e.g. `$and` given an object) |
| `UNSAFE_KEY` | A prototype-pollution key was found (`__proto__` etc.) |
| `UNSAFE_PATH` | A field-path segment contains unsafe characters |
| `DEPTH_EXCEEDED` | Filter depth exceeds `maxDepth` |
| `PATH_DENIED` | A field path is denied by `pathPolicy` |

### Example

```ts
const result = CastleGuard.inspects({ id: { $bad: 1, $also_bad: 2 } })

result.ok     // false
result.issues // [
              //   { code: 'UNKNOWN_OPERATOR', operator: '$bad',      path: 'id', ... },
              //   { code: 'UNKNOWN_OPERATOR', operator: '$also_bad', path: 'id', ... },
              // ]

// Successful inspection
const clean = CastleGuard.inspects({ id: { $gt: 0 } })
clean.ok      // true
clean.issues  // []
```

---

## `scrubs`

Returns a **sanitized copy** of the filter with policy-violating branches
removed or replaced according to `filterOptions.onViolation`.  The input is
**never mutated**.

```ts
static scrubs(
    filter:        FilterObject,
    filterOptions?: FilterOptions,
): FilterObject
```

### Violation modes

| `onViolation` | Behaviour |
|---|---|
| `'throw'` (default) | Throws on the first depth/policy violation (same as `validates`). |
| `'strip'` | Removes the violating branch entirely.  If the whole filter is stripped, returns `{}`. |
| `'false'` | Replaces the violating branch with a local literal-false, then simplifies: `OR(…, false, …)` → `OR(…)`, `AND(…, false, …)` → `false`, `NOT(false)` → `{}`. |

Boolean simplification is applied after each replacement, so the returned
object is always in a consistent state.

> **Note** Unknown operators always throw regardless of `onViolation`.

### Example

```ts
// Strip depth-violating branches silently
const safe = CastleGuard.scrubs(
    { 'a.b.c.d': 1, title: 'ok' },
    { maxDepth: 1, onViolation: 'strip' },
)
// safe ≈ { title: 'ok' }

// Replace violating branch with literal-false
const falsified = CastleGuard.scrubs(
    { $or: [{ 'author.name': 'bad' }, { id: 1 }] },
    {
        pathPolicy:  { default: 'allow', rules: [{ path: 'author.**', decision: 'deny' }] },
        onViolation: 'false',
    },
)
// author.name branch becomes false → $or simplifies → { id: 1 }
```

---

## `validatesForSubject`

Validates the filter against the **TypeORM schema** of `subject`, throwing on
the first problem.  Performs all checks of `validates`, plus:

- Every path segment must resolve to a real column or relation on the entity.
- Relation segments are checked to be joinable (many-to-one / one-to-one with
  join column).
- Sub-paths after a `json` / `simple-json` column are permitted without further
  schema resolution.
- Sub-paths after any other leaf column throw.

```ts
static validatesForSubject(
    manager:       DataSource | EntityManager,
    subject:       SubjectType,
    filter:        FilterObject,
    filterOptions?: FilterOptions,
): void
```

### Example

```ts
import { CastleGuard } from 'casl-bridge'

// OK — 'title' exists on Book
CastleGuard.validatesForSubject(dataSource, 'Book', { title: 'Dune' })

// Throws — 'nonExistent' is not a column on Book
CastleGuard.validatesForSubject(dataSource, 'Book', { nonExistent: 'x' })

// OK — 'author' is a relation; 'name' is a column on Author
CastleGuard.validatesForSubject(dataSource, 'Book', { 'author.name': 'Frank' })

// Throws — 'title' is not a relation; 'sub' cannot follow it
CastleGuard.validatesForSubject(dataSource, 'Book', { 'title.sub': 'x' })
```

---

## Schema-less vs schema-aware constraints

| | `validates` / `inspects` / `scrubs` | `validatesForSubject` |
|---|---|---|
| Database connection required | No | Yes (`DataSource` or `EntityManager`) |
| Checks operators & shapes | ✓ | ✓ |
| Checks unsafe keys/paths | ✓ | ✓ |
| Enforces `maxDepth` / `pathPolicy` | ✓ | ✓ |
| Checks columns exist in schema | ✗ | ✓ |
| Validates relation traversal | ✗ | ✓ |

Use `validates` / `inspects` for **pure structural safety** (e.g. validating
user-submitted JSON before touching the database).  Use `validatesForSubject`
when you want to **guarantee every path exists in the schema** before building
a query.

---

## Security notes

- Always run `CastleGuard.validates` (or `inspects` + check `ok`) on
  **untrusted filter input** before passing it to `CaslBridge`.
- `validatesForSubject` offers the strongest guarantee but requires a live ORM
  connection; use it in trusted server-side contexts.
- `scrubs` with `onViolation: 'strip'` is suitable for best-effort sanitization
  of partially trusted filters where you prefer silent removal over errors.
- Unknown operators **always throw**, even in `scrubs` — there is no mode that
  silently ignores an unrecognized `$operator`.
