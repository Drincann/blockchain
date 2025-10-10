import { bitString, hex, hexBytes, sha256 } from "./util/crypto.mts"
import { config } from "./config.mts"
import { BlockMiner } from "./lib/miner.mts"
import { Transaction } from "./lib/transaction/transaction.mts"

export type Hash = Uint8Array

/**
 * serialization:
 * 0-7 height (big-endian 64-bit integer)
 * 8-15 ts (big-endian 64-bit integer)
 * 16-47 prev (32 bytes sha256 hash)
 * 48-48 difficulty (8-bit integer)
 * 49-80 nonce (32 bytes random nonce)
 * 81-max(81, TXS_LENGTH) txs (variable length data)
 */
export interface BlockData {
  height: number
  ts: number
  prev: Hash
  difficulty: number
  nonce: Uint8Array
  txs: Uint8Array
}

export interface BlockDisplay {
  height: number
  ts: number
  prev: string
  difficulty: number
  nonce: string
  coinbase: {
    reward: number
    to: string
    data: string
  }
  txCount: number
}

export interface BlockSummary {
  hash: string
  height: number
}

export class Block {
  static isValidBlockSummary(blockSummary: unknown): blockSummary is BlockSummary {
    if (typeof blockSummary !== 'object' || blockSummary === null) {
      return false
    }
    const { hash, height } = blockSummary as BlockSummary
    return typeof hash === 'string' && typeof height === 'number'
  }

  public next: Block | null = null

  public static readonly GENESIS_BLOCK: Uint8Array = Block.serialize({
    height: 0,
    ts: 1749376247272,
    prev: new Uint8Array(32),
    difficulty: 1,
    nonce: hexBytes('125c95cf5a41e63f6c1400cf6bbc14bc376bde4b8ac4e7fa3f071b7f0f7a592e'),
    txs: Transaction.buildCoinbaseTx(
      hexBytes('040581ea37c8e191bc9c5c80965a91818ff6e6a93e493747ffba467b4d6a7ad4e5cd17c0b4da99eebed5c9182fa66edb3c7a1dfea6f8c68b5887702a52c504f4de'),
      5_000_000_000,
      0,
      new TextEncoder().encode(
        'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks'
      )
    ).serialize()
  })

  public static readonly GENESIS_BLOCK_HASH: Hash = sha256(Block.GENESIS_BLOCK)

  public constructor(private readonly block: BlockData) { }

  public display(): BlockDisplay {
    return {
      height: this.height,
      ts: this.ts,
      prev: hex(this.prev),
      difficulty: this.block.difficulty,
      nonce: hex(this.block.nonce),
      coinbase: {
        reward: this.coinbase.outputValue,
        to: hex(this.coinbase.outputs[0].publicKey),
        data: Buffer.from(removeSuffix0(this.coinbase.inputs[0].signature)).toString('utf8')
      },
      txCount: this.transactions.length
    }
  }

  get height(): number {
    return this.block.height
  }

  get ts(): number {
    return this.block.ts
  }

  get prev(): Hash {
    return this.block.prev
  }

  get difficulty(): number {
    return this.block.difficulty
  }

  get nonce(): Uint8Array {
    return this.block.nonce
  }

  get txs(): Uint8Array {
    return this.block.txs
  }

  get rawTxs(): Uint8Array {
    return this.block.txs
  }

  get transactions(): Transaction[] {
    return Transaction.deserializeMany(this.txs).slice(1)
  }

  get coinbase(): Transaction {
    return Transaction.deserializeMany(this.txs)[0]
  }

  get summary(): BlockSummary {
    return {
      hash: hex(this.hash()),
      height: this.height
    }
  }

  public equals(other: Block): boolean {
    return byteseq(this.hash(), other.hash())
  }

  public hash(): Hash {
    return sha256(Block.serialize(this.block));
  }

  public serialize(): Uint8Array {
    return Block.serialize(this.block);
  }

