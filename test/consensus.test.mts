import assert from 'node:assert/strict'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { it } from 'node:test'
import { Block } from '../src/domain/block/block.mts'
import { Transaction, TxIn, TxOut } from '../src/domain/transaction/transaction.mts'
import { Account } from '../src/domain/transaction/account.mts'
import { Node } from '../src/infra/node/node.mts'
import { hex } from '../src/util/crypto.mts'

// These are ordinary, valid histories. The two mining schedules straddle the retarget thresholds.
function history(height: number, interval: number, owner: Account) {
  const blocks = [Block.deserialize(Block.GENESIS_BLOCK)]
  let work = 0n
  for (let h = 1; h <= height; h++) {
    const difficulty = h <= 10 ? 2 : interval === 4000 ? 3 : 1
    const previous = blocks[h - 1]
    const block = previous.generate({ difficulty })
    block.setTs(previous.ts + interval)
    block.addTransaction(Transaction.buildCoinbaseTx(owner.publicKey, 5_000_000_000, h))
    const nonce = Buffer.alloc(32)
    for (let n = 0; ; n++) {
      nonce.writeUInt32BE(n)
      block.setNonce(nonce)
      const digest = createHash('sha256').update(block.serialize()).digest()
      if (digest[0] < 2 ** (8 - difficulty)) break
    }
    blocks.push(block)
    work += 1n << BigInt(difficulty)
  }
  return { blocks, work }
}

it('agrees with an independent work sum even when the winning fork is shorter', () => {
  const node = new Node()
  try {
    const owner = new Account()
    const slow = history(16, 30_000, owner)
    const fast = history(12, 4000, owner)
    assert.equal(slow.work, 52n)
    assert.equal(fast.work, 56n)
    for (const { blocks, work } of [slow, fast]) {
      assert.ok(node['acceptBranch'](blocks[0], blocks.at(-1)!, work, height => blocks[height]))
      assert.equal(node.current.summary.hash, blocks.at(-1)!.summary.hash)
    }
    const tie = history(18, 30_000, owner)
    assert.equal(tie.work, fast.work)
    assert.equal(node['acceptBranch'](tie.blocks[0], tie.blocks.at(-1)!, tie.work, i => tie.blocks[i]), false)
    assert.equal(node.getBalance(owner.publicKey), 12 * 5_000_000_000)
  } finally {
    node.stop()
  }
})

it('matches integer subsidy arithmetic at every halving through the last satoshi', () => {
  const node = new Node()
  try {
    for (let era = 1; era <= 40; era++) {
      for (const height of [era * 210_000 - 1, era * 210_000, era * 210_000 + 1]) {
        const expected = 5_000_000_000n >> BigInt(Math.floor(height / 210_000))
        assert.equal(BigInt(node['getCoinbaseRewardAtHeight'](height)), expected)
      }
    }
  } finally {
    node.stop()
  }
})

it('encodes satoshis exactly and refuses unsafe amounts and aggregate totals', () => {
  const key = new Account().publicKey
  for (const amount of [0, 1, 5_000_000_000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(TxOut.deserialize(new TxOut(amount, key).serialize()).amount, amount)
  }
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new TxOut(amount, key), /satoshi range/)
  }
  const tx = new Transaction().addOutput(new TxOut(Number.MAX_SAFE_INTEGER, key)).addOutput(new TxOut(1, key))
  assert.throws(() => tx.outputValue, /satoshi range/)
})

it('verifies wallet signatures using OpenSSL and an independent unsigned encoding', () => {
  const owner = new Account()
  const key = owner.publicKey
  const pub = createPublicKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'secp256k1',
    x: Buffer.from(key.subarray(1, 33)).toString('base64url'), y: Buffer.from(key.subarray(33)).toString('base64url')
  } })
  const recipient = new Account()
  for (let i = 0; i < 128; i++) {
    const ref = createHash('sha256').update('funding-' + i).digest()
    const tx = new Transaction().addInput(new TxIn(hex(ref), i)).addOutput(new TxOut(i + 1, recipient.publicKey))
    const bytes = Buffer.alloc(8 + 36 + 73)
    bytes.writeUInt32BE(1, 0)
    bytes.writeUInt32BE(1, 4)
    ref.copy(bytes, 8)
    bytes.writeUInt32BE(i, 40)
    bytes.writeBigUInt64BE(BigInt(i + 1), 44)
    bytes.set(recipient.publicKey, 52)
    owner.signTxIn(tx, 0)
    assert.equal(hex(tx.id), createHash('sha256').update(bytes).digest('hex'))
    assert.ok(verify('sha256', bytes, pub, tx.inputs[0].signature!))
    assert.ok(!Account.verifyTxIn(tx, 0, recipient.publicKey))
    tx.outputs[0].amount++
    assert.ok(!Account.verifyTxIn(tx, 0, key))
  }
})

