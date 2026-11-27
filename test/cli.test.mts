import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/app/cli.mjs', import.meta.url))

function run(commands: string[]): string {
  const result = spawnSync(process.execPath, [cli, '0', '--memory'], {
    input: commands.join('\n') + '\n',
    encoding: 'utf8',
    timeout: 5000
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

describe('CLI', () => {
  it('prints startup help without a wallet and interactive help without exiting', () => {
    const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /peer add <host:port>/)
    const output = run(['help', 'balance', 'q'])
    assert.match(output, /mineasync/)
    assert.match(output, /balance: 0 sats/)
    assert.doesNotMatch(run(['account', 'q']), /privateKey:/)
    assert.match(run(['account private', 'q']), /privateKey: [0-9a-f]{64}/)
  })

  it('keeps the active account after an invalid import and rejects a partial amount', () => {
    const output = run(['account', 'importprivatekey 00', 'account', 'send 04 1e3', 'q'])
    const keys = [...output.matchAll(/publicKey: (\w+)/g)].map(match => match[1])
    assert.equal(keys.length, 2)
    assert.equal(keys[0], keys[1])
    assert.match(output, /failed to import private key/)
    assert.match(output, /amount must be a positive integer/)
  })

  it('uses the same wallet and chain from the default and explicit data path', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'blockchain-cli-'))
    try {
      const env = { ...process.env, BLOCKCHAIN_WALLET_PASSPHRASE: 'test wallet' }
      const created = spawnSync(process.execPath, [cli, '0'], {
        cwd, env, input: 'mine persistence\naccount\nq\n', encoding: 'utf8', timeout: 5000
      })
      assert.equal(created.status, 0, created.stderr)
      const hash = /new block: (\w+)/.exec(created.stdout)?.[1]
      const address = /publicKey: (\w+)/.exec(created.stdout)?.[1]
      assert.ok(hash && address)
      const restored = spawnSync(process.execPath, [cli, '0', '--data-dir', '.blockchain/node-0', '--reindex'], {
        cwd, env, input: 'account\nblock\nq\n', encoding: 'utf8', timeout: 5000
      })
      assert.equal(restored.status, 0, restored.stderr)
      assert.ok(restored.stdout.includes('publicKey: ' + address))
      assert.ok(restored.stdout.includes('block: ' + hash))
      assert.match(restored.stdout, /balance: 5000000000 sats/)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('stops continuous mining on quit', () => {
    const output = run(['mineloop', 'q'])
    assert.match(output, /bye\n$/)
  })
})
