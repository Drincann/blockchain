import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const tsx = createRequire(import.meta.url).resolve('tsx/cli')
const cli = fileURLToPath(new URL('../src/app/cli.mts', import.meta.url))

function run(commands: string[]): string {
  const result = spawnSync(process.execPath, [tsx, cli, '0'], {
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

  it('stops continuous mining on quit', () => {
    const output = run(['mineloop', 'q'])
    assert.match(output, /bye\n$/)
  })
})
