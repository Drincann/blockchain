import { describe, it } from "node:test"
import assert from 'node:assert/strict'
import { Account } from "../src/lib/transaction/account.mts"
import { hex } from "../src/util/crypto.mts"
import { Transaction, TxOut, TxIn } from "../src/lib/transaction/transaction.mts"

describe('Account', () => {
  it('account gen', () => {
    const account = new Account()
    console.log('private key:', hex(account.privateKey))
    console.log('public key :', hex(account.publicKey))
    const sameAccount = new Account(account.privateKey)
    console.log('same private key:', hex(sameAccount.privateKey))
    console.log('same public key :', hex(sameAccount.publicKey))

    assert(hex(account.privateKey) === hex(sameAccount.privateKey), 'private keys should match')
    assert(hex(account.publicKey) === hex(sameAccount.publicKey), 'public keys should match')
  })

  it('account sign/verify', () => {
    const account = new Account()
    const data = new TextEncoder().encode('hello world')
    const signature = account.sign(data)
    console.log('data     :', hex(data))
    console.log('signature:', hex(signature))
    assert.ok(Account.verify(data, signature, account.publicKey), 'verify should pass')
    assert.ok(!Account.verify(data, signature, new Account().publicKey), 'verify should fail with different public key')
  })

  it('account sign/verify transaction', () => {
    const sender = new Account()
    const receiver = new Account()
    const tx = new Transaction().addInput(new TxIn('a3b1c5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364758697a8', 0))
      .addOutput(new TxOut(100_000_000, receiver.publicKey))

    const signedTx = sender.signTxIn(tx, 0)
    console.log('transaction:', signedTx)
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
    console.log('transaction:', tx)
    assert.ok(Account.verifyTxIn(tx, 0, sender1.publicKey), 'verify input 0 should pass')
    assert.ok(Account.verifyTxIn(tx, 1, sender2.publicKey), 'verify input 1 should pass')
  })
})
