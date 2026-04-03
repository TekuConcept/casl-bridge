import 'mocha'
import { expect } from 'chai'
import { CastleGuard, FilterAnalysisResult } from './castle-guard'
import { CaslBridge } from './casl-bridge'
import { FilterOptions } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function validates(filter: any, opts?: FilterOptions) {
    return () => CastleGuard.validates(filter, opts)
}

function inspects(filter: any, opts?: FilterOptions): FilterAnalysisResult {
    return CastleGuard.inspects(filter, opts)
}

function issueWithCode(result: FilterAnalysisResult, code: string) {
    return result.issues.find(i => i.code === code)
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('CastleGuard', () => {

    // ── CaslBridge.Guard alias ──────────────────────────────────────────────
    describe('CaslBridge.Guard', () => {
        it('should be the CastleGuard class', () => {
            expect(CaslBridge.Guard).to.equal(CastleGuard)
        })
    })

    // ── validates / inspects basics ─────────────────────────────────────────
    describe('valid filters', () => {
        it('should accept an empty filter', () => {
            expect(validates({})).to.not.throw()
            const result = inspects({})
            expect(result.ok).to.be.true
            expect(result.issues).to.be.empty
        })

        it('should accept null/undefined filter', () => {
            expect(validates(null)).to.not.throw()
            expect(validates(undefined)).to.not.throw()
            expect(inspects(null).ok).to.be.true
            expect(inspects(undefined).ok).to.be.true
        })

        it('should silently ignore a non-object primitive passed as a filter', () => {
            // e.g. a stray number or string slipping through TypeScript types at runtime
            expect(validates(42 as any)).to.not.throw()
            expect(inspects(42 as any).ok).to.be.true
        })

        it('should silently skip a field whose value is undefined', () => {
            expect(validates({ id: undefined })).to.not.throw()
            expect(inspects({ id: undefined }).ok).to.be.true
        })

        it('should accept a simple primitive equality filter', () => {
            expect(validates({ id: 1 })).to.not.throw()
            expect(inspects({ id: 1 }).ok).to.be.true
        })

        it('should accept a field with an array value (implicit $in)', () => {
            // { tags: ['a', 'b'] } is implicitly { tags: { $in: ['a', 'b'] } }
            expect(validates({ tags: ['a', 'b'] })).to.not.throw()
            expect(inspects({ tags: ['a', 'b'] }).ok).to.be.true
        })

        it('should accept known operators', () => {
            expect(validates({ id: { $gt: 1, $lt: 10 } })).to.not.throw()
            expect(validates({ name: { $like: '%foo%' } })).to.not.throw()
            expect(validates({ tags: { $in: ['a', 'b'] } })).to.not.throw()
            expect(validates({ score: { $between: [1, 100] } })).to.not.throw()
        })

        it('should accept $and / $or arrays', () => {
            expect(validates({
                $and: [{ id: 1 }, { name: 'Alice' }],
            })).to.not.throw()
            expect(validates({
                $or: [{ id: 1 }, { id: 2 }],
            })).to.not.throw()
        })

        it('should accept $not object', () => {
            expect(validates({ $not: { id: 1 } })).to.not.throw()
        })

        it('should accept an array filter (implicit $and)', () => {
            expect(validates([{ id: 1 }, { name: 'Alice' }])).to.not.throw()
        })

        it('should accept a join-scope (nested fields object)', () => {
            expect(validates({
                author: { name: 'Tolkien' },
            })).to.not.throw()
        })

        it('should accept dotted-path notation', () => {
            expect(validates({ 'author.name': 'Tolkien' })).to.not.throw()
        })
    })

    // ── Unknown operators ───────────────────────────────────────────────────
    describe('unknown operators', () => {
        it('validates should throw for an unknown operator', () => {
            expect(validates({ id: { $bad: 1 } }))
                .to.throw(/Unknown operator "\$bad"/)
        })

        it('inspects should report UNKNOWN_OPERATOR and ok=false', () => {
            const result = inspects({ id: { $bad: 1 } })
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'UNKNOWN_OPERATOR')
            expect(issue).to.exist
            expect(issue!.operator).to.equal('$bad')
        })

        it('inspects should continue collecting after an unknown operator', () => {
            const result = inspects({ id: { $bad: 1, $also_bad: 2 } })
            expect(result.ok).to.be.false
            const codes = result.issues.map(i => i.code)
            expect(codes.filter(c => c === 'UNKNOWN_OPERATOR')).to.have.length(2)
        })

        it('should report the path where the unknown operator appears', () => {
            const result = inspects({ id: { $bad: 1 } })
            const issue = issueWithCode(result, 'UNKNOWN_OPERATOR')
            expect(issue!.path).to.equal('id')
        })

        it('should report path=undefined for a root-level unknown operator', () => {
            const result = inspects({ $bad: 1 })
            const issue = issueWithCode(result, 'UNKNOWN_OPERATOR')
            expect(issue).to.exist
            expect(issue!.path).to.be.undefined
        })
    })

    // ── Operator shape validation ───────────────────────────────────────────
    describe('operator shape validation', () => {
        describe('$and', () => {
            it('validates should throw when $and is not an array', () => {
                expect(validates({ $and: { id: 1 } }))
                    .to.throw('Operator "$and" requires an array')
            })

            it('inspects should report INVALID_OPERAND when $and is not an array', () => {
                const result = inspects({ $and: { id: 1 } })
                expect(result.ok).to.be.false
                const issue = issueWithCode(result, 'INVALID_OPERAND')
                expect(issue!.operator).to.equal('$and')
            })

            it('should accept $and as an array', () => {
                expect(validates({ $and: [{ id: 1 }] })).to.not.throw()
            })
        })

        describe('$or', () => {
            it('validates should throw when $or is not an array', () => {
                expect(validates({ $or: { id: 1 } }))
                    .to.throw('Operator "$or" requires an array')
            })

            it('inspects should report INVALID_OPERAND when $or is not an array', () => {
                const result = inspects({ $or: { id: 1 } })
                expect(result.ok).to.be.false
                const issue = issueWithCode(result, 'INVALID_OPERAND')
                expect(issue!.operator).to.equal('$or')
            })
        })

        describe('$not', () => {
            it('validates should throw when $not is an array', () => {
                expect(validates({ $not: [{ id: 1 }] }))
                    .to.throw('Operator "$not" requires an object')
            })

            it('validates should throw when $not is a primitive', () => {
                expect(validates({ $not: 'bad' }))
                    .to.throw('Operator "$not" requires an object')
            })

            it('inspects should report INVALID_OPERAND when $not is an array', () => {
                const result = inspects({ $not: [{ id: 1 }] })
                expect(result.ok).to.be.false
                const issue = issueWithCode(result, 'INVALID_OPERAND')
                expect(issue!.operator).to.equal('$not')
            })

            it('should accept $not as an object', () => {
                expect(validates({ $not: { id: 1 } })).to.not.throw()
            })
        })

        describe('$in / $nin / $notIn', () => {
            it('validates should throw when $in is not an array', () => {
                expect(validates({ id: { $in: 'bad' } }))
                    .to.throw('Operator "$in" requires an array')
            })

            it('validates should throw when $nin is not an array', () => {
                expect(validates({ id: { $nin: 123 } }))
                    .to.throw('Operator "$nin" requires an array')
            })

            it('validates should throw when $notIn is not an array', () => {
                expect(validates({ id: { $notIn: {} } }))
                    .to.throw('Operator "$notIn" requires an array')
            })

            it('inspects should report INVALID_OPERAND when $in is not an array', () => {
                const result = inspects({ id: { $in: 'bad' } })
                expect(result.ok).to.be.false
                const issue = issueWithCode(result, 'INVALID_OPERAND')
                expect(issue!.operator).to.equal('$in')
                expect(issue!.path).to.equal('id')
            })

            it('should accept $in as an empty array', () => {
                // PR 7 fix: $in:[] is compiled to literal false, so it is valid
                expect(validates({ id: { $in: [] } })).to.not.throw()
            })

            it('should accept $in as a non-empty array', () => {
                expect(validates({ id: { $in: [1, 2, 3] } })).to.not.throw()
            })
        })

        describe('$between / $notBetween', () => {
            it('validates should throw when $between is not an array', () => {
                expect(validates({ score: { $between: 'bad' } }))
                    .to.throw('Operator "$between" requires an array of exactly 2 elements')
            })

            it('validates should throw when $between has wrong length', () => {
                expect(validates({ score: { $between: [1, 2, 3] } }))
                    .to.throw('Operator "$between" requires an array of exactly 2 elements')
            })

            it('validates should throw when $between has only one element', () => {
                expect(validates({ score: { $between: [1] } }))
                    .to.throw('Operator "$between" requires an array of exactly 2 elements')
            })

            it('inspects should report INVALID_OPERAND when $between is wrong', () => {
                const result = inspects({ score: { $between: [1] } })
                expect(result.ok).to.be.false
                const issue = issueWithCode(result, 'INVALID_OPERAND')
                expect(issue!.operator).to.equal('$between')
                expect(issue!.path).to.equal('score')
            })

            it('should accept $between with exactly 2 elements', () => {
                expect(validates({ score: { $between: [1, 100] } })).to.not.throw()
            })

            it('should accept $notBetween with exactly 2 elements', () => {
                expect(validates({ score: { $notBetween: [1, 100] } })).to.not.throw()
            })
        })
    })

    // ── Prototype-pollution keys ────────────────────────────────────────────
    describe('prototype-pollution keys', () => {
        it('validates should throw for __proto__ in field position', () => {
            // Use Object.create(null) + bracket assignment so that __proto__ is
            // an own enumerable property rather than the prototype setter.
            const filter = Object.create(null) as any
            filter['__proto__'] = { x: 1 }
            expect(validates(filter)).to.throw(/Unsafe key "__proto__"/)
        })

        it('validates should throw for prototype in field position', () => {
            expect(validates({ prototype: { x: 1 } }))
                .to.throw(/Unsafe key "prototype"/)
        })

        it('validates should throw for constructor in field position', () => {
            expect(validates({ constructor: { x: 1 } }))
                .to.throw(/Unsafe key "constructor"/)
        })

        it('inspects should report UNSAFE_KEY for __proto__', () => {
            const filter = Object.create(null) as any
            filter['__proto__'] = { polluted: true }
            const result = inspects(filter)
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'UNSAFE_KEY')
            expect(issue!.path).to.include('__proto__')
        })

        it('validates should throw for __proto__ inside a nested object', () => {
            // Create the nested object with __proto__ as an own enumerable property.
            const nested = Object.create(null) as any
            nested['__proto__'] = { x: 1 }
            expect(validates({ author: nested })).to.throw(/Unsafe key "__proto__"/)
        })

        it('validates should throw for prototype in an operator context', () => {
            // An object whose only key is "prototype" – treated as an operators
            // object since "prototype" doesn't start with $ but it's still unsafe.
            // The mixed object ({ prototype: ... }) goes through processFields.
            expect(validates({ prototype: 1 }))
                .to.throw(/Unsafe key "prototype"/)
        })

        it('should reject unsafe key segments inside a dotted path', () => {
            expect(validates({ 'a.__proto__.b': 1 }))
                .to.throw(/Unsafe key "__proto__"/)
        })
    })

    // ── JSON path safety ────────────────────────────────────────────────────
    describe('JSON path safety', () => {
        it('should accept simple alphanumeric field names', () => {
            expect(validates({ isbn: '123' })).to.not.throw()
            expect(validates({ field_name: 1 })).to.not.throw()
            expect(validates({ CamelCase: 1 })).to.not.throw()
        })

        it('should accept dotted paths with safe segments', () => {
            expect(validates({ 'author.name': 'Alice' })).to.not.throw()
            expect(validates({ 'metadata.library.isbn': '123' })).to.not.throw()
        })

        it('should reject $-prefixed segments in dotted paths', () => {
            // $ is not accepted by assertSafeJsonPath in the SQL dialect adapter,
            // so CastleGuard must reject them consistently.
            expect(validates({ 'library.$taxes': 1.5 }))
                .to.throw(/Unsafe characters/)
            expect(validates({ 'metadata.$meta.value': 'x' }))
                .to.throw(/Unsafe characters/)
        })

        it('should reject a bare $ segment', () => {
            // "$" alone does not start with a letter or underscore
            expect(validates({ 'library.$': 1 }))
                .to.throw(/Unsafe characters/)
        })

        it('should reject malicious dot patterns', () => {
            // Double dot: empty segment in the middle
            expect(validates({ 'a..b': 1 })).to.throw(/Unsafe characters/)
            // Leading dot: empty segment at the start
            expect(validates({ '.a': 1 })).to.throw(/Unsafe characters/)
            // Trailing dot: empty segment at the end
            expect(validates({ 'a.': 1 })).to.throw(/Unsafe characters/)
        })

        it('inspects should report UNSAFE_PATH for malicious dots', () => {
            const result = inspects({ 'a..b': 1 })
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'UNSAFE_PATH')
            expect(issue).to.exist
        })

        it('validates should throw for array indexing in a key', () => {
            expect(validates({ 'items[0]': 1 }))
                .to.throw(/Array indexing is not allowed/)
        })

        it('inspects should report UNSAFE_PATH for array indexing', () => {
            const result = inspects({ 'items[0]': 1 })
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'UNSAFE_PATH')
            expect(issue).to.exist
        })

        it('validates should throw for array indexing inside a dotted path', () => {
            expect(validates({ 'author[0].name': 1 }))
                .to.throw(/Array indexing is not allowed/)
        })

        it('inspects should report UNSAFE_PATH for array indexing in a dotted path', () => {
            const result = inspects({ 'author[0].name': 1 })
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'UNSAFE_PATH')
            expect(issue).to.exist
        })

        it('should reject segment with spaces', () => {
            expect(validates({ 'bad field': 1 }))
                .to.throw(/Unsafe characters/)
        })

        it('should reject segment with special characters', () => {
            expect(validates({ 'a;drop': 1 }))
                .to.throw(/Unsafe characters/)
            expect(validates({ "a'b": 1 }))
                .to.throw(/Unsafe characters/)
        })

        it('should reject segments starting with a digit', () => {
            expect(validates({ '1badstart': 1 }))
                .to.throw(/Unsafe characters/)
        })
    })

    // ── maxDepth enforcement ────────────────────────────────────────────────
    describe('maxDepth', () => {
        const opts0: FilterOptions = { maxDepth: 0 }
        const opts1: FilterOptions = { maxDepth: 1 }

        it('should allow a root-level condition at maxDepth=0', () => {
            expect(validates({ id: 1 }, opts0)).to.not.throw()
        })

        it('validates should throw when a join scope exceeds maxDepth=0', () => {
            expect(validates({ author: { name: 'Alice' } }, opts0))
                .to.throw(/exceeds maximum join depth of 0/)
        })

        it('inspects should report MAX_DEPTH_EXCEEDED when join exceeds maxDepth=0', () => {
            const result = inspects({ author: { name: 'Alice' } }, opts0)
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'MAX_DEPTH_EXCEEDED')
            expect(issue).to.exist
            expect(issue!.path).to.equal('author')
        })

        it('should allow one join at maxDepth=1', () => {
            expect(validates({ author: { name: 'Alice' } }, opts1)).to.not.throw()
        })

        it('validates should throw for depth-2 join at maxDepth=1', () => {
            expect(validates({
                author: { publisher: { city: 'NYC' } },
            }, opts1)).to.throw(/exceeds maximum join depth of 1/)
        })

        it('inspects should report MAX_DEPTH_EXCEEDED for depth-2 at maxDepth=1', () => {
            const result = inspects({ author: { publisher: { city: 'NYC' } } }, opts1)
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'MAX_DEPTH_EXCEEDED')
            expect(issue).to.exist
            expect(issue!.path).to.equal('author.publisher')
        })

        it('should count dotted-path intermediate segments as join hops', () => {
            // "author.name" expands to author(join) -> name(leaf)
            expect(validates({ 'author.name': 'Alice' }, opts0))
                .to.throw(/exceeds maximum join depth of 0/)
        })

        it('should not increment depth for operator conditions ($eq etc.)', () => {
            // { id: { $gt: 1 } } has no join scope, so depth stays at 0
            expect(validates({ id: { $gt: 1 } }, opts0)).to.not.throw()
        })

        it('should not increment depth for $and/$or at the root level', () => {
            expect(validates({
                $and: [{ id: 1 }, { name: 'Alice' }],
            }, opts0)).to.not.throw()
        })
    })

    // ── PathPolicy enforcement ──────────────────────────────────────────────
    describe('pathPolicy', () => {
        const denyAuthor: FilterOptions = {
            pathPolicy: {
                default: 'allow',
                rules: [{ path: 'author', decision: 'deny' }],
            },
        }
        const denyAuthorAll: FilterOptions = {
            pathPolicy: {
                default: 'allow',
                rules: [{ path: 'author.**', decision: 'deny' }],
            },
        }
        const denyAllAllowId: FilterOptions = {
            pathPolicy: {
                default: 'deny',
                rules: [{ path: 'id', decision: 'allow' }],
            },
        }

        it('should allow a path not matched by any deny rule', () => {
            expect(validates({ id: 1 }, denyAuthor)).to.not.throw()
        })

        it('validates should throw when exact path is denied', () => {
            expect(validates({ author: 'Alice' }, denyAuthor))
                .to.throw(/Filter path "author" is not permitted/)
        })

        it('inspects should report PATH_POLICY_VIOLATION for denied exact path', () => {
            const result = inspects({ author: 'Alice' }, denyAuthor)
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'PATH_POLICY_VIOLATION')
            expect(issue).to.exist
            expect(issue!.path).to.equal('author')
        })

        it('should deny a descendant path when wildcard rule is set', () => {
            const result = inspects({ author: { name: 'Alice' } }, denyAuthorAll)
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'PATH_POLICY_VIOLATION')
            expect(issue!.path).to.equal('author.name')
        })

        it('validates should throw for a descendant path denied by wildcard', () => {
            expect(validates({ author: { name: 'Alice' } }, denyAuthorAll))
                .to.throw(/Filter path "author.name" is not permitted/)
        })

        it('should allow when default is deny but path is explicitly allowed', () => {
            expect(validates({ id: 1 }, denyAllAllowId)).to.not.throw()
        })

        it('should deny when default is deny and path is not explicitly allowed', () => {
            const result = inspects({ title: 'Book' }, denyAllAllowId)
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'PATH_POLICY_VIOLATION')
            expect(issue!.path).to.equal('title')
        })

        it('inspects should collect multiple path policy violations', () => {
            const result = inspects(
                { title: 'Book', genre: 'Fantasy' },
                denyAllAllowId,
            )
            expect(result.ok).to.be.false
            const violations = result.issues.filter(
                i => i.code === 'PATH_POLICY_VIOLATION'
            )
            expect(violations).to.have.length(2)
        })

        it('should not check pathPolicy for join scopes themselves', () => {
            // Denying "author" by exact rule should not block join traversal
            // for deeper paths like "author.name".  (The policy is checked at
            // the leaf — "author.name" — not at the scope level.)
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [
                        { path: 'author.name', decision: 'deny' },
                    ],
                },
            }
            // author.id is allowed; author.name is denied
            const result = inspects({ author: { name: 'Alice', id: 1 } }, opts)
            expect(result.ok).to.be.false
            const violations = result.issues.filter(
                i => i.code === 'PATH_POLICY_VIOLATION'
            )
            // Only author.name should be reported
            expect(violations).to.have.length(1)
            expect(violations[0].path).to.equal('author.name')
        })

        it('should use "allow" as default decision when pathPolicy.default is omitted', () => {
            // Covers the `?? 'allow'` fallback in isAllowedByPolicy.
            const opts: FilterOptions = {
                pathPolicy: {
                    rules: [{ path: 'secret', decision: 'deny' }],
                    // no `default` — should fall back to 'allow'
                },
            }
            expect(validates({ id: 1 }, opts)).to.not.throw()
            const result = inspects({ secret: 1 }, opts)
            expect(result.ok).to.be.false
        })

        it('should treat every path as allowed when pathPolicy.rules is omitted', () => {
            // Covers the `?? []` fallback in isAllowedByPolicy (empty rules list).
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    // no `rules` — should fall back to []
                },
            }
            expect(validates({ id: 1, name: 'Alice' }, opts)).to.not.throw()
        })
    })

    // ── Nested / combined scenarios ─────────────────────────────────────────
    describe('combined scenarios', () => {
        it('inspects should collect multiple distinct issue types in one pass', () => {
            const result = inspects({
                id: { $bad: 1 },
                'items[0]': 'x',
            })
            expect(result.ok).to.be.false
            const codes = result.issues.map(i => i.code)
            expect(codes).to.include('UNKNOWN_OPERATOR')
            expect(codes).to.include('UNSAFE_PATH')
        })

        it('should validate deeply nested $and with field conditions', () => {
            expect(validates({
                $and: [
                    { id: { $gt: 0 } },
                    { $or: [{ name: 'Alice' }, { name: 'Bob' }] },
                ],
            })).to.not.throw()
        })

        it('should reject an unknown operator nested inside $and', () => {
            const result = inspects({
                $and: [{ id: { $unknown: 1 } }],
            })
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'UNKNOWN_OPERATOR')
            expect(issue!.operator).to.equal('$unknown')
        })

        it('should respect maxDepth inside $and items', () => {
            const result = inspects(
                { $and: [{ author: { name: 'Alice' } }] },
                { maxDepth: 0 },
            )
            expect(result.ok).to.be.false
            const issue = issueWithCode(result, 'MAX_DEPTH_EXCEEDED')
            expect(issue).to.exist
        })

        it('should not mutate the original filter', () => {
            const filter = { 'author.name': 'Alice' }
            CastleGuard.validates(filter)
            // Original key must survive the dot-key expansion
            expect(Object.keys(filter)).to.deep.equal(['author.name'])
        })
    })
})
