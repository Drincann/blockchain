import { Account } from '../domain/transaction/account.mts'
import { Node } from '../infra/node/node.mts'
import { hex, hexBytes } from '../util/crypto.mts'

const node = new Node()
node.start(parseInt(process.argv[2] || '3001'))


const write = (chars: string) => {
  process.stdout.write(chars)
}

const read = (): Promise<string> => {
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim())
    })
  })
}

const cleanup = () => {
  node.stop()
  process.stdin.removeAllListeners()
  process.stdin.destroy()
}

const sleep = (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let stoploop = false
const mineloop = async (data: string) => {
  while (1) {
    if (stoploop) {
      console.log('mineloop stopped')
      return
    }
    const start = Date.now()
    const block = await node.mineAsync(new Uint8Array(Buffer.from(data))).catch(() => null)
    if (block == null) {
      console.log('mine cancelled')
      continue
    }
    write(`cost: ${Date.now() - start}ms\nnew block: ${hex(block.hash())}\n${JSON.stringify(block.display(), null, 2)}\n`)
  }
}

write('\nSimple Blockchain CLI\n')
write('Enter "q" to quit\n\n')

while (true) {
  await sleep(100)
  write('> ')
  const input = (await read()).split(' ').map(s => s.trim()).filter(s => s !== '')
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

  if (input[0] === 'balance') {
    const specified = input[1]
    if (specified) {
      const balance = node.getBalance(hexBytes(specified))
      write(`balance: ${balance} sats (${balance / 100_000_000} bitcoin)\n`)
      continue
    }

    const balance = node.getBalance()
    write(`balance: ${balance} sats (${balance / 100_000_000} bitcoin)\n`)
    continue
  }

  if (input[0] === 'send') {
    if (input.length < 3) {
      write('usage: send <toPublicKey> <amount>\n')
      continue
    }

    const toPublicKey = hexBytes(input[1])
    const amount = parseInt(input[2])
    if (isNaN(amount) || amount <= 0) {
      write('amount must be a positive integer, in sats (1 bitcoin = 100,000,000 sats)\n')
      continue
    }

    try {
      const txinfo = node.send(toPublicKey, amount)
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

  if (input[0] === 'mine') {
    const start = Date.now()
    const block = await node.mineAsync(new Uint8Array(Buffer.from(input.slice(1).join(' ')))).catch(() => null)
    const cost = Date.now() - start

    if (block == null) {
      console.log('mine cancelled')
      continue
    }

    write(`cost: ${cost}ms\n`)
    write(`new block: ${hex(block.hash())}\n${JSON.stringify(block.display(), null, 2)}\n`)
    continue
  }

  if (input[0] === 'mineasync') {
    const block = node.submitMine(new Uint8Array(Buffer.from(input.slice(1).join(' ')))).getBlock()
    write(`new block: ${hex(block.hash())}\n${JSON.stringify(block.display(), null, 2)}\n`)
    continue
  }

  if (input[0] === 'mineloop') {
    stoploop = false
    mineloop(input.slice(1).join(' '))
    continue
  }

  if (input[0] === 'stoploop') {
    stoploop = true
    continue
  }

  if (input[0] === 'peer') {
    if (input[1] === undefined) {
      write('usage: peer <address>\n')
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

    if (await node.addPeer(input[1])) {
      write(`added peer: ${input[1]}\n`)
    } else {
      write(`failed to add peer: ${input[1]}\n`)
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

  /**
   * unspent <publicKey>
   */
  if (input[0] == 'unspent') {
    const specified = input[1]
    if (specified) {
      const unspent = node.getUnspentOutputs(hexBytes(specified))
      if (unspent.length === 0) {
        write('no unspent outputs\n')
        continue
      }
      write(`unspent outputs:\n${unspent.map((u, i) => i + ': ' + JSON.stringify(u.display(), null, 2)).join('\n')}\n`)
      continue
    }

    const unspent = node.getUnspentOutputs()
    if (unspent.length === 0) {
      write('no unspent outputs\n')
      continue
    }
    write(`unspent outputs:\n${unspent.map((u, i) => i + ': ' + JSON.stringify(u.display(), null, 2)).join('\n')}\n`)
    continue
  }

  if (input.length === 0) {
    continue
  }

  write(`unknown command: ${input[0]}\n`)
}

write('bye\n')
cleanup()
