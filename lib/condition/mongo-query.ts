import { ConditionTree, PrimOp, ScopeOp, IQuery } from './types'
import { PrimitiveCondition } from './primitive-condition'
import { ScopedCondition } from './scoped-condition'

export type MongoPrimitive =
    string    |
    number    |
    boolean   |
    null      |
    undefined |
    Date

export interface MongoFields {
    [field: string]: MongoPrimitive | MongoFields | MongoConditions
}

export interface MongoPrimitiveConditions {
    '$eq'?:         MongoPrimitive
    '$ne'?:         MongoPrimitive
    '$gte'?:        MongoPrimitive
    '$gt'?:         MongoPrimitive
    '$lte'?:        MongoPrimitive
    '$lt'?:         MongoPrimitive
    '$is'?:         null | true | false
    '$isNot'?:      null | true | false
    '$in'?:         MongoPrimitive[]
    '$notIn'?:      MongoPrimitive[]
    '$like'?:       string
    '$notLike'?:    string
    '$iLike'?:      string
    '$notILike'?:   string
    '$regex'?:      string
    '$regexp'?:     string
    '$notRegex'?:   string
    '$notRegexp'?:  string
    '$iRegexp'?:    string
    '$notIRegexp'?: string
    '$between'?:    [MongoPrimitive, MongoPrimitive]
    '$notBetween'?: [MongoPrimitive, MongoPrimitive]
    '$size'?:       number
}

type ScopedGroup = MongoFields | MongoConditions
export interface MongoScopedConditions {
    '$not'?: ScopedGroup
    '$and'?: ScopedGroup | ScopedGroup[]
    '$or'?:  ScopedGroup | ScopedGroup[]
}

export type MongoConditions = MongoPrimitiveConditions | MongoScopedConditions
export type MongoQueryObject = MongoFields | MongoConditions
export type MongoQueryObjects = MongoQueryObject | MongoQueryObject[]

export class MongoQuery implements IQuery {
    private _tree: ConditionTree = null
    get tree(): ConditionTree { return this._tree }

    constructor(public readonly query: MongoQueryObjects) {}

    /** Returns whether the query includes `where` conditions */
    isEmpty(): boolean {
        return Object.keys(this.query).length === 0
    }

    /**
     * Builds and returns a ConditionTree representation of the query.
     * 
     * @param alias The alias to use for the root condition.
     */
    build(
        alias: string = '__root__',
    ): ConditionTree {
        if (this._tree) return this._tree

        const builder = new MongoTreeBuilder(
            this.query,
            alias,
        )
        this._tree = builder.build()

        return this._tree
    }
}

export class MongoTreeBuilder {
    constructor(
        readonly query: MongoQueryObjects,
        readonly alias: string = '__root__',
    ) {}

    private conditionStack: ScopedCondition[] = []
    private fieldStack: string[] = []

    isQuery(obj: MongoQueryObject) {
        return Object.keys(obj).every(key => key.startsWith('$'))
    }

    /** Turns a mongo query object into a condition tree */
    build(): ConditionTree {
        const root = new ScopedCondition({ alias: this.alias })
        this.conditionStack.push(root)

        this.buildObject(this.query)
        return this.conditionStack.pop()
    }

    getTraceName(operator: string, field?: string) {
        return field ? `${field} > ${operator}` : operator
    }

    scopedInvoke(
        callback: () => void,
        field: string = '',
        scope: ScopeOp = ScopeOp.AND,
        join = false
    ) {
        const scopeIndex  = this.conditionStack.length - 1
        const parentScope = this.conditionStack[scopeIndex]
        const parentAlias = parentScope.alias

        let alias: string = null
        let scopeName: string = null

        switch (scope) {
        case ScopeOp.NOT: scopeName = '$not'; break
        case ScopeOp.AND: scopeName = '$and'; break
        case ScopeOp.OR:  scopeName = '$or';  break
        default: throw new Error(`Unknown scope: ${scope}`)
        }

        if (join) {
            if (!field) throw new Error('Expected field name for join')
            alias = `${parentAlias}_${field}`
        }

        const column = field || null
        const nextScope = new ScopedCondition({
            alias,
            join,
            traceName: this.getTraceName(scopeName, field),
            scope,
            column,
        })
        parentScope.push(nextScope)

        this.conditionStack.push(nextScope)
        callback()
        this.conditionStack.pop()
    }

