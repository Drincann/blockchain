import { it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { commandReader } from '../src/app/console.mts'

it('edits recalled commands with Up and Down and skips key imports', () => {
  const term = process.env.TERM
  process.env.TERM = 'xterm-256color'
  const input = new PassThrough()
  const output = new Writable({ write(_chunk, _encoding, done) { done() } })
  const reader = commandReader(input, output, true)
  const seen: string[] = []
  reader.on('line', line => seen.push(line))
  try {
    input.write('balance\rpeer list\r')
    input.write('\x1b[A\x1b[A\x1b[B\r')
    assert.deepEqual(seen, ['balance', 'peer list', 'peer list'])
    input.write('  importprivatekey 01\r')
    input.write('\x1b[A\r')
    assert.deepEqual(seen.slice(-2), ['  importprivatekey 01', 'peer list'])
    input.write('\x1b[A edited\r')
    assert.equal(seen.at(-1), 'peer list edited')
  } finally {
    if (term === undefined) delete process.env.TERM
    else process.env.TERM = term
    reader.close()
    input.destroy()
    output.destroy()
  }
})
