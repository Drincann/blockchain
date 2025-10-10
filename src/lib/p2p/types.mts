export interface Message {
  id?: number,
  type: MessageType,
  data: Record<string, any>
}

export type MessageType = 'blockinv' | 'getblock' | 'response' | 'nodeinfo' | 'getpeers' | 'gettx' | 'txinv'
