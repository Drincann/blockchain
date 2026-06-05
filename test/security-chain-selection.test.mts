import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Node } from "../src/infra/node/node.mts"
import { Account } from "../src/domain/transaction/account.mts"
import { Block } from "../src/domain/block/block.mts"
import { Transaction } from "../src/domain/transaction/transaction.mts"
import { COINBASE_REWARD } from "../src/app/config.mts"

describe("security: chain selection", () => {
  let node: Node | undefined

  afterEach(() => {
    node?.stop()
    node = undefined
  })

  it("does not discard a lower-height fork before cumulative work validation", async () => {
    const miner = new Account()
    node = new Node()
    node.importAccount(miner)
    node.start(0)

    await node.mineAsync(new TextEncoder().encode("local 1"))
    await node.mineAsync(new TextEncoder().encode("local 2"))
    assert.equal(node.current.height, 2)

    const lowerHeightCandidate = await mineChildBlock(
      Block.deserialize(Block.GENESIS_BLOCK),
      miner,
      node["getCurrentDifficulty"]()
    )

    node["validateDifficulty"] = () => undefined
    node["validateAndRecalculateUTxOuts"] = () => undefined

    await node["onNewBlock"](lowerHeightCandidate)

    assert.deepEqual(node.current.hash(), lowerHeightCandidate.hash())
  })
})

async function mineChildBlock(prev: Block, miner: Account, difficulty: number): Promise<Block> {
  const block = prev.generate({ difficulty })
  const coinbase = Transaction.buildCoinbaseTx(miner.publicKey, COINBASE_REWARD, block.height)

  assert.equal(block.addTransaction(coinbase), true)
  const mined = await block.mine()
  assert.ok(mined)
  return mined
}
