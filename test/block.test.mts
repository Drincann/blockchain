import { describe, it } from "node:test"
import assert from 'node:assert/strict'
import { Block } from '../src/block.mts'
import { hex } from "../src/util/crypto.mts"

describe('Block', () => {
  it('genesis block', async () => {
    const genesisBlock = Block.desrialize(Block.GENESIS_BLOCK)
    console.log(`genesis block: (sha256) ${hex(await genesisBlock.hash())}`)
    console.log(`genesis block: (prev sha256) ${hex(genesisBlock.prev)}`)
    console.log(`genesis block: (ts) ${new Date(genesisBlock.ts)}`)
    console.log(`genesis block: (data) ${new TextDecoder().decode(genesisBlock.data)}`)
    assert.equal(hex(await genesisBlock.hash()), '091c83073b570c5865a11ddf73976839d03a85190ca92df33a7364138ec426df')
    assert.deepStrictEqual(genesisBlock.prev, new Uint8Array(32).fill(0))
    assert.equal(genesisBlock.ts, 1749376247272)
    assert.equal(new TextDecoder().decode(genesisBlock.data), 'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks')
  })
})

