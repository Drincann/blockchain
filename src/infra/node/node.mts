import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { BlockStorage } from '../persistence/storage.mts'
import { WalletFile } from '../persistence/wallet.mts'
import { Block, BlockSummary } from "../../domain/block/block.mts";
import { Peer, Session } from "../p2p/peer.mts";
import { Server } from "../p2p/server.mts";
import { hex, hexBytes, isHash } from "../../util/crypto.mts";
import { SyncronizedQueue } from "../../util/async/queue.mts";
import { BlockMiner } from "../miner/miner.mts";
import { checkedSats, Transaction, TxIn, TxOut } from "../../domain/transaction/transaction.mts";
import { UTxOut } from "../../domain/transaction/utxo.mts";
import { UTxOutSet } from "../../domain/transaction/utxo.mts";

import { Account } from "../../domain/transaction/account.mts";

import {
  COINBASE_REWARD,
  MAX_BLOCK_TX_BYTES,
  MAX_FUTURE_DRIFT_IN_MILLS,
  MAX_PENDING_TRANSACTIONS,
  MAX_CONNECTED_PEERS,
  SYNC_BATCH_SIZE,
  REWARD_HALVING_EVERY_BLOCKS,
  BLOCK_GENERATION_TARGET_IN_MILLS,
  DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS,
  MEDIAN_TIME_PAST_WINDOW,
  MIN_TX_FEES_EVERY_BYTE
} from "../../app/config.mts";
import { TransactionPool } from "./txpool.mts";

export interface NodeOptions {
  dataDir: string
  passphrase: string
  reindex?: boolean
}

/**
 * A full node in the blockchain network
 */
export class Node {
  private tip: Block
  private store: BlockStorage
  private wallet?: WalletFile
  private server?: Server
  private stopped = false
  private queue = new SyncronizedQueue()
  private announcements = new Map<Peer, { block?: BlockSummary, txids: Set<string> }>()
  private mining: BlockMiner | null = null
  private transientAccount?: Account
  private transactionPool = new TransactionPool()

  public constructor(options?: NodeOptions) {
    if (options) mkdirSync(options.dataDir, { recursive: true, mode: 0o700 })
    this.store = new BlockStorage(options ? join(resolve(options.dataDir), 'chain.sqlite') : ':memory:')
    try {
      if (options) {
        this.wallet = new WalletFile(options.dataDir, options.passphrase, !this.store.walletInitialized)
        this.store.markWalletInitialized()
      } else {
        this.transientAccount = new Account()
      }
      this.tip = this.store.tip()
      if (options?.reindex) this.store.rebuild((block, previous) => this.validateAndIndex(block, previous))
      for (const tx of this.store.pending()) {
        if (this.store.transactionBlock(hex(tx.id)) || tx.inputs.some(input => !this.store.output(input))) {
          this.store.forgetPending(hex(tx.id))
        } else {
          this.transactionPool.add({ tx, fees: this.validateTransaction(tx) })
        }
      }
    } catch (error) {
      this.store.close()
      throw error
    }
  }

  public get current() {
    return this.tip
  }

  public get account() {
    return this.wallet?.account ?? this.transientAccount!
  }

  public importAccount(account: Account) {
    if (this.wallet) this.wallet.save(account)
    else this.transientAccount = account
  }

  public stop() {
    if (this.stopped) return
    this.stopped = true
    this.cancelMining()
    this.server?.close()
    this.store.close()
  }

  public peer() {
    return this.server?.getPeersAddresses() ?? []
  }

  public discoveredPeers(): string[] {
    return this.server?.discoveredAddresses() ?? []
  }

  public block(hash: string): Block | undefined {
    return this.store.block(hash.toLowerCase())
  }

  public transaction(id: string): { tx: Transaction, block?: Block } | undefined {
    id = id.toLowerCase()
    const block = this.store.transactionBlock(id)
    if (block) {
      const tx = [block.coinbase, ...block.transactions].find(tx => hex(tx.id) === id)
      if (!tx) throw new Error('Transaction index does not match stored block')
      return { tx, block }
    }
    const pending = this.transactionPool.get(id)
    return pending && { tx: pending.tx }
  }

