import { WebSocketServer, WebSocket } from "ws"
import { Peer, Session } from "./peer.mts"
import { isMessage, isPeerAddress, Message, MessageType } from "./types.mts"
import { config, MAX_CONNECTED_PEERS, MAX_DISCOVERED_PEERS, MAX_PEER_MESSAGE_BYTES } from "../../app/config.mts"
import { uuid } from "../../util/crypto.mts"

export class Server {
  private nodeId = uuid()
  private wss: WebSocketServer
  private handlers = new Map<MessageType, (session: Session) => Promise<unknown>>()
  private connectHandler: (session: Session) => unknown = () => { }
  private peers: Peer[] = []
  private knownAddresses: Set<string> = new Set()
  private stopping = false
  private refreshInterval: NodeJS.Timeout | null = null

  constructor({ port, host }: { port: number, host?: string }) {
    this.wss = new WebSocketServer({ port, host, maxPayload: MAX_PEER_MESSAGE_BYTES })
    this.wss.on('connection', (ws, req) => {
      if (this.peers.length >= MAX_CONNECTED_PEERS) {
        ws.on('error', () => ws.terminate())
        ws.close(1013, 'Peer capacity reached')
        return
      }
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
      if (!this.stopping) this.scheduleRefreshAddresses()
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
      for (const address of response.peers.slice(0, MAX_DISCOVERED_PEERS)) {
        if (this.knownAddresses.size >= MAX_DISCOVERED_PEERS) break
        if (isPeerAddress(address)) this.knownAddresses.add(address)
      }
    }
  }

  public discoveredAddresses(): string[] {
    return [...this.knownAddresses]
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
    this.handlers.set(type, handler)
    return this
  }

  public onConnect(handler: (session: Session) => unknown) {
    this.connectHandler = handler
    return this
  }

  public broadcast(message: Message) {
    for (const peer of this.peers) peer.send(message)
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
    if (this.stopping || this.peers.length >= MAX_CONNECTED_PEERS || !isPeerAddress(address)) return Promise.resolve(null)
    return new Promise((resolve) => {
      try {
        const socket = new WebSocket("ws://" + address, { maxPayload: MAX_PEER_MESSAGE_BYTES })
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
    if (typeof message.data.nodeId !== 'string' || message.data.nodeId.length > 128 ||
        (message.data.listenAddress != null && message.data.listenAddress !== '' && !isPeerAddress(message.data.listenAddress))) {
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
    if (message.data.listenAddress) {
      peer.listenAddress = message.data.listenAddress
    }
    return
  }

  private setupSocket(ws: WebSocket, address: string): Peer | null {
    try {
      const pendingRequests = new Map<number, (message: Message) => void>()

      const peer = new Peer(address, ws, (syncId, callback) => {
        pendingRequests.set(syncId, callback)
        return () => { pendingRequests.delete(syncId) }
      })

      this.peers.push(peer)
      ws.on('message', async (data: Buffer) => {
        try {
          let message: unknown
          try {
            message = JSON.parse(data.toString())
          } catch {
            ws.close(1008, 'Invalid JSON')
            return
          }
          if (!isMessage(message)) {
            ws.close(1008, 'Invalid message')
            return
          }
          if (message.type === 'response' && message.id !== undefined) {
            const callback = pendingRequests.get(message.id)
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

          const handler = this.handlers.get(message.type)
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

}
