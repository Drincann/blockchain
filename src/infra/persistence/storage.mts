import { existsSync } from 'node:fs'
import type BetterSQLite from 'better-sqlite3'
import Database from './sqlite.mts'
import { Block } from '../../domain/block/block.mts'
import { Transaction, TxIn, TxOut } from '../../domain/transaction/transaction.mts'
import { UTxOut } from '../../domain/transaction/utxo.mts'
import { hex } from '../../util/crypto.mts'

const schema = `
  CREATE TABLE blocks (
    height INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, bytes BLOB NOT NULL,
    timestamp INTEGER NOT NULL, chain_work TEXT NOT NULL
  );
  CREATE TABLE transactions (id TEXT PRIMARY KEY, height INTEGER NOT NULL);
  CREATE INDEX transactions_height ON transactions(height);
  CREATE TABLE outputs (
    txid TEXT NOT NULL, idx INTEGER NOT NULL, height INTEGER NOT NULL, amount INTEGER NOT NULL,
    owner BLOB NOT NULL, spent_at INTEGER, PRIMARY KEY (txid, idx)
  );
  CREATE INDEX outputs_height ON outputs(height);
  CREATE INDEX outputs_spent ON outputs(spent_at) WHERE spent_at IS NOT NULL;
  CREATE INDEX wallet_coins ON outputs(owner, amount DESC, txid, idx) WHERE spent_at IS NULL;
  CREATE TABLE outbox (id TEXT PRIMARY KEY, bytes BLOB NOT NULL);
  CREATE TABLE settings (name TEXT PRIMARY KEY);
  PRAGMA user_version = 1;
`

interface BlockRow {
  bytes: Buffer
  hash: string
  height: number
}

interface OutputRow {
  txid: string
  idx: number
  hash: string
  amount: number
  owner: Buffer
}

function unspent(row: OutputRow) {
  return new UTxOut({ blockhash: row.hash, txid: row.txid, index: row.idx, output: new TxOut(row.amount, row.owner) })
}

const selectOutput = 'SELECT o.txid, o.idx, b.hash, o.amount, o.owner FROM outputs o JOIN blocks b ON b.height = o.height'

/** Canonical history and its indexes share a transaction. The temporary branch belongs to this connection. */
export class BlockStorage {
  private db: BetterSQLite.Database
  private statements = new Map<string, BetterSQLite.Statement>()

