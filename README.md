# Simple Blockchain

This project is a tiny blockchain you can run locally. It lets you start a node, mine blocks, and connect with other nodes to share the chain.

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Launch a node (defaults to port 3001):
   ```bash
   pnpm start [port]
   ```
3. Open the CLI and try commands like:
   - `mine <data>` – mine a block with your own message.
   - `peer add <host:port>` – connect to another node.
   - `block current` – check the latest block.
   - `q` – exit the CLI.

## What You Can Do

- **Run a local network** – start multiple nodes on different ports and connect them together.
- **Mine blocks** – produce blocks using a simple proof-of-work algorithm.
- **Sync automatically** – nodes share blocks with each other over WebSockets.

## Extra Info

- Configuration lives in `src/config.json` and can be overridden with the `BLOCKCHAIN_SERVER_LISTEN_ADDRESS` environment variable.
- Run the test suite with:
  ```bash
  pnpm test
  ```
- Curious about the internals? Check out the TypeScript source in `src/` for the block structure, mining logic, and P2P messaging.
