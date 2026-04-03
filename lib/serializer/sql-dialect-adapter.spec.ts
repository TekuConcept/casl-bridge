
import 'mocha'
import { expect } from 'chai'
import { assertSafeJsonPath, renderJsonExtract } from './sql-dialect-adapter'

describe('SqlDialectAdapter', () => {

    describe('assertSafeJsonPath', () => {
        it('should return the path unchanged when valid', () => {
            expect(assertSafeJsonPath('isbn')).to.equal('isbn')
            expect(assertSafeJsonPath('library.isbn')).to.equal('library.isbn')
            expect(assertSafeJsonPath('a.b.c')).to.equal('a.b.c')
            expect(assertSafeJsonPath('abc_123')).to.equal('abc_123')
            expect(assertSafeJsonPath('A.B.C')).to.equal('A.B.C')
        })

        it('should throw on semicolons', () => {
            expect(() => assertSafeJsonPath("'; DROP TABLE books; --"))
                .to.throw('Unsafe JSON path')
        })

        it('should throw on array indexing', () => {
            expect(() => assertSafeJsonPath('[0]')).to.throw('Unsafe JSON path')
            expect(() => assertSafeJsonPath('a[0].b')).to.throw('Unsafe JSON path')
        })

        it('should throw on dollar-sign path root', () => {
            expect(() => assertSafeJsonPath('$')).to.throw('Unsafe JSON path')
            expect(() => assertSafeJsonPath('$.a')).to.throw('Unsafe JSON path')
        })

        it('should throw on spaces and quotes', () => {
            expect(() => assertSafeJsonPath('a b')).to.throw('Unsafe JSON path')
            expect(() => assertSafeJsonPath("a'b")).to.throw('Unsafe JSON path')
            expect(() => assertSafeJsonPath('a"b')).to.throw('Unsafe JSON path')
        })

        it('should throw on empty string', () => {
            expect(() => assertSafeJsonPath('')).to.throw('Unsafe JSON path')
        })
    })

    describe('renderJsonExtract', () => {
        const column   = '__test__.metadata'
        const jsonPath = 'library.isbn'

        it('should render MySQL JSON extraction', () => {
            expect(renderJsonExtract('mysql', column, jsonPath))
                .to.equal(`JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.${jsonPath}'))`)
        })

        it('should render aurora-mysql JSON extraction', () => {
            expect(renderJsonExtract('aurora-mysql', column, jsonPath))
                .to.equal(`JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.${jsonPath}'))`)
        })

        it('should render mariadb JSON extraction', () => {
            expect(renderJsonExtract('mariadb', column, jsonPath))
                .to.equal(`JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.${jsonPath}'))`)
        })

        it('should render SQLite (better-sqlite3) JSON extraction', () => {
            expect(renderJsonExtract('better-sqlite3', column, jsonPath))
                .to.equal(`json_extract(${column}, '$.${jsonPath}')`)
        })

        it('should render sqlite JSON extraction', () => {
            expect(renderJsonExtract('sqlite', column, jsonPath))
                .to.equal(`json_extract(${column}, '$.${jsonPath}')`)
        })

        it('should render sqljs JSON extraction', () => {
            expect(renderJsonExtract('sqljs', column, jsonPath))
                .to.equal(`json_extract(${column}, '$.${jsonPath}')`)
        })

        it('should render postgres JSON extraction for a multi-part path', () => {
            expect(renderJsonExtract('postgres', column, jsonPath))
                .to.equal(`${column} #>> '{library,isbn}'`)
        })

        it('should render postgres JSON extraction for a single-part path', () => {
            expect(renderJsonExtract('postgres', column, 'isbn'))
                .to.equal(`${column} ->> 'isbn'`)
        })

        it('should render aurora-postgres JSON extraction', () => {
            expect(renderJsonExtract('aurora-postgres', column, jsonPath))
                .to.equal(`${column} #>> '{library,isbn}'`)
        })

        it('should render mssql JSON extraction', () => {
            expect(renderJsonExtract('mssql', column, jsonPath))
                .to.equal(`JSON_VALUE(${column}, '$.${jsonPath}')`)
        })

        it('should render oracle JSON extraction', () => {
            expect(renderJsonExtract('oracle', column, jsonPath))
                .to.equal(`JSON_VALUE(${column}, '$.${jsonPath}')`)
        })

        it('should propagate unsafe JSON path error', () => {
            expect(() => renderJsonExtract('mysql', column, '[0]'))
                .to.throw('Unsafe JSON path')
        })

        it('should throw for an unsupported dialect', () => {
            expect(() => renderJsonExtract('unknown' as any, column, jsonPath))
                .to.throw('Unsupported dialect for JSON extraction')
        })
    })
})
