import { describe, it } from "node:test"
import assert from 'node:assert/strict'
import { Account } from "../src/domain/transaction/account.mts"
import { hex, hexBytes } from "../src/util/crypto.mts"
import { TxIn, TxOut, Transaction } from "../src/domain/transaction/transaction.mts"
import { TransactionPool } from "../src/infra/node/txpool.mts"
import { UTxOut } from "../src/domain/transaction/utxo.mts"

describe('Transaction', () => {
  describe('Input', () => {
    it('serialize/deserialize', () => {
      const tx = 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8'
      const signature = '3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165'
      const input = new TxIn(tx, 2, hexBytes(signature))
      const serialized = input.serialize()
      // console.log('serialized:', hex(serialized))
      const deserialized = TxIn.deserialize(serialized)
      // console.log('deserialized:', deserialized)

      assert.equal(deserialized.txid, tx, 'tx should match')
      assert.equal(deserialized.index, 2, 'index should match')
      assert.equal(hex(deserialized.signature), signature, 'signature should match')
    })
  })

  describe('Output', () => {
    it('serialize/deserialize', () => {
      const amount = 1234567890
      const publicKey = hexBytes('040d6a02280c79541c23630b267d0507d261c63f08e33cd5718b5461bada15e36314ab898e149a13d21a2e7a9eb99d0cb1291a5878011437cd8588ffc253feea88')
      const output = new TxOut(amount, publicKey)
      const serialized = output.serialize()
      // console.log('serialized:', hex(serialized))
      const deserialized = TxOut.deserialize(serialized)
      // console.log('deserialized:', deserialized)

      assert.equal(deserialized.amount, amount, 'amount should match')
      assert.equal(hex(deserialized.publicKey), hex(publicKey), 'public key should match')
    })
  })

  it('serialize/deserialize', () => {
    const sender = new Account()
    const receiver = new Account()
    const inputTx = 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8'
    const inputSignature = '3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165'

    const input1 = new TxIn(inputTx, 0, hexBytes(inputSignature))
    const input2 = new TxIn(inputTx, 1, hexBytes(inputSignature))
    const output1 = new TxOut(100_000_000, receiver.publicKey)
    const change = new TxOut(900_000_000, sender.publicKey)

    const tx = new Transaction().addInput(input1).addInput(input2).addOutput(output1).addOutput(change)
    // console.log('transaction:', tx)

    const serialized = tx.serialize()
    // console.log('serialized:', hex(serialized))

    const deserialized = Transaction.deserialize(serialized)
    // console.log('deserialized:', deserialized)

    assert.equal(deserialized.inputs.length, 2, 'should have 2 inputs')
    assert.equal(deserialized.outputs.length, 2, 'should have 2 outputs')
    assert.equal(deserialized.inputs[0].txid, input1.txid, 'input 1 tx should match')
    assert.equal(deserialized.inputs[0].index, input1.index, 'input 1 index should match')
    assert.equal(hex(deserialized.inputs[0].signature), hex(input1.signature), 'input 1 signature should match')
    assert.equal(deserialized.inputs[1].txid, input2.txid, 'input 2 tx should match')
    assert.equal(deserialized.inputs[1].index, input2.index, 'input 2 index should match')
    assert.equal(hex(deserialized.inputs[1].signature), hex(input2.signature), 'input 2 signature should match')
    assert.equal(deserialized.outputs[0].amount, output1.amount, 'output 1 amount should match')
    assert.equal(hex(deserialized.outputs[0].publicKey), hex(output1.publicKey), 'output 1 public key should match')
    assert.equal(deserialized.outputs[1].amount, change.amount, 'change amount should match')
    assert.equal(hex(deserialized.outputs[1].publicKey), hex(change.publicKey), 'change public key should match')

    assert.equal(hex(tx.id), hex(deserialized.id), 'transaction hash should match')
  })

  it('length calculation', () => {
    const sender = new Account()
    const receiver = new Account()
    const inputTx = 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8'
    const inputSignature = '3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165'

    const input1 = new TxIn(inputTx, 0, hexBytes(inputSignature))
    const input2 = new TxIn(inputTx, 1, hexBytes(inputSignature))
    const output1 = new TxOut(100_000_000, receiver.publicKey)
    const change = new TxOut(900_000_000, sender.publicKey)

    const tx = new Transaction().addInput(input1).addInput(input2).addOutput(output1).addOutput(change)
    assert.equal(tx.bytesLength(), tx.serialize().length, 'length should match')
  })
})

