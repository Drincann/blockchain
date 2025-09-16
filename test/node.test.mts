import { describe, it, before, after, beforeEach, afterEach } from "node:test"
import assert from 'node:assert/strict'
import { Node } from '../src/node.mts'
import { Block } from '../src/block.mts'
import { hex } from '../src/util/crypto.mts'

function createTestNode(port: number): Node {
  const node = new Node()
  node.start(port)
  return node
}

function waitForSync(delay: number = 200): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay))
}

function getBlockchainLength(node: Node): number {
  let current = node.current
  let length = 1
  while (current.prev.some(byte => byte !== 0)) {
    const prevHash = hex(current.prev)
    const prevBlock = node.block(prevHash)
    if (!prevBlock) break
    current = prevBlock
    length++
  }
  return length
}

function getBlockchainHashes(node: Node): string[] {
  const hashes: string[] = []
  let current = node.current
  hashes.push(hex(current.hash()))

  while (current.prev.some(byte => byte !== 0)) {
    const prevHash = hex(current.prev)
    const prevBlock = node.block(prevHash)
    if (!prevBlock) break
    current = prevBlock
    hashes.push(hex(current.hash()))
  }

  return hashes.reverse() // Start from genesis block
}

async function mine(node: Node, data: string): Promise<Block> {
  const block = await node.mineAsync(new TextEncoder().encode(data))
  if (block == null) {
    assert.fail('Failed to mine block')
  }
  return block
}

