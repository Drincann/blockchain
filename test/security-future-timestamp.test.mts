import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { Node } from "../src/infra/node/node.mts"
import { Account } from "../src/domain/transaction/account.mts"
import { Block } from "../src/domain/block/block.mts"
import { Transaction } from "../src/domain/transaction/transaction.mts"
import { COINBASE_REWARD, MAX_FUTURE_DRIFT_IN_MILLS } from "../src/app/config.mts"
import { hex } from "../src/util/crypto.mts"

describe("security: block timestamps", () => {
  it("rejects a downloaded chain when any intermediate block is too far in the future", () => {
    const node = new Node()
    const miner = new Account()
    const futureBlock = buildChildBlock(
      node.current,
      miner,
      Date.now() + MAX_FUTURE_DRIFT_IN_MILLS + 60_000,
      "future",
      node["getCurrentDifficulty"]()
    )
    const normalTip = buildChildBlock(futureBlock, miner, Date.now(), "normal tip", futureBlock.difficulty)
    futureBlock.connect(normalTip)
    const downloadedBlocks = {
      [hex(futureBlock.hash())]: futureBlock,
      [hex(normalTip.hash())]: normalTip
    }

    assert.throws(
      () => node["validateNewBlocksAndUpdateUTxOuts"](downloadedBlocks, futureBlock, normalTip),
      /future/i
    )
  })
})

function buildChildBlock(prev: Block, miner: Account, ts: number, data: string, difficulty: number): Block {
  const block = prev.generate({ difficulty })
  const coinbase = Transaction.buildCoinbaseTx(
    miner.publicKey,
    COINBASE_REWARD,
    block.height,
    new TextEncoder().encode(data)
  )

  assert.equal(block.addTransaction(coinbase), true)
  block.setTs(ts)
  mineWithFixedTimestamp(block)
  return block
}

function mineWithFixedTimestamp(block: Block): void {
  while (block.isProofInvalid()) {
    block.setNonce(randomBytes(32))
  }
}
