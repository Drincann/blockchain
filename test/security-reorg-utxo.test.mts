import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Node } from "../src/infra/node/node.mts"
import { Account } from "../src/domain/transaction/account.mts"
import { Block } from "../src/domain/block/block.mts"
import { Transaction } from "../src/domain/transaction/transaction.mts"
import { COINBASE_REWARD } from "../src/app/config.mts"

describe("security: reorg UTXO recalculation", () => {
  let node: Node | undefined

  afterEach(() => {
    node?.stop()
    node = undefined
  })

  it("preserves UTXOs before the fork point when replacing a branch", async () => {
    const miner = new Account()
    node = new Node()
    node.importAccount(miner)
    node.start(0)

    const sharedBlock = await node.mineAsync(new TextEncoder().encode("shared"))
    assert.ok(sharedBlock)

    const replacedBlock = await node.mineAsync(new TextEncoder().encode("replaced"))
    assert.ok(replacedBlock)
    assert.equal(node.getBalance(miner.publicKey), COINBASE_REWARD * 2)

    const replacementBlock = await mineChildBlock(sharedBlock, miner, "replacement")
    await node["onNewBlock"](replacementBlock)

    assert.deepEqual(node.current.hash(), replacementBlock.hash())
    assert.equal(
      node.getBalance(miner.publicKey),
      COINBASE_REWARD * 2,
      "reorg must keep the shared pre-fork coinbase UTXO and add the replacement block coinbase"
    )
  })
})

async function mineChildBlock(prev: Block, miner: Account, data: string): Promise<Block> {
  const block = prev.generate({ difficulty: prev.difficulty })
  const coinbase = Transaction.buildCoinbaseTx(
    miner.publicKey,
    COINBASE_REWARD,
    block.height,
    new TextEncoder().encode(data)
  )

  assert.equal(block.addTransaction(coinbase), true)
  const mined = await block.mine()
  assert.ok(mined)
  return mined
}
