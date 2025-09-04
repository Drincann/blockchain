import { Node } from './node.mts'
import { hex } from './util/crypto.mts'

const node = new Node()
await node.start(parseInt(process.argv[2] || '3001'))


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

const sleep = (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms))
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

  if (input[0] === 'mine') {
    const block = node.mine(new Uint8Array(Buffer.from(input.slice(1).join(' '))))
    write(`mined block: ${hex(block.hash())}\n${JSON.stringify(block.display())}\n`)
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
      write('usage: block [current | <hash>]\n')
    } else if (input[1] === 'current') {
      write(`block: ${hex(node.current.hash())}\n${JSON.stringify(node.current.display())}\n`)
    } else {
      write(`block: ${hex(node.block(input[1])?.hash())}\n${JSON.stringify(node.block(input[1])?.display())}\n`)
    }

    continue
  }

  write('unknown command\n')
}

write('bye\n')

process.exit(0)