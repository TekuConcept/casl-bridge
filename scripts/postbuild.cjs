#!/usr/bin/env node
'use strict';

/**
 * Post-build script run after `npm run build`.
 *
 * 1. Writes sub-package.json files so Node treats dist/esm as ESM and
 *    dist/cjs as CommonJS regardless of the root package "type".
 * 2. Rewrites bare relative specifiers in the dist/esm output to include
 *    explicit ".js" (or "/index.js") extensions so that Node's native ESM
 *    loader can resolve them without a bundler.
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const ESM_DIR  = path.join(ROOT, 'dist', 'esm');
const CJS_DIR  = path.join(ROOT, 'dist', 'cjs');

// ─── 1. Sub-package.json files ───────────────────────────────────────────────

fs.writeFileSync(
    path.join(ESM_DIR, 'package.json'),
    JSON.stringify({ type: 'module' }, null, 2) + '\n',
);

fs.writeFileSync(
    path.join(CJS_DIR, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);

// ─── 2. Fix ESM relative-import specifiers ───────────────────────────────────

/**
 * Relative-import/export pattern.
 * Matches the path portion of:
 *   import ... from './foo'
 *   export * from '../bar/baz'
 *   export { X } from './qux'
 * but NOT bare specifiers (no leading ./ or ../).
 */
const IMPORT_RE = /((?:import|export)[^'"]*from\s+['"])(\.\.?\/[^'"]+)(['"]\s*;?)/g;

/**
 * Return true when `spec` already carries a file extension
 * (e.g. '.js', '.cjs', '.mjs', '.json').
 */
function hasExtension(spec) {
    return /\.[cm]?js(?:on)?$/.test(spec);
}

/**
 * Given a resolved directory path and a bare relative specifier (no ext),
 * decide whether to append '.js' or '/index.js'.
 */
function resolveSpecifier(fromDir, spec) {
    const candidate = path.resolve(fromDir, spec);

    // Is there a <spec>.js file?
    if (fs.existsSync(candidate + '.js')) {
        return spec + '.js';
    }

    // Is there a <spec>/index.js?
    if (
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isDirectory() &&
        fs.existsSync(path.join(candidate, 'index.js'))
    ) {
        return spec + '/index.js';
    }

    // Fallback: just append .js (TypeScript always produces .js outputs)
    return spec + '.js';
}

function fixFile(filePath) {
    let src = fs.readFileSync(filePath, 'utf-8');
    const dir = path.dirname(filePath);

    const fixed = src.replace(IMPORT_RE, (match, prefix, spec, suffix) => {
        if (hasExtension(spec)) return match;
        return prefix + resolveSpecifier(dir, spec) + suffix;
    });

    if (fixed !== src) {
        fs.writeFileSync(filePath, fixed, 'utf-8');
    }
}

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
        } else if (entry.name.endsWith('.js')) {
            fixFile(full);
        }
    }
}

walk(ESM_DIR);

console.log('postbuild: ESM specifiers fixed and sub-package.json files written.');
