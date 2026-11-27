import { createInterface } from 'node:readline'
import { Account } from '../domain/transaction/account.mts'
import { Node } from '../infra/node/node.mts'
import { hex, hexBytes } from '../util/crypto.mts'

const node = new Node()
node.start(parseInt(process.argv[2] || '3001'))


const write = (chars: string) => {
  process.stdout.write(chars)
}

const lines = createInterface({ input: process.stdin, terminal: false })
const commands = lines[Symbol.asyncIterator]()

let stoploop = false
let pendingMine: Promise<void> | undefined
let miningLoop: Promise<void> | undefined

const mine = async (data: string) => {
  const start = Date.now()
  const block = await node.mineAsync(Buffer.from(data))
  if (block) {
    write(`cost: ${Date.now() - start}ms\nnew block: ${hex(block.hash())}\n${JSON.stringify(block.display(), null, 2)}\n`)
  } else {
    write('mine cancelled\n')
  }
}

const mineloop = async (data: string) => {
  while (!stoploop) {
    await mine(data)
  }
}

write('\nSimple Blockchain CLI\n')
write('Enter "q" to quit\n\n')

while (true) {
  write('> ')
  const line = await commands.next()
  if (line.done) break
  const input = line.value.trim().split(/\s+/).filter(Boolean)
  if (input[0] === 'q') {
    break
  }


  if (input[0] === 'importprivatekey') {
    if (input[1] === undefined) {
      write('usage: importprivatekey <hex private key>\n')
      continue
    }

    try {
      node.importAccount(new Account(hexBytes(input[1])))
    } catch (e) {
      write(`failed to import private key: ${(e as Error).message}\n`)
    }
    continue
  }

  if (input[0] === 'balance' || input[0] === 'unspent') {
    try {
      const key = input[1] ? hexBytes(input[1]) : undefined
      if (input[0] === 'balance') {
        const balance = node.getBalance(key)
        write(`balance: ${balance} sats (${balance / 100_000_000} bitcoin)\n`)
      } else {
        const unspent = node.getUnspentOutputs(key)
        if (unspent.length === 0) {
          write('no unspent outputs\n')
        } else {
          write(`unspent outputs:\n${unspent.map((u, i) => i + ': ' + JSON.stringify(u.display(), null, 2)).join('\n')}\n`)
        }
      }
    } catch (e) {
      write(`invalid public key: ${(e as Error).message}\n`)
    }
    continue
  }

  if (input[0] === 'send') {
    if (input.length < 3) {
      write('usage: send <toPublicKey> <amount>\n')
      continue
    }

    const amount = Number(input[2])
    if (!/^\d+$/.test(input[2]) || !Number.isSafeInteger(amount) || amount <= 0) {
      write('amount must be a positive integer, in sats (1 bitcoin = 100,000,000 sats)\n')
      continue
    }

    try {
      const txinfo = node.send(hexBytes(input[1]), amount)
      write(`sent transaction: ${hex(txinfo.tx.id)}, fees: ${txinfo.fees} sats\n`)
    } catch (e: any) {
      write(`failed to send transaction: ${e.message}\n`)
    }
    continue
  }

  if (input[0] === 'account') {
    write(`balance: ${node.getBalance()} sats (${node.getBalance() / 100_000_000} bitcoin)\n\n`)
    write(`publicKey: ${hex(node.account.publicKey)}\n`)
    write(`privateKey: ${hex(node.account.privateKey)}\n`)
    continue
  }

  if (input[0] === 'mine' || input[0] === 'mineasync') {
    pendingMine = mine(input.slice(1).join(' ')).catch(error => write(`mining failed: ${error.message}\n`))
    if (input[0] === 'mine') await pendingMine
    continue
  }

  if (input[0] === 'mineloop') {
    if (!miningLoop) {
      stoploop = false
      miningLoop = mineloop(input.slice(1).join(' '))
        .catch(error => write(`mining failed: ${error.message}\n`))
        .finally(() => { miningLoop = undefined })
    }
    continue
  }

  if (input[0] === 'stoploop') {
    if (miningLoop) {
      stoploop = true
      node.cancelMining()
      await miningLoop
      write('mineloop stopped\n')
    }
    continue
  }

  if (input[0] === 'peer') {
    const address = input[1] === 'add' ? input[2] : input[1]
    if (!address) {
      write('usage: peer add <address> | peer list\n')
      continue
    }

    if (input[1] === 'list') {
      const peers = node.peer()
      if (peers.length === 0) {
        write('no peers\n')
        continue
      }
      write(`peers: ${peers.join(', ')}\n`)
      continue
    }

    if (await node.addPeer(address)) {
      write(`added peer: ${address}\n`)
    } else {
      write(`failed to add peer: ${address}\n`)
    }

    continue
  }

  if (input[0] === 'block') {
    if (input[1] === undefined) {
      write(`block: ${hex(node.current.hash())}\n${JSON.stringify(node.current.display(), null, 2)}\n`)
    } else {
      const block = node.block(input[1])
      if (block) {
        write(JSON.stringify(block.display(), null, 2) + '\n')
      } else {
        write(`block not found: ${input[1]}\n`)
      }
    }

    continue
  }

  /**
   * blocktxs <blockhash>
   */
  if (input[0] == 'blocktxs') {
    if (input.length < 2) {
      write('usage: blocktxs <blockhash>\n')
      continue
    }

    const block = node.block(input[1])
    if (!block) {
      write(`block not found: ${input[1]}\n`)
      continue
    }

    write(`transactions:\n${[block.coinbase, ...block.transactions].map((tx, i) => i + ': ' + hex(tx.id)).join('\n')}\n`)
    continue
  }

  /**
   * tx <txid>
   */
  if (input[0] == 'tx') {
    if (input.length < 2) {
      write('usage: tx <txid>\n')
      continue
    }

    const { tx, block } = node.transaction(input[1]) ?? {}
    if (!tx) {
      write(`transaction not found: ${input[1]}\n`)
      continue
    }

    write(`block: ${block ? hex(block.hash()) : 'in mempool'}\n`)
    write(`transaction: ${JSON.stringify(tx.display(), null, 2)}\n`)
    continue
  }

  if (input.length === 0) {
    continue
  }

  write(`unknown command: ${input[0]}\n`)
}

stoploop = true
node.stop()
lines.close()
await Promise.all([miningLoop, pendingMine])
write('bye\n')
