import { Transaction, TxIn, TxOut } from "./transaction.mts"
import { TransactionPool } from "../../infra/node/txpool.mts"
import { hex } from "../../util/crypto.mts"

/**
 * Unspent transaction output
 */
export class UTxOut {
  private _blockhash: string
  private _txid: string
  private _index: number
  private _output: TxOut

  public get blockhash() {
    return this._blockhash
  }

  public get txid() {
    return this._txid
  }

  public get index() {
    return this._index
  }

  public get output() {
    return this._output
  }

  constructor({ blockhash, txid, index, output }: { blockhash: string, txid: string; index: number; output: TxOut }) {
    this._blockhash = blockhash
    this._txid = txid
    this._index = index
    this._output = output
  }

  public display(): {
    blockhash: string
    txid: string
    index: number
    amount: number
    publicKey: string
  } {
    return {
      blockhash: this._blockhash,
      txid: this._txid,
      index: this._index,
      amount: this._output.amount,
      publicKey: hex(this._output.publicKey)
    }
  }

  public static fromTransaction(blockhash: Uint8Array, tx: Transaction): UTxOut[] {
    return tx.outputs.map((output, index) => new UTxOut({ blockhash: hex(blockhash), txid: hex(tx.id), index, output }))
  }
}

/*
 * A collection of unspent transaction outputs
 */
export class UTxOutSet {
  private uTxOuts: Record<string, UTxOut> = {}

  constructor(uTxOuts?: UTxOut[]) {
    if (uTxOuts) {
      for (const uTxOut of uTxOuts) {
        this.uTxOuts[UTxOutSet.id(uTxOut)] = uTxOut
      }
    }
  }

  public getBalance(publicKey: Uint8Array<ArrayBufferLike>): number {
    return Object.values(this.uTxOuts)
      .filter(uTxOut => Buffer.from(uTxOut.output.publicKey).equals(Buffer.from(publicKey)))
      .map(uTxOut => uTxOut.output.amount)
      .reduce((a, b) => a + b, 0)
  }

  public get(input: TxIn | UTxOut): UTxOut | undefined {
    return this.uTxOuts[UTxOutSet.id(input)]
  }

  public filter(predicate: (uTxOut: UTxOut) => boolean): UTxOut[] {
    return Object.values(this.uTxOuts).filter(predicate)
  }

  public static accountFilter(accountPubKey: Uint8Array) {
    return (uTxOut: UTxOut) => Buffer.from(uTxOut.output.publicKey).equals(Buffer.from(accountPubKey))
  }

  public static excludePendingTxIns(transactionPool: TransactionPool) {
    return (uTxOut: UTxOut) => !transactionPool.has(uTxOut)
  }

  public add(uTxOut: UTxOut) {
    this.uTxOuts[UTxOutSet.id(uTxOut)] = uTxOut
  }

  public remove(input: TxIn | UTxOut) {
    delete this.uTxOuts[UTxOutSet.id(input)]
  }

  public toArray(): UTxOut[] {
    return Object.values(this.uTxOuts)
  }

  public copy(): UTxOutSet {
    return new UTxOutSet(this.toArray())
  }

  private static id(input: TxIn | UTxOut) {
    return `${input.txid}:${input.index}`
  }
}
