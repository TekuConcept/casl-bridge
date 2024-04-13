const path = require('path')

module.exports = {
    resolveSnapshotPath: (testPath, snapshotExtension) => {
        const thisPath = path.resolve(__dirname, '../lib')
        const relative = path.relative(thisPath, testPath)
        const result = path.join('test', '__snapshots__', relative + snapshotExtension)
        return result
    },
    resolveTestPath: (snapshotFilePath, snapshotExtension) => {
        const thisPath = path.join('test', '__snapshots__')
        const relative = path
            .relative(thisPath, snapshotFilePath)
            .slice(0, -snapshotExtension.length)
        const result = path.join('lib', relative)
        return result
    },
    testPathForConsistencyCheck: 'lib/example.test.js'
}
