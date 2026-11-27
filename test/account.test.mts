import { describe, it } from "node:test"
import assert from 'node:assert/strict'
import { Account } from "../src/domain/transaction/account.mts"
import { hex } from "../src/util/crypto.mts"
import { Transaction, TxOut, TxIn } from "../src/domain/transaction/transaction.mts"

describe('Account', () => {
  it('account gen', () => {
    const account = new Account()
    const sameAccount = new Account(account.privateKey)

    assert(hex(account.privateKey) === hex(sameAccount.privateKey), 'private keys should match')
    assert(hex(account.publicKey) === hex(sameAccount.publicKey), 'public keys should match')
  })

  it('rejects zero and out-of-range private keys', () => {
    assert.throws(() => new Account(new Uint8Array(32)), /Invalid/)
    assert.throws(() => new Account(new Uint8Array(32).fill(255)), /Invalid/)
    const shortKey = new Account(Uint8Array.of(1))
    assert.deepEqual(new Account(shortKey.privateKey).publicKey, shortKey.publicKey)
  })

  it('account sign/verify', () => {
    const account = new Account()
    const data = new TextEncoder().encode('hello world')
    const signature = account.sign(data)
    assert.ok(Account.verify(data, signature, account.publicKey), 'verify should pass')
    assert.ok(!Account.verify(data, signature, new Account().publicKey), 'verify should fail with different public key')
  })

  it('verifies a DER signature from the previous wallet implementation', () => {
    const owner = new Account(Uint8Array.of(1))
    const tx = new Transaction().addInput(new TxIn('12'.repeat(32), 1)).addOutput(new TxOut(1000, owner.publicKey))
    const signature = Buffer.from('304602210087e50951d1b1a7457b2de9e2b58365ced45202e83bbbe240ce66c0d6503a08ef0221009eae08dd06d11aa7d1d3ae3e8f3cddbc263d4a66f492df4ef1fbf8b793d20ec5', 'hex')
    tx.inputs[0].setSignature(signature)
    assert.equal(hex(tx.id), '77dcf0eb6a855d6b7a39b278d163164276e0a2be7d631330dad4f9ab71b804e5')
    assert.ok(Account.verifyTxIn(tx, 0, owner.publicKey))
  })

  it('binds a signature to the whole message', () => {
    const owner = new Account()
    const message = Buffer.from('A payment note long enough to span a complete digest.')
    const signature = owner.sign(message)
    assert.ok(Account.verify(message, signature, owner.publicKey))
    assert.equal(Account.verify(Buffer.concat([message, Buffer.from('edited')]), signature, owner.publicKey), false)
  })

  it('separates ordinary messages from transaction authorizations', () => {
    const owner = new Account()
    const tx = new Transaction().addInput(new TxIn('12'.repeat(32), 0)).addOutput(new TxOut(50, owner.publicKey))
    const messageSignature = owner.sign(tx.id)
    owner.signTxIn(tx, 0)
    assert.ok(Account.verify(tx.id, messageSignature, owner.publicKey))
    assert.equal(Account.verify(tx, messageSignature, owner.publicKey), false)
    assert.equal(Account.verify(tx.id, tx.inputs[0].signature!, owner.publicKey), false)
    assert.ok(Account.verifyTxIn(tx, 0, owner.publicKey))
  })

  it('account sign/verify transaction', () => {
    const sender = new Account()
    const receiver = new Account()
    const tx = new Transaction().addInput(new TxIn('a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8', 0))
      .addOutput(new TxOut(100_000_000, receiver.publicKey))

    const signedTx = sender.signTxIn(tx, 0)
    assert.ok(Account.verifyTxIn(tx, 0, sender.publicKey), 'verify should pass')
  })

  it('account multi sign/verify transaction', () => {
    const sender1 = new Account()
    const sender2 = new Account()
    const receiver = new Account()
    const tx = new Transaction()
      .addInput(new TxIn('a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8', 0))
      .addInput(new TxIn('b4c2d6e7f8a9b0c1d2e3f405162738495a6b7c8d9e0f102132435465768798a9', 1))
      .addOutput(new TxOut(100_000_000, receiver.publicKey))

    sender1.signTxIn(tx, 0)
    sender2.signTxIn(tx, 1)
    assert.ok(Account.verifyTxIn(tx, 0, sender1.publicKey), 'verify input 0 should pass')
    assert.ok(Account.verifyTxIn(tx, 1, sender2.publicKey), 'verify input 1 should pass')
  })
})
