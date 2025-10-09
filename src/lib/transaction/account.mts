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


// sender
// publicKey: 04579617870aeee723169c31c9fc28a261acab3944983972dffa10fe35f483db4539a9857aed4b0ad56d5ebb950df8c29c33873480a63c5bbe1b76311f01c7b2de
// privateKey: 2678e206850067f6f6dce5faee52ffe7ad6d2859f49acff956811fbd9bddeb96

// receiver
// publicKey: 04477f01acbb6725f94f84c8483b1c9057d5064f021b5e5080ca82c16dc925376f5b87fd4b1af8c502f4bb75a2360621081036f4f312f98225183ae4a8d524cda9
// privateKey: 30366907756c48fea118fb7149d7f9d77dbcba60765d3c8fbb4b4c64cfd6d696
