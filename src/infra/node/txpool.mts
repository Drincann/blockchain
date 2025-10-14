import { Transaction } from "../../domain/transaction/transaction.mts"
import { UTxOut } from "../../domain/transaction/utxo.mts"
import { hex } from "../../util/crypto.mts"

export interface PendingTransaction {
  tx: Transaction
  fees: number
}

export class TransactionPool {

  private txs: Map<string, PendingTransaction> = new Map()

  // key: txid + '-' + outputIndex
  private pendingUTxOuts: Set<string> = new Set()

  public get(txid: string): PendingTransaction | undefined {
    return this.txs.get(txid)
  }

  public keys(): string[] {
    return [...this.txs.keys()]
  }

  public add(tx: PendingTransaction): void {
    this.txs.set(hex(tx.tx.id), tx)
    for (const [i, input] of tx.tx.inputs.entries()) {
      this.pendingUTxOuts.add(`${input.txid}-${input.index}`)
    }
  }

  public remove(txid: string): void {
    const tx = this.txs.get(txid)
    if (tx) {
      for (const [i, input] of tx.tx.inputs.entries()) {
        this.pendingUTxOuts.delete(`${input.txid}-${input.index}`)
      }
    }

    this.txs.delete(txid)
  }

  public has(txid: string | UTxOut): boolean {
    if (typeof txid === 'string') {
      return this.txs.has(txid)
    }

    return this.pendingUTxOuts.has(`${txid.txid}-${txid.index}`)
  }

  public orderByFeesDesc(): PendingTransaction[] {
    return [...this.txs.values()].sort((a, b) => b.fees - a.fees)
  }

  public getAll(): PendingTransaction[] {
    return [...this.txs.values()]
  }
}