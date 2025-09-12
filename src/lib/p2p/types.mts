export interface Message {
  id?: number,
  type: MessageType,
  data: Record<string, any>
}

export type MessageType = 'inventory' | 'block' | 'response'