import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const tsx = createRequire(import.meta.url).resolve('tsx/cli')
const cli = fileURLToPath(new URL('../src/app/cli.mts', import.meta.url))

function run(commands: string[]): string {
  const result = spawnSync(process.execPath, [tsx, cli, '0', '--memory'], {
    input: commands.join('\n') + '\n',
    encoding: 'utf8',
    timeout: 5000
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

describe('CLI', () => {
  it('keeps the active account after an invalid import and rejects a partial amount', () => {
    const output = run(['account', 'importprivatekey 00', 'account', 'send 04 1e3', 'q'])
    const keys = [...output.matchAll(/publicKey: (\w+)/g)].map(match => match[1])
    assert.equal(keys.length, 2)
    assert.equal(keys[0], keys[1])
    assert.match(output, /failed to import private key/)
    assert.match(output, /amount must be a positive integer/)
  })

  it('uses the same wallet and chain from the default and explicit data path', t => {
    const cwd = mkdtempSync(join(tmpdir(), 'blockchain-cli-'))
    t.after(() => rmSync(cwd, { recursive: true, force: true }))
    const env = { ...process.env, BLOCKCHAIN_WALLET_PASSPHRASE: 'test wallet' }
    const created = spawnSync(process.execPath, [tsx, cli, '0'], {
      cwd, env, input: 'mine persistence\naccount\nq\n', encoding: 'utf8', timeout: 5000
    })
    assert.equal(created.status, 0, created.stderr)
    const hash = /new block: (\w+)/.exec(created.stdout)?.[1]
    const address = /publicKey: (\w+)/.exec(created.stdout)?.[1]
    assert.ok(hash && address)
    const restored = spawnSync(process.execPath, [tsx, cli, '0', '--data-dir', '.blockchain/node-0', '--reindex'], {
      cwd, env, input: 'account\nblock\nq\n', encoding: 'utf8', timeout: 5000
    })
    assert.equal(restored.status, 0, restored.stderr)
    assert.ok(restored.stdout.includes('publicKey: ' + address))
    assert.ok(restored.stdout.includes('block: ' + hash))
    assert.match(restored.stdout, /balance: 5000000000 sats/)
  })

  it('stops continuous mining on quit', () => {
    const output = run(['mineloop', 'q'])
    assert.match(output, /bye\n$/)
  })
})
