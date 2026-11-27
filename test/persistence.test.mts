import Database from 'better-sqlite3'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Account } from '../src/domain/transaction/account.mts'
import { Node } from '../src/infra/node/node.mts'
import { hex } from '../src/util/crypto.mts'

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'blockchain-test-'))
  const nodes: Node[] = []
  t.after(() => {
    nodes.forEach(node => node.stop())
    rmSync(root, { recursive: true, force: true })
  })
  function open(name: string, reindex = false) {
    const node = new Node({ dataDir: join(root, name), passphrase: 'fixture passphrase', reindex })
    nodes.push(node)
    return node
  }
  return { root, open }
}

async function connect(node: Node, peer: Node) {
  const address = peer['server']!['wss'].address()
  assert.ok(address && typeof address !== 'string')
  assert.ok(await node.addPeer(`127.0.0.1:${address.port}`))
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for sync')
    await delay(10)
  }
}

it('restores a confirmed payment, key and spendable balance offline', async t => {
  const { open, root } = fixture(t)
  const a = open('a'), b = open('b')
  a.start(0)
  b.start(0)
  const address = b.account.publicKey
  await a.mineAsync()
  const { tx } = a.send(address, 1000)
  const block = await a.mineAsync()
  assert.ok(block)
  await connect(b, a)
  await until(() => b.current.equals(block))
  a.stop()
  b.stop()

  const recovered = open('b')
  assert.deepEqual(recovered.account.publicKey, address)
  assert.equal(recovered.getBalance(), 1000)
  assert.ok(recovered.transaction(hex(tx.id))?.block?.equals(block))
  assert.ok(recovered.current.equals(block))
  assert.ok(!readFileSync(join(root, 'b/wallet.json'), 'utf8').includes(hex(recovered.account.privateKey)))
  const payment = recovered.send(new Account().publicKey, 500)
  assert.ok(await recovered.mineAsync())
  assert.ok(recovered.transaction(hex(payment.tx.id))?.block)
})

it('persists imports and refuses a second writer, wrong passphrase or missing wallet', t => {
  const { open, root } = fixture(t)
  const account = new Account()
  const node = open('wallet')
  node.importAccount(account)
  assert.throws(() => open('wallet'), /locked|busy/i)
  node.stop()
  const wallet = join(root, 'wallet/wallet.json')
  const original = readFileSync(wallet)
  assert.throws(() => new Node({ dataDir: join(root, 'wallet'), passphrase: 'wrong' }), /unlock/)
  assert.deepEqual(readFileSync(wallet), original)
  const reopened = open('wallet')
  assert.deepEqual(reopened.account.publicKey, account.publicKey)
  reopened.stop()
  unlinkSync(wallet)
  assert.throws(() => open('wallet'), /Missing wallet/)
})

it('restores local pending sends, reserves their inputs and relays them on reconnect', async t => {
  const { open } = fixture(t)
  const a = open('a'), b = open('b')
  await a.mineAsync()
  const { tx } = a.send(b.account.publicKey, 1000)
  a.stop()
  const restored = open('a')
  assert.equal(hex(restored.transaction(hex(tx.id))!.tx.id), hex(tx.id))
  assert.throws(() => restored.send(b.account.publicKey, 1), /Insufficient/)
  restored.start(0)
  b.start(0)
  await connect(b, restored)
  await until(() => !!b.transaction(hex(tx.id)))
  const mined = await b.mineAsync()
  assert.ok(mined)
  await until(() => restored.current.equals(mined))
  restored.stop()
  assert.ok(open('a').transaction(hex(tx.id))?.block?.equals(mined))
})

