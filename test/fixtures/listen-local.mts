import { once } from 'node:events'
import type { Node } from '../../src/infra/node/node.mts'

export async function listenLocal(node: Node) {
  node.start(0, '127.0.0.1')
  const server = node['server']!['wss']
  if (!server.address()) await once(server, 'listening')
}
