export function padSuffix(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length >= length) {
    return bytes
  }

  const padded = new Uint8Array(length)
  padded.set(bytes, 0)
  return padded
}

export function removePadding(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x30) {
    throw new Error("Not a DER sequence");
  }
  const totalLen = bytes[1];
  const realLen = 2 + totalLen;
  return bytes.slice(0, realLen);
}
