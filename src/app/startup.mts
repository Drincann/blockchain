import { parseArgs } from 'node:util'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { Node } from '../infra/node/node.mts'

async function walletPassphrase(dataDir: string): Promise<string> {
  const secret = process.env.BLOCKCHAIN_WALLET_PASSPHRASE
  if (secret) return secret
  if (!process.stdin.isTTY) throw new Error('Set BLOCKCHAIN_WALLET_PASSPHRASE for a non-interactive node')
  const muted = new Writable({ write(_chunk, _encoding, done) { done() } })
  const input = createInterface({ input: process.stdin, output: muted, terminal: true })
  const question = () => new Promise<string>((resolve, reject) => {
    const cancelled = () => reject(new Error('Wallet unlock cancelled'))
    input.once('close', cancelled)
    input.question('', answer => {
      input.off('close', cancelled)
      resolve(answer)
    })
  })
  try {
    process.stderr.write('Wallet passphrase (hidden): ')
    const passphrase = await question()
    if (!existsSync(join(dataDir, 'wallet.json'))) {
      process.stderr.write('\nConfirm new wallet passphrase: ')
      if (await question() !== passphrase) throw new Error('Wallet passphrases do not match')
    }
    return passphrase
  } finally {
    input.close()
    process.stderr.write('\n')
  }
}

export async function startNode(args: string[]): Promise<Node> {
  const { positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: { 'data-dir': { type: 'string' }, memory: { type: 'boolean' }, reindex: { type: 'boolean' } }
  })
  const port = Number(positionals[0] ?? 3001)
  if (positionals.length > 1 || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Usage: npm start -- [port] [--data-dir DIRECTORY] [--reindex] | [--memory]')
  }
  if (values.memory && (values['data-dir'] || values.reindex)) throw new Error('Choose a data directory or --memory')
  const dataDir = resolve(values['data-dir'] ?? `.blockchain/node-${port}`)
  const node = values.memory ? new Node() : new Node({ dataDir, passphrase: await walletPassphrase(dataDir), reindex: values.reindex })
  node.start(port)
  if (!values.memory) console.log(`Node data: ${dataDir}`)
  return node
}
