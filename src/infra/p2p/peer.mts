import { MAX_PEER_MESSAGE_BYTES } from '../../app/config.mts'
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
  public listenAddress: string | null = null
  constructor(
    public address: string,
    public ws: WebSocket,
    private waitResponse: (id: number, callback: (message: Message) => void) => () => void
  ) { }

  public send(message: Message, callback?: (error?: Error) => void) {
    if (this.ws.readyState !== WebSocket.OPEN) {
      callback?.(new Error('Peer disconnected'))
      return
    }
    if (this.ws.bufferedAmount > MAX_PEER_MESSAGE_BYTES * 2) {
      this.ws.close(1013, 'Peer is not keeping up')
      callback?.(new Error('Peer send buffer full'))
      return
    }
    this.ws.send(JSON.stringify(message), callback)
  }

  public createSession(message?: Message): Session {
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
        this.send({ type: 'response', id: message.id, data })
      },
      send: (type: MessageType, data: Record<string, any>) => {
        this.send({ type, data })
      }
    }
  }

  private request(message: Message): Promise<Record<string, any>> {
    const id = this.syncId++
    const request = { ...message, id }
    let unregister: (() => void) | undefined
    let timer: NodeJS.Timeout
    return new Promise<Message>((resolve, reject) => {
      unregister = this.waitResponse(id, resolve)
      timer = setTimeout(() => reject(new Error('Request timed out')), 3000)
      this.send(request, error => { if (error) reject(error) })
    }).finally(() => {
      clearTimeout(timer)
      unregister?.()
    }).then(reply => reply.data ?? {})
  }
}