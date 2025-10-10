# Simple Blockchain

This project is a tiny proof-of-work blockchain that you can run locally to see how mining, wallets, and peer-to-peer syncing work. It comes with a CLI so you can mine blocks, send coins, and watch the chain grow in real time.

> This repository is meant for learning: read through src/ to see how a full node is implemented in a compact and readable TypeScript codebase.

## Dependencies

- [Node.js](https://nodejs.org/) v16+
- [pnpm](https://pnpm.io/)

## Quick start

1. Install dependencies

   ```bash
   pnpm install
   ```

2. **(Optional) Tell other nodes how to reach you**
   Set `BLOCKCHAIN_SERVER_LISTEN_ADDRESS="host:port"` before starting if your node should advertise a public address.

3. Launch a node (default port is 3001)

   ```bash
   pnpm start [port]
   ```

4. Use the interactive prompt that appears to control your node.

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
- `unspent [publicKeyHex]` – see unspent outputs for a wallet.
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
