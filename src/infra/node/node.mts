import { Block } from "../../domain/block/block.mts";
import { Session } from "../p2p/peer.mts";
import { Server } from "../p2p/server.mts";
import { hex, hexBytes } from "../../util/crypto.mts";
import { SyncronizedQueue } from "../../util/async/queue.mts";
import { BlockMiner } from "../miner/miner.mts";
import { Transaction, TxIn, TxOut } from "../../domain/transaction/transaction.mts";
import { UTxOut } from "../../domain/transaction/utxo.mts";
import { UTxOutSet } from "../../domain/transaction/utxo.mts";

import { Account } from "../../domain/transaction/account.mts";

import {
  COINBASE_REWARD,
  MAX_BLOCK_TX_BYTES,
  REWARD_HALVING_EVERY_BLOCKS,
  BLOCK_GENERATION_TARGET_IN_MILLS,
  DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS,
  MEDIAN_TIME_PAST_WINDOW,
  MIN_TX_FEES_EVERY_BYTE
} from "../../app/config.mts";
import { TransactionPool } from "./txpool.mts";

/**
 * A full node in the blockchain network
 */
export class Node {
  private tip: Block = Block.deserialize(Block.GENESIS_BLOCK)
  private blocks: Map<string, Block> = new Map([[hex(Block.GENESIS_BLOCK_HASH), this.tip]])
  private server?: Server
  private queue: SyncronizedQueue = new SyncronizedQueue()
  private mining: BlockMiner | null = null
  private _account: Account = new Account()

  private transactionPool: TransactionPool = new TransactionPool()
  private uTxOuts: UTxOutSet = new UTxOutSet()

  public constructor() { }

  public get current() {
    return this.tip
  }

  public get account() {
    return this._account
  }

  public importAccount(account: Account) {
    this._account = account
  }

  public stop() {
    this.cancelMining()
    this.server?.close()
  }

  public peer() {
    return this.server?.getPeersAddresses() ?? []
  }

  public block(hash: string): Block | undefined {
    return this.blocks.get(hash)
  }

  public transaction(id: string): { tx: Transaction, block?: Block } | undefined {
    const idBuffer = Buffer.from(id, 'hex')
    // search from blocks
    for (let block: Block | null = this.tip; block != null; block = block.prev ? this.blocks.get(hex(block.prev)) ?? null : null) {
      if (idBuffer.equals(block.coinbase.id)) {
        return { tx: block.coinbase, block }
      }

      const tx = block.transactions.find(tx => idBuffer.equals(tx.id))
      if (tx) {
        return { tx, block }
      }
    }

    if (this.transactionPool.has(id)) {
      return { tx: this.transactionPool.get(id)!.tx }
    }

    return undefined
  }

  public start(port: number): void {
    this.server = new Server({ port })
      .on('blockinv', (...args) => this.queue.schedule(() => this.onNewBlocks(...args)).catch(() => {
        console.error('Inventory handler error')
      }))
      .on('getblock', this.getBlock.bind(this))
      .on('txinv', session => this.queue.schedule(() => this.onNewTxs(session)))
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

    this.mining = new BlockMiner(this.generateBlock(data), block =>
      this.acceptBlocks({ [hex(block.hash())]: block }, block, block))
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
    const available = this.uTxOuts.filter(UTxOutSet.accountFilter(this.account.publicKey))
      .filter(UTxOutSet.excludePendingTxIns(this.transactionPool))
      .sort((a, b) => b.output.amount - a.output.amount)

    let totalIn = 0
    for (const utxo of available) {
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

      for (let i = 0; i < tx.inputs.length; i++) {
        this.account.signTxIn(tx, i)
      }
      const fees = totalIn - tx.outputValue
      this.transactionPool.add({ tx, fees })
      this.server?.broadcast({ type: 'txinv', data: { txids: [hex(tx.id)] } })
      return { tx, fees }
    }

    throw new Error(totalIn < amount ? 'Insufficient balance' : 'Insufficient balance to cover transaction fees')
  }

  public getBalance(pubkey?: Uint8Array): number {
    return this.uTxOuts.getBalance(pubkey ? Account.normalizePublicKey(pubkey) : this.account.publicKey)
  }

  public getUnspentOutputs(pubkey?: Uint8Array): UTxOut[] {
    return this.uTxOuts.filter(UTxOutSet.accountFilter(pubkey ? Account.normalizePublicKey(pubkey) : this.account.publicKey))
  }

