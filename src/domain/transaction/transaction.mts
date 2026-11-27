import { hex, hexBytes, sha256 } from "../../util/crypto.mts"
import { removeDERPadding, padSuffix } from '../../util/common.mts'

export function checkedSats(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Amount outside the exact satoshi range')
  return value
}

/**
 * serialization: 108 bytes
 * 0-31 txid (32 bytes transaction sha256 hash)
 * 32-35 index (big-endian 32-bit integer)
 * 36-107 DER encoded signature (padded to 72 bytes)
 */
class Input {
  public static readonly BYTES = 108

  private _txid: string
  private _index: number
  private _signature?: Uint8Array

  public get txid() {
    return this._txid
  }

  public get index() {
    return this._index
  }

  public get isCoinbase(): boolean {
    return this._txid === '0'.repeat(64)
  }

  public get signature(): Uint8Array | undefined {
    if (this.isCoinbase || !this._signature) {
      return this._signature
    }
    return removeDERPadding(this._signature)
  }

  public signed(): boolean {
    return this._signature !== undefined
  }

  constructor(tx: string, index: number, signature?: Uint8Array) {
    if (!/^[0-9a-f]{64}$/i.test(tx) || !Number.isInteger(index) || index < 0 || index > 0xffffffff) {
      throw new Error('Invalid transaction outpoint')
    }
    this._txid = tx.toLowerCase()
    this._index = index
    if (signature != undefined) {
      this._signature = padSuffix(signature, 72)
    }
  }

  public setSignature(signature: Uint8Array) {
    this._signature = padSuffix(signature, 72)
  }

  public serializeUnsigned(): Uint8Array {
    const tx = hexBytes(this._txid)

    const index = new Uint8Array(4)
    new DataView(index.buffer).setUint32(0, this._index, false)

    return new Uint8Array([...tx, ...index])
  }

  public serialize(): Uint8Array {
    const tx = hexBytes(this._txid)

    const index = new Uint8Array(4)
    new DataView(index.buffer).setUint32(0, this._index, false)

    const signature = this._signature
    if (!signature) {
      throw new Error('Input not signed')
    }

    return new Uint8Array([...tx, ...index, ...signature])
  }

  public static deserialize(data: Uint8Array): Input {
    if (data.length !== Input.BYTES) {
      throw new Error('Invalid input data length')
    }

    const tx = hex(data.slice(0, 32))
    const index = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(32, false)
    const signature = data.slice(36)

    return new Input(tx, index, signature)
  }

  public static buildCoinbaseTxIn(blockHeight: number, data?: Uint8Array): Input {
    return new Input('0'.repeat(64), blockHeight, data ?? new Uint8Array())
  }
}
export const TxIn = Input
export type TxIn = Input

/**
 * serialization: 73 bytes
 * 0-7 amount (big-endian 64-bit integer)
 * 8-72 publicKey (65 bytes public key)
 */
class Output {
  public static readonly BYTES = 73

  private _amount: number
  private _publicKey: Uint8Array

  public get amount() {
    return this._amount
  }

  public set amount(value: number) {
    this._amount = checkedSats(value)
  }

  public get publicKey() {
    return this._publicKey
  }

  constructor(amount: number, publicKey: Uint8Array) {
    this._amount = checkedSats(amount)
    this._publicKey = publicKey
  }

  public serialize(): Uint8Array {
    if (this._publicKey.length !== 65) {
      throw new Error('Transaction output requires a 65-byte public key')
    }
    const amount = new Uint8Array(8)
    new DataView(amount.buffer).setBigUint64(0, BigInt(this._amount), false)

    return new Uint8Array([...amount, ...this._publicKey])
  }

  public static deserialize(data: Uint8Array): Output {
    if (data.length !== Output.BYTES) {
      throw new Error('Invalid output data length')
    }
    const amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(0, false)
    const publicKey = data.slice(8)

    return new Output(Number(amount), publicKey)
  }

  public static buildCoinbaseTxOut(toPubKey: Uint8Array, reward: number): Output {
    return new Output(reward, toPubKey)
  }
}
export const TxOut = Output
export type TxOut = Output


/**
 * serialization:
 * 0-3 input count (big-endian 32-bit integer)
 * 4-7 output count (big-endian 32-bit integer)
 * 8-... inputs (variable length, each input is 108 bytes)
 * ...-... outputs (variable length, each output is 73 bytes)
 */
export class Transaction {
  public static readonly COINBASE_BYTES = 8 + Input.BYTES + Output.BYTES

  public display(): {
    id: string
    inputs: { txid: string; index: number; signature: string | null }[]
    outputs: { amount: number; publicKey: string }[]
  } {
    return {
      id: hex(this.id),
      inputs: this.inputs.map(input => ({
        txid: input.txid,
        index: input.index,
        signature: input.signature ? hex(input.signature) : null
      })),
      outputs: this.outputs.map(output => ({
        amount: output.amount,
        publicKey: hex(output.publicKey)
      }))
    }
  }

