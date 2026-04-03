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

// ─────────────────────────────────────────────────────────────────────────────
// scrubs
// ─────────────────────────────────────────────────────────────────────────────

describe('CastleGuard.scrubs', () => {
    function scrubs(filter: any, opts?: FilterOptions): any {
        return CastleGuard.scrubs(filter, opts)
    }

    // ── basic pass-through ──────────────────────────────────────────────────
    describe('pass-through (no violations)', () => {
        it('should return {} for null/undefined input', () => {
            expect(scrubs(null)).to.deep.equal({})
            expect(scrubs(undefined)).to.deep.equal({})
        })

        it('should return an equivalent filter when there are no violations', () => {
            const result = scrubs({ id: 1, title: 'Book' })
            expect(result).to.deep.equal({ id: 1, title: 'Book' })
        })

        it('should preserve operator conditions unchanged', () => {
            const result = scrubs({ id: { $gt: 0, $lt: 100 } })
            expect(result).to.deep.equal({ id: { $gt: 0, $lt: 100 } })
        })

        it('should pass through a top-level array filter (implicit $and)', () => {
            // Lines 670-671, 686-695: processImplicitAnd is called for array input
            const result = scrubs([{ id: 1 }, { title: 'Book' }])
            expect(result).to.deep.equal([{ id: 1 }, { title: 'Book' }])
        })

        it('should unwrap a single-element top-level array filter', () => {
            // Lines 693: items.length === 1 → return items[0]
            const result = scrubs([{ id: 1 }])
            expect(result).to.deep.equal({ id: 1 })
        })

        it('should pass through a field with an array value (implicit $in)', () => {
            // Lines 811-813: Array value in processFieldValue
            const result = scrubs({ tags: ['a', 'b'] })
            expect(result).to.deep.equal({ tags: ['a', 'b'] })
        })

        it('should handle a null $not operand gracefully', () => {
            // Line 666: null node in processNode (null $not value)
            // typeof null === 'object' so it passes Guard; scrubs handles node === null
            const result = scrubs({ $not: null })
            expect(result).to.deep.equal({ $not: {} })
        })

        it('should handle a non-object $not operand gracefully', () => {
            // Line 667: typeof node !== 'object' branch — non-object inside $not
            const result = scrubs({ $not: 42 } as any)
            expect(result).to.deep.equal({ $not: {} })
        })

        it('should handle an empty nested object node gracefully', () => {
            // Line 674: keys.length === 0 in processNode
            const result = scrubs({ $and: [{}] })
            // {} has no constraints → stripped → $and is empty → STRIP → {}
            expect(result).to.deep.equal({})
        })

        it('should preserve nested $and/$or unchanged', () => {
            const filter = {
                $or: [{ id: 1 }, { title: 'Book' }],
            }
            const result = scrubs(filter)
            expect(result).to.deep.equal(filter)
        })

        it('should preserve $not with a valid operand unchanged', () => {
            // Lines 949-950: return r in processNotOperand (operand is not stripped/false)
            const result = scrubs({ $not: { id: 1 } })
            expect(result).to.deep.equal({ $not: { id: 1 } })
        })

        it('should strip a field with an undefined value', () => {
            // Line 803: value === undefined → STRIP in processFieldValue
            const result = scrubs({ id: undefined, title: 'Book' })
            expect(result).to.deep.equal({ title: 'Book' })
        })

        it('should preserve dotted-path keys unchanged', () => {
            const result = scrubs({ 'author.name': 'Alice' })
            expect(result).to.deep.equal({ 'author.name': 'Alice' })
        })
    })

    // ── input non-mutation ──────────────────────────────────────────────────
    describe('input non-mutation', () => {
        it('should not mutate the original filter object', () => {
            const original = { 'author.name': 'Alice', title: 'Book' }
            scrubs(original, { maxDepth: 0, onViolation: 'strip' })
            expect(Object.keys(original)).to.deep.equal(['author.name', 'title'])
            expect(original['author.name']).to.equal('Alice')
        })

        it('should not mutate nested objects', () => {
            const nested = { name: 'Alice', secret: 'pass' }
            const original = { author: nested }
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'author.secret', decision: 'deny' }],
                },
                onViolation: 'strip',
            }
            scrubs(original, opts)
            expect(nested).to.deep.equal({ name: 'Alice', secret: 'pass' })
        })
    })

    // ── pathPolicy fallback defaults ─────────────────────────────────────────
    describe('pathPolicy fallback defaults', () => {
        it('should use "allow" as default when pathPolicy.default is omitted', () => {
            // Lines 969: pathPolicy.default ?? 'allow' — the ?? 'allow' fallback
            const opts: FilterOptions = {
                pathPolicy: { rules: [{ path: 'secret', decision: 'deny' }] },
                onViolation: 'strip',
            }
            const result = scrubs({ id: 1, secret: 'x' }, opts)
            expect(result).to.deep.equal({ id: 1 })
        })

        it('should allow all paths when pathPolicy.rules is omitted', () => {
            // Lines 970: pathPolicy.rules ?? [] — the ?? [] fallback
            const opts: FilterOptions = {
                pathPolicy: { default: 'allow' },
                onViolation: 'strip',
            }
            const result = scrubs({ id: 1, title: 'Book' }, opts)
            expect(result).to.deep.equal({ id: 1, title: 'Book' })
        })
    })

    // ── onViolation: 'throw' ────────────────────────────────────────────────
    describe("onViolation: 'throw' (default)", () => {
        it('should throw on maxDepth violation', () => {
            expect(() => scrubs({ author: { name: 'Alice' } }, { maxDepth: 0 }))
                .to.throw(/Filter policy violation/)
        })

        it('should throw on path policy denial', () => {
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'password', decision: 'deny' }],
                },
            }
            expect(() => scrubs({ password: 'xxx' }, opts))
                .to.throw(/Filter policy violation/)
        })

        it('should throw on array-indexing path', () => {
            expect(() => scrubs({ 'items[0]': 1 }))
                .to.throw(/Filter policy violation/)
        })

        it('should throw on unsafe path characters', () => {
            expect(() => scrubs({ '1badstart': 1 }))
                .to.throw(/Filter policy violation/)
        })

        it('should always throw for unknown operators regardless of onViolation', () => {
            expect(() => scrubs({ id: { $bad: 1 } }))
                .to.throw(/Unknown operator/)
        })

        it('should always throw for prototype-pollution key in scrubs (regardless of onViolation)', () => {
            // Lines 707-710: UNSAFE_KEY throw in processFieldsObj of ScrubWalker
            const filter = Object.create(null) as any
            filter['__proto__'] = { polluted: true }
            expect(() => scrubs(filter)).to.throw(/Unsafe key "__proto__"/)
            expect(() => scrubs(filter, { onViolation: 'strip' })).to.throw(/Unsafe key "__proto__"/)
            expect(() => scrubs(filter, { onViolation: 'false' })).to.throw(/Unsafe key "__proto__"/)
        })

        it('should always throw for prototype-pollution key inside a dotted path in scrubs', () => {
            // Lines 762-765: UNSAFE_KEY throw inside dotted segments
            expect(() => scrubs({ 'a.__proto__.b': 1 })).to.throw(/Unsafe key "__proto__"/)
            expect(() => scrubs({ 'a.__proto__.b': 1 }, { onViolation: 'strip' }))
                .to.throw(/Unsafe key "__proto__"/)
        })
    })

    // ── onViolation: 'strip' ────────────────────────────────────────────────
    describe("onViolation: 'strip'", () => {
        const strip = (f: any, opts?: Omit<FilterOptions, 'onViolation'>) =>
            scrubs(f, { onViolation: 'strip', ...opts })

        describe('maxDepth violations', () => {
            it('should strip join-scope field that exceeds maxDepth=0', () => {
                const result = strip({ author: { name: 'Alice' } }, { maxDepth: 0 })
                expect(result).to.deep.equal({})
            })

            it('should strip only the violating field and keep siblings', () => {
                const result = strip(
                    { title: 'Book', author: { name: 'Alice' } },
                    { maxDepth: 0 },
                )
                expect(result).to.deep.equal({ title: 'Book' })
            })

            it('should strip dotted-path key that exceeds maxDepth', () => {
                const result = strip({ 'author.name': 'Alice' }, { maxDepth: 0 })
                expect(result).to.deep.equal({})
            })

            it('should strip branch in $and and keep siblings', () => {
                const result = strip(
                    { $and: [{ title: 'Book' }, { author: { name: 'Alice' } }] },
                    { maxDepth: 0 },
                )
                // $and with one remaining item is simplified
                expect(result).to.deep.include({ title: 'Book' })
            })

            it('should return {} when all $and items are stripped', () => {
                // Line 920: kept.length === 0 → STRIP in processAndOperands
                const result = strip(
                    { $and: [{ author: { name: 'Alice' } }] },
                    { maxDepth: 0 },
                )
                // single item stripped → $and is empty → STRIP → {}
                expect(result).to.deep.equal({})
            })

            it('should strip branch in $or and keep other branches', () => {
                const result = strip(
                    { $or: [{ author: { name: 'Alice' } }, { title: 'Book' }] },
                    { maxDepth: 0 },
                )
                expect(result).to.deep.include({ title: 'Book' })
            })
        })

        describe('pathPolicy violations', () => {
            const denyPassword: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'password', decision: 'deny' }],
                },
                onViolation: 'strip',
            }

            it('should strip a denied field', () => {
                const result = scrubs({ title: 'Book', password: 'xxx' }, denyPassword)
                expect(result).to.deep.equal({ title: 'Book' })
            })

            it('should strip from $or and keep the remaining branch', () => {
                const result = scrubs(
                    { $or: [{ password: 'xxx' }, { title: 'Book' }] },
                    denyPassword,
                )
                expect(result).to.deep.include({ title: 'Book' })
            })

            it('should strip from $and and keep siblings', () => {
                const result = scrubs(
                    { $and: [{ title: 'Book' }, { password: 'xxx' }] },
                    denyPassword,
                )
                expect(result).to.deep.include({ title: 'Book' })
            })

            it('should apply default-deny policy and keep only allowed fields', () => {
                const opts: FilterOptions = {
                    pathPolicy: {
                        default: 'deny',
                        rules: [{ path: 'id', decision: 'allow' }],
                    },
                    onViolation: 'strip',
                }
                const result = scrubs({ id: 1, title: 'Book' }, opts)
                expect(result).to.deep.equal({ id: 1 })
            })

            it('should strip descendant wildcard-denied paths', () => {
                const opts: FilterOptions = {
                    pathPolicy: {
                        default: 'allow',
                        rules: [{ path: 'author.**', decision: 'deny' }],
                    },
                    onViolation: 'strip',
                }
                const result = scrubs(
                    { title: 'Book', author: { name: 'Alice' } },
                    opts,
                )
                expect(result).to.deep.equal({ title: 'Book' })
            })
        })

        describe('JSON path safety violations', () => {
            it('should strip a key with array-indexing notation', () => {
                const result = strip({ 'items[0]': 1, title: 'Book' })
                expect(result).to.deep.equal({ title: 'Book' })
            })

            it('should strip a key with unsafe characters', () => {
                const result = strip({ '1badStart': 1, title: 'Book' })
                expect(result).to.deep.equal({ title: 'Book' })
            })

            it('should strip a dotted path segment with unsafe characters', () => {
                // Lines 767-768: handleViolation() for unsafe segment in dotted path
                const result = strip({ 'author.$bad.name': 'Alice', id: 1 })
                expect(result).to.deep.equal({ id: 1 })
            })

            it('should strip array-indexing inside a dotted path', () => {
                const result = strip({ 'author[0].name': 'Alice', id: 1 })
                expect(result).to.deep.equal({ id: 1 })
            })
        })
    })

    // ── onViolation: 'false' ────────────────────────────────────────────────
    describe("onViolation: 'false'", () => {
        const asFalse = (f: any, opts?: Omit<FilterOptions, 'onViolation'>) =>
            scrubs(f, { onViolation: 'false', ...opts })

        describe('maxDepth violations', () => {
            it('should replace a join-scope violation with false, collapsing $and', () => {
                // The violated branch becomes false; AND(false, …) = false → {}
                const result = asFalse(
                    { author: { name: 'Alice' } },
                    { maxDepth: 0 },
                )
                // Whole filter collapsed to false → returns {}
                expect(result).to.deep.equal({})
            })

            it('should drop a false branch from $or so sibling can succeed', () => {
                const result = asFalse(
                    { $or: [{ author: { name: 'Alice' } }, { title: 'Book' }] },
                    { maxDepth: 0 },
                )
                // false dropped from $or; remaining: { title: 'Book' }
                expect(result).to.deep.include({ title: 'Book' })
            })

            it('should collapse $and when one branch is false', () => {
                const result = asFalse(
                    { $and: [{ title: 'Book' }, { author: { name: 'Alice' } }] },
                    { maxDepth: 0 },
                )
                // AND(title, false) = false → {}
                expect(result).to.deep.equal({})
            })
        })

        describe('pathPolicy violations', () => {
            const denyPassword: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'password', decision: 'deny' }],
                },
                onViolation: 'false',
            }

            it('should drop false branch from $or so sibling succeeds', () => {
                const result = scrubs(
                    { $or: [{ password: 'xxx' }, { title: 'Book' }] },
                    denyPassword,
                )
                expect(result).to.deep.include({ title: 'Book' })
            })

            it('should collapse $and to {} when password branch is false', () => {
                const result = scrubs(
                    { $and: [{ title: 'Book' }, { password: 'xxx' }] },
                    denyPassword,
                )
                // AND(title, false) = false → {}
                expect(result).to.deep.equal({})
            })

            it('should collapse fields object to {} when only field is denied', () => {
                const result = scrubs({ password: 'xxx' }, denyPassword)
                expect(result).to.deep.equal({})
            })

            it('should return {} when an operator-condition field is denied', () => {
                // Line 821: checkPathPolicy returns non-null for an operator condition
                const opts: FilterOptions = {
                    pathPolicy: {
                        default: 'allow',
                        rules: [{ path: 'id', decision: 'deny' }],
                    },
                    onViolation: 'false',
                }
                const result = scrubs({ id: { $gt: 5 } }, opts)
                // id denied → LITERAL_FALSE → {}
                expect(result).to.deep.equal({})
            })
        })

        describe('JSON path safety violations', () => {
            it('should treat array-indexing as false, collapsing containing $and', () => {
                const result = asFalse(
                    { $and: [{ 'items[0]': 1 }, { title: 'Book' }] },
                )
                // AND(false, title) = false → {}
                expect(result).to.deep.equal({})
            })

            it('should drop false branch from $or', () => {
                const result = asFalse(
                    { $or: [{ 'items[0]': 1 }, { title: 'Book' }] },
                )
                expect(result).to.deep.include({ title: 'Book' })
            })

            it('should treat unsafe-chars key as false, collapsing $and', () => {
                // Line 731: unsafe chars with onViolation: 'false'
                const result = asFalse(
                    { $and: [{ '1badStart': 1 }, { title: 'Book' }] },
                )
                // AND(false, title) = false → {}
                expect(result).to.deep.equal({})
            })

            it('should treat dotted-path depth violation as false', () => {
                // Line 716: dotted key processSegmentedKey returns LITERAL_FALSE
                const result = asFalse(
                    { 'author.name': 'Alice', id: 1 },
                    { maxDepth: 0 },
                )
                // author.name → depth violation → LITERAL_FALSE → fields obj = false → {}
                expect(result).to.deep.equal({})
            })
        })
    })

    // ── simplification rules ────────────────────────────────────────────────
    describe('boolean simplification', () => {
        it('should simplify $and with a single remaining item', () => {
            const result = scrubs(
                { $and: [{ title: 'Book' }, { id: 1 }] },
                { maxDepth: 0, onViolation: 'strip' },
            )
            // Both fields are at depth 0 and are not join scopes → both kept
            // (no violation), no simplification needed here
            expect((result as any)['$and']).to.deep.equal([
                { title: 'Book' }, { id: 1 },
            ])
        })

        it('should remove false literals from $or', () => {
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'secret', decision: 'deny' }],
                },
                onViolation: 'false',
            }
            const result = scrubs(
                { $or: [{ secret: 'x' }, { id: 1 }, { secret: 'y' }] },
                opts,
            )
            // false, id, false → OR(id) → { id: 1 }
            expect(result).to.deep.include({ id: 1 })
            expect((result as any)['$or']).to.be.undefined
        })

        it('should collapse empty $or to {} at root (empty OR = false = no constraint at root)', () => {
            const opts: FilterOptions = {
                pathPolicy: { default: 'deny', rules: [] },
                onViolation: 'false',
            }
            const result = scrubs({ $or: [{ id: 1 }] }, opts)
            // id is denied → false → $or(false) → LITERAL_FALSE → {}
            expect(result).to.deep.equal({})
        })

        it('NOT(false) collapses to no constraint (STRIP), removing $not', () => {
            const opts: FilterOptions = {
                maxDepth: 0,
                onViolation: 'false',
            }
            const result = scrubs({ $not: { author: { name: 'Alice' } } }, opts)
            // author → false, NOT(false) = true → STRIP → {}
            expect(result).to.deep.equal({})
        })

        it('NOT(stripped) collapses to no constraint when $not content is stripped', () => {
            // Lines 949-950: r === STRIP path in processNotOperand
            // When onViolation: 'strip', the $not operand is stripped entirely → $not is removed
            const opts: FilterOptions = {
                maxDepth: 0,
                onViolation: 'strip',
            }
            const result = scrubs({ $not: { author: { name: 'Alice' } } }, opts)
            // author exceeds maxDepth → stripped, NOT(stripped) → STRIP → {}
            expect(result).to.deep.equal({})
        })

        it('should collapse LITERAL_FALSE from $and in a top-level array filter', () => {
            // Lines 689: LITERAL_FALSE in processImplicitAnd (array input)
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'id', decision: 'deny' }],
                },
                onViolation: 'false',
            }
            const result = scrubs([{ id: 1 }, { title: 'Book' }], opts)
            // id → false → AND([false, title]) → {} because false in top-level AND
            expect(result).to.deep.equal({})
        })

        it('should strip items from top-level array filter and keep remaining', () => {
            // Lines 690-694: STRIP in processImplicitAnd, items.length === 1 → unwrap
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'id', decision: 'deny' }],
                },
                onViolation: 'strip',
            }
            const result = scrubs([{ id: 1 }, { title: 'Book' }], opts)
            // id stripped → [title] → single item unwrapped to { title: 'Book' }
            expect(result).to.deep.equal({ title: 'Book' })
        })

        it('should return {} when all top-level array items are stripped', () => {
            // Line 692: items.length === 0 → STRIP in processImplicitAnd
            const opts: FilterOptions = {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'id', decision: 'deny' }],
                },
                onViolation: 'strip',
            }
            const result = scrubs([{ id: 1 }], opts)
            // id stripped → items = [] → STRIP → {}
            expect(result).to.deep.equal({})
        })
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// validatesForSubject
// ─────────────────────────────────────────────────────────────────────────────

