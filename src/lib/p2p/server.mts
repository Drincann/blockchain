import { WebSocketServer, WebSocket } from "ws"
import { Peer, Session } from "./peer.mts"
import { Message, MessageType } from "./types.mts"
import { config } from "../../config.mts"
import { uuid } from "../../util/crypto.mts"

export class Server {
  private nodeId = uuid()
  private wss: WebSocketServer
  private handlers: Record<string, (session: Session) => Promise<any>> = {} as any
  private connectHandler: (session: Session) => unknown = () => { }
  private peers: Peer[] = []
  private knownAddresses: Set<string> = new Set()
  private stopping = false
  private refreshInterval: NodeJS.Timeout | null = null

  constructor({ port }: { port: number }) {
    this.wss = new WebSocketServer({ port })
    this.wss.on('connection', (ws, req) => {
      const peer = this.setupSocket(ws, req.socket.remoteAddress + ':' + req.socket.remotePort)
      if (peer) {
        this.connectHandler(peer.createSession())
        this.discoverNewPeersFrom(peer)
      }
    })
    this.scheduleRefreshAddresses()
  }

  private scheduleRefreshAddresses() {
    this.refreshInterval = setTimeout(async () => {
      await this.refreshAddresses()
      this.scheduleRefreshAddresses()
    }, 60_000)
  }

  private async refreshAddresses() {
    const peers = this.randomPeers(2)
    for (let peer of peers) {
      await this.discoverNewPeersFrom(peer)
    }
  }

  private async discoverNewPeersFrom(peer: Peer) {
    const response = await peer.createSession().request('getpeers', {}).catch(() => ({ peers: [] }))
    if (Array.isArray(response.peers)) {
      response.peers.forEach((address: string) => {
        this.knownAddresses.add(address)
      })
    }
  }

  public getPeersAddresses(): string[] {
    return this.peers.map(peer => peer.listenAddress ?? peer.address)
  }

  public close() {
    this.stopping = true
    this.peers.forEach(peer => peer.ws.terminate())
    this.peers = []
    this.wss.close()
    if (this.refreshInterval) {
      clearTimeout(this.refreshInterval)
      this.refreshInterval = null
    }
  }

  public on(type: Exclude<MessageType, 'nodeinfo' | 'response'>, handler: (session: Session) => Promise<any>) {
    this.handlers[type] = handler
    return this
  }

  public onConnect(handler: (session: Session) => unknown) {
    this.connectHandler = handler
    return this
  }

  public broadcast(message: Message) {
    const peers: Peer[] = []
    if (this.peers.length < 8) {
      peers.push(...this.peers)
    } else {
      peers.push(...this.randomPeers(8))
    }

    peers.forEach(peer => {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(JSON.stringify(message))
      }
    })
  }

  private randomPeers(num: number): Peer[] {
    if (this.peers.length <= num) {
      return [...this.peers]
    }

    const peers: Peer[] = []
    while (peers.length < num) {
      const peer = this.peers[Math.floor(Math.random() * this.peers.length)]
      if (!peers.includes(peer)) {
        peers.push(peer)
      }
    }
    return peers
  }

  public connect(address: string): Promise<Peer | null> {
    return new Promise((resolve) => {
      try {
        const socket = new WebSocket("ws://" + address)
        const peer = this.setupSocket(socket, address)
        let open = false
        socket.once('error', () => { resolve(null) })
        socket.once('close', () => { resolve(null) })
        socket.on('open', () => {
          open = true
          resolve(peer)
          if (peer) {
            peer.listenAddress = address
            const session = peer.createSession()
            session.send('nodeinfo', { nodeId: this.nodeId, listenAddress: config.listenAddress })

            this.connectHandler(session)
            this.discoverNewPeersFrom(peer)
          }
        })

        setTimeout(() => {
          if (!open) {
            socket.close()
            resolve(null)
          }
        }, 1000)
      } catch (error) {
        console.error('Error connecting to WebSocket:', error)
        resolve(null)
      }
    })
  }

  private handleNodeInfo(peer: Peer, message: Message) {
    if (isInvalidHandshake(message.data)) {
      console.error('Invalid nodeinfo data')
      peer.ws.close()
      this.peers = this.peers.filter(p => p !== peer)
      return
    }
    if (message.data.nodeId === this.nodeId) {
      console.error('Connected to self, closing connection')
      peer.ws.close()
      this.peers = this.peers.filter(p => p !== peer)
      return
    }
    if (message.data.listenAddress?.trim().length > 0) {
      peer.listenAddress = message.data.listenAddress
    }
    return
  }

  private setupSocket(ws: WebSocket, address: string): Peer | null {
    try {
      const pendingRequests: Record<number, (message: Message) => void> = {}

      const peer = new Peer(address, ws, (syncId, callback) => { pendingRequests[syncId] = callback })

      this.peers.push(peer)
      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as Message
          if (message.type === 'response' && message.id !== undefined) {
            const callback = pendingRequests[message.id]
            delete pendingRequests[message.id]
            callback?.(message)
            return
          }

          if (message.type === 'nodeinfo') {
            this.handleNodeInfo(peer, message)
            return
          }

          if (message.type === 'getpeers') {
            peer.createSession(message).respond({ peers: this.peers.map(p => p.listenAddress).filter(addr => addr != null && addr !== peer.listenAddress) })
            return
          }

          const handler = this.handlers[message.type]
          if (!handler) {
            console.error(`WebSocket handler for ${message.type} not found`)
            return
          }

          handler(peer.createSession(message)).catch(error => {
            console.error(`WebSocket ${message.type} error`, error)
          })
        } catch (error) {
          console.error('Error handling WebSocket message', error)
        }
      })

      ws.on('close', () => {
        this.peers = this.peers.filter(p => p !== peer)
        this.tryConnectAnother()
      })
      ws.on('error', (error) => {
        this.peers = this.peers.filter(p => p !== peer)
        console.error('WebSocket error:', error)
      })
      return peer
    } catch (error) {
      console.error('Error setting up WebSocket', error)
      return null
    }
  }


  private async tryConnectAnother() {
    while (!this.stopping && this.peers.length < 8 && this.knownAddresses.size > 0) {
      const address = pop(this.knownAddresses)
      if (address != null && this.peers.find(p => p.address === address) == null) {
        const newPeer = await this.connect(address)
        if (newPeer) {
          return
        }
      }
    }
  }
}

function pop<T>(set: Set<T>): T | undefined {
  for (const item of set) {
    set.delete(item)
    return item
  }
  return undefined
}

function isInvalidHandshake(data: Record<string, any>) {
  return data === undefined || typeof data.nodeId !== 'string'
}
