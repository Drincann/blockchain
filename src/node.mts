import { Block } from "./block.mts";
import { Session, Server } from "./lib/p2p/index.mts";
import { hex, hexBytes } from "./util/crypto.mts";
import { SyncronizedQueue } from "./lib/queue.mts";

export class Node {
  private blocks: Record<string, Block> = { [hex(Block.GENESIS_BLOCK_HASH)]: Block.deserialize(Block.GENESIS_BLOCK) }
  private tail: Block = Block.deserialize(Block.GENESIS_BLOCK)
  private server: Server
  private queue: SyncronizedQueue = new SyncronizedQueue()
  public constructor() { }

  public get current() {
    return this.tail
  }

  public stop() {
    this.server?.close()
  }

  public peer() {
    return this.server.getPeersAddresses()
  }

  public block(hash: string): Block {
    return this.blocks[hash]
  }

  public start(port: number): void {
    this.server = new Server({ port })
      .on('inventory', (...args) => this.queue.schedule(() => this.onNewBlocks(...args)).catch(() => console.error('Inventory handler error')))
      .on('block', this.getBlock.bind(this))
      .onConnect(peer => peer.send('inventory', this.tail.summary))

    console.log(`Node started on port ${port}`)
  }

  public mine(data: Uint8Array): Block {
    const newBlock = this.tail.generate(data)
    this.tail.connect(newBlock)
    this.tail = newBlock
    this.blocks[hex(newBlock.hash())] = newBlock

    this.server.broadcast({ type: 'inventory', data: newBlock.summary })
    return newBlock
  }

  public async addPeer(address: string): Promise<boolean> {
    const socket = await this.server.connect(address)
    if (socket != null) {
      return true
    }

    return false
  }

  private async fetchBlock(peer: Session, hash: string): Promise<Block | undefined> {
    return this.fetchBlocks(peer, [hash]).then(blocks => blocks[hash]).catch(() => undefined)
  }

  private async fetchBlocks(peer: Session, hashes: string[]): Promise<Record<string, Block>> {
    let hash2Block = await peer.request('block', { hash: hashes });
    if (isValidStringStringMap(hash2Block)) {
      const blocks = {}
      for (const hash in hash2Block) {
        blocks[hash] = Block.deserialize(hexBytes(hash2Block[hash]))
      } return blocks
    }
    return {}
  }

  private async onNewBlocks(session: Session): Promise<void> {
    const newBlockSummary = session.data
    if (Block.isValidBlockSummary(newBlockSummary)) {
      if (this.blocks[newBlockSummary.hash] || this.tail.height > newBlockSummary.height) {
        return
      }

      const orphans = {}

      let newBlock = await this.fetchBlock(session, newBlockSummary.hash)
      if (!newBlock) {
        return
      }

      let block = newBlock
      orphans[hex(block.hash())] = block

      let prevHash = hex(block.prev)
      while (this.blocks[prevHash] === undefined) {
        const prev = await this.fetchBlock(session, prevHash);
        if (!prev) {
          return
        }
        if (prev.isInvalidNext(block)) {
          console.log('Received invalid block from peer: ' + session.peer.address
            + ', current block: ' + JSON.stringify(block.display())
            + ', previous block: ' + JSON.stringify(prev?.display())
            + ', expected previous hash: ' + hex(prev?.hash())
            + ', actual previous hash: ' + hex(block.prev)
          )
        }

        prev.connect(block)
        orphans[prevHash] = prev

        block = prev
        prevHash = hex(block.prev)
      }

      const fork = this.blocks[prevHash]
      let toDeleteBlock = fork.next
      fork.connect(block)

      while (toDeleteBlock) {
        delete this.blocks[hex(toDeleteBlock.hash())]
        toDeleteBlock = toDeleteBlock.next
      }

      for (const hash in orphans) {
        this.blocks[hash] = orphans[hash]
      }

      this.tail = newBlock
    }
  }

  private async getBlock(session: Session): Promise<void> {
    const hashes = session.data?.hash
    if (!Array.isArray(hashes)) {
      session.respond({})
      return
    }

    const serializedBlocks = {}
    for (const hash of hashes) {
      serializedBlocks[hash] = hex(this.blocks[hash]?.serialize())
    }
    session.respond(serializedBlocks)
  }
}

function isValidStringStringMap(rawResponse: any): rawResponse is Record<string, string> {
  return typeof rawResponse === 'object' && rawResponse !== null
    && Object.values(rawResponse).every(value => typeof value === 'string')
    && Object.keys(rawResponse).every(key => typeof key === 'string')
}
