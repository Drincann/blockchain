import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Node } from "../src/infra/node/node.mts"
import { Account } from "../src/domain/transaction/account.mts"
import { Block } from "../src/domain/block/block.mts"
import { Transaction, TxIn, TxOut } from "../src/domain/transaction/transaction.mts"
import { UTxOut } from "../src/domain/transaction/utxo.mts"
import { COINBASE_REWARD } from "../src/app/config.mts"

describe("security: transaction shape validation", () => {
  let node: Node | undefined

  afterEach(() => {
    node?.stop()
    node = undefined
  })

  it("rejects a block containing a transaction output with an invalid public key encoding", async () => {
    const sender = new Account()
    node = new Node()
    node.importAccount(sender)
    node.start(0)

    const fundingBlock = await node.mineAsync(new TextEncoder().encode("fund sender"))
    assert.ok(fundingBlock)

    const spendable = node.getUnspentOutputs(sender.publicKey)[0]
    assert.ok(spendable)

    const invalidPublicKey = new Uint8Array(65)
    const tx = buildTransactionToInvalidPublicKey(sender, spendable, invalidPublicKey)
    const block = await mineBlockWithTransactions(node, sender, [tx])

    await node["onNewBlock"](block)

    assert.notDeepEqual(node.current.hash(), block.hash())
    assert.equal(node.getBalance(invalidPublicKey), 0)
  })
})

function buildTransactionToInvalidPublicKey(sender: Account, spendable: UTxOut, invalidPublicKey: Uint8Array): Transaction {
  const tx = new Transaction()
    .addInput(new TxIn(spendable.txid, spendable.index))
    .addOutput(new TxOut(spendable.output.amount - 1_000, invalidPublicKey))

  sender.signTxIn(tx, 0)
  return tx
}

async function mineBlockWithTransactions(node: Node, miner: Account, transactions: Transaction[]): Promise<Block> {
  const block = node.current.generate({ difficulty: node["getCurrentDifficulty"]() })
  const coinbase = Transaction.buildCoinbaseTx(miner.publicKey, COINBASE_REWARD, block.height)

  assert.equal(block.addTransaction(coinbase), true)
  for (const tx of transactions) {
    assert.equal(block.addTransaction(tx), true)
  }

  const mined = await block.mine()
  assert.ok(mined)
  return mined
}
