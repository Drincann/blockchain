import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Node } from "../src/infra/node/node.mts"
import { Account } from "../src/domain/transaction/account.mts"
import { Block } from "../src/domain/block/block.mts"
import { Transaction, TxIn, TxOut } from "../src/domain/transaction/transaction.mts"
import { UTxOut } from "../src/domain/transaction/utxo.mts"
import { COINBASE_REWARD } from "../src/app/config.mts"

describe("security: duplicate transaction inputs", () => {
  let node: Node | undefined

  afterEach(() => {
    node?.stop()
    node = undefined
  })

  it("rejects a block containing a transaction that spends the same UTXO twice", async () => {
    const attacker = new Account()
    const receiver = new Account()
    node = new Node()
    node.importAccount(attacker)
    node.start(0)

    const fundingBlock = await node.mineAsync(new TextEncoder().encode("fund attacker"))
    assert.ok(fundingBlock)

    const spendable = node.getUnspentOutputs(attacker.publicKey)[0]
    assert.ok(spendable)

    const maliciousTx = buildDuplicateInputTransaction(attacker, receiver, spendable)
    const maliciousBlock = await mineBlockWithTransactions(node, attacker, [maliciousTx])

    await node["onNewBlock"](maliciousBlock)

    assert.notEqual(
      node.current.hash(),
      maliciousBlock.hash(),
      "node must not accept a block that counts one UTXO more than once"
    )
    assert.equal(node.getBalance(receiver.publicKey), 0)
  })
})

function buildDuplicateInputTransaction(attacker: Account, receiver: Account, spendable: UTxOut): Transaction {
  const tx = new Transaction()
    .addInput(new TxIn(spendable.txid, spendable.index))
    .addInput(new TxIn(spendable.txid, spendable.index))
    .addOutput(new TxOut(spendable.output.amount + 1, receiver.publicKey))

  attacker.signTxIn(tx, 0)
  attacker.signTxIn(tx, 1)
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
