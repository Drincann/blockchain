export function padSuffix(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length >= length) {
    // limit to length
    return bytes.slice(0, length)
  }

  const padded = new Uint8Array(length)
  padded.set(bytes, 0)
  return padded
}

export function removeDERPadding(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x30) {
    return bytes;
  }
  const totalLen = bytes[1];
  const realLen = 2 + totalLen;
  return bytes.slice(0, realLen);
}
