import { readFile } from "fs/promises"

const jsonConfig = JSON.parse(
  await readFile(new URL('./config.json', import.meta.url), 'utf-8') ?? '{}'
)
export const config = {
  get maxDataBytes(): number {
    return jsonConfig.maxDataBytes ?? 1024
  },

  get listenAddress(): string | undefined {
    return process.env.BLOCKCHAIN_SERVER_LISTEN_ADDRESS ?? jsonConfig.listenAddress ?? undefined
  }
}