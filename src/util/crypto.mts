import { createHash, randomUUID } from "node:crypto";
export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest())
}

const TEXT_ENCODER = new TextEncoder()

export function utf8Bytes(data: string): Uint8Array {
  return TEXT_ENCODER.encode(data)
}

export function hexBytes(data: string): Uint8Array {
  return new Uint8Array(data.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
}

export function hex(data?: Uint8Array): string {
  if (data == null || data.length === 0) {
    return ''
  }
  return (Array.from(data)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function uuid(): string {
  return randomUUID()
}

export function randomBytes(length: number): Uint8Array {
  return new Uint8Array(crypto.getRandomValues(new Uint8Array(length)))
}

export function bitString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(2).padStart(8, "0"))
    .join("");
}