it('agrees with a 256-bit target comparison at every representable difficulty', () => {
  for (let bits = 0; bits <= 255; bits++) {
    const threshold = 1n << BigInt(256 - bits)
    const values = [threshold - 1n]
    if (bits) values.push(threshold, threshold + 1n)
    for (let i = 0; i < 16; i++) {
      const digest = createHash('sha256').update(bits + '/' + i).digest('hex')
      values.push(BigInt('0x' + digest))
    }
    for (const value of values) {
      const hash = Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
      assert.equal(Block.meetsDifficulty(hash, bits), value < threshold)
    }
  }
})

it('enforces coinbase value and height, including the zero-subsidy era', () => {
  const key = new Account().publicKey
  for (let era = 0; era <= 40; era++) {
    const height = era * 210_000 + 1
    const subsidy = Number(5_000_000_000n >> BigInt(era))
    for (const fees of [0, 189, 1024]) {
      const limit = subsidy + fees
      const reward = Transaction.buildCoinbaseTx(key, limit, height)
      reward.validateCoinbase(height, limit)
      assert.throws(() => reward.validateCoinbase(height + 1, limit), /coinbase/i)
      reward.outputs[0].amount++
      assert.throws(() => reward.validateCoinbase(height, limit), /exceeds maximum/)
    }
  }
})

it('consumes a confirmed payment input only once and keeps the confirmed balances', async () => {
  const node = new Node()
  try {
    await node.mineAsync()
    const receiver = new Account()
    const { tx } = node.send(receiver.publicKey, 1000)
    await node.mineAsync()
    const before = node.getBalance()
    assert.throws(() => node['validateTransaction'](tx), /not found/)
    assert.equal(node.getBalance(), before)
    assert.equal(node.getBalance(receiver.publicKey), 1000)
  } finally {
    node.stop()
  }
})

it('can keep mining when the local clock is behind valid recent blocks', async t => {
  const node = new Node()
  try {
    const localTime = Date.now()
    const fastClock = t.mock.method(Date, 'now', () => localTime + 30_000)
    for (let i = 0; i < 4; i++) assert.ok(await node.mineAsync())
    fastClock.mock.restore()
    const next = await node.mineAsync()
    assert.ok(next)
    assert.ok(next.ts >= localTime + 30_000)
    assert.equal(node.current.height, 5)
  } finally {
    node.stop()
  }
})

it('rolls back staged changes if the proposed chain work disagrees with validated headers', () => {
  const node = new Node()
  try {
    const initial = node.current
    const owner = new Account()
    const { blocks, work } = history(12, 4000, owner)
    assert.throws(() => node['acceptBranch'](initial, blocks[12], work + 1n, h => blocks[h]), /validated branch/i)
    assert.ok(node.current.equals(initial))
    assert.equal(node.block(blocks[1].summary.hash), undefined)
    assert.equal(node.getBalance(owner.publicKey), 0)
  } finally {
    node.stop()
  }
})

it('keeps retarget cutoffs and wire-format difficulty bounds', () => {
  const node = new Node()
  try {
    for (const height of [9, 10, 11]) {
      for (const difficulty of [1, 2, 254, 255]) {
        for (const elapsed of [49_999, 50_000, 100_000, 200_000, 200_001]) {
          const ts = 1_000_000
          const prev = new Block({ height, ts, difficulty, prev: new Uint8Array(32), nonce: new Uint8Array(32), txs: new Uint8Array() })
          const times = Array.from({ length: 10 }, (_, i) => ts - Math.floor(i * elapsed / 9))
          const delta = height !== 10 ? 0 : elapsed < 50_000 ? 1 : elapsed > 200_000 ? -1 : 0
          assert.equal(node['getExpectedDifficulty'](prev, times), Math.max(1, Math.min(255, difficulty + delta)))
        }
      }
    }
  } finally {
    node.stop()
  }
})
