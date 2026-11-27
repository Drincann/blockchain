import { createHash, ECDH } from 'node:crypto'
import { secp256k1 } from '@noble/curves/secp256k1'
import { Transaction } from './transaction.mts'

function signingDigest(data: Uint8Array | Transaction): Uint8Array {
  if (data instanceof Transaction) return data.id
  return createHash('sha256').update('Simple Blockchain signed message\0').update(data).digest()
}

export class Account {
  private readonly secret: Uint8Array
  private readonly publicBytes: Uint8Array

  constructor(privateKey?: Uint8Array) {
    if (privateKey) {
      if (!privateKey.length || privateKey.length > 32) throw new Error('Invalid secp256k1 private key length')
      this.secret = new Uint8Array(32)
      this.secret.set(privateKey, 32 - privateKey.length)
      if (!secp256k1.utils.isValidSecretKey(this.secret)) throw new Error('Invalid secp256k1 private key')
    } else {
      this.secret = secp256k1.utils.randomSecretKey()
    }
    this.publicBytes = secp256k1.getPublicKey(this.secret, false)
  }

  public get privateKey(): Uint8Array {
    return this.secret.slice()
  }

  public get publicKey(): Uint8Array {
    return this.publicBytes.slice()
  }

  public static normalizePublicKey(key: Uint8Array): Uint8Array {
    const uncompressed = ECDH.convertKey(key, 'secp256k1', undefined, undefined, 'uncompressed') as Buffer
    if (uncompressed.length !== 65) throw new Error('Invalid secp256k1 public key')
    return uncompressed
  }

  public sign(data: Uint8Array | Transaction): Uint8Array {
    return secp256k1.sign(signingDigest(data), this.secret, { prehash: false, lowS: true, extraEntropy: true }).toDERRawBytes()
  }

  public signTxIn(tx: Transaction, inputIndex: number): Account {
    tx.inputs[inputIndex].setSignature(this.sign(tx))
    return this
  }

  public static verify(data: Uint8Array | Transaction, signature: Uint8Array, publicKey: Uint8Array): boolean {
    // Previously confirmed transactions may contain either valid ECDSA S value.
    try {
      return secp256k1.verify(signature, signingDigest(data), publicKey, { prehash: false, format: 'der', lowS: false })
    } catch {
      return false
    }
  }

  public static verifyTxIn(tx: Transaction, inputIndex: number, publicKey: Uint8Array): boolean {
    const signature = tx.inputs[inputIndex]?.signature
    return signature !== undefined && Account.verify(tx, signature, publicKey)
  }
}
