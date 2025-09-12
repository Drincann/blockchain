import { WebSocketServer, WebSocket } from "ws"
import { Peer, Session } from "./peer.mts"
import { Message, MessageType } from "./types.mts"

export class Server {
  private wss: WebSocketServer
  private handlers: Record<string, (session: Session) => Promise<any>> = {} as any
  private connectHandler: (session: Session) => unknown = () => { }
  private peers: Peer[] = []

  constructor({ port }: { port: number }) {
    this.wss = new WebSocketServer({ port })
    this.wss.on('connection', (ws, req) => {
      const peer = this.setupSocket(ws, req.socket.remoteAddress + ':' + req.socket.remotePort)
      if (peer) {
        this.connectHandler(peer.createSession())
      }
    })
  }

  public getPeersAddresses(): string[] {
    return this.peers.map(peer => peer.address)
  }

  public close() {
    this.peers.forEach(peer => peer.ws.terminate())
    this.peers = []
    this.wss.close()
  }

  public on(type: Exclude<MessageType, 'response'>, handler: (session: Session) => Promise<any>) {
    this.handlers[type] = handler
    return this
  }

  public onConnect(handler: (session: Session) => unknown) {
    this.connectHandler = handler
    return this
  }

  public broadcast(message: Message) {
    this.peers.forEach(peer => {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(JSON.stringify(message))
      }
    })
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
            this.connectHandler(peer.createSession())
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
        this.peers = this.peers.filter(peer => peer !== peer)
        console.log(`WebSocket client disconnected`)
      })
      ws.on('error', (error) => {
        this.peers = this.peers.filter(peer => peer !== peer)
        console.error('WebSocket error:', error)
      })
      return peer
    } catch (error) {
      console.error('Error setting up WebSocket', error)
      return null
    }
  }

}