import { Author, Book, TestDatabase } from './test-db'
import { DataSource } from 'typeorm'

describe('CastleGuard.validatesForSubject', () => {
    let db: TestDatabase
    let source: DataSource

    before(async () => {
        db = new TestDatabase()
        await db.connect()
        source = db.source
    })

    after(async () => {
        if (db) await db.disconnect()
    })

    function validates(filter: any, opts?: FilterOptions) {
        return () => CastleGuard.validatesForSubject(source, Book, filter, opts)
    }

    // ── column existence ────────────────────────────────────────────────────
    describe('column existence', () => {
        it('should accept a valid column on the entity', () => {
            expect(validates({ title: 'Book' })).to.not.throw()
        })

        it('should throw on an unknown column', () => {
            expect(validates({ unknownColumn: 1 }))
                .to.throw(/Unknown field or relation "unknownColumn"/)
        })

        it('should accept multiple valid columns', () => {
            expect(validates({ id: 1, title: 'Book' })).to.not.throw()
        })

        it('should throw on unknown column in operator condition', () => {
            expect(validates({ badField: { $gt: 0 } }))
                .to.throw(/Unknown field or relation "badField"/)
        })
    })

    // ── relation traversal ──────────────────────────────────────────────────
    describe('relation traversal', () => {
        it('should accept a valid relation and its columns (nested object)', () => {
            expect(validates({ author: { name: 'Alice' } })).to.not.throw()
        })

        it('should throw on an unknown relation', () => {
            expect(validates({ unknownRelation: { name: 'Alice' } }))
                .to.throw(/Unknown field or relation "unknownRelation"/)
        })

        it('should throw on unknown column inside a relation', () => {
            expect(validates({ author: { badField: 'x' } }))
                .to.throw(/Unknown field or relation "author.badField"/)
        })

        it('should accept valid dotted-path notation for relation traversal', () => {
            expect(validates({ 'author.name': 'Alice' })).to.not.throw()
        })

        it('should throw on unknown column in dotted path', () => {
            expect(validates({ 'author.badField': 1 }))
                .to.throw(/Unknown field "author.badField"/)
        })

        it('should throw when trying to traverse through a non-relation column', () => {
            // title is a varchar column, not a relation
            expect(validates({ 'title.extra': 'x' }))
                .to.throw(/Cannot use sub-path notation after non-relation/)
        })
    })

    // ── JSON column sub-paths ───────────────────────────────────────────────
    describe('JSON column sub-paths', () => {
        it('should allow direct access to a JSON column (no sub-path)', () => {
            // metadata is a simple-json column on Book
            expect(validates({ metadata: { $like: '%isbn%' } })).to.not.throw()
        })

        it('should allow a JSON sub-path under a JSON column', () => {
            // metadata is simple-json; library.isbn is a JSON sub-path
            expect(validates({ 'metadata.library.isbn': '123' })).to.not.throw()
        })

        it('should throw when using a sub-path after a non-JSON, non-relation column', () => {
            expect(validates({ 'title.library.isbn': '123' }))
                .to.throw(/Cannot use sub-path notation after non-relation/)
        })

        it('should allow a JSON column reached through a relation (dotted path)', () => {
            // On Author entity: books is a relation to Book; metadata is JSON on Book.
            expect(
                () => CastleGuard.validatesForSubject(
                    source, Author,
                    { 'books.metadata.library.isbn': '123' },
                )
            ).to.not.throw()
        })

        it('should allow a JSON column reached through a relation (nested object)', () => {
            expect(
                () => CastleGuard.validatesForSubject(
                    source, Author,
                    { books: { 'metadata.library.isbn': '123' } },
                )
            ).to.not.throw()
        })
    })

    // ── $and / $or / $not at root ───────────────────────────────────────────
    describe('boolean operators', () => {
        it('should validate columns inside $and', () => {
            expect(validates({
                $and: [{ id: 1 }, { title: 'Book' }],
            })).to.not.throw()
        })

        it('should throw for unknown column inside $and', () => {
            expect(validates({
                $and: [{ id: 1 }, { badField: 'x' }],
            })).to.throw(/Unknown field or relation "badField"/)
        })

        it('should validate columns inside $or', () => {
            expect(validates({
                $or: [{ id: 1 }, { title: 'Book' }],
            })).to.not.throw()
        })

        it('should throw for unknown column inside $or', () => {
            expect(validates({
                $or: [{ id: 1 }, { badField: 'x' }],
            })).to.throw(/Unknown field or relation "badField"/)
        })

        it('should validate inside $not', () => {
            expect(validates({ $not: { id: 1 } })).to.not.throw()
        })

        it('should accept a primitive operator condition on a valid column ($eq, $gt, etc.)', () => {
            // Lines 1185-1186: default branch in SchemaWalker.processOperators
            // This branch is hit when processNode routes an all-$-key object
            // through processOperators (e.g. a bare operator item inside $and).
            expect(validates({
                $and: [{ id: 1 }, { $gt: 5 }],
            })).to.not.throw()
        })

        it('should accept a top-level array filter (implicit $and)', () => {
            // Lines 1037-1039: processNode in SchemaWalker handles Array.isArray
            expect(
                () => CastleGuard.validatesForSubject(
                    source, Book,
                    [{ id: 1 }, { title: 'Book' }] as any,
                )
            ).to.not.throw()
        })

        it('should throw for an unknown column inside a top-level array filter', () => {
            // Lines 1037-1039: exercising the array loop in SchemaWalker.processNode
            expect(
                () => CastleGuard.validatesForSubject(
                    source, Book,
                    [{ id: 1 }, { badField: 'x' }] as any,
                )
            ).to.throw(/Unknown field or relation "badField"/)
        })
    })

    // ── non-joinable column as join scope ────────────────────────────────────
    describe('non-joinable column as join scope', () => {
        it('should throw when a non-relation column is used as a nested object scope', () => {
            // Lines 1153-1156: processField throws when a varchar column is used as a join scope
            // e.g. { title: { extra: 'x' } } — title is varchar, not a relation
            expect(validates({ title: { extra: 'x' } }))
                .to.throw(/"title" is not a relation/)
        })
    })

    // ── unknown field in intermediate dotted-path segment ────────────────────
    describe('unknown intermediate segment in dotted path', () => {
        it('should throw when the first segment of a dotted path does not exist', () => {
            // Lines 1095-1098: unknown field/relation in intermediate segment
            expect(validates({ 'badRelation.name': 'Alice' }))
                .to.throw(/Unknown field or relation "badRelation"/)
        })
    })

    // ── filterOptions pass-through ──────────────────────────────────────────
    describe('filterOptions integration', () => {
        it('should still throw for unknown operator (from validates)', () => {
            expect(validates({ id: { $badOp: 1 } }))
                .to.throw(/Unknown operator/)
        })

        it('should enforce maxDepth from filterOptions', () => {
            expect(validates({ author: { name: 'Alice' } }, { maxDepth: 0 }))
                .to.throw(/exceeds maximum join depth/)
        })

        it('should enforce pathPolicy from filterOptions', () => {
            expect(validates(
                { title: 'Book' },
                {
                    pathPolicy: {
                        default: 'deny',
                        rules: [],
                    },
                },
            )).to.throw(/Filter path "title" is not permitted/)
        })
    })
})

