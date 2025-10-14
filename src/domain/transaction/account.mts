import elliptic from 'elliptic'
import { Transaction } from './transaction.mts';

var ec = new elliptic.ec('secp256k1');

export class Account {

  private key: elliptic.ec.KeyPair

  constructor(privateKey?: Uint8Array) {
    if (privateKey) {
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
