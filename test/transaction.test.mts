import { describe, it } from "node:test"
import assert from 'node:assert/strict'
import { Account } from "../src/lib/transaction/account.mts"
import { hex, hexBytes } from "../src/util/crypto.mts"
import { Input, Output, Transaction } from "../src/lib/transaction/transaction.mts"

describe('Transaction', () => {
  describe('Input', () => {
    it('serialize/deserialize', () => {
      const tx = 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8'
      const signature = '3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165'
      const input = new Input(tx, 2, hexBytes(signature))
      const serialized = input.serialize()
      console.log('serialized:', hex(serialized))
      const deserialized = Input.deserialize(serialized)
      console.log('deserialized:', deserialized)

      assert.equal(deserialized.tx, tx, 'tx should match')
      assert.equal(deserialized.index, 2, 'index should match')
      assert.equal(hex(deserialized.signature), signature, 'signature should match')
    })
  })

  describe('Output', () => {
    it('serialize/deserialize', () => {
      const amount = 1234567890
      const publicKey = hexBytes('040d6a02280c79541c23630b267d0507d261c63f08e33cd5718b5461bada15e36314ab898e149a13d21a2e7a9eb99d0cb1291a5878011437cd8588ffc253feea88')
      const output = new Output(amount, publicKey)
      const serialized = output.serialize()
      console.log('serialized:', hex(serialized))
      const deserialized = Output.deserialize(serialized)
      console.log('deserialized:', deserialized)

      assert.equal(deserialized.amount, amount, 'amount should match')
      assert.equal(hex(deserialized.publicKey), hex(publicKey), 'public key should match')
    })
  })

  it('serialize/deserialize', () => {
    const sender = new Account()
    const receiver = new Account()
    const inputTx = 'a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8'
    const inputSignature = '3046022100e014bc75f513846a3ce9aa13aed6a791457b3fd914400bdd0033fccdaf64d4f9022100abd40200ef4aad06371c5546a986de427f659b8d7780bbcd0a4fffe7d8980165'

    const input1 = new Input(inputTx, 0, hexBytes(inputSignature))
    const input2 = new Input(inputTx, 1, hexBytes(inputSignature))
    const output1 = new Output(100_000_000, receiver.publicKey)
    const change = new Output(900_000_000, sender.publicKey)

    const tx = new Transaction().addInput(input1).addInput(input2).addOutput(output1).addOutput(change)
    console.log('transaction:', tx)

    const serialized = tx.serialize()
    console.log('serialized:', hex(serialized))

    const deserialized = Transaction.deserialize(serialized)
    console.log('deserialized:', deserialized)

    assert.equal(deserialized.inputs.length, 2, 'should have 2 inputs')
    assert.equal(deserialized.outputs.length, 2, 'should have 2 outputs')
    assert.equal(deserialized.inputs[0].tx, input1.tx, 'input 1 tx should match')
    assert.equal(deserialized.inputs[0].index, input1.index, 'input 1 index should match')
    assert.equal(hex(deserialized.inputs[0].signature), hex(input1.signature), 'input 1 signature should match')
    assert.equal(deserialized.inputs[1].tx, input2.tx, 'input 2 tx should match')
    assert.equal(deserialized.inputs[1].index, input2.index, 'input 2 index should match')
    assert.equal(hex(deserialized.inputs[1].signature), hex(input2.signature), 'input 2 signature should match')
    assert.equal(deserialized.outputs[0].amount, output1.amount, 'output 1 amount should match')
    assert.equal(hex(deserialized.outputs[0].publicKey), hex(output1.publicKey), 'output 1 public key should match')
    assert.equal(deserialized.outputs[1].amount, change.amount, 'change amount should match')
    assert.equal(hex(deserialized.outputs[1].publicKey), hex(change.publicKey), 'change public key should match')

    assert.equal(hex(tx.hash), hex(deserialized.hash), 'transaction hash should match')
  })
})