describe('Blockchain Node Sync Tests', () => {
  let nodeA: Node
  let nodeB: Node
  let portA: number
  let portB: number

  beforeEach(async () => {
    // Create new node instances before each test
    portA = 3000 + Math.floor(Math.random() * 1000)
    portB = portA + 1

    nodeA = createTestNode(portA)
    nodeB = createTestNode(portB)

    // Wait for nodes to start
    await waitForSync(100)
  })

  afterEach(async () => {
    // Clean up all nodes
    if (nodeA) {
      nodeA.stop()
    }
    if (nodeB) {
      nodeB.stop()
    }
  })

  describe('Test 1: Node A mines a block, Node B connects and syncs successfully', () => {
    it('should sync one block', async () => {
      // Node A mines a block
      const minedBlock = await mine(nodeA, 'test block 1')
      console.log(`Node A mined block: ${hex(minedBlock.hash())}`)

      // Verify Node A has 2 blocks (genesis + new block)
      assert.equal(getBlockchainLength(nodeA), 2)

      // Node B connects to Node A
      const connected = await nodeB.addPeer(`localhost:${portA}`)
      assert.ok(connected, 'Node B should successfully connect to Node A')

      // Wait for sync
      await waitForSync(300)

      // Verify Node B synced Node A's block
      assert.equal(getBlockchainLength(nodeB), 2, 'Node B should have 2 blocks')

      // Verify Node B's latest block is the one mined by Node A
      const nodeBLastBlock = nodeB.current
      assert.equal(hex(nodeBLastBlock.hash()), hex(minedBlock.hash()), 'Node B\'s latest block should be the one mined by Node A')

      // Verify data content
      const nodeBData = new TextDecoder().decode(nodeBLastBlock.data)
      assert.equal(nodeBData, 'test block 1', 'Node B\'s synced block data should be correct')
    })
  })

  describe('Test 2: Node A mines three blocks, Node B connects and syncs successfully', () => {
    it('should sync three blocks', async () => {
      // Node A mines three blocks
      const blocks: Block[] = []
      for (let i = 1; i <= 3; i++) {
        const minedBlock = await mine(nodeA, `test block ${i}`)
        blocks.push(minedBlock)
        console.log(`Node A mined block ${i}: ${hex(minedBlock.hash())}`)
      }

      // Verify Node A has 4 blocks (genesis + 3 new blocks)
      assert.equal(getBlockchainLength(nodeA), 4)

      // Node B connects to Node A
      const connected = await nodeB.addPeer(`localhost:${portA}`)
      assert.ok(connected, 'Node B should successfully connect to Node A')

      // Wait for sync
      await waitForSync(500)

      // Verify Node B synced all of Node A's blocks
      assert.equal(getBlockchainLength(nodeB), 4, 'Node B should have 4 blocks')

      // Verify Node B's blockchain matches Node A's
      const nodeAHashes = getBlockchainHashes(nodeA)
      const nodeBHashes = getBlockchainHashes(nodeB)
      assert.deepStrictEqual(nodeBHashes, nodeAHashes, 'Node B\'s blockchain should match Node A\'s exactly')

      // Verify the last block
      const nodeBLastBlock = nodeB.current
      assert.equal(hex(nodeBLastBlock.hash()), hex(blocks[2].hash()), 'Node B\'s latest block should be Node A\'s third block')
    })
  })

  describe('Test 3: Node A mines a block, Node A connects to B and B syncs automatically', () => {
    it('should sync from Node A to Node B', async () => {
      // Node A mines a block
      const minedBlock = await mine(nodeA, 'test block from A')
      console.log(`Node A mined block: ${hex(minedBlock.hash())}`)

      // Node A connects to Node B
      const connected = await nodeA.addPeer(`localhost:${portB}`)
      assert.ok(connected, 'Node A should successfully connect to Node B')

      // Wait for sync
      await waitForSync(300)

      // Verify Node B synced Node A's block
      assert.equal(getBlockchainLength(nodeB), 2, 'Node B should have 2 blocks')

      // Verify Node B's latest block is the one mined by Node A
      const nodeBLastBlock = nodeB.current
      assert.equal(hex(nodeBLastBlock.hash()), hex(minedBlock.hash()), 'Node B\'s latest block should be the one mined by Node A')
    })
  })

  describe('Test 4: Node A mines three blocks, Node A connects to B and B syncs automatically', () => {
    it('should sync three blocks from Node A to Node B', async () => {
      // Node A mines three blocks
      const blocks: Block[] = []
      for (let i = 1; i <= 3; i++) {
        const minedBlock = await mine(nodeA, `test block ${i} from A`)
        blocks.push(minedBlock)
        console.log(`Node A mined block ${i}: ${hex(minedBlock.hash())}`)
      }

      // Node A connects to Node B
      const connected = await nodeA.addPeer(`localhost:${portB}`)
      assert.ok(connected, 'Node A should successfully connect to Node B')

      // Wait for sync
      await waitForSync(500)

      // Verify Node B synced all of Node A's blocks
      assert.equal(getBlockchainLength(nodeB), 4, 'Node B should have 4 blocks')

      // Verify blockchain consistency
      const nodeAHashes = getBlockchainHashes(nodeA)
      const nodeBHashes = getBlockchainHashes(nodeB)
      assert.deepStrictEqual(nodeBHashes, nodeAHashes, 'Node B\'s blockchain should match Node A\'s exactly')
    })
  })

  describe('Test 5: Bidirectional mining and sync test', () => {
    it('should support bidirectional mining and automatic sync', async () => {
      // Connect the two nodes first
      const connected = await nodeA.addPeer(`localhost:${portB}`)
      assert.ok(connected, 'Node A should successfully connect to Node B')

      await waitForSync(200)

      // Node A mines a block
      const minedBlockA = await mine(nodeA, 'block from A')
      console.log(`Node A mined block: ${hex(minedBlockA.hash())}`)

      // Wait for Node A's block to sync to Node B
      await waitForSync(300)

      // Verify Node B synced Node A's block
      assert.equal(getBlockchainLength(nodeB), 2, 'Node B should have 2 blocks')
      assert.equal(hex(nodeB.current.hash()), hex(minedBlockA.hash()), 'Node B should have synced Node A\'s block')

      // Node B mines a block
      const minedBlockB = await mine(nodeB, 'block from B')
      console.log(`Node B mined block: ${hex(minedBlockB.hash())}`)

      // Wait for Node B's block to sync to Node A
      await waitForSync(300)

      // Verify Node A synced Node B's block
      assert.equal(getBlockchainLength(nodeA), 3, 'Node A should have 3 blocks')
      assert.equal(hex(nodeA.current.hash()), hex(minedBlockB.hash()), 'Node A should have synced Node B\'s block')

      // Verify both nodes' blockchains are identical
      const nodeAHashes = getBlockchainHashes(nodeA)
      const nodeBHashes = getBlockchainHashes(nodeB)
      assert.deepStrictEqual(nodeBHashes, nodeAHashes, 'Both nodes\' blockchains should be identical')
    })
  })

  describe('Test 6: Fork handling and chain replacement - A connects to B', () => {
    it('should replace shorter chain with longer chain', async () => {
      // Node A mines two blocks
      const blocksA: Block[] = []
      for (let i = 1; i <= 2; i++) {
        const minedBlock = await mine(nodeA, `A block ${i}`)
        blocksA.push(minedBlock)
        console.log(`Node A mined block ${i}: ${hex(minedBlock.hash())}`)
      }

      // Node B mines three blocks
      const blocksB: Block[] = []
      for (let i = 1; i <= 3; i++) {
        const minedBlock = await mine(nodeB, `B block ${i}`)
        blocksB.push(minedBlock)
        console.log(`Node B mined block ${i}: ${hex(minedBlock.hash())}`)
      }

      // Verify initial state
      assert.equal(getBlockchainLength(nodeA), 3, 'Node A should have 3 blocks')
      assert.equal(getBlockchainLength(nodeB), 4, 'Node B should have 4 blocks')

      // Node A connects to Node B
      const connected = await nodeA.addPeer(`localhost:${portB}`)
      assert.ok(connected, 'Node A should successfully connect to Node B')

      // Wait for sync
      await waitForSync(500)

      // Verify Node A's chain was replaced by Node B's longer chain
      assert.equal(getBlockchainLength(nodeA), 4, 'Node A should have 4 blocks (replaced by Node B\'s chain)')
      assert.equal(hex(nodeA.current.hash()), hex(blocksB[2].hash()), 'Node A\'s latest block should be Node B\'s third block')

      // Verify Node A's blockchain matches Node B's
      const nodeAHashes = getBlockchainHashes(nodeA)
      const nodeBHashes = getBlockchainHashes(nodeB)
      assert.deepStrictEqual(nodeAHashes, nodeBHashes, 'Node A\'s blockchain should match Node B\'s exactly')
    })
  })

  describe('Test 7: Fork handling and chain replacement - B connects to A', () => {
    it('should replace shorter chain with longer chain', async () => {
      // Node A mines two blocks
      const blocksA: Block[] = []
      for (let i = 1; i <= 2; i++) {
        const minedBlock = await mine(nodeA, `A block ${i}`)
        blocksA.push(minedBlock)
        console.log(`Node A mined block ${i}: ${hex(minedBlock.hash())}`)
      }

      // Node B mines three blocks
      const blocksB: Block[] = []
      for (let i = 1; i <= 3; i++) {
        const minedBlock = await mine(nodeB, `B block ${i}`)
        blocksB.push(minedBlock)
        console.log(`Node B mined block ${i}: ${hex(minedBlock.hash())}`)
      }

      // Verify initial state
      assert.equal(getBlockchainLength(nodeA), 3, 'Node A should have 3 blocks')
      assert.equal(getBlockchainLength(nodeB), 4, 'Node B should have 4 blocks')

      // Node B connects to Node A
      const connected = await nodeB.addPeer(`localhost:${portA}`)
      assert.ok(connected, 'Node B should successfully connect to Node A')

      // Wait for sync
      await waitForSync(500)

      // Verify Node A's chain was replaced by Node B's longer chain
      assert.equal(getBlockchainLength(nodeA), 4, 'Node A should have 4 blocks (replaced by Node B\'s chain)')
      assert.equal(hex(nodeA.current.hash()), hex(blocksB[2].hash()), 'Node A\'s latest block should be Node B\'s third block')

      // Verify both nodes' blockchains are identical
      const nodeAHashes = getBlockchainHashes(nodeA)
      const nodeBHashes = getBlockchainHashes(nodeB)
      assert.deepStrictEqual(nodeBHashes, nodeAHashes, 'Both nodes\' blockchains should be identical')
    })
  })

  describe('Edge case tests', () => {
    it('should handle empty data blocks', async () => {
      // Node A mines an empty data block
      const emptyBlock = await mine(nodeA, '')
      console.log(`Node A mined empty block: ${hex(emptyBlock.hash())}`)

      // Node B connects to Node A
      const connected = await nodeB.addPeer(`localhost:${portA}`)
      assert.ok(connected)

      await waitForSync(300)

      // Verify sync success
      assert.equal(getBlockchainLength(nodeB), 2)
      assert.equal(hex(nodeB.current.hash()), hex(emptyBlock.hash()))
      assert.equal(nodeB.current.data.length, 0, 'Node B\'s synced block should have empty data')
    })

    it('should handle large block data', async () => {
      // Create a large data block
      const largeData = new Uint8Array(1000).fill(65) // 1000 'A's
      const largeBlock = await nodeA.mineAsync(largeData)
      console.log(`Node A mined large block: ${hex(largeBlock?.hash())}`)

      // Node B connects to Node A
      const connected = await nodeB.addPeer(`localhost:${portA}`)
      assert.ok(connected)

      await waitForSync(300)

      // Verify sync success
      assert.equal(getBlockchainLength(nodeB), 2)
      assert.equal(hex(nodeB.current.hash()), hex(largeBlock?.hash()))
      assert.equal(nodeB.current.data.length, 1000, 'Node B\'s synced block should have 1000 bytes of data')
    })
  })
})