  constructor(filename: string = ':memory:') {
    const existing = filename !== ':memory:' && existsSync(filename)
    this.db = new Database(filename, { timeout: 0 })
    try {
      this.db.pragma('locking_mode = EXCLUSIVE')
      this.db.pragma('synchronous = FULL')
      this.db.pragma('temp_store = FILE')
      this.atomic(() => {
        const version = this.db.pragma('user_version', { simple: true })
        if (version === 0) {
          if (existing) throw new Error('Unrecognized chain database. Restore a backup or choose a fresh directory.')
          this.db.exec(schema)
          const genesis = Block.deserialize(Block.GENESIS_BLOCK)
          this.append(genesis, 1n << BigInt(genesis.difficulty))
          this.indexTransaction(genesis.coinbase, 0)
        } else if (version !== 1) {
          throw new Error('Unsupported chain database version')
        }
        const genesis = this.blockAt(0)
        if (!genesis || hex(genesis.hash()) !== hex(Block.GENESIS_BLOCK_HASH)) {
          throw new Error('Chain database has a different genesis block')
        }
      })
      this.db.exec('CREATE TEMP TABLE incoming (height INTEGER PRIMARY KEY, bytes BLOB NOT NULL)')
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private sql(query: string): BetterSQLite.Statement {
    let statement = this.statements.get(query)
    if (!statement) {
      statement = this.db.prepare(query)
      this.statements.set(query, statement)
    }
    return statement
  }

  atomic<T>(operation: () => T): T {
    return this.db.transaction(operation).exclusive()
  }

  close() {
    if (this.db.open) this.db.close()
  }

  get walletInitialized() {
    return !!this.sql("SELECT 1 FROM settings WHERE name = 'wallet'").get()
  }

  markWalletInitialized() {
    this.sql("INSERT OR IGNORE INTO settings VALUES ('wallet')").run()
  }

  private decode(row?: BlockRow): Block | undefined {
    if (!row) return undefined
    const block = Block.deserialize(new Uint8Array(row.bytes))
    if (block.height !== row.height || hex(block.hash()) !== row.hash) throw new Error('Stored block does not match its index')
    const { height, hash } = row
    block.connect(() => {
      if (!this.db.open) return null
      const next = this.blockAt(height + 1)
      return next && hex(next.prev) === hash ? next : null
    })
    return block
  }

  blockAt(height: number) {
    return this.decode(this.sql('SELECT height, hash, bytes FROM blocks WHERE height = ?').get(height) as BlockRow | undefined)
  }

  block(hash: string) {
    return this.decode(this.sql('SELECT height, hash, bytes FROM blocks WHERE hash = ?').get(hash) as BlockRow | undefined)
  }

  tip() {
    return this.decode(this.sql('SELECT height, hash, bytes FROM blocks ORDER BY height DESC LIMIT 1').get() as BlockRow | undefined)!
  }

  workAt(height: number): bigint {
    return BigInt(this.sql('SELECT chain_work FROM blocks WHERE height = ?').pluck().get(height) as string)
  }

  timestamps(height: number, count: number): number[] {
    return this.sql('SELECT timestamp FROM blocks WHERE height <= ? ORDER BY height DESC LIMIT ?').pluck().all(height, count) as number[]
  }

  append(block: Block, work: bigint) {
    this.sql('INSERT INTO blocks VALUES (?, ?, ?, ?, ?)').run(block.height, hex(block.hash()), Buffer.from(block.serialize()), block.ts, work.toString())
  }

  rewind(height: number) {
    this.sql('DELETE FROM outputs WHERE height > ?').run(height)
    this.sql('UPDATE outputs SET spent_at = NULL WHERE spent_at > ?').run(height)
    this.sql('DELETE FROM transactions WHERE height > ?').run(height)
    this.sql('DELETE FROM blocks WHERE height > ?').run(height)
  }

  indexTransaction(tx: Transaction, height: number) {
    this.sql('INSERT INTO transactions VALUES (?, ?)').run(hex(tx.id), height)
  }

  transactionBlock(id: string) {
    const height = this.sql('SELECT height FROM transactions WHERE id = ?').pluck().get(id)
    return typeof height === 'number' ? this.blockAt(height) : undefined
  }

  addOutputs(tx: Transaction, height: number) {
    const id = hex(tx.id)
    const insert = this.sql('INSERT INTO outputs(txid, idx, height, amount, owner) VALUES (?, ?, ?, ?, ?)')
    tx.outputs.forEach((output, index) => insert.run(id, index, height, output.amount, Buffer.from(output.publicKey)))
  }

  spend(input: TxIn, height: number) {
    const result = this.sql('UPDATE outputs SET spent_at = ? WHERE txid = ? AND idx = ? AND spent_at IS NULL').run(height, input.txid, input.index)
    if (result.changes !== 1) throw new Error('Transaction input is already spent or missing')
  }

  output(input: TxIn): UTxOut | undefined {
    const row = this.sql(selectOutput + ' WHERE o.txid = ? AND o.idx = ? AND o.spent_at IS NULL').get(input.txid, input.index) as OutputRow | undefined
    return row && unspent(row)
  }

  *coins(owner: Uint8Array, limit = -1, offset = 0): IterableIterator<UTxOut> {
    const rows = this.sql(selectOutput + ' WHERE o.owner = ? AND o.spent_at IS NULL ORDER BY o.amount DESC, o.txid, o.idx LIMIT ? OFFSET ?').iterate(Buffer.from(owner), limit, offset)
    for (const row of rows) yield unspent(row as OutputRow)
  }

  balance(owner: Uint8Array): number {
    return this.sql('SELECT COALESCE(SUM(amount), 0) FROM outputs WHERE owner = ? AND spent_at IS NULL').pluck().get(Buffer.from(owner)) as number
  }

  savePending(tx: Transaction) {
    this.sql('INSERT INTO outbox VALUES (?, ?)').run(hex(tx.id), Buffer.from(tx.serialize()))
  }

  pending(): Transaction[] {
    const rows = this.sql('SELECT bytes FROM outbox ORDER BY rowid').pluck().all() as Buffer[]
    return rows.map(bytes => Transaction.deserialize(new Uint8Array(bytes)))
  }

  forgetPending(id: string) {
    this.sql('DELETE FROM outbox WHERE id = ?').run(id)
  }

  stage(block: Block) {
    this.sql('INSERT INTO incoming VALUES (?, ?)').run(block.height, Buffer.from(block.serialize()))
  }

  staged(height: number): Block {
    const bytes = this.sql('SELECT bytes FROM incoming WHERE height = ?').pluck().get(height) as Buffer | undefined
    if (!bytes) throw new Error('Incomplete downloaded branch')
    return Block.deserialize(new Uint8Array(bytes))
  }

  clearStaging() {
    this.sql('DELETE FROM incoming').run()
  }

  rebuild(index: (block: Block, previous: Block) => void) {
    this.atomic(() => {
      this.db.exec('DELETE FROM outputs; DELETE FROM transactions')
      let previous = this.blockAt(0)!
      this.indexTransaction(previous.coinbase, 0)
      const height = this.tip().height
      let work = 1n << BigInt(previous.difficulty)
      const updateHeader = this.sql('UPDATE blocks SET timestamp = ?, chain_work = ? WHERE height = ?')
      updateHeader.run(previous.ts, work.toString(), 0)
      for (let i = 1; i <= height; i++) {
        const block = this.blockAt(i)
        if (!block) throw new Error('Missing block in stored chain')
        index(block, previous)
        work += 1n << BigInt(block.difficulty)
        updateHeader.run(block.ts, work.toString(), i)
        previous = block
      }
    })
  }
}
