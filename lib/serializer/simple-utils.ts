import { ITableInfo } from '../schema'

export class SimpleUtils {
    /**
     * Whether to hex-encode aliases in the query.
     * Like a URI, any non-alphanumeric characters
     * will be encoded as `xx`. Default is `false`.
     */
    static encodeAliases = false

    static getQuotedAlias(
        table: ITableInfo,
        alias: string
    ): string {
        const aliasName = SimpleUtils.encodeAliases
            ? SimpleUtils.encodeName(alias) : alias
        return table.quotedName(aliasName)
    }

    static encodeName(alias: string): string {
        let result = alias.replace(/[^a-zA-Z0-9_]/g, c => {
            let r = c.charCodeAt(0).toString(16)
            if (r.length % 2) r = `0${r}`
            return r
        })

        if (result[0].match(/[0-9]/)) result = `_${result}`

        return result
    }
}
