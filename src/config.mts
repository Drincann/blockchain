import { readFile } from "fs/promises"

const jsonConfig = JSON.parse(
  await readFile(new URL('./config.json', import.meta.url), 'utf-8') ?? '{}'
)
export const config = {
  get maxDataBytes(): number {
    return jsonConfig.maxDataBytes ?? 10240
  },

  get listenAddress(): string | undefined {
    return process.env.BLOCKCHAIN_SERVER_LISTEN_ADDRESS ?? jsonConfig.listenAddress ?? undefined
  }
}

// sender
// publicKey: 04579617870aeee723169c31c9fc28a261acab3944983972dffa10fe35f483db4539a9857aed4b0ad56d5ebb950df8c29c33873480a63c5bbe1b76311f01c7b2de
// privateKey: 2678e206850067f6f6dce5faee52ffe7ad6d2859f49acff956811fbd9bddeb96

// receiver
// publicKey: 04477f01acbb6725f94f84c8483b1c9057d5064f021b5e5080ca82c16dc925376f5b87fd4b1af8c502f4bb75a2360621081036f4f312f98225183ae4a8d524cda9
// privateKey: 30366907756c48fea118fb7149d7f9d77dbcba60765d3c8fbb4b4c64cfd6d696
