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
  REWARD_HALVING_EVERY_BLOCKS,
  BLOCK_GENERATION_TARGET_IN_MILLS,
  DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS,
  MEDIAN_TIME_PAST_WINDOW,
  MAX_FUTURE_DRIFT_IN_MILLS,
  MIN_TX_FEES_EVERY_BYTE
} from "../../app/config.mts";
import { TransactionPool } from "./txpool.mts";

/**
 * A full node in the blockchain network
 */
export class Node {
  private blocks: Map<string, Block> = new Map([[hex(Block.GENESIS_BLOCK_HASH), Block.deserialize(Block.GENESIS_BLOCK)]])
  private tip: Block = Block.deserialize(Block.GENESIS_BLOCK)
  private server: Server
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
    this.server?.close()
  }

  public peer() {
    return this.server.getPeersAddresses()
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
      .on('txinv', this.onNewTxs.bind(this))
      .on('gettx', this.getTxs.bind(this))
      .onConnect(peer => {
        peer.send('blockinv', this.tip.summary)
        peer.send('txinv', { txids: this.transactionPool.keys() })
      })

    console.log(`Node started on port ${port}`)
  }

  public async mineAsync(data: Uint8Array): Promise<Block | null> {
    if (this.mining?.isNotFinish()) {
      return this.mining.then(v => v)
    }

    const newBlock = this.generateBlock(data)
    this.mining = newBlock.mine()
    this.tryAccept(await this.mining)
    return await this.mining
  }

  public submitMine(data: Uint8Array): BlockMiner {
    if (this.mining?.isNotFinish()) {
      return this.mining
    }

    const newBlock = this.generateBlock(data)
    this.mining = newBlock.mine()

    this.mining?.then(minedBlock => {
      this.tryAccept(minedBlock)
    })

    return this.mining!
  }

  public send(to: Uint8Array, amount: number): { tx: Transaction, fees: number } {
    const uTxOuts: UTxOut[] =
      this.uTxOuts
        .filter(UTxOutSet.accountFilter(this.account.publicKey))
        .filter(UTxOutSet.excludePendingTxIns(this.transactionPool))
        .sort((a, b) => (a.output.amount || 0) - (b.output.amount || 0))

    const total = uTxOuts.reduce((sum, uTxOut) => sum + (uTxOut.output.amount || 0), 0)
    if (total < amount) {
      throw new Error('Insufficient balance')
    }

    const willSpend: UTxOut[] = []
    let inputValue = 0
    for (const uTxOut of uTxOuts) {
      willSpend.push(uTxOut)
      inputValue += (uTxOut.output.amount || 0)
      if (inputValue >= amount) {
        break
      }
    }
    const unspent = uTxOuts.filter(uTxOut => !willSpend.includes(uTxOut))

    const tx = new Transaction()
    for (const uTxOut of willSpend) {
      tx.addInput(new TxIn(uTxOut.txid, uTxOut.index))
    }
    tx.addOutput(new TxOut(amount, to))

    // change
    let changeOutput: TxOut | null = null
    if (inputValue > amount) {
      changeOutput = new TxOut(inputValue - amount, this.account.publicKey)
      tx.addOutput(changeOutput)
    }

    const fees = tx.bytesLength() * MIN_TX_FEES_EVERY_BYTE
    if (total < amount + fees) {
      throw new Error(`Insufficient balance to cover transaction fees, need at least ${fees} sats more`)
    }

    if (!this.trySetFees(tx, changeOutput)) {
      if (!changeOutput) {
        changeOutput = new TxOut(0, this.account.publicKey)
        tx.addOutput(changeOutput)
      }

      while (!this.trySetFees(tx, changeOutput)) {
        const utxo = unspent.shift()
        if (utxo == null) {
          throw new Error('Insufficient balance to cover transaction fees')
        }

        tx.addInput(new TxIn(utxo.txid, utxo.index))
        changeOutput.amount += utxo.output.amount
      }
    }

    // sign all inputs
    for (let i = 0; i < tx.inputs.length; i++) {
      this.account.signTxIn(tx, i)
    }

    this.transactionPool.add({ tx, fees: this.getTxInAmount(tx) - tx.outputValue })
    this.server.broadcast({ type: 'txinv', data: { txids: [hex(tx.id)] } })

    return { tx, fees }
  }

  private trySetFees(tx: Transaction, changeOutput: TxOut | null): boolean {
    const totalIn = this.getTxInAmount(tx)
    const totalOut = tx.outputValue
    const minFees = tx.bytesLength() * MIN_TX_FEES_EVERY_BYTE
    if (totalIn === totalOut + minFees) {
      return true
    }
    if (!changeOutput) {
      return false
    }

    if (changeOutput.amount < minFees) {
      return false
    }

    changeOutput.amount -= minFees
    return true
  }

  public getBalance(pubkey?: Uint8Array): number {
    return this.uTxOuts.getBalance(pubkey || this.account.publicKey)
  }

  public getUnspentOutputs(pubkey?: Uint8Array): UTxOut[] {
    return this.uTxOuts.filter(UTxOutSet.accountFilter(pubkey || this.account.publicKey))
  }

  private generateBlock(data?: Uint8Array): Block {
    const block = this.tip.generate({ difficulty: this.getCurrentDifficulty() })
    const orderedTxs = this.transactionPool.orderByFeesDesc()
    const coinbase = Transaction.buildCoinbaseTx(
      this.account.publicKey,
      0,
      block.height,
      data
    )

    // select transactions & calculate coinbase reward
    const selectedTxs = Block.selectTransactions(orderedTxs.map(pendingTx => pendingTx.tx), coinbase.bytesLength())
    const txFees = this.calculateTotalFees(selectedTxs)
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

  private calculateTotalFees(transactionPool: Transaction[]): number {
    return transactionPool.reduce((total, tx) => total + this.getTxInAmount(tx) - tx.outputValue, 0)
  }

  private getTxInAmount(tx: Transaction) {
    return tx.inputs.reduce((total, input) => {
      const uTxOut = this.uTxOuts.get(input)
      if (!uTxOut) {
        throw new Error('Transaction input UTxOut not found when calculating transaction fees')
      }

      return total + (uTxOut ? uTxOut.output.amount || 0 : 0)
    }, 0)
  }

  private tryAccept(minedBlock: Block | null) {
    if (!minedBlock) return
    this.onNewBlock(minedBlock)
  }

  private getExpectedDifficulty(prev: Block, lastDuration: number): number {
    if (prev.height % DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS !== 0) {
      return prev.difficulty
    }

    const expected = BLOCK_GENERATION_TARGET_IN_MILLS * DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS

    if (lastDuration < expected / 2) {
      return Math.min(prev.difficulty + 1, 2 << 7)
    }
    if (lastDuration > expected * 2) {
      return Math.max(prev.difficulty - 1, 1)
    }
    return prev.difficulty
  }

  private getCurrentDifficulty(): number {
    if (this.tip.height % DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS !== 0) {
      return this.tip.difficulty
    }

    const end = this.tip.ts
    const start = this.top(9).ts
    const duration = end - start
    const expected = BLOCK_GENERATION_TARGET_IN_MILLS * DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS

    if (duration < expected / 2) {
      return Math.min(this.tip.difficulty + 1, 2 << 7)
    }
    if (duration > expected * 2) {
      return Math.max(this.tip.difficulty - 1, 1)
    }
    return this.tip.difficulty
  }

  private top(n: number): Block {
    let block = this.tip
    for (let i = 0; i < n; i++) {
      const prev = this.blocks.get(hex(block.prev))
      if (prev == null) {
        return block
      }
      block = prev
    }

    return block
  }

  public async addPeer(address: string): Promise<boolean> {
    const socket = await this.server.connect(address)
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
      const blocks = {}
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
      const blocks = {}
      for (const hash in hash2Block) {
        blocks[hash] = Block.deserialize(hexBytes(hash2Block[hash]))
      }
      return blocks
    }
    return {}
  }

  private async onNewBlock(block: Block): Promise<void> {
    if (this.blocks.get(hex(block.hash())) || this.tip.height > block.height) {
      return
    }

    const orphans = { [hex(block.hash())]: block } as Record<string, Block>

    let prevHash = hex(block.prev)
    const fork = this.blocks.get(prevHash)
    if (!fork) {
      throw new Error('Previous block not found')
    }

    try {
      if (fork.next == null) {
        this.validateNewBlocksAndUpdateUTxOuts(orphans, block, block)
      } else {
        this.validateDifficulty(fork.next, orphans)
        this.validateAndRecalculateUTxOuts(orphans, block, block)
      }
    } catch {
      // validation failed
      return
    }

    this.mining?.cancel()

    let oldForkNext = fork.next
    fork.connect(block)

    while (oldForkNext) {
      this.blocks.delete(hex(oldForkNext.hash()))
      oldForkNext = oldForkNext.next
    }

    for (const hash in orphans) {
      this.blocks.set(hash, orphans[hash])
    }

    this.tip = block
    this.server.broadcast({ type: 'blockinv', data: block.summary })
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

    const fork = this.blocks.get(hex(block.prev))
    if (!fork) {
      throw new Error('Previous block not found')
    }
    try {
      if (fork.next == null) {
        this.validateNewBlocksAndUpdateUTxOuts(orphans, block, newBlock)
      } else {
        this.validateDifficulty(fork.next, orphans)
        this.validateAndRecalculateUTxOuts(orphans, block, newBlock)
      }
    } catch (err) {
      // validation failed
      console.log('Received invalid block chain from peer: ' + session.peer.address)
      console.error(err)
      return
    }
    this.mining?.cancel()
    let oldForkNext = fork.next
    fork.connect(block)
    while (oldForkNext) {
      this.blocks.delete(hex(oldForkNext.hash()))
      oldForkNext = oldForkNext.next
    }
    for (const hash in orphans) {
      this.blocks.set(hash, orphans[hash])
    }
    this.tip = newBlock
    this.server.broadcast({ type: 'blockinv', data: newBlock.summary })
    if (Object.keys(orphans).length > 1) {
      console.log(`Accepted ${Object.keys(orphans).length} new blocks, cost: ${Date.now() - start}ms`)
    }
  }

  private validateDifficulty(localBlockStart: Block | null, incomingBlocks: Record<string, Block>) {
    if (!localBlockStart) {
      return
    }

    const incomingDifficulty = Object.values(incomingBlocks).reduce((sum, block) => sum + 2 ** block.difficulty, 0)
    const localDifficulty = (() => {
      let total = 0
      for (let block: Block | null = localBlockStart; block != null; block = block.next) {
        total += 2 ** block.difficulty
      }
      return total
    })()

    if (incomingDifficulty >= localDifficulty) {
      return
    }

    throw new Error('Incoming chain has insufficient cumulative difficulty')
  }

  private validateNewBlocksAndUpdateUTxOuts(blocks: Record<string, Block>, start: Block, tip: Block, uTxOutsState?: UTxOutSet) {
    if (tip.ts >= Date.now() + MAX_FUTURE_DRIFT_IN_MILLS) {
      throw new Error('Block timestamp too far in the future')
    }

    const last = (tail: Block, n: number): Block => {
      let block = tail
      for (let i = 0; i < n; i++) {
        const prev = blocks[hex(block.prev)] ?? this.blocks.get(hex(block.prev))
        if (prev == null) {
          return block
        }
        block = prev
      }

      return block
    }

    function mtp(tail: Block): number {
      return last(tail, Math.floor(MEDIAN_TIME_PAST_WINDOW / 2)).ts
    }

    let prev = this.blocks.get(hex(start.prev))
    if (!prev) {
      throw new Error('Previous block not found')
    }

    // utxos copy
    const uTxOuts: UTxOutSet = (uTxOutsState ?? this.uTxOuts).copy()

    // validate blocks
    for (let block: Block | null = start; block != null; block = block.next) {
      const duration = prev.ts - last(block, 10).ts
      const expectedDifficulty = this.getExpectedDifficulty(prev, duration)

      if (prev.isInvalidNext(block, expectedDifficulty, mtp(prev))) {
        throw new Error('Invalid block sequence or proof')
      }

      // validate transactions
      let totalFee = 0
      for (let tx of block.transactions) {
        // assert tx inputs all refer to unspent outputs
        const referencedUTxOuts: (UTxOut | undefined)[] = tx.inputs.map(input => uTxOuts.get(input))
        if (referencedUTxOuts.includes(undefined)) {
          throw new Error('Transaction input UTxOut not found')
        }

        // assert total input >= total output
        const totalIn = referencedUTxOuts.reduce((sum, uTxOut) => sum + (uTxOut!.output.amount || 0), 0)
        const totalOut = tx.outputs.reduce((sum, output) => sum + output.amount, 0)
        if (totalIn < totalOut) {
          throw new Error('Transaction outputs exceed inputs')
        }

        // verify all input signatures
        for (let i = 0; i < tx.inputs.length; i++) {
          const input = tx.inputs[i]
          if (!input.signed()) {
            throw new Error('Transaction input not signed')
          }
          if (!Account.verifyTxIn(tx, i, referencedUTxOuts[i]!.output.publicKey)) {
            throw new Error('Transaction input signature invalid')
          }
        }

        // verify transaction fees
        const txBytes = tx.bytesLength()
        const minFees = txBytes * MIN_TX_FEES_EVERY_BYTE
        if (totalIn - totalOut < minFees) {
          throw new Error('Transaction fees too low')
        }

        // update UTxOuts
        referencedUTxOuts.forEach(uTxOut => uTxOuts.remove(uTxOut!))
        UTxOut.fromTransaction(block.hash(), tx).forEach(uTxOut => uTxOuts.add(uTxOut))

        totalFee += (totalIn - totalOut)
      }

      // validate coinbase transaction
      const coinbase = block.coinbase
      if (coinbase.inputs.length !== 1 || coinbase.inputs[0].index !== block.height || coinbase.outputs.length !== 1) {
        throw new Error('Invalid coinbase transaction')
      }

      const maxCoinbaseOut = this.getCoinbaseRewardAtHeight(block.height) + totalFee
      if (coinbase.outputs[0].amount > maxCoinbaseOut) {
        throw new Error('Coinbase transaction output exceeds maximum')
      }

      // update UTxOuts for coinbase
      UTxOut.fromTransaction(block.hash(), coinbase).forEach(uTxOut => uTxOuts.add(uTxOut))

      prev = block
    }

    // all valid, commit UTxOuts
    this.uTxOuts = uTxOuts

    // update transaction pool
    for (let pendingTx of this.transactionPool.getAll()) {
      for (let input of pendingTx.tx.inputs) {
        if (this.uTxOuts.get(input) === undefined) {
          this.transactionPool.remove(hex(pendingTx.tx.id))
          break
        }
      }
    }
  }

  private getCoinbaseRewardAtHeight(height: number): number {
    return Math.floor(COINBASE_REWARD / (2 ** Math.floor(height / REWARD_HALVING_EVERY_BLOCKS)))
  }

  /**
   * Recalculate UTxOuts from genesis to fork, then validate new chain from start to tip
   * This is very inefficient, the best way is to rollback UTxOuts from tip to fork, but it's complex to implement, so make it work first
   */
  private validateAndRecalculateUTxOuts(blocks: Record<string, Block>, start: Block, tip: Block) {
    // recalculate UTxOuts from genesis to fork
    const fork = this.blocks.get(hex(start.prev))
    if (!fork) {
      throw new Error('Previous block not found')
    }

    const uTxOuts: { [txidAndOutIndex: string]: UTxOut } = {}
    const uTxOutId = (input: TxIn | UTxOut) => `${input.txid}:${input.index}`

    for (let block: Block | null = Block.deserialize(Block.GENESIS_BLOCK); block != null && block !== fork.next; block = block.next) {
      for (let tx of block.transactions) {
        const referencedUTxOuts: (UTxOut | undefined)[] = tx.inputs.map(input => uTxOuts[uTxOutId(input)])
        if (referencedUTxOuts.includes(undefined)) {
          throw new Error('Transaction input UTxOut not found during recalculation')
        }

        referencedUTxOuts.forEach(uTxOut => delete uTxOuts[uTxOutId(uTxOut!)])
        UTxOut.fromTransaction(block.hash(), tx).forEach(uTxOut => uTxOuts[uTxOutId(uTxOut)] = uTxOut)
      }
    }

    // validate new blocks and update UTxOuts
    this.validateNewBlocksAndUpdateUTxOuts(blocks, start, tip, new UTxOutSet(Object.values(uTxOuts)))
  }

  private async getBlock(session: Session): Promise<void> {
    const { hash: hashes, frontier, batch } = session.data ?? {}

    if (Array.isArray(hashes)) {
      const serializedBlocks = {}
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

        // assert tx inputs all refer to unspent outputs
        const referencedUTxOuts: (UTxOut | undefined)[] = incomingTx.inputs.map(input => this.uTxOuts.get(input))
        if (referencedUTxOuts.includes(undefined)) {
          throw new Error('Transaction input UTxOut not found')
        }

        // assert total input >= total output
        const totalIn = referencedUTxOuts.reduce((sum, uTxOut) => sum + (uTxOut!.output.amount || 0), 0)
        const totalOut = incomingTx.outputs.reduce((sum, output) => sum + output.amount, 0)
        if (totalIn < totalOut) {
          throw new Error('Transaction outputs exceed inputs')
        }
        // transaction fees validation
        const txBytes = incomingTx.serialize().length
        const minFees = txBytes * MIN_TX_FEES_EVERY_BYTE
        if (totalIn - totalOut < minFees) {
          throw new Error('Transaction fees too low')
        }

        // verify all input signatures
        for (let i = 0; i < incomingTx.inputs.length; i++) {
          const input = incomingTx.inputs[i]
          if (!input.signed()) {
            throw new Error('Transaction input not signed')
          }
          if (!Account.verifyTxIn(incomingTx, i, referencedUTxOuts[i]!.output.publicKey)) {
            throw new Error('Transaction input signature invalid')
          }
        }

        for (let pendingTx of this.transactionPool.getAll()) {
          for (let input of pendingTx.tx.inputs) {
            if (incomingTx.inputs.some(i => i.index === input.index && Buffer.from(i.txid).equals(Buffer.from(input.txid)))) {
              throw new Error('Transaction input already in pool')
            }
          }
        }


        this.transactionPool.add({ tx: incomingTx, fees: totalIn - totalOut })
        validTxIds.add(hex(incomingTx.id))
      } catch (e) {
        console.error('Received invalid transaction from peer: ' + session.peer.address)
        console.error(e)
      }
    }
    if (validTxIds.size > 0) {
      this.server.broadcast({ type: 'txinv', data: { txids: Array.from(validTxIds) } })
    }
  }
}

function isValidStringStringMap(rawResponse: any): rawResponse is Record<string, string> {
  return typeof rawResponse === 'object' && rawResponse !== null
    && Object.values(rawResponse).every(value => typeof value === 'string')
    && Object.keys(rawResponse).every(key => typeof key === 'string')
}
