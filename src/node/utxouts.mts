import { TxIn, UTxOut } from "../lib/transaction/transaction.mts"
import { TransactionPool } from "./txpool.mts"

/*
 * A collection of unspent transaction outputs
 */
export class UTxOuts {
  private uTxOuts: Record<string, UTxOut> = {}

  constructor(uTxOuts?: UTxOut[]) {
    if (uTxOuts) {
      for (const uTxOut of uTxOuts) {
        this.uTxOuts[UTxOuts.id(uTxOut)] = uTxOut
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
    return this.uTxOuts[UTxOuts.id(input)]
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
    this.uTxOuts[UTxOuts.id(uTxOut)] = uTxOut
  }

  public remove(input: TxIn | UTxOut) {
    delete this.uTxOuts[UTxOuts.id(input)]
  }

  public toArray(): UTxOut[] {
    return Object.values(this.uTxOuts)
  }

  public copy(): UTxOuts {
    return new UTxOuts(this.toArray())
  }

  private static id(input: TxIn | UTxOut) {
    return `${input.txid}:${input.index}`
  }
}
