import assert from 'node:assert/strict'
import { it } from 'node:test'
import { isHash } from '../src/util/crypto.mts'
import { isMessage, isPeerAddress } from '../src/infra/p2p/types.mts'

it('validates message envelopes, request IDs and endpoint syntax', () => {
  for (const value of [null, [], 'blockinv', {}, { type: 'other', data: {} }, { type: 'response', data: {} }]) {
    assert.equal(isMessage(value), false)
  }
  for (const id of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isMessage({ type: 'response', id, data: {} }), false)
  }
  for (const type of ['getblock', 'nodeinfo', 'txinv', 'gettx', 'getpeers', 'blockinv', 'response']) {
    assert.ok(isMessage({ type, id: 0, data: {} }))
  }
  for (const address of ['localhost:3001', '127.0.0.1:4000', 'node-1.example:65535', '[::1]:1']) {
    assert.ok(isPeerAddress(address))
  }
  for (const address of ['localhost:0', 'localhost:65536', 'host/path:80', 'a..b:2', '[]:1', '[:::]:12', null]) {
    assert.equal(isPeerAddress(address), false)
  }
  for (let i = 0; i < 10_000; i++) {
    const hash = i.toString(16).padStart(64, '0')
    assert.ok(isHash(hash))
    assert.equal(isHash(hash.slice(1)), false)
    assert.equal(isHash(hash + '0'), false)
  }
})