  private _inputs: Input[] = []

  private _outputs: Output[] = []

  public get inputs(): Input[] {
    return this._inputs
  }

  public get outputs(): Output[] {
    return this._outputs
  }

  public get outputValue(): number {
    return checkedSats(this._outputs.reduce((sum, output) => sum + output.amount, 0))
  }

  constructor() { }

  public addInput(input: Input): Transaction {
    this._inputs.push(input)
    return this
  }

  public addOutput(output: Output): Transaction {
    this._outputs.push(output)
    return this
  }

  public validateCoinbase(height: number, maximum: number) {
    if (this.inputs.length !== 1 || !this.inputs[0].isCoinbase ||
        this.inputs[0].index !== height || this.outputs.length !== 1) {
      throw new Error('Invalid coinbase transaction')
    }
    if (this.outputValue > checkedSats(maximum)) throw new Error('Coinbase transaction output exceeds maximum')
  }

  public bytesLength(): number {
    return 8 + this._inputs.length * Input.BYTES + this._outputs.length * Output.BYTES
  }

  public get id(): Uint8Array {
    return sha256(this.serializeUnsigned())
  }

  private serializeUnsigned(): Uint8Array {
    const inputCount = this._inputs.length
    const outputCount = this._outputs.length

    const inputCountBytes = new Uint8Array(4)
    new DataView(inputCountBytes.buffer).setUint32(0, inputCount, false)

    const outputCountBytes = new Uint8Array(4)
    new DataView(outputCountBytes.buffer).setUint32(0, outputCount, false)

    const inputsBytes = this._inputs.flatMap(input => Array.from(input.serializeUnsigned()))
    const outputsBytes = this._outputs.flatMap(output => Array.from(output.serialize()))

    return new Uint8Array([
      ...inputCountBytes,
      ...outputCountBytes,
      ...inputsBytes,
      ...outputsBytes
    ])
  }

  public serialize(): Uint8Array {
    const inputCount = this._inputs.length
    const outputCount = this._outputs.length

    const inputCountBytes = new Uint8Array(4)
    new DataView(inputCountBytes.buffer).setUint32(0, inputCount, false)

    const outputCountBytes = new Uint8Array(4)
    new DataView(outputCountBytes.buffer).setUint32(0, outputCount, false)

    const inputsBytes = this._inputs.flatMap(input => Array.from(input.serialize()))
    const outputsBytes = this._outputs.flatMap(output => Array.from(output.serialize()))

    return new Uint8Array([
      ...inputCountBytes,
      ...outputCountBytes,
      ...inputsBytes,
      ...outputsBytes
    ])
  }

  public static deserialize(data: Uint8Array): Transaction {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const inputCount = view.getUint32(0, false)
    const outputCount = view.getUint32(4, false)
    const expectedLength = 8 + inputCount * Input.BYTES + outputCount * Output.BYTES
    if (data.length !== expectedLength) {
      throw new Error('Invalid transaction data length')
    }
    const inputs: Input[] = []
    const outputs: Output[] = []

    let offset = 8
    for (let i = 0; i < inputCount; i++) {
      const inputData = data.slice(offset, offset + Input.BYTES)
      inputs.push(Input.deserialize(inputData))
      offset += Input.BYTES
    }

    for (let i = 0; i < outputCount; i++) {
      const outputData = data.slice(offset, offset + Output.BYTES)
      outputs.push(Output.deserialize(outputData))
      offset += Output.BYTES
    }

    const tx = new Transaction()
    for (const input of inputs) {
      tx.addInput(input)
    }
    for (const output of outputs) {
      tx.addOutput(output)
    }
    return tx
  }

  public static deserializeMany(data: Uint8Array): Transaction[] {
    const txs: Transaction[] = []
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 0
    while (offset < data.length) {
      if (offset + 8 > data.length) {
        throw new Error('Invalid transaction data length')
      }
      const inputCount = view.getUint32(offset, false)
      const outputCount = view.getUint32(offset + 4, false)
      const txLength = 8 + inputCount * Input.BYTES + outputCount * Output.BYTES
      if (offset + txLength > data.length) {
        throw new Error('Invalid transaction data length')
      }
      const tx = data.slice(offset, offset + txLength)
      txs.push(Transaction.deserialize(tx))
      offset += txLength
    }
    return txs
  }

  public static buildCoinbaseTx(toPubKey: Uint8Array, reward: number, blockHeight: number, data?: Uint8Array): Transaction {
    const tx = new Transaction()
    tx.addInput(Input.buildCoinbaseTxIn(blockHeight, data))
    tx.addOutput(Output.buildCoinbaseTxOut(toPubKey, reward))
    return tx
  }
}
