import { hex, hexBytes, sha256 } from "../../util/crypto.mts"
import { removePadding, padSuffix } from '../../util/common.mts'

/**
 * serialization: 107 bytes
 * 0-31 tx (32 bytes transaction sha256 hash)
 * 32-35 index (big-endian 32-bit integer)
 * 36-108 DER encoded signature (padded to 72 bytes)
 */
class Input {
  private _tx: string
  private _index: number
  private _signature?: Uint8Array

  public get tx() {
    return this._tx
  }

  public get index() {
    return this._index
  }

  public get signature() {
    return this._signature ? removePadding(this._signature) : undefined
  }

  public signed(): boolean {
    return this._signature !== undefined
  }

  constructor(tx: string, index: number, signature?: Uint8Array) {
    this._tx = tx
    this._index = index
    if (signature != undefined) {
      this._signature = padSuffix(signature, 72)
    }
  }

  public setSignature(signature: Uint8Array) {
    this._signature = padSuffix(signature, 72)
  }

  public serializeUnsigned(): Uint8Array {
    const tx = hexBytes(this._tx)

    const index = new Uint8Array(4)
    new DataView(index.buffer).setUint32(0, this._index, false)

    return new Uint8Array([...tx, ...index])
  }

  public serialize(): Uint8Array {
    const tx = hexBytes(this._tx)

    const index = new Uint8Array(4)
    new DataView(index.buffer).setUint32(0, this._index, false)

    const signature = this._signature
    if (!signature) {
      throw new Error('Input not signed')
    }

    return new Uint8Array([...tx, ...index, ...signature])
  }

  public static deserialize(data: Uint8Array): Input {
    if (data.length !== 108) {
      throw new Error('Invalid input data length')
    }

    const tx = hex(data.slice(0, 32))
    const index = new DataView(data.slice(32, 36).buffer).getUint32(0, false)
    const signature = removePadding(data.slice(36))

    return new Input(tx, index, signature)
  }
}
export const TxIn = Input

/**
 * serialization: 73 bytes
 * 0-7 amount (big-endian 64-bit integer)
 * 8-72 publicKey (65 bytes public key)
 */
class Output {
  private _amount: number
  private _publicKey: Uint8Array

  public get amount() {
    return this._amount
  }

  public get publicKey() {
    return this._publicKey
  }

  constructor(amount: number, publicKey: Uint8Array) {
    this._amount = amount
    this._publicKey = publicKey
  }

  public serialize(): Uint8Array {
    const amount = new Uint8Array(8)
    new DataView(amount.buffer).setBigUint64(0, BigInt(this._amount), false)

    return new Uint8Array([...amount, ...this._publicKey])
  }

  public static deserialize(data: Uint8Array): Output {
    const amount = new DataView(data.slice(0, 8).buffer).getBigUint64(0, false)
    const publicKey = data.slice(8)

    return new Output(Number(amount), publicKey)
  }
}
export const TxOut = Output


/**
 * serialization:
 * 0-3 input count (big-endian 32-bit integer)
 * 4-7 output count (big-endian 32-bit integer)
 * 8-... inputs (variable length, each input is 108 bytes)
 * ...-... outputs (variable length, each output is 73 bytes)
 */
export class Transaction {

  private _inputs: Input[] = []

  private _outputs: Output[] = []

  public get inputs(): Input[] {
    return this._inputs
  }

  public get outputs(): Output[] {
    return this._outputs
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
    const inputCount = new DataView(data.slice(0, 4).buffer).getUint32(0, false)
    const outputCount = new DataView(data.slice(4, 8).buffer).getUint32(0, false)
    const expectedLength = 8 + inputCount * 108 + outputCount * 73
    if (data.length !== expectedLength) {
      throw new Error('Invalid transaction data length')
    }
    const inputs: Input[] = []
    const outputs: Output[] = []

    let offset = 8
    for (let i = 0; i < inputCount; i++) {
      const inputData = data.slice(offset, offset + 108)
      inputs.push(Input.deserialize(inputData))
      offset += 108
    }

    for (let i = 0; i < outputCount; i++) {
      const outputData = data.slice(offset, offset + 73)
      outputs.push(Output.deserialize(outputData))
      offset += 73
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
}
