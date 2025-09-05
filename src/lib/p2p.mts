import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'

export interface Message {
  id?: number,
  type: string,
  data: Record<string, any>
}

export interface ClientInterface<MessageType extends string> {
  client: Client
  request: (type: MessageType, data: Record<string, any>) => Promise<Record<string, any>>
  respond: (data: Record<string, any>) => void
  send: (type: MessageType, data: Record<string, any>) => unknown
}

export class Server<MessageType extends string> {
  private wss: WebSocketServer
  private handlers: Record<string, (message: Record<string, any>, client: ClientInterface<MessageType>) => Promise<any>> = {} as any
  private connectHandler: (client: ClientInterface<MessageType>) => unknown = () => { }
  public clients: Client[] = []

  constructor({ port }: { port: number }) {
    this.wss = new WebSocketServer({ port })
    this.wss.on('connection', (ws, req) => {
      const client = this.setupSocket(ws, req.socket.remoteAddress + ':' + req.socket.remotePort)
      if (client) {
        this.connectHandler(this.buildPeerContext(client))
      }
    })
  }

  private setupSocket(ws: WebSocket, address: string): Client | null {
    try {
      const pendingRequests: Record<number, (message: Message) => void> = {}

      const client = new Client(address, ws, (syncId, callback) => { pendingRequests[syncId] = callback })

      this.clients.push(client)
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

          handler(message.data, this.buildPeerContext(client, message)).catch(error => {
            console.error(`WebSocket ${message.type} error`, error)
          })
        } catch (error) {
          console.error('Error handling WebSocket message', error)
        }
      })

      ws.on('close', () => {
        this.clients = this.clients.filter(client => client !== client)
        console.log(`WebSocket client disconnected`)
      })
      ws.on('error', (error) => {
        this.clients = this.clients.filter(client => client !== client)
        console.error('WebSocket error:', error)
      })
      return client
    } catch (error) {
      console.error('Error setting up WebSocket', error)
      return null
    }
  }

  private buildPeerContext(client: Client, message?: Message): ClientInterface<MessageType> {
    const ws = client.ws
    return {
      client,
      request: (type: MessageType, data: Record<string, any>) => {
        return client.request({ type, data })
      },
      respond: (data: Record<string, any>) => {
        if (message?.id === undefined) {
          return
        }
        ws.send(JSON.stringify({ type: 'response', id: message.id, data }))
      },
      send: (type: MessageType, data: Record<string, any>) => {
        ws.send(JSON.stringify({ type, data }))
      }
    }
  }

  public on(type: string, handler: (message: Record<string, any>, interfaces: ClientInterface<MessageType>) => Promise<any>) {
    this.handlers[type] = handler
    return this
  }

  public onConnect(handler: (client: ClientInterface<MessageType>) => unknown) {
    this.connectHandler = handler
    return this
  }

  public broadcast(message: Message) {
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message))
      }
    })
  }

  public connect(address: string): Promise<Client | null> {
    return new Promise((resolve) => {
      try {
        const peer = new WebSocket("ws://" + address)
        const client = this.setupSocket(peer, address)
        let open = false
        peer.once('error', () => { resolve(null) })
        peer.once('close', () => { resolve(null) })
        peer.on('open', () => {
          open = true
          resolve(client)
          if (client) {
            this.connectHandler(this.buildPeerContext(client))
          }
        })

        setTimeout(() => {
          if (!open) {
            peer.close()
            resolve(null)
          }
        }, 1000)
      } catch (error) {
        console.error('Error connecting to WebSocket:', error)
        resolve(null)
      }
    })
  }
}

export class Client {
  private syncId = 0
  constructor(
    public address: string,
    public ws: WebSocket,
    private waitResponse: (id: number, callback: (message: Message) => void) => void
  ) { }

  public request(message: Message): Promise<Record<string, any>> {
    const id = this.syncId++
    const request = { ...message, id }
    const promise = new Promise((resolve, reject) => {
      this.waitResponse(id, resolve)
      setTimeout(() => {
        reject(new Error('Request timed out'))
      }, 3000)
    })

    this.ws.send(JSON.stringify(request))
    return promise.then((message) => (message as any)?.data) as Promise<Record<string, any>>
  }
}