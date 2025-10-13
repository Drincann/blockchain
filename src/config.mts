import { readFile } from "fs/promises"

const jsonConfig = JSON.parse(
  await readFile(new URL('./config.json', import.meta.url), 'utf-8') ?? '{}'
)

export const MAX_BLOCK_TX_BYTES = 10240
export const COINBASE_REWARD = 5_000_000_000
export const REWARD_HALVING_EVERY_BLOCKS = 210_000
export const BLOCK_GENERATION_TARGET_IN_MILLS = 10_000 // 10 seconds
export const DIFFICULTY_ADJUSTMENT_EVERY_BLOCKS = 10
export const MEDIAN_TIME_PAST_WINDOW = 11
export const MAX_FUTURE_DRIFT_IN_MILLS = 1000 * 60 * 2 // 2 minutes
export const MIN_TX_FEES_EVERY_BYTE = 1 // 1 satoshi per byte

export const config = {
  get maxDataBytes(): number {
    return 10240
  },

  get listenAddress(): string | undefined {
    return process.env.BLOCKCHAIN_SERVER_LISTEN_ADDRESS ?? jsonConfig.listenAddress ?? undefined
  }
}
