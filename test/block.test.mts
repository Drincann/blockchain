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
})

