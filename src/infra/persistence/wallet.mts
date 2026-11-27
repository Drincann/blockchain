import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Account } from '../../domain/transaction/account.mts'

/** The file holds one active key. Imports replace it only after the new envelope reaches disk. */
export class WalletFile {
  private readonly filename: string
  private readonly salt: Buffer
  private readonly key: Buffer
  account: Account

  constructor(directory: string, passphrase: string, allowCreate: boolean) {
    if (!passphrase) throw new Error('A wallet passphrase is required')
    this.filename = join(directory, 'wallet.json')
    if (!existsSync(this.filename)) {
      if (!allowCreate) throw new Error('Missing wallet.json. Restore your wallet backup.')
      this.salt = randomBytes(16)
      this.key = scryptSync(passphrase, this.salt, 32)
      this.account = new Account()
      this.save(this.account)
      return
    }

    const envelope = JSON.parse(readFileSync(this.filename, 'utf8'))
    if (envelope.version !== 1) throw new Error('Unsupported wallet file version')
    this.salt = Buffer.from(envelope.salt, 'hex')
    const iv = Buffer.from(envelope.iv, 'hex')
    const tag = Buffer.from(envelope.tag, 'hex')
    if (this.salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid wallet file')
    this.key = scryptSync(passphrase, this.salt, 32)
    try {
      const cipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 })
      cipher.setAuthTag(tag)
      const plaintext = Buffer.concat([cipher.update(Buffer.from(envelope.data, 'hex')), cipher.final()])
      try { this.account = new Account(plaintext) } finally { plaintext.fill(0) }
    } catch {
      throw new Error('Cannot unlock wallet. Check the passphrase and wallet file.')
    }
  }

  save(account: Account) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const data = Buffer.concat([cipher.update(account.privateKey), cipher.final()])
    const envelope = { version: 1, salt: this.salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }
    const temporary = this.filename + '.' + randomBytes(8).toString('hex') + '.tmp'
    try {
      writeFileSync(temporary, JSON.stringify(envelope) + '\n', { mode: 0o600, flag: 'wx', flush: true })
      renameSync(temporary, this.filename)
      this.account = account
      if (process.platform !== 'win32') {
        const directory = openSync(dirname(this.filename), 'r')
        try { fsyncSync(directory) } finally { closeSync(directory) }
      }
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}