  private generateBlock(data?: Uint8Array): Block {
    const block = this.tip.generate({ difficulty: this.getExpectedDifficulty(this.tip, this.recentTimestamps(this.tip)) })
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

  private recentTimestamps(tip: Block, incoming: Record<string, Block> = {}): number[] {
    const times: number[] = []
    const window = Math.max(MEDIAN_TIME_PAST_WINDOW, DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS)
    let block: Block | undefined = tip
    while (block && times.length < window) {
      times.push(block.ts)
      const prevHash = hex(block.prev)
      block = incoming[prevHash] ?? this.blocks.get(prevHash)
    }
    return times
  }

  public async addPeer(address: string): Promise<boolean> {
    const socket = await this.server?.connect(address)
    if (socket != null) {
      return true
    }

    return false
  }

  private async fetchBlock(peer: Session, hash: string): Promise<Block | undefined> {
    return this.fetchBlocks(peer, [hash]).then(blocks => blocks[hash]).catch(() => undefined)
  }

  private async fetchBatchBlocks(peer: Session, frontier: string, batch: number): Promise<Record<string, Block>> {
    let hash2Block = await peer.request('getblock', { frontier, batch }).catch(() => ({}))
    if (isValidStringStringMap(hash2Block)) {
      const blocks: Record<string, Block> = {}
      for (const hash in hash2Block) {
        blocks[hash] = Block.deserialize(hexBytes(hash2Block[hash]))
      }
      return blocks
    }
    return {}
  }
  private async fetchBlocks(peer: Session, hashes: string[]): Promise<Record<string, Block>> {
    let hash2Block = await peer.request('getblock', { hash: hashes }).catch(() => ({}))
    if (isValidStringStringMap(hash2Block)) {
      const blocks: Record<string, Block> = {}
      for (const hash in hash2Block) {
        blocks[hash] = Block.deserialize(hexBytes(hash2Block[hash]))
      }
      return blocks
    }
    return {}
  }

  private async onNewBlocks(session: Session): Promise<void> {
    let start = Date.now()
    const newBlockSummary = session.data
    if (!Block.isValidBlockSummary(newBlockSummary)) {
      return
    }
    if (this.blocks.get(newBlockSummary.hash)) {
      return
    }
    const orphans = {} as Record<string, Block>
    let newBlock = await this.fetchBlock(session, newBlockSummary.hash)
    if (!newBlock) {
      return
    }
    let block = newBlock
    orphans[hex(block.hash())] = block
    let frontier = hex(block.hash())

    const MAX_FETCH_BATCH = 2048
    let batch = 2
    while (!this.blocks.has(hex(block.prev))) {
      const hash2block = await this.fetchBatchBlocks(session, frontier, batch)
      if (Object.keys(hash2block).length === 0) {
        throw new Error('Failed to fetch previous blocks from peer')
      }
      if (hash2block[hex(block.prev)] == null) {
        throw new Error('Peer returned inconsistent block data')
      }

      while (!this.blocks.has(hex(block.prev)) && hash2block[hex(block.prev)] != null) {
        const prevHash = hex(block.prev)
        const prev = hash2block[prevHash]
        prev.connect(block)
        orphans[prevHash] = prev
        block = prev
      }

      frontier = hex(block.hash())
      batch = Math.min(batch * 2, MAX_FETCH_BATCH)
    }

    if (Object.keys(orphans).length > 1) {
      console.log(`Fetched ${Object.keys(orphans).length} blocks from peer: ${session.peer.address}, cost: ${Date.now() - start}ms`)
      start = Date.now()
    }

    if (this.acceptBlocks(orphans, block, newBlock) && Object.keys(orphans).length > 1) {
      console.log(`Accepted ${Object.keys(orphans).length} new blocks, cost: ${Date.now() - start}ms`)
    }
  }

  private acceptBlocks(blocks: Record<string, Block>, start: Block, tip: Block): boolean {
    const fork = this.blocks.get(hex(start.prev))
    if (!fork || this.blocks.has(hex(tip.hash()))) {
      return false
    }
    if (fork.next && !this.hasMoreWork(fork.next, blocks)) {
      return false
    }

    const outputs = fork.next ? this.unspentOutputsAt(fork) : this.uTxOuts.copy()
    try {
      this.validateBlocks(blocks, start, fork, outputs)
    } catch (error) {
      console.error('Invalid block chain:', error)
      return false
    }

    this.mining?.cancel()
    for (let block = fork.next; block; block = block.next) {
      this.blocks.delete(hex(block.hash()))
    }
    fork.connect(start)
    for (const [hash, block] of Object.entries(blocks)) {
      this.blocks.set(hash, block)
    }
    this.tip = tip
    this.uTxOuts = outputs
    for (const { tx } of this.transactionPool.getAll()) {
      if (tx.inputs.some(input => !outputs.get(input))) {
        this.transactionPool.remove(hex(tx.id))
      }
    }
    this.server?.broadcast({ type: 'blockinv', data: tip.summary })
    return true
  }

  private hasMoreWork(local: Block, incoming: Record<string, Block>): boolean {
    let localWork = 0n
    for (let block: Block | null = local; block; block = block.next) {
      localWork += 1n << BigInt(block.difficulty)
    }
    const incomingWork = Object.values(incoming).reduce((work, block) => work + (1n << BigInt(block.difficulty)), 0n)
    return incomingWork > localWork
  }

  private validateBlocks(blocks: Record<string, Block>, start: Block, prev: Block, outputs: UTxOutSet) {
    for (let block: Block | null = start; block; block = block.next) {
      const times = this.recentTimestamps(prev, blocks)
      const difficulty = this.getExpectedDifficulty(prev, times)
      if (prev.isInvalidNext(block, difficulty, Block.medianTimePast(times))) {
        throw new Error('Invalid block sequence or proof')
      }
      this.applyBlockTransactions(block, outputs)
      prev = block
    }
  }

  private validateTransaction(tx: Transaction, outputs: UTxOutSet): number {
    const inputs = outputs.getInputs(tx)
    const fees = inputs.reduce((sum, input) => sum + input.output.amount, 0) - tx.outputValue
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

  private applyBlockTransactions(block: Block, outputs: UTxOutSet) {
    const hash = block.hash()
    let totalFees = 0
    for (const tx of block.transactions) {
      totalFees += this.validateTransaction(tx, outputs)
      tx.inputs.forEach(input => outputs.remove(input))
      UTxOut.fromTransaction(hash, tx).forEach(output => outputs.add(output))
    }

    const coinbase = block.coinbase
    if (coinbase?.inputs.length !== 1 || !coinbase.inputs[0].isCoinbase ||
        coinbase.inputs[0].index !== block.height || coinbase.outputs.length !== 1) {
      throw new Error('Invalid coinbase transaction')
    }
    if (coinbase.outputValue > this.getCoinbaseRewardAtHeight(block.height) + totalFees) {
      throw new Error('Coinbase transaction output exceeds maximum')
    }
    UTxOut.fromTransaction(hash, coinbase).forEach(output => outputs.add(output))
  }

  private getCoinbaseRewardAtHeight(height: number): number {
    return Math.floor(COINBASE_REWARD / (2 ** Math.floor(height / REWARD_HALVING_EVERY_BLOCKS)))
  }

  private unspentOutputsAt(fork: Block): UTxOutSet {
    const outputs = new UTxOutSet()
    const genesis = this.blocks.get(hex(Block.GENESIS_BLOCK_HASH))!
    // The live ledger starts empty at genesis. Replay the accepted blocks through the fork.
    for (let block = genesis.next; block && block !== fork.next; block = block.next) {
      this.applyBlockTransactions(block, outputs)
    }
    return outputs
  }

  private async getBlock(session: Session): Promise<void> {
    const { hash: hashes, frontier, batch } = session.data ?? {}

    if (Array.isArray(hashes)) {
      const serializedBlocks: Record<string, string> = {}
      for (const hash of hashes) {
        serializedBlocks[hash] = hex(this.blocks.get(hash)?.serialize())
      }
      session.respond(serializedBlocks)
      return
    }

    if (typeof frontier === 'string' && typeof batch === 'number' && batch >= 1) {
      const blockBatch: Block[] = []
      let block = this.blocks.get(frontier)
      while (block && blockBatch.length < batch) {
        block = this.blocks.get(hex(block.prev))
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
    const txids = session.data?.txids
    if (!Array.isArray(txids)) {
      session.respond({ txs: this.transactionPool.getAll().map(pendingTx => pendingTx.tx.serialize()) })
      return
    }

    session.respond({ txs: txids.filter(txid => this.transactionPool.has(txid)).map(txid => hex(this.transactionPool.get(txid)!.tx.serialize())) })
  }

  private async onNewTxs(session: Session): Promise<void> {
    const txids = session.data?.txids
    if (!Array.isArray(txids)) {
      return
    }

    const unknownTxids = txids.filter(txid => !this.transactionPool.has(txid))
    if (unknownTxids.length === 0) {
      return
    }

    const response = await session.request('gettx', { txids: unknownTxids }).catch(() => null)
    if (!Array.isArray(response?.txs)) {
      return
    }

    const validTxIds = new Set<string>()
    for (const serializedTx of response.txs) {
      try {
        const incomingTx = Transaction.deserialize(hexBytes(serializedTx))

        if (incomingTx.bytesLength() + Transaction.COINBASE_BYTES > MAX_BLOCK_TX_BYTES) {
          throw new Error('Transaction is too large to fit in a block')
        }
        const fees = this.validateTransaction(incomingTx, this.uTxOuts)

        // check if any input is already in the transaction pool
        if (incomingTx.inputs.some(input => this.transactionPool.has(this.uTxOuts.get(input)!))) {
          throw new Error('Transaction input already in pool')
        }

        this.transactionPool.add({ tx: incomingTx, fees })
        validTxIds.add(hex(incomingTx.id))
      } catch (e) {
        console.error('Received invalid transaction from peer: ' + session.peer.address)
        console.error(e)
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
