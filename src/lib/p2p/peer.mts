import { WebSocket } from 'ws'
import { Message, MessageType } from './types.mts'

export interface Session {
  data?: Record<string, any>
  peer: Peer
  request: (type: MessageType, data: Record<string, any>) => Promise<Record<string, any>>
  respond: (data: Record<string, any>) => void
  send: (type: MessageType, data: Record<string, any>) => unknown
}

export class Peer {
  private syncId = 0
  constructor(
    public address: string,
    public ws: WebSocket,
    private waitResponse: (id: number, callback: (message: Message) => void) => void
  ) { }

  public createSession(message?: Message): Session {
    const ws = this.ws
    return {
      data: message?.data,
      peer: this,
      request: (type: MessageType, data: Record<string, any>) => {
        return this.request({ type, data })
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

  private request(message: Message): Promise<Record<string, any>> {
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