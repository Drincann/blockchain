import { bitString, hex, hexBytes, sha256 } from "./util/crypto.mts"
import { config } from "./config.mts"
import { BlockMiner } from "./lib/miner.mts"

export type Hash = Uint8Array

/**
 * serialization:
 * 0-7 height (big-endian 64-bit integer)
 * 8-15 ts (big-endian 64-bit integer)
 * 16-47 prev (32 bytes sha256 hash)
 * 48-48 difficulty (8-bit integer)
 * 49-80 nonce (32 bytes random nonce)
 * 81-max(81, DATA_LENGTH) data (variable length data)
 */
export interface BlockData {
  height: number
  ts: number
  prev: Hash
  difficulty: number
  nonce: Uint8Array
  data: Uint8Array
}

export interface BlockDisplay {
  height: number
  ts: number
  prev: string
  difficulty: number
  nonce: string
  dataHex: string
  dataUtf8: string
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
    data: new Uint8Array([
      84, 104, 101, 32, 84, 105, 109, 101,
      115, 32, 48, 51, 47, 74, 97, 110,
      47, 50, 48, 48, 57, 32, 67, 104,
      97, 110, 99, 101, 108, 108, 111, 114,
      32, 111, 110, 32, 98, 114, 105, 110,
      107, 32, 111, 102, 32, 115, 101, 99,
      111, 110, 100, 32, 98, 97, 105, 108,
      111, 117, 116, 32, 102, 111, 114, 32,
      98, 97, 110, 107, 115
    ])
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
      dataHex: hex(this.data),
      dataUtf8: new TextDecoder().decode(this.data)
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

  get data(): Uint8Array {
    return this.block.data
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

  public generate({ difficulty, data }: { difficulty: number, data?: Uint8Array }) {
    const block = new Block({
      height: this.block.height + 1,
      ts: Date.now(),
      prev: this.hash(),
      difficulty,
      nonce: new Uint8Array(32),
      data: data ?? new Uint8Array()
    })
    if (this.isValidNext(block)) {
      return block
    }
    throw new Error('Invalid next block')
  }

  public mine(): BlockMiner {
    return new BlockMiner(this)
  }

  public setNonce(nonce: Uint8Array) {
    this.block.nonce = nonce
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

  public isInvalidNext(next: Block): boolean {
    return !this.isValidNext(next)
  }

  public isValidNext(next: Block): boolean {
    if (next.height !== this.height + 1) {
      return false
    }

    if (next.ts < this.ts) {
      return false
    }

    if (next.data.length > config.maxDataBytes) {
      return false
    }

    if (!byteseq(next.prev, this.hash())) {
      return false
    }

    return true
  }

  public static deserialize(bytes: Uint8Array): Block {
    try {
      if (bytes.length < 48) {
        throw new Error('Data must be at least 48 bytes long');
      }

      const height = new DataView(bytes.buffer, 0, 8).getBigUint64(0, false);
      const ts = new DataView(bytes.buffer, 8, 8).getBigUint64(0, false);
      const prev = bytes.slice(16, 48);
      const difficulty = new DataView(bytes.buffer, 48, 1).getUint8(0);
      const nonce = bytes.slice(49, 81);
      const data = bytes.slice(81)

      return new Block({
        height: Number(height),
        ts: Number(ts),
        prev: prev,
        difficulty: difficulty,
        nonce: nonce,
        data: data
      });
    } catch (error) {
      console.error('Failed to deserialize block:', error);
      throw error
    }
  }

  public static serialize(block: Block | BlockData): Uint8Array {
    const heightBuffer = new Uint8Array(8)
    new DataView(heightBuffer.buffer).setBigUint64(0, BigInt(block.height), false);

    const tsBuffer = new Uint8Array(8)
    new DataView(tsBuffer.buffer).setBigUint64(0, BigInt(block.ts), false);

    const prevBuffer = block.prev

    const difficultyBuffer = new Uint8Array(1)
    difficultyBuffer[0] = block.difficulty

    const nonceBuffer = block.nonce

    const dataBuffer = block.data

    return new Uint8Array([...heightBuffer, ...tsBuffer, ...prevBuffer, ...difficultyBuffer, ...nonceBuffer, ...dataBuffer]);
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