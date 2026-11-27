import { ECDH } from 'node:crypto'
import elliptic from 'elliptic'
import { Transaction } from './transaction.mts';

var ec = new elliptic.ec('secp256k1');

export class Account {

  private key: elliptic.ec.KeyPair

  constructor(privateKey?: Uint8Array) {
    if (privateKey) {
      if (privateKey.length === 0 || privateKey.length > 32) {
        throw new Error('Invalid secp256k1 private key length')
      }
      const scalar = BigInt('0x' + Buffer.from(privateKey).toString('hex'))
      const order = BigInt('0x' + ec.curve.n.toString(16))
      if (scalar === 0n || scalar >= order) {
        throw new Error('Invalid secp256k1 private key')
      }
      this.key = ec.keyFromPrivate(privateKey);
      return;
    }

    this.key = ec.genKeyPair();
  }

  public get privateKey(): Uint8Array {
    return this.key.getPrivate().toBuffer();
  }

  public get publicKey(): Uint8Array {
    return Buffer.from(this.key.getPublic().encode('array', false))
  }

  public static normalizePublicKey(key: Uint8Array): Uint8Array {
    const uncompressed = ECDH.convertKey(key, 'secp256k1', undefined, undefined, 'uncompressed') as Buffer
    if (uncompressed.length !== 65) {
      throw new Error('Invalid secp256k1 public key')
    }
    return uncompressed
  }

  public sign(data: Uint8Array | Transaction): Uint8Array {
    if (data instanceof Transaction) {
      data = data.serialize()
    }

    const signature = this.key.sign(data)
    return new Uint8Array(signature.toDER())
  }

  public signTxIn(tx: Transaction, inputIndex: number): Account {
    const signature = this.sign(tx.id)
    tx.inputs[inputIndex].setSignature(signature)
    return this
  }

  public static verify(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    const key = ec.keyFromPublic(publicKey, 'array')
    return key.verify(data, signature)
  }

  public static verifyTxIn(tx: Transaction, inputIndex: number, publicKey: Uint8Array): boolean {
    const key = ec.keyFromPublic(publicKey, 'array')
    const input = tx.inputs[inputIndex]
    if (!input.signed()) {
      return false
    }
    return key.verify(tx.id, input.signature!)
  }
}