    buildObject(obj: MongoQueryObjects) {
        if (typeof obj !== 'object')
            throw new Error(`Expected object, got ${typeof obj}`)

        if (Array.isArray(obj))
            this.buildOperator('$and', obj)
        else if (this.isQuery(obj))
            this.buildQuery(obj as MongoConditions)
        else this.buildFields(obj as MongoFields)
    }

    buildFields(obj: MongoFields) {
        // TODO: depending on permissions library,
        //       we may be able to skip this. CASL
        //       requires embedded fields to be
        //       defined with dot-notation.
        this.collapseFields(obj)

        Object.keys(obj).forEach(field => {
            const value = obj[field]
            this.buildField(field, value)
        })
    }

    // NOTE: This mutates the object.
    // TODO: Maybe deep clone in build() instead?
    collapseFields(obj: MongoFields) {
        /**
         * WARNING: Due to ambiguity between 'dot-notation' and
         * quoted column names, column names MUST not contain
         * dots. This is a limitation of the current
         * implementation of CASL (or mondodb queries).
         * 
         * For example, how does one differentiate between:
         * - a.b: { c } aka 'a.b.c'
         * - a: { b.c } aka 'a.b.c'
         */

        let merger: object = {}

        // Step 1. Find and collapse all dot-notation fields
        Object.keys(obj).forEach(key => {
            const dotIndex = key.indexOf('.')
            if (dotIndex < 0) return

            const tableKey = key.substring(0, dotIndex)
            if (!merger[tableKey]) merger[tableKey] = {}

            const fieldKey = key.substring(dotIndex + 1)
            merger[tableKey][fieldKey] = obj[key]

            delete obj[key]
        })

        // Step 2. Merge collapsed fields back into the main object
        //         without overwriting existing fields.
        // NOTE: This does not deep-merge objects!
        Object.keys(merger).forEach(key => {
            if (obj[key] === undefined ||
                obj[key] === null)
                obj[key] = merger[key]
            else if (typeof obj[key] === 'object')
                Object.assign(obj[key], merger[key])
            else throw new Error(
                `Expected object for '${key}', got ${typeof obj[key]}`
            )
        })
    }

    buildField(
        field: string,
        value: any
    ) {
        this.fieldStack.push(field)

        if (value === null)
            this.buildOperator('$is', value)
        else if (Array.isArray(value))
            this.buildOperator('$in', value)
        else if (typeof value === 'object') {
            if (this.isQuery(value))
                this.buildQuery(value as MongoConditions)
            else {
                this.scopedInvoke(
                    () => this.buildFields(value as MongoFields),
                    field, ScopeOp.AND, true
                )
            }
        } else this.buildOperator('$eq', value)

        this.fieldStack.pop()
    }

    buildQuery(query: MongoConditions) {
        Object.keys(query).forEach(operator => {
            const operand = query[operator]
            this.buildOperator(operator, operand)
        })
    }

