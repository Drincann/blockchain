import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { listenLocal } from '../fixtures/listen-local.mts'
import { Account } from '../../src/domain/transaction/account.mts'
import { Node } from '../../src/infra/node/node.mts'
import { hex } from '../../src/util/crypto.mts'

function address(node: Node): string {
  const socket = node['server']!['wss'].address()
  assert.ok(socket && typeof socket !== 'string')
  return '127.0.0.1:' + socket.port
}

async function waitForTip(nodes: Node[], hash: string, phase: string) {
  const deadline = Date.now() + 30_000
  while (true) {
    const ready = nodes.filter(node => node.current.summary.hash === hash).length
    if (ready === nodes.length) return
    assert.ok(Date.now() < deadline, `${phase}: ${ready}/${nodes.length} nodes on expected tip`)
    await delay(20)
  }
}

async function joinStar(nodes: Node[], root: Node) {
  // Stagger initial catch-up; every connection stays open for live propagation.
  for (let i = 0; i < nodes.length; i += 2) {
    const pair = nodes.slice(i, i + 2)
    await Promise.all(pair.map(async n => assert.ok(await n.addPeer(address(root)))))
    await waitForTip(pair, root.current.summary.hash, 'initial catch-up')
  }
}

it('reconciles 32 persistent nodes, signed transfers and two independently mined branches', { timeout: 300_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ledger-network-'))
  const count = 32
  const wallets = Array.from({ length: count }, () => new Account())
  const miner = new Account()
  const reward = 5_000_000_000n
  const balances = new Map<string, bigint>()
  const ids: string[] = []
  const adjust = (key: Account, delta: bigint) => {
    const id = hex(key.publicKey)
    balances.set(id, (balances.get(id) ?? 0n) + delta)
  }
  const open = (i: number, reindex = false) => new Node({
    dataDir: join(root, String(i)), passphrase: 'network test', reindex
  })
  let nodes: Node[] = []
  try {
    nodes = Array.from({ length: count }, (_, i) => open(i))
    const source = nodes[0]
    for (const wallet of wallets) {
      source.importAccount(wallet)
      assert.ok(await source.mineAsync())
      adjust(wallet, reward)
    }
    for (let round = 0; round < count; round++) {
      let fees = 0n
      for (const [i, wallet] of wallets.entries()) {
        const recipient = wallets[(i + 1 + round % 7) % count]
        const sats = 1000 + round * count + i
        source.importAccount(wallet)
        const payment = source.send(recipient.publicKey, sats)
        // One input and two outputs, with a 1 sat/byte fee on this fixture.
        assert.equal(payment.fees, 8 + 108 + 2 * 73)
        fees += BigInt(payment.fees)
        adjust(wallet, -BigInt(sats + payment.fees))
        adjust(recipient, BigInt(sats))
        ids.push(hex(payment.tx.id))
      }
      source.importAccount(miner)
      const block = await source.mineAsync()
      assert.equal(block?.transactions.length, count)
      adjust(miner, reward + fees)
    }
    assert.equal(new Set(ids).size, 1024)
    await Promise.all(nodes.map(listenLocal))
    await joinStar(nodes.slice(1), source)
    nodes.forEach(n => n.stop())

    nodes = Array.from({ length: count }, (_, i) => open(i))
    const older = nodes[0], heavier = nodes[count / 2]
    older.importAccount(wallets[0])
    const detached = older.send(wallets[1].publicKey, 700)
    assert.ok(await older.mineAsync())
    heavier.importAccount(miner)
    assert.ok(await heavier.mineAsync())
    assert.ok(await heavier.mineAsync())
    adjust(miner, 2n * reward)
    const winningTip = heavier.current.summary.hash

    await Promise.all(nodes.map(listenLocal))
    await joinStar(nodes.slice(1, count / 2), older)
    await joinStar(nodes.slice(count / 2 + 1), heavier)
    assert.ok(await older.addPeer(address(heavier)))
    await waitForTip(nodes, winningTip, 'partition healed')

    const spender = nodes[3], confirmer = nodes[count - 1]
    spender.importAccount(wallets[3])
    const live = spender.send(wallets[29].publicKey, 3030)
    const liveId = hex(live.tx.id)
    const deadline = Date.now() + 30_000
    while (!nodes.every(node => node.transaction(liveId))) {
      assert.ok(Date.now() < deadline, 'Live payment did not reach every peer')
      await delay(20)
    }
    confirmer.importAccount(miner)
    const confirmed = await confirmer.mineAsync()
    assert.ok(confirmed)
    assert.ok(confirmed.transactions.some(tx => hex(tx.id) === liveId))
    const expectedTip = confirmed.summary.hash
    await waitForTip(nodes, expectedTip, 'live confirmation')
    adjust(wallets[3], -BigInt(3030 + live.fees))
    adjust(wallets[29], 3030n)
    adjust(miner, reward + BigInt(live.fees))

    nodes.forEach(n => n.stop())
    nodes = Array.from({ length: count }, (_, i) => open(i, i === 0 || i === count - 1))
    for (const node of nodes) {
      assert.equal(node.current.summary.hash, expectedTip)
      assert.equal(node.transaction(hex(detached.tx.id)), undefined)
      let supply = 0n
      for (const wallet of [...wallets, miner]) {
        const value = BigInt(node.getBalance(wallet.publicKey))
        assert.equal(value, balances.get(hex(wallet.publicKey)))
        supply += value
      }
      assert.equal(supply, 67n * reward)
      for (const id of [ids[0], ids[511], ids[1023], liveId]) assert.ok(node.transaction(id)?.block)
    }
    console.log('32 offline restarts, 1,025 canonical payments including a live relay, 1,056 wallet balance comparisons, 2 full replays')
  } finally {
    nodes.forEach(n => n.stop())
    rmSync(root, { recursive: true, force: true })
  }
})
