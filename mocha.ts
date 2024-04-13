import chai = require('chai')
import { jestSnapshotPlugin } from 'mocha-chai-jest-snapshot'

chai.use(jestSnapshotPlugin())
