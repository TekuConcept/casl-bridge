
/** Dialects explicitly supported for JSON path extraction */
export type DbDialect =
    | 'mysql'
    | 'aurora-mysql'
    | 'mariadb'
    | 'better-sqlite3'
    | 'sqlite'
    | 'sqljs'
    | 'postgres'
    | 'aurora-postgres'
    | 'mssql'
    | 'oracle'

/**
 * Validates that a JSON sub-path contains only safe characters
 * (letters, digits, underscores, and dots as separators).
 *
 * Rejects anything that could interfere with SQL JSON path syntax,
 * such as array indexing `[0]`, `$` sigil, quotes, semicolons, etc.
 * 
 * IMPORTANT: Adding `-` (dash) support requires dialect-aware quoting.
 *            Otherwise it presents a SQL injection risk.
 *
 * @param path  The JSON sub-path, e.g. `library.isbn`.
 * @returns     The same path if valid.
 * @throws      Error if the path contains unsafe characters.
 */
export function assertSafeJsonPath(path: string): string {
    if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(path)) {
        throw new Error(`Unsafe JSON path: "${path}"`)
    }
    return path
}

/**
 * Renders a dialect-specific SQL expression that extracts a scalar
 * value from a JSON column.
 *
 * @param dialect  The database dialect (from `dataSource.options.type`).
 * @param column   The SQL column reference, e.g. `__table__.metadata`.
 * @param jsonPath The dot-separated sub-path, e.g. `library.isbn`.
 * @returns        A raw SQL expression suitable for use as the left
 *                 operand of a WHERE condition.
 */
export function renderJsonExtract(
    dialect: DbDialect,
    column: string,
    jsonPath: string,
): string {
    switch (dialect) {
    case 'mysql':
    case 'aurora-mysql':
    case 'mariadb':
        return `JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.${assertSafeJsonPath(jsonPath)}'))`

    case 'better-sqlite3':
    case 'sqlite':
    case 'sqljs':
        return `json_extract(${column}, '$.${assertSafeJsonPath(jsonPath)}')`

    case 'postgres':
    case 'aurora-postgres': {
        const parts = assertSafeJsonPath(jsonPath).split('.')
        if (parts.length === 1) return `${column} ->> '${parts[0]}'`
        return `${column} #>> '{${parts.join(',')}}'`
    }

    case 'mssql':
    case 'oracle':
        return `JSON_VALUE(${column}, '$.${assertSafeJsonPath(jsonPath)}')`

    default: {
        // Exhaustiveness check: TypeScript will error here if a new dialect
        // is added to DbDialect without a corresponding case above.
        const _: never = dialect
        void _
        throw new Error(`Unsupported dialect for JSON extraction: ${dialect as string}`)
    }
    }
}