  public generate({ difficulty }: { difficulty: number }): Block {
    return new Block({
      height: this.block.height + 1,
      ts: Date.now(),
      prev: this.hash(),
      difficulty,
      nonce: new Uint8Array(32),
      txs: new Uint8Array()
    })
  }

  public mine(): BlockMiner {
    return new BlockMiner(this)
  }

  public setNonce(nonce: Uint8Array) {
    this.block.nonce = nonce
  }

  public setTs(ts: number) {
    this.block.ts = ts
  }

  public isProofInvalid(): boolean {
    return !this.isProofValid()
  }

  public isProofValid(): boolean {
    return [...bitString(this.hash()).slice(0, this.block.difficulty)].every(b => b === '0')
  }

  public connect(next: Block) {
    this.next = next
  }

  public isInvalidNext(next: Block, difficulty: number, mtp: number): boolean {
    return !this.isValidNext(next, difficulty, mtp)
  }

  public isValidNext(next: Block, difficulty: number, mtp: number): boolean {
    if (next.height !== this.height + 1) {
      return false
    }

    if (next.ts < mtp) {
      return false
    }

    if (next.difficulty !== difficulty) {
      return false
    }

    if (this.isProofInvalid()) {
      return false
    }

    if (next.txs.length > config.maxDataBytes) {
      return false
    }

    if (!byteseq(next.prev, this.hash())) {
      return false
    }

    return true
  }

  /**
   * Add a transaction to the block
   * @param tx transaction to add
   * @returns true if added, false if block is full
   */
  public addTransaction(tx: Transaction): boolean {
    const newTx = tx.serialize()
    const newTxs = new Uint8Array(this.txs.length + newTx.length)
    newTxs.set(this.txs, 0)
    newTxs.set(newTx, this.txs.length)
    if (newTxs.length > config.maxDataBytes) {
      return false
    }

    this.block.txs = newTxs
    return true
  }

  public static deserialize(bytes: Uint8Array): Block {
    try {
      if (bytes.length < 48) {
        throw new Error('Data must be at least 48 bytes long')
      }

      const height = new DataView(bytes.buffer, 0, 8).getBigUint64(0, false)
      const ts = new DataView(bytes.buffer, 8, 8).getBigUint64(0, false)
      const prev = bytes.slice(16, 48)
      const difficulty = new DataView(bytes.buffer, 48, 1).getUint8(0)
      const nonce = bytes.slice(49, 81)
      const txs = bytes.slice(81)

      return new Block({
        height: Number(height),
        ts: Number(ts),
        prev: prev,
        difficulty: difficulty,
        nonce: nonce,
        txs: txs
      });
    } catch (error) {
      console.error('Failed to deserialize block:', error)
      throw error
    }
  }

  public static serialize(block: Block | BlockData): Uint8Array {
    const heightBuffer = new Uint8Array(8)
    new DataView(heightBuffer.buffer).setBigUint64(0, BigInt(block.height), false)

    const tsBuffer = new Uint8Array(8)
    new DataView(tsBuffer.buffer).setBigUint64(0, BigInt(block.ts), false)

    const prevBuffer = block.prev

    const difficultyBuffer = new Uint8Array(1)
    difficultyBuffer[0] = block.difficulty

    const nonceBuffer = block.nonce

    const txsBuffer = block.txs

    return new Uint8Array([...heightBuffer, ...tsBuffer, ...prevBuffer, ...difficultyBuffer, ...nonceBuffer, ...txsBuffer]);
  }
}

function byteseq(a?: Uint8Array, b?: Uint8Array) {
  if (a == null || b == null || a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

function removeSuffix0(signature: Uint8Array<ArrayBufferLike> | undefined): any {
  if (!signature) {
    return signature;
  }

  let end = signature.length;
  while (end > 0 && signature[end - 1] === 0x00) {
    end--;
  }
  return signature.slice(0, end);
}
