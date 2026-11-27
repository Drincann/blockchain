import { isIPv6 } from 'node:net'

export interface Message {
  id?: number
  type: MessageType
  data: Record<string, any>
}

export type MessageType = 'blockinv' | 'getblock' | 'response' | 'nodeinfo' | 'getpeers' | 'gettx' | 'txinv'

const messageTypes = new Set<MessageType>(['blockinv', 'getblock', 'response', 'nodeinfo', 'getpeers', 'gettx', 'txinv'])

export function isMessage(input: unknown): input is Message {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  const { type, id, data } = input as Partial<Message>
  if (!type || !messageTypes.has(type) || !data || typeof data !== 'object' || Array.isArray(data)) return false
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 0)) return false
  return type !== 'response' || id !== undefined
}

export function isPeerAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 260) return false
  const match = /^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\]):(\d{1,5})$/i.exec(value)
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) return false
  const host = value.slice(0, value.lastIndexOf(':'))
  if (host.startsWith('[')) return isIPv6(host.slice(1, -1))
  return host.replace(/\.$/, '').split('.').every(label =>
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
}