  public start(port: number, host?: string): void {
    this.server = new Server({ port, host })
      .on('blockinv', session => this.queueInventory(session, 'blockinv'))
      .on('getblock', this.getBlock.bind(this))
      .on('txinv', session => this.queueInventory(session, 'txinv'))
      .on('gettx', this.getTxs.bind(this))
      .onConnect(peer => {
        peer.send('blockinv', this.tip.summary)
        peer.send('txinv', { txids: this.transactionPool.keys() })
      })

    console.log(`Node started on port ${port}`)
  }

  public async mineAsync(data?: Uint8Array): Promise<Block | null> {
    return await this.submitMine(data)
  }

  public submitMine(data?: Uint8Array): BlockMiner {
    if (this.mining?.isNotFinish()) {
      return this.mining
    }

    this.mining = new BlockMiner(this.generateBlock(data), block => {
      if (this.stopped || hex(block.prev) !== hex(this.tip.hash())) return false
      return this.acceptBranch(this.tip, block, 1n << BigInt(block.difficulty), () => block)
    })
    return this.mining
  }

  public cancelMining() {
    this.mining?.cancel()
  }

  public send(to: Uint8Array, amount: number): { tx: Transaction, fees: number } {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('Amount must be a positive integer in sats')
    }

    const tx = new Transaction().addOutput(new TxOut(amount, Account.normalizePublicKey(to)))
    if (this.transactionPool.full) throw new Error('Transaction pool is full')
    let totalIn = 0
    let funded = false
    for (const utxo of this.store.coins(this.account.publicKey)) {
      if (this.transactionPool.has(utxo)) continue
      tx.addInput(new TxIn(utxo.txid, utxo.index))
      totalIn += utxo.output.amount
      const size = tx.bytesLength()
      if (size + Transaction.COINBASE_BYTES > MAX_BLOCK_TX_BYTES) {
        throw new Error('Transaction is too large to fit in a block')
      }

      const remaining = totalIn - amount
      if (remaining < size * MIN_TX_FEES_EVERY_BYTE) {
        continue
      }

      const sizeWithChange = size + TxOut.BYTES
      const change = remaining - sizeWithChange * MIN_TX_FEES_EVERY_BYTE
      if (change > 0) {
        if (sizeWithChange + Transaction.COINBASE_BYTES > MAX_BLOCK_TX_BYTES) {
          throw new Error('Transaction is too large to fit in a block')
        }
        tx.addOutput(new TxOut(change, this.account.publicKey))
      }

      funded = true
      break
    }