it('restores a fork and its indexes identically after restart and full replay', async t => {
  const { open } = fixture(t)
  const a = open('a'), b = open('b')
  a.start(0)
  b.start(0)
  await a.mineAsync()
  a.send(b.account.publicKey, 2000)
  const common = await a.mineAsync()
  assert.ok(common)
  await connect(b, a)
  await until(() => b.current.equals(common))
  a.stop()
  await until(() => !b.peer().length)

  const losing = open('a')
  const recipient = new Account()
  const abandoned = losing.send(recipient.publicKey, 700)
  const abandonedBlock = await losing.mineAsync()
  assert.ok(abandonedBlock)
  const payment = b.send(recipient.publicKey, 1200)
  await b.mineAsync()
  const tip = await b.mineAsync()
  assert.ok(tip)
  losing.start(0)
  await connect(losing, b)
  await until(() => losing.current.equals(tip))
  losing.stop()

  for (const rebuild of [false, true]) {
    const node = open('a', rebuild)
    assert.ok(node.current.equals(tip))
    assert.equal(node.block(hex(abandonedBlock.hash())), undefined)
    assert.equal(node.transaction(hex(abandoned.tx.id)), undefined)
    assert.ok(node.transaction(hex(payment.tx.id))?.block)
    assert.equal(node.getBalance(recipient.publicKey), 1200)
    assert.deepEqual(node.getUnspentOutputs(b.account.publicKey), b.getUnspentOutputs())
    node.stop()
  }
})

it('rolls back a rebuild if a stored historical block is damaged', async t => {
  const { root, open } = fixture(t)
  const node = open('history')
  await node.mineAsync()
  await node.mineAsync()
  node.stop()
  const filename = join(root, 'history/chain.sqlite')
  const db = new Database(filename)
  const count = db.prepare('SELECT COUNT(*) AS count FROM outputs').get()
  db.prepare('UPDATE blocks SET bytes = zeroblob(length(bytes)) WHERE height = 1').run()
  db.close()
  assert.throws(() => open('history', true), /does not match/)
  const after = new Database(filename, { readonly: true })
  assert.deepEqual(after.prepare('SELECT COUNT(*) AS count FROM outputs').get(), count)
  after.close()
})

it('keeps the old tip and pending payment when an index write fails', async t => {
  const { root, open } = fixture(t)
  const original = open('disk-error')
  const tip = await original.mineAsync()
  assert.ok(tip)
  const { tx } = original.send(new Account().publicKey, 600)
  original.stop()
  const filename = join(root, 'disk-error/chain.sqlite')
  const db = new Database(filename)
  db.exec("CREATE TRIGGER fail_index BEFORE INSERT ON outputs BEGIN SELECT RAISE(ABORT, 'injected write failure'); END")
  db.close()
  const node = open('disk-error')
  await assert.rejects(node.mineAsync(), /injected write failure/)
  assert.ok(node.current.equals(tip))
  assert.equal(node.transaction(hex(tx.id))?.block, undefined)
  node.stop()
  const repaired = new Database(filename)
  repaired.exec('DROP TRIGGER fail_index')
  repaired.close()
  const recovered = open('disk-error')
  assert.equal(hex(recovered.transaction(hex(tx.id))!.tx.id), hex(tx.id))
  const confirmed = await recovered.mineAsync()
  assert.ok(confirmed)
  assert.ok(recovered.block(hex(tip.hash()))?.next?.equals(confirmed))
})

it('recovers the entire old ledger when killed inside an uncommitted rewind', { timeout: 10000 }, async t => {
  const { open, root } = fixture(t)
  const node = open('crash')
  await node.mineAsync()
  const { tx } = node.send(new Account().publicKey, 1000)
  const tip = await node.mineAsync()
  assert.ok(tip)
  const balance = node.getBalance()
  node.stop()
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/interrupted-write.mts', import.meta.url)), join(root, 'crash')])
  t.after(() => child.kill('SIGKILL'))
  const exited = once(child, 'exit')
  const [signal] = await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw new Error('Child exited before its transaction') })])
  assert.match(signal.toString(), /uncommitted/)
  child.kill('SIGKILL')
  await exited
  const restored = open('crash')
  assert.ok(restored.current.equals(tip))
  assert.equal(restored.getBalance(), balance)
  assert.ok(restored.transaction(hex(tx.id))?.block?.equals(tip))
})