describe('TransactionPool', () => {
  it('should detect double spending in transaction pool', () => {
    const pool = new TransactionPool()
    const sender = new Account()
    const receiver1 = new Account()
    const receiver2 = new Account()

    // 创建一个 UTXO
    const utxo = new UTxOut({
      blockhash: 'blockhash123',
      txid: 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8',
      index: 0,
      output: new TxOut(100_000_000, sender.publicKey)
    })

    // 创建第一个交易，使用这个 UTXO
    const tx1 = new Transaction()
      .addInput(new TxIn(utxo.txid, utxo.index, hexBytes('3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165')))
      .addOutput(new TxOut(90_000_000, receiver1.publicKey))

    // 将第一个交易添加到池中
    pool.add({ tx: tx1, fees: 10_000_000 })

    // 验证 UTXO 已经被标记为待处理
    assert.ok(pool.has(utxo), 'UTXO should be marked as pending in pool')

    // 创建第二个交易，尝试使用相同的 UTXO（双花）
    const tx2 = new Transaction()
      .addInput(new TxIn(utxo.txid, utxo.index, hexBytes('3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980166')))
      .addOutput(new TxOut(80_000_000, receiver2.publicKey))

    // 验证可以检测到双花
    const isDoubleSpend = tx2.inputs.some(input => {
      const inputUtxo = new UTxOut({
        blockhash: 'blockhash123',
        txid: input.txid,
        index: input.index,
        output: new TxOut(0, new Uint8Array()) // 金额和公钥在这里不重要
      })
      return pool.has(inputUtxo)
    })

    assert.ok(isDoubleSpend, 'Should detect double spending attempt')
  })

  it('should allow different UTXOs in multiple transactions', () => {
    const pool = new TransactionPool()
    const sender = new Account()
    const receiver1 = new Account()
    const receiver2 = new Account()

    // 创建两个不同的 UTXOs
    const utxo1 = new UTxOut({
      blockhash: 'blockhash123',
      txid: 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8',
      index: 0,
      output: new TxOut(100_000_000, sender.publicKey)
    })

    const utxo2 = new UTxOut({
      blockhash: 'blockhash456',
      txid: 'b4c2d6f8a9c0e1f2031425364758697a8b9c0d1e2f30415263748596a7b8c9d0',
      index: 1,
      output: new TxOut(200_000_000, sender.publicKey)
    })

    // 创建第一个交易，使用 utxo1
    const tx1 = new Transaction()
      .addInput(new TxIn(utxo1.txid, utxo1.index, hexBytes('3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165')))
      .addOutput(new TxOut(90_000_000, receiver1.publicKey))

    // 创建第二个交易，使用 utxo2
    const tx2 = new Transaction()
      .addInput(new TxIn(utxo2.txid, utxo2.index, hexBytes('3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980166')))
      .addOutput(new TxOut(180_000_000, receiver2.publicKey))

    // 将两个交易都添加到池中
    pool.add({ tx: tx1, fees: 10_000_000 })
    pool.add({ tx: tx2, fees: 20_000_000 })

    // 验证两个交易都在池中
    assert.ok(pool.has(hex(tx1.id)), 'First transaction should be in pool')
    assert.ok(pool.has(hex(tx2.id)), 'Second transaction should be in pool')

    // 验证两个 UTXO 都被标记为待处理
    assert.ok(pool.has(utxo1), 'First UTXO should be marked as pending')
    assert.ok(pool.has(utxo2), 'Second UTXO should be marked as pending')
  })

  it('should release UTXO when transaction is removed from pool', () => {
    const pool = new TransactionPool()
    const sender = new Account()
    const receiver = new Account()

    const utxo = new UTxOut({
      blockhash: 'blockhash123',
      txid: 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8',
      index: 0,
      output: new TxOut(100_000_000, sender.publicKey)
    })

    const tx = new Transaction()
      .addInput(new TxIn(utxo.txid, utxo.index, hexBytes('3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165')))
      .addOutput(new TxOut(90_000_000, receiver.publicKey))

    // 添加交易到池中
    pool.add({ tx, fees: 10_000_000 })
    assert.ok(pool.has(utxo), 'UTXO should be marked as pending')

    // 从池中移除交易
    pool.remove(hex(tx.id))
    assert.ok(!pool.has(hex(tx.id)), 'Transaction should be removed from pool')
    assert.ok(!pool.has(utxo), 'UTXO should no longer be marked as pending')
  })
})