import { MAX_BLOCK_TX_BYTES, MAX_FUTURE_DRIFT_IN_MILLS } from "../src/app/config.mts"
import { Transaction, TxOut } from "../src/domain/transaction/transaction.mts"
import { describe, it } from "node:test"
import assert from 'node:assert/strict'
import { Block } from "../src/domain/block/block.mts"
import { hex } from "../src/util/crypto.mts"

describe('Block', () => {
  it('genesis block', () => {
    const genesisBlock = Block.deserialize(Block.GENESIS_BLOCK)
    // console.log(`genesis block: (sha256) ${hex(genesisBlock.hash())}`)
    // console.log(`genesis block: (prev sha256) ${hex(genesisBlock.prev)}`)
    // console.log(`genesis block: (ts) ${new Date(genesisBlock.ts)}`)
    // console.log(`genesis block: (difficulty) ${genesisBlock.difficulty}`)
    // console.log(`genesis block: (nonce) ${hex(genesisBlock.nonce)}`)
    // console.log(`genesis block: (data) ${new TextDecoder().decode(genesisBlock.data)}`)
    assert.equal(hex(genesisBlock.hash()), '53b57bb9620f24dec002a412ee1daec97304001eef934429c7ed5369b9955c05')
    assert.deepStrictEqual(genesisBlock.prev, new Uint8Array(32).fill(0))
    assert.equal(genesisBlock.ts, 1749376247272)
    assert.equal(genesisBlock.difficulty, 1)
    assert.equal(hex(genesisBlock.nonce), '125c95cf5a41e63f6c1400cf6bbc14bc376bde4b8ac4e7fa3f071b7f0f7a592e')
    assert.equal(new TextDecoder().decode(genesisBlock.coinbase.inputs[0].signature), 'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks\x00\x00\x00')
  })

  it('serialize/deserialize', () => {
    const genesisBlock = Block.deserialize(Block.GENESIS_BLOCK)
    const serialized = genesisBlock.serialize()
    const deserialized = Block.deserialize(serialized)
    assert.equal(hex(deserialized.hash()), hex(genesisBlock.hash()))
    assert.equal(deserialized.height, genesisBlock.height)
    assert.equal(deserialized.ts, genesisBlock.ts)
    assert.deepStrictEqual(deserialized.prev, genesisBlock.prev)
    assert.equal(deserialized.difficulty, genesisBlock.difficulty)
    assert.equal(hex(deserialized.nonce), hex(genesisBlock.nonce))
    assert.equal(hex(deserialized.rawTxs), hex(genesisBlock.rawTxs))
  })
  it('reads block headers from a sliced buffer', () => {
    const bytes = Buffer.concat([Buffer.alloc(13), Block.GENESIS_BLOCK]).subarray(13)
    const decoded = Block.deserialize(bytes)
    assert.equal(hex(decoded.hash()), hex(Block.GENESIS_BLOCK_HASH))
    assert.ok(decoded.equals(Block.deserialize(Block.GENESIS_BLOCK)))
  })

  it('keeps smaller transactions and accepts an exact fit', () => {
    const small = new Transaction().addOutput(new TxOut(1, new Uint8Array(65)))
    const large = new Transaction().addOutput(small.outputs[0]).addOutput(small.outputs[0])
    const reserved = MAX_BLOCK_TX_BYTES - small.bytesLength()
    assert.deepEqual(Block.selectTransactions([large, small], reserved), [small])
  })

  it('displays coinbase text beginning with a DER prefix in full', () => {
    const text = '0 this mining note should be visible in full'
    const block = Block.deserialize(Block.GENESIS_BLOCK).generate({ difficulty: 1 })
    block.addTransaction(Transaction.buildCoinbaseTx(new Uint8Array(65), 1, 1, Buffer.from(text)))
    assert.equal(Block.deserialize(block.serialize()).display().coinbase.data, text)
  })

  it('uses the median of the most recent timestamps, including short histories', () => {
    const times = [25, 21, 30, 27, 22, 29, 23, 20, 26, 24, 28, 1]
    assert.equal(Block.medianTimePast(times), 25)
    assert.equal(Block.medianTimePast([10, 20]), 20)
  })

  it('checks the future limit on each parent-child pair', () => {
    const parent = Block.deserialize(Block.GENESIS_BLOCK)
    const child = parent.generate({ difficulty: 0 })
    assert.ok(parent.isValidNext(child, 0, parent.ts))
    child.setTs(Date.now() + MAX_FUTURE_DRIFT_IN_MILLS + 1000)
    assert.ok(parent.isInvalidNext(child, 0, parent.ts))
  })

})

