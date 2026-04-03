import 'mocha'
import { expect } from 'chai'
import { ScopedCondition } from '../condition/scoped-condition'
import { PrimitiveCondition } from '../condition/primitive-condition'
import { PrimOp, ScopeOp } from '../condition/types'
import {
    PassFn,
    SchemaLessPassContext,
    SchemaAwarePassContext,
    runPasses,
    schemaLessExternalPasses,
    schemaAwareExternalPasses,
    depthLimiterPass,
    pathPolicyPass,
    relationIdRewriterPass,
} from './runner'
import { PassResult, PassError } from './types'
import { ConditionTree } from '../condition/types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRoot(alias = '__root__'): ScopedCondition {
    return new ScopedCondition({ alias, scope: ScopeOp.AND })
}

function joinScope(column: string, parentAlias: string): ScopedCondition {
    return new ScopedCondition({
        column,
        alias: `${parentAlias}_${column}`,
        scope: ScopeOp.AND,
        join: true,
    })
}

function prim(column: string): PrimitiveCondition {
    return new PrimitiveCondition({ column, operator: PrimOp.EQUAL, operand: 1 })
}

// ─────────────────────────────────────────────────────────────────────────────
// runPasses
// ─────────────────────────────────────────────────────────────────────────────

describe('runPasses', () => {
    it('should return the original tree unchanged when passes array is empty', () => {
        const r = makeRoot()
        const ctx: SchemaLessPassContext = { alias: '__root__' }
        const result = runPasses(r, ctx, [])
        expect(result.tree).to.equal(r)
        expect(result.issues).to.be.empty
        r.unlink()
    })

    it('should accumulate issues from multiple passes', () => {
        const issue1 = { code: 'ERR1', message: 'error 1' }
        const issue2 = { code: 'ERR2', message: 'error 2' }

        const pass1: PassFn<SchemaLessPassContext> = (tree) => ({ tree, issues: [issue1] })
        const pass2: PassFn<SchemaLessPassContext> = (tree) => ({ tree, issues: [issue2] })

        const r = makeRoot()
        const ctx: SchemaLessPassContext = { alias: '__root__' }
        const result = runPasses(r, ctx, [pass1, pass2])

        expect(result.issues).to.have.length(2)
        expect(result.issues[0].code).to.equal('ERR1')
        expect(result.issues[1].code).to.equal('ERR2')
        r.unlink()
    })

    it('should pass the tree returned by each pass to the next pass', () => {
        const r1 = makeRoot('tree1')
        const r2 = makeRoot('tree2')

        const seenTrees: any[] = []
        const pass1: PassFn<SchemaLessPassContext> = (tree) => {
            seenTrees.push(tree)
            return { tree: r2, issues: [] }  // return different tree
        }
        const pass2: PassFn<SchemaLessPassContext> = (tree) => {
            seenTrees.push(tree)
            return { tree, issues: [] }
        }

        const ctx: SchemaLessPassContext = { alias: '__root__' }
        const result = runPasses(r1, ctx, [pass1, pass2])

        expect(seenTrees[0]).to.equal(r1)   // pass1 received original tree
        expect(seenTrees[1]).to.equal(r2)   // pass2 received tree returned by pass1
        expect(result.tree).to.equal(r2)    // final tree is r2
        r1.unlink()
        r2.unlink()
    })

    it('should return no issues when all passes succeed', () => {
        const r = makeRoot()
        r.push(prim('id'))
        const ctx: SchemaLessPassContext = { alias: '__root__' }
        const result = runPasses(r, ctx, schemaLessExternalPasses)
        expect(result.issues).to.be.empty
        r.unlink()
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// depthLimiterPass
// ─────────────────────────────────────────────────────────────────────────────

describe('depthLimiterPass', () => {
    it('should be a no-op when maxDepth is undefined', () => {
        const r = makeRoot()
        const joinSc = joinScope('author', '__root__')
        joinSc.push(prim('name'))
        r.push(joinSc)

        const ctx: SchemaLessPassContext = { alias: '__root__', filterOptions: {} }
        const result = depthLimiterPass(r, ctx)
        expect(result.issues).to.be.empty
        r.unlink()
    })

    it('should report MAX_DEPTH_EXCEEDED when depth is exceeded', () => {
        const r = makeRoot()
        const joinSc = joinScope('author', '__root__')
        joinSc.push(prim('name'))
        r.push(joinSc)

        const ctx: SchemaLessPassContext = {
            alias: '__root__',
            filterOptions: { maxDepth: 0 },
        }
        const result = depthLimiterPass(r, ctx)
        expect(result.issues).to.have.length(1)
        expect(result.issues[0].code).to.equal('MAX_DEPTH_EXCEEDED')
        r.unlink()
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// pathPolicyPass
// ─────────────────────────────────────────────────────────────────────────────

describe('pathPolicyPass', () => {
    it('should be a no-op when pathPolicy is undefined', () => {
        const r = makeRoot()
        const joinSc = joinScope('author', '__root__')
        joinSc.push(prim('name'))
        r.push(joinSc)

        const ctx: SchemaLessPassContext = { alias: '__root__', filterOptions: {} }
        const result = pathPolicyPass(r, ctx)
        expect(result.issues).to.be.empty
        r.unlink()
    })

    it('should report PATH_POLICY_VIOLATION when a path is denied', () => {
        const r = makeRoot()
        const andSc = new ScopedCondition({ scope: ScopeOp.AND })
        andSc.push(prim('secret'))
        r.push(andSc)

        const ctx: SchemaLessPassContext = {
            alias: '__root__',
            filterOptions: {
                pathPolicy: {
                    default: 'allow',
                    rules: [{ path: 'secret', decision: 'deny' }],
                },
            },
        }
        const result = pathPolicyPass(r, ctx)
        expect(result.issues).to.have.length(1)
        expect(result.issues[0].code).to.equal('PATH_POLICY_VIOLATION')
        r.unlink()
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// schemaLessExternalPasses / schemaAwareExternalPasses
// ─────────────────────────────────────────────────────────────────────────────

describe('canonical pass lists', () => {
    it('schemaLessExternalPasses should contain depthLimiterPass and pathPolicyPass', () => {
        expect(schemaLessExternalPasses).to.include(depthLimiterPass)
        expect(schemaLessExternalPasses).to.include(pathPolicyPass)
    })

    it('schemaAwareExternalPasses should include all schema-less passes', () => {
        expect(schemaAwareExternalPasses).to.include(depthLimiterPass)
        expect(schemaAwareExternalPasses).to.include(pathPolicyPass)
    })

    it('schemaAwareExternalPasses should include relationIdRewriterPass', () => {
        expect(schemaAwareExternalPasses).to.include(relationIdRewriterPass)
    })

    it('schemaAwareExternalPasses should have more passes than schemaLessExternalPasses', () => {
        expect(schemaAwareExternalPasses.length).to.be.greaterThan(
            schemaLessExternalPasses.length
        )
    })
})

// ─────────────────────────────────────────────────────────────────────────────
// PassError (backward-compat export)
// ─────────────────────────────────────────────────────────────────────────────

describe('PassError', () => {
    it('should be an instance of Error', () => {
        const err = new PassError('something went wrong', 'TEST_CODE')
        expect(err).to.be.instanceOf(Error)
        expect(err.name).to.equal('PassError')
        expect(err.message).to.equal('something went wrong')
        expect(err.code).to.equal('TEST_CODE')
        expect(err.path).to.be.undefined
    })

    it('should carry an optional path', () => {
        const err = new PassError('bad path', 'PATH_ERR', 'author.name')
        expect(err.path).to.equal('author.name')
    })
})
