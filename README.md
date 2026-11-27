# Simple Blockchain

This project is a tiny proof-of-work blockchain that you can run locally to see how mining, wallets, and peer-to-peer syncing work. It comes with a CLI so you can mine blocks, send coins, and watch the chain grow in real time.

> This repository is meant for learning: read through src/ to see how a full node is implemented in a compact and readable TypeScript codebase.

## Dependencies

- [Node.js](https://nodejs.org/) v22 or newer
- [pnpm](https://pnpm.io/)

## Quick start

1. Install dependencies

   ```bash
   pnpm install --frozen-lockfile
   ```

2. **(Optional) Tell other nodes how to reach you**
   Set `BLOCKCHAIN_SERVER_LISTEN_ADDRESS="host:port"` before starting if your node should advertise a public address.

3. Launch a node (default port is 3001)

   ```bash
   pnpm start [port]
   ```

4. Enter a wallet passphrase when prompted. The first run creates a wallet. Use the same passphrase and data directory on later runs to unlock it. Then use the interactive prompt to mine or send coins.

## Local storage and recovery

By default, each port uses its own directory under `.blockchain/` in the current working directory (for example, `.blockchain/node-3001`). To use an explicit location, including after changing ports:

```bash
pnpm start 3001 --data-dir ./alice-node
```

- `chain.sqlite` stores the accepted blocks, transaction index, spendable outputs and your wallet's pending sends. A block or fork switch commits atomically before the node announces its new tip. Restarting works offline. History stays on disk, and catch-up downloads up to 64 blocks per request into temporary storage.
- `wallet.json` holds the active private key encrypted with your passphrase (scrypt and AES-256-GCM). Back up the directory after quitting with `q`. Restore it to a private local directory, then start with `--data-dir` and the original passphrase. Losing both the usable wallet and a private-key backup loses access to the coins. Before replacing a wallet with `importprivatekey`, back up the old key. Keep custom data directories outside version control.
- Only one node can open a data directory at a time. For unattended use, supply the passphrase through the `BLOCKCHAIN_WALLET_PASSPHRASE` environment variable. For a disposable session that leaves no wallet or ledger on disk, use `pnpm start 3001 --memory`.
- To verify the stored blocks and rebuild their transaction and spendable-output indexes, stop the node and run `pnpm start 3001 --data-dir ./alice-node --reindex`. A failed rebuild rolls back. To recover an unreadable database, restore a backup. A wallet alone can also be placed in a fresh directory and its confirmed history synced from a peer.
- Older versions kept data only in the running process. To carry over that wallet, save its private key from the old node's `account` command, then use `importprivatekey` on the new node. For an existing chain, leave a peer with the old history running until the new node has synced. Previously stopped nodes have no local chain to migrate.

## Commands

> required arguments: `<arg1>`; optional arguments: `[arg1]`

- `account` – show your node’s public & private keys plus current balance.
- `balance [publicKeyHex]` – check your wallet or another wallet’s balance in sats.
- `mine [text]` – mine a single block that includes the given text in the coinbase message.
- `mineloop [text]` / `stoploop` – keep mining blocks until you stop the loop.
- `send <toPublicKeyHex> <amount>` – create and broadcast a signed transaction from your wallet.
- `peer add <host:port>` / `peer list` – connect to another node or list connected peers.
- `block [hash]` – view the latest block or a specific block.
- `blocktxs <hash>` – list the transactions inside a block.
- `tx <txid>` – inspect a transaction (mempool or confirmed).
- `unspent [publicKeyHex] [page]` – show up to 100 unspent outputs at a time. The prompt prints the command for the next page.
- `importprivatekey <hex>` – load an existing key pair.
- `q` – quit the CLI.

## What you get

- Proof-of-work mining with automatic difficulty targets and a halving coinbase reward.
- Peer-to-peer syncing over WebSockets so nodes exchange blocks and transactions.
- Wallet with elliptic curve keys, UTXO tracking, and signed transactions.

## Run a small network

Open two terminals and start nodes on different ports, for example:

```bash
pnpm start 3001
pnpm start 3002
```

In one CLI, add the other as a peer:

```bash
peer add localhost:3002
```

Both nodes will now share newly mined blocks and broadcast transactions to each other.

## Testing

Run the test suite:

```bash
pnpm test
```

Run `pnpm test:scale` to compare peak receiver memory while syncing generated histories of 1,000 and 10,000 reward-only blocks in separate processes.