    buildOperator(
        operator: string,
        operand: any,
    ) {
        const field = this.fieldStack[this.fieldStack.length - 1]

        switch (operator) {
        case '$eq':         this.buildPrimCondition(operator, PrimOp.EQUAL,            operand, field); break
        case '$ne':         this.buildPrimCondition(operator, PrimOp.NOT_EQUAL,        operand, field); break
        case '$ge':         // fall-through
        case '$gte':        this.buildPrimCondition(operator, PrimOp.GREATER_OR_EQUAL, operand, field); break
        case '$gt':         this.buildPrimCondition(operator, PrimOp.GREATER_THAN,     operand, field); break
        case '$le':         // fall-through
        case '$lte':        this.buildPrimCondition(operator, PrimOp.LESS_OR_EQUAL,    operand, field); break
        case '$lt':         this.buildPrimCondition(operator, PrimOp.LESS_THAN,        operand, field); break
        case '$is':         this.buildPrimCondition(operator, PrimOp.IS,               operand, field); break
        case '$isNot':      this.buildPrimCondition(operator, PrimOp.IS_NOT,           operand, field); break
        case '$in':         this.buildPrimCondition(operator, PrimOp.IN,               operand, field); break
        case '$notIn':      this.buildPrimCondition(operator, PrimOp.NOT_IN,           operand, field); break
        case '$like':       this.buildPrimCondition(operator, PrimOp.LIKE,             operand, field); break
        case '$notLike':    this.buildPrimCondition(operator, PrimOp.NOT_LIKE,         operand, field); break
        case '$iLike':      this.buildPrimCondition(operator, PrimOp.ILIKE,            operand, field); break
        case '$notILike':   this.buildPrimCondition(operator, PrimOp.NOT_ILIKE,        operand, field); break
        case '$regex':      // fall-through
        case '$regexp':     this.buildPrimCondition(operator, PrimOp.REGEX,            operand, field); break
        case '$notRegex':   // fall-through
        case '$notRegexp':  this.buildPrimCondition(operator, PrimOp.NOT_REGEX,        operand, field); break
        case '$iRegexp':    this.buildPrimCondition(operator, PrimOp.IREGEX,           operand, field); break
        case '$notIRegexp': this.buildPrimCondition(operator, PrimOp.NOT_IREGEX,       operand, field); break
        case '$between':    this.buildPrimCondition(operator, PrimOp.BETWEEN,          operand, field); break
        case '$notBetween': this.buildPrimCondition(operator, PrimOp.NOT_BETWEEN,      operand, field); break
        case '$size':       this.buildPrimCondition(operator, PrimOp.SIZE,             operand, field); break
        // case '$elemMatch': break // mongodb only
        case '$and':
            this.scopedInvoke(() => {
                if (Array.isArray(operand)) {
                    operand.forEach(fieldGroup => {
                        this.scopedInvoke(() => {
                            this.buildObject(fieldGroup)
                        })
                    })
                } else if (typeof operand === 'object')
                    this.buildObject(operand)
                else throw new Error(`Expected array or object for '$and', got ${typeof operand}`)
            }, field, ScopeOp.AND)
            break
        case '$or':
            this.scopedInvoke(() => {
                if (Array.isArray(operand)) {
                    operand.forEach(fieldGroup => {
                        this.scopedInvoke(() => {
                            this.buildObject(fieldGroup)
                        })
                    })
                } else if (typeof operand === 'object')
                    this.buildObject(operand)
                else throw new Error(`Expected array or object for '$or', got ${typeof operand}`)
            }, field, ScopeOp.OR)
            break
        case '$not':
            this.scopedInvoke(() => {
                if (Array.isArray(operand)) {
                    operand.forEach(fieldGroup => {
                        this.scopedInvoke(() => {
                            this.buildObject(fieldGroup)
                        })
                    })
                } else if (typeof operand === 'object')
                    this.buildObject(operand)
                else throw new Error(`Expected array or object for '$not', got ${typeof operand}`)
            }, field, ScopeOp.NOT)
            break
        // case $nor: break // TODO?
        default: throw new Error(`Unsupported operator '${operator}'`)
        }
    }

    buildPrimCondition(
        operatorName: string,
        operator: PrimOp,
        operand: MongoPrimitive,
        column: string
    ) {
        if (!column) throw new Error(`Expected column name for '${operatorName}'!`)

        const scopeIndex = this.conditionStack.length - 1
        const scope = this.conditionStack[scopeIndex]

        const condition = new PrimitiveCondition({
            column,
            traceName: this.getTraceName(operatorName, column),
            operator,
            operand
        })

        scope.push(condition)
    }

    /** Used for troubleshooting */
    static print(
        condition: ConditionTree,
        indent = 0,
        id: number | null = null
    ): string {
        const prefix = '  '.repeat(indent)
        const prefix2 = '  '.repeat(indent + 1)
        const lines = []

        lines.push(`${prefix}condition [${id === null ? '?': id}] {`)

        if (condition.type === 'primitive') {
            const primitive = condition as PrimitiveCondition
            lines.push(`${prefix2}type: ${primitive.type}`)
            lines.push(`${prefix2}trace: ${primitive.trace()}`)
            lines.push(`${prefix2}alias: ${primitive.alias}`)
            lines.push(`${prefix2}column: ${primitive.column}`)

            lines.push(`${prefix2}operator: ${primitive.operator}`)
            lines.push(`${prefix2}operand: ${primitive.operand}`)
        } else {
            const scoped = condition as ScopedCondition
            lines.push(`${prefix2}type: ${scoped.type}`)
            lines.push(`${prefix2}trace: ${scoped.trace()}`)
            lines.push(`${prefix2}alias: ${scoped.alias}`)
            lines.push(`${prefix2}column: ${scoped['_column']}`)

            lines.push(`${prefix2}scope: ${scoped.scope}`)

            for (let i = 0; i < scoped.conditions.length; i++) {
                const subCondition = scoped.conditions[i]
                lines.push(this.print(subCondition, indent + 1, i))
            }
        }

        lines.push(`${prefix}}`)
        return lines.join('\n')
    }
}
