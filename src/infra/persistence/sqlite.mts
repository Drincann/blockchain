import { createRequire } from 'node:module'
import type BetterSQLite from 'better-sqlite3'

const require = createRequire(import.meta.url)
const legacy = process.versions.node.split('.')[0] === '16'
const Database: typeof BetterSQLite = require(legacy ? 'blockchain-sqlite-node16' : 'better-sqlite3')
export default Database
