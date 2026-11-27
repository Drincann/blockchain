import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Node } from '../../src/infra/node/node.mts'

const [dataDir, port, expectedHeight, expectedTip] = process.argv.slice(2)
const options = { dataDir, passphrase: 'memory test' }
const node = new Node(options)
try {
  node.start(0)
  assert.ok(await node.addPeer('127.0.0.1:' + port))
  const deadline = Date.now() + 120_000
  while (node.current.height < Number(expectedHeight)) {
    if (Date.now() > deadline) throw new Error('Catch-up timed out')
    await delay(10)
  }
  assert.equal(node.current.summary.hash, expectedTip)
  assert.equal(node.getBalance(node.current.coinbase.outputs[0].publicKey), Number(expectedHeight) * 5_000_000_000)
} finally {
  node.stop()
}
const reopened = new Node(options)
assert.equal(reopened.current.summary.hash, expectedTip)
reopened.stop()
console.log('peakKiB=' + process.resourceUsage().maxRSS)
