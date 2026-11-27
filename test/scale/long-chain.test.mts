import { it } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Transaction } from '../../src/domain/transaction/transaction.mts'
import { listenLocal } from '../fixtures/listen-local.mts'
import { Node } from '../../src/infra/node/node.mts'
import { BlockStorage } from '../../src/infra/persistence/storage.mts'
import { BLOCK_GENERATION_TARGET_IN_MILLS, COINBASE_REWARD } from '../../src/app/config.mts'

const childScript = fileURLToPath(new URL('../fixtures/sync-memory.mts', import.meta.url))

// Space out timestamps by the target interval to keep proof generation cheap and reproducible.
function extendFixture(filename: string, owner: Uint8Array, height: number) {
  const store = new BlockStorage(filename)
  try {
    store.atomic(() => {
      let prev = store.tip()
      let work = store.workAt(prev.height)
      while (prev.height < height) {
        const block = prev.generate({ difficulty: 2 })
        block.setTs(prev.ts + BLOCK_GENERATION_TARGET_IN_MILLS)
        const reward = Transaction.buildCoinbaseTx(owner, COINBASE_REWARD, block.height)
        block.addTransaction(reward)
        const nonce = Buffer.alloc(32)
        for (let i = 0; !block.isProofValid(); i++) {
          nonce.writeUInt32BE(i)
          block.setNonce(nonce)
        }
        work += 4n
        store.append(block, work)
        store.indexTransaction(reward, block.height)
        store.addOutputs(reward, block.height)
        prev = block
      }
    })
  } finally {
    store.close()
  }
}

it('syncs ten times more blocks in a fresh receiver with bounded peak memory', { timeout: 240_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'blockchain-scale-'))
  try {
    const options = { dataDir: join(root, 'source'), passphrase: 'memory test' }
    const initial = new Node(options)
    const owner = initial.account.publicKey
    initial.stop()
    const peaks: number[] = []
    for (const height of [1000, 10000]) {
      extendFixture(join(options.dataDir, 'chain.sqlite'), owner, height)
      const source = new Node(options)
      try {
        await listenLocal(source)
        const address = source['server']!['wss'].address()
        assert.ok(address && typeof address !== 'string')
        const { stdout } = await promisify(execFile)(process.execPath, [
          '--max-old-space-size=96', '--import', 'tsx', childScript,
          join(root, 'receiver-' + height), String(address.port), String(height), source.current.summary.hash
        ], { timeout: 150_000 })
        const peak = Number(/peakKiB=(\d+)/.exec(stdout)?.[1])
        assert.ok(peak > 0)
        console.log(`Receiver peak RSS for ${height} blocks: ${(peak / 1024).toFixed(1)} MiB`)
        peaks.push(peak)
      } finally {
        source.stop()
      }
    }
    // Allow runtime/allocator variation. This is a regression limit, not a production memory budget.
    assert.ok(peaks[1] < 3 * peaks[0])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
