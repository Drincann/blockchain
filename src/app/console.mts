import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export const help = `Commands
  help                       List commands
  account                    Show your balance and public key
  account private            Also reveal the private key
  balance [publicKey]        Show a wallet balance in sats
  send <publicKey> <sats>    Send a payment
  unspent [publicKey] [page] List spendable outputs
  importprivatekey <hex>     Replace the active wallet key

  mine [text]                Mine one block
  mineasync [text]           Mine one block in the background
  mineloop [text]            Mine continuously
  stoploop                   Stop continuous mining

  peer add <host:port>       Connect to a peer
  peer list                  List connected peers
  peer discovered            List addresses reported by peers
  block [hash]               Show the latest block or a block by hash
  blocktxs <hash>            List transactions in a block
  tx <txid>                  Look up a confirmed or pending transaction
  q                          Quit
`

export function commandReader(input: Readable, output: Writable, terminal: boolean) {
  const lines = createInterface({ input, output, terminal, prompt: '> ', removeHistoryDuplicates: true })
  lines.on('history', history => {
    if (/^\s*importprivatekey(?:\s|$)/.test(history[0] ?? '')) history.shift()
  })
  return lines
}