    if (!funded) {
      throw new Error(totalIn < amount ? 'Insufficient balance' : 'Insufficient balance to cover transaction fees')
    }
    for (let i = 0; i < tx.inputs.length; i++) this.account.signTxIn(tx, i)
    const fees = totalIn - tx.outputValue
    this.store.savePending(tx)
    this.transactionPool.add({ tx, fees })
    this.server?.broadcast({ type: 'txinv', data: { txids: [hex(tx.id)] } })
    return { tx, fees }
  }

  public getBalance(pubkey?: Uint8Array): number {
    return this.store.balance(pubkey ? Account.normalizePublicKey(pubkey) : this.account.publicKey)
  }

  public getUnspentOutputs(pubkey?: Uint8Array, limit = -1, offset = 0): UTxOut[] {
    const owner = pubkey ? Account.normalizePublicKey(pubkey) : this.account.publicKey
    return Array.from(this.store.coins(owner, limit, offset))
  }

  private generateBlock(data?: Uint8Array): Block {
    const timestamps = this.recentTimestamps(this.tip)
    const median = Block.medianTimePast(timestamps)
    if (median >= Date.now() + MAX_FUTURE_DRIFT_IN_MILLS) throw new Error('Local clock is behind the chain')
    const block = this.tip.generate({ difficulty: this.getExpectedDifficulty(this.tip, timestamps) })
    block.setTs(Math.max(block.ts, median))
    const orderedTxs = this.transactionPool.orderByFeesDesc()
    const coinbase = Transaction.buildCoinbaseTx(
      this.account.publicKey,
      0,
      block.height,
      data
    )

    // select transactions & calculate coinbase reward
    const selectedTxs = Block.selectTransactions(orderedTxs.map(pendingTx => pendingTx.tx), coinbase.bytesLength())
    const txFees = selectedTxs.reduce((fees, tx) => fees + this.transactionPool.get(hex(tx.id))!.fees, 0)
    coinbase.outputs[0].amount = this.getCoinbaseRewardAtHeight(block.height) + txFees

    // add transactions
    if (!block.addTransaction(coinbase)) {
      throw new Error('Failed to add coinbase transaction to the new block, data size may exceed the limit')
    }
    for (const tx of selectedTxs) {
      if (!block.addTransaction(tx)) {
        throw new Error('Failed to add transaction to the new block, data size may exceed the limit')
      }
    }
    return block
  }

  private getExpectedDifficulty(prev: Block, times: number[]): number {
    if (prev.height % DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS !== 0) {
      return prev.difficulty
    }

    const lastDuration = prev.ts - times[Math.min(times.length, DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS) - 1]
    const expected = BLOCK_GENERATION_TARGET_IN_MILLS * DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS

    if (lastDuration < expected / 2) {
      return Math.min(prev.difficulty + 1, 255)
    }
    if (lastDuration > expected * 2) {
      return Math.max(prev.difficulty - 1, 1)
    }
    return prev.difficulty
  }

  private recentTimestamps(tip: Block): number[] {
    return this.store.timestamps(tip.height, Math.max(MEDIAN_TIME_PAST_WINDOW, DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS))
  }

  public async addPeer(address: string): Promise<boolean> {
    const socket = await this.server?.connect(address)
    if (socket != null) {
      return true
    }

    return false
  }

  private async queueInventory(session: Session, type: 'blockinv' | 'txinv') {
    const peer = session.peer
    const existing = this.announcements.get(peer)
    if (this.stopped || (!existing && this.announcements.size >= MAX_CONNECTED_PEERS)) return
    const pending = existing ?? { block: undefined, txids: new Set<string>() }
    if (type === 'blockinv') {
      if (!Block.isValidBlockSummary(session.data)) return
      pending.block = { height: session.data.height, hash: session.data.hash }
    } else {
      const ids = session.data?.txids
      if (!Array.isArray(ids)) return
      for (const id of ids.slice(0, MAX_PENDING_TRANSACTIONS)) {
        if (pending.txids.size >= MAX_PENDING_TRANSACTIONS) break
        if (isHash(id)) pending.txids.add(id)
      }
      if (!pending.txids.size) return
    }
    if (existing) return
    this.announcements.set(peer, pending)
    await this.queue.schedule(async () => {
      this.announcements.delete(peer)
      if (this.stopped || peer.ws.readyState !== peer.ws.OPEN) return
      const session = peer.createSession()
      if (pending.block) await this.onNewBlocks({ ...session, data: pending.block })
      if (pending.txids.size) await this.onNewTxs({ ...session, data: { txids: [...pending.txids] } })
    })
  }

  private async onNewBlocks(session: Session): Promise<void> {
    const summary = session.data
    if (this.stopped || !Block.isValidBlockSummary(summary) || this.block(summary.hash)) return
    const response = await session.request('getblock', { hash: [summary.hash] })
    if (this.stopped || !response[summary.hash]) return
    const tip = decodePeerBlock(summary.hash, response[summary.hash])
    if (tip.height !== summary.height || tip.height < 1) return

    let oldest = tip
    let work = 1n << BigInt(tip.difficulty)
    let batch = 2
    try {
      this.store.stage(tip)
      while (!this.block(hex(oldest.prev))) {
        const ancestors = await session.request('getblock', { frontier: hex(oldest.hash()), batch })
        if (this.stopped) return
        if (!isValidStringStringMap(ancestors) || Object.keys(ancestors).length > batch) {
          throw new Error('Invalid ancestor batch')
        }
        let downloaded = 0
        while (!this.block(hex(oldest.prev)) && ancestors[hex(oldest.prev)]) {
          const parent = decodePeerBlock(hex(oldest.prev), ancestors[hex(oldest.prev)])
          if (parent.height < 1 || parent.height !== oldest.height - 1) throw new Error('Invalid ancestor height')
          this.store.stage(parent)
          work += 1n << BigInt(parent.difficulty)
          oldest = parent
          downloaded++
        }
        if (!downloaded && !this.block(hex(oldest.prev))) throw new Error('Incomplete ancestor batch')
        batch = Math.min(batch * 2, SYNC_BATCH_SIZE)
      }
      const fork = this.block(hex(oldest.prev))!
      this.acceptBranch(fork, tip, work, height => this.store.staged(height))
    } finally {
      if (!this.stopped) this.store.clearStaging()
    }
  }

  private acceptBranch(fork: Block, tip: Block, branchWork: bigint, read: (height: number) => Block): boolean {
    if (!this.store.blockAt(fork.height)?.equals(fork)) return false
    const forkWork = this.store.workAt(fork.height)
    const currentWork = this.store.workAt(this.tip.height)
    if (forkWork + branchWork <= currentWork) return false
    const removed: string[] = []
    this.store.atomic(() => {
      if (fork.height < this.tip.height) this.store.rewind(fork.height)
      let previous = fork
      let work = forkWork
      for (let height = fork.height + 1; height <= tip.height; height++) {
        const block = read(height)
        work += 1n << BigInt(block.difficulty)
        this.store.append(block, work)
        this.validateAndIndex(block, previous)
        previous = block
      }
      if (!previous.equals(tip) || work !== forkWork + branchWork || work <= currentWork) {
        throw new Error('Validated branch does not match the proposed tip and work')
      }
      for (const { tx } of this.transactionPool.getAll()) {
        if (tx.inputs.some(input => !this.store.output(input))) {
          const id = hex(tx.id)
          this.store.forgetPending(id)
          removed.push(id)
        }
      }
    })
    this.tip = this.store.tip()
    this.mining?.cancel()
    for (const id of removed) this.transactionPool.remove(id)
    this.server?.broadcast({ type: 'blockinv', data: tip.summary })
    return true
  }

  private validateAndIndex(block: Block, previous: Block) {
    const times = this.recentTimestamps(previous)
    const difficulty = this.getExpectedDifficulty(previous, times)
    if (previous.isInvalidNext(block, difficulty, Block.medianTimePast(times))) {
      throw new Error('Invalid block sequence or proof')
    }
    this.applyBlockTransactions(block)
  }

  private validateTransaction(tx: Transaction): number {
    const inputs = UTxOutSet.resolveInputs(tx, input => this.store.output(input))
    const totalIn = checkedSats(inputs.reduce((sum, input) => sum + input.output.amount, 0))
    const fees = totalIn - tx.outputValue
    if (!Number.isSafeInteger(fees) || fees < tx.bytesLength() * MIN_TX_FEES_EVERY_BYTE) {
      throw new Error('Insufficient transaction fees')
    }
    for (const [index, input] of inputs.entries()) {
      if (!Account.verifyTxIn(tx, index, input.output.publicKey)) {
        throw new Error('Transaction input signature invalid')
      }
    }
    return fees
  }

  private applyBlockTransactions(block: Block) {
    let totalFees = 0
    for (const tx of block.transactions) {
      totalFees += this.validateTransaction(tx)
      tx.inputs.forEach(input => this.store.spend(input, block.height))
      this.store.indexTransaction(tx, block.height)
      this.store.addOutputs(tx, block.height)
    }

    const coinbase = block.coinbase
    if (!coinbase) throw new Error('Missing coinbase transaction')
    coinbase.validateCoinbase(block.height, this.getCoinbaseRewardAtHeight(block.height) + totalFees)
    this.store.indexTransaction(coinbase, block.height)
    this.store.addOutputs(coinbase, block.height)
  }

  private getCoinbaseRewardAtHeight(height: number): number {
    return Math.floor(COINBASE_REWARD / (2 ** Math.floor(height / REWARD_HALVING_EVERY_BLOCKS)))
  }

  private async getBlock(session: Session): Promise<void> {
    const { hash: hashes, frontier, batch } = session.data ?? {}

    if (Array.isArray(hashes)) {
      const serializedBlocks: Record<string, string> = {}
      for (const hash of new Set(hashes.slice(0, SYNC_BATCH_SIZE).filter(isHash))) {
        serializedBlocks[hash] = hex(this.store.block(hash)?.serialize())
      }
      session.respond(serializedBlocks)
      return
    }

    if (isHash(frontier) && Number.isSafeInteger(batch) && batch >= 1) {
      const blockBatch: Block[] = []
      let block = this.store.block(frontier)
      while (block && blockBatch.length < Math.min(batch, SYNC_BATCH_SIZE)) {
        block = this.store.block(hex(block.prev))
        if (!block) {
          break
        }
        blockBatch.push(block)
      }

      session.respond(blockBatch.reduce((blockMap, block) => {
        blockMap[hex(block.hash())] = hex(block.serialize())
        return blockMap
      }, {} as Record<string, string>))
      return
    }

    session.respond({})
  }

  private async getTxs(session: Session): Promise<void> {
    const ids = session.data?.txids ?? this.transactionPool.keys()
    const txs: string[] = []
    if (Array.isArray(ids)) {
      for (const id of new Set(ids.slice(0, SYNC_BATCH_SIZE).filter(isHash))) {
        const pending = this.transactionPool.get(id)
        if (pending) txs.push(hex(pending.tx.serialize()))
      }
    }
    session.respond({ txs })
  }

  private async onNewTxs(session: Session): Promise<void> {
    const ids = session.data?.txids
    if (!Array.isArray(ids) || this.stopped || this.transactionPool.full) return
    const unknown = [...new Set(ids.slice(0, MAX_PENDING_TRANSACTIONS).filter(isHash))]
      .filter(id => !this.transactionPool.has(id))
    const validTxIds = new Set<string>()
    for (let offset = 0; offset < unknown.length && !this.transactionPool.full; offset += SYNC_BATCH_SIZE) {
      const batch = unknown.slice(offset, offset + SYNC_BATCH_SIZE)
      const response = await session.request('gettx', { txids: batch }).catch(() => null)
      if (this.stopped) return
      if (!Array.isArray(response?.txs) || response.txs.length > batch.length) continue

      const requested = new Set(batch)
      for (const serialized of response.txs) {
        if (this.transactionPool.full) break
        if (typeof serialized !== 'string' || serialized.length > 2 * (MAX_BLOCK_TX_BYTES - Transaction.COINBASE_BYTES)) continue
        try {
          const tx = Transaction.deserialize(hexBytes(serialized))
          const id = hex(tx.id)
          if (!requested.delete(id) || this.transactionPool.has(id)) continue
          if (tx.inputs.some(input => this.transactionPool.has(input))) continue
          const fees = this.validateTransaction(tx)
          this.transactionPool.add({ tx, fees })
          validTxIds.add(id)
        } catch {
          // Other entries in this response may still be valid.
          continue
        }
      }
    }
    if (validTxIds.size > 0) {
      this.server?.broadcast({ type: 'txinv', data: { txids: Array.from(validTxIds) } })
    }
  }
}

function isValidStringStringMap(rawResponse: any): rawResponse is Record<string, string> {
  return typeof rawResponse === 'object' && rawResponse !== null
    && Object.values(rawResponse).every(value => typeof value === 'string')
    && Object.keys(rawResponse).every(key => typeof key === 'string')
}

function decodePeerBlock(hash: string, serialized: string): Block {
  if (typeof serialized !== 'string' || serialized.length > 2 * (81 + MAX_BLOCK_TX_BYTES)) {
    throw new Error('Invalid serialized block')
  }
  const block = Block.deserialize(hexBytes(serialized))
  if (hex(block.hash()) !== hash) throw new Error('Invalid block identity')
  if (block.difficulty < 1 || !block.isProofValid()) throw new Error('Invalid downloaded proof of work')
  return block
}
