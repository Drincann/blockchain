# Simple Blockchain Implementation

A lightweight blockchain implementation written in TypeScript with P2P networking capabilities. This project demonstrates core blockchain concepts including block creation, mining, peer-to-peer communication, and distributed consensus.

## Features

- **Blockchain Core**: Complete block structure with serialization/deserialization
- **Fork Handling**: Intelligent handling of blockchain forks and orphan blocks
- **P2P Networking**: WebSocket-based peer-to-peer communication
- **Distributed Sync**: Automatic blockchain synchronization across peers
- **Mining**: Simple block mining with data validation
- **CLI Interface**: Interactive command-line interface for blockchain operations

## Project Structure

```
src/
├── block.mts          # Core blockchain block implementation
├── node.mts           # Main blockchain node with P2P capabilities
├── cli.mts            # Command-line interface
├── config.mts         # Configuration management
├── lib/
│   ├── p2p.mts        # P2P networking implementation
│   └── queue.mts      # Synchronized queue for handling operations
└── util/
    └── crypto.mts     # Cryptographic utilities (SHA-256, hex encoding)
```

## Build

1. Clone the repository:

```bash
git clone https://github.com/Drincann/blockchain.git
cd blockchain
```

2. Install dependencies:

```bash
pnpm install
```

If you don't have pnpm, you can install it with:

```bash
npm install -g pnpm
```

## Usage

### Starting a Node

Start a blockchain node on a specific port (default: 3001):

```bash
pnpm start [port]
```

### CLI Commands

Once the node is running, you can use the following commands:

#### Mining

```bash
mine <data>
```

Mine a new block with the specified data (utf-8 encoded string).

#### Peer Management

```bash
peer add <address>     # Add a new peer (e.g., "localhost:3002")
peer list             # List all connected peers
```

#### Block Operations

```bash
block current         # Show current block information
block <hash>          # Show specific block by hash
```

#### Quit

```bash
q                     # Exit the CLI
```

### Example Session

```bash
$ pnpm start 3001
Node started on port 3001

Simple Blockchain CLI
Enter "q" to quit

> block current
block: 091c83073b570c5865a11ddf73976839d03a85190ca92df33a7364138ec426df
{
  "height": 0,
  "ts": 1749376247272,
  "prev": "0000000000000000000000000000000000000000000000000000000000000000",
  "dataHex": "5468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73",
  "dataUtf8": "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks"
}

> mine HelloWorld
new block: 02546d1e58257eccf3141ac6d0bafcda02925b7554a2c2715cbb6875e3271fce
{
  "height": 1,
  "ts": 1757061175860,
  "prev": "091c83073b570c5865a11ddf73976839d03a85190ca92df33a7364138ec426df",
  "dataHex": "48656c6c6f576f726c64",
  "dataUtf8": "HelloWorld"
}

> peer add localhost:3002
added peer: localhost:3002

> peer list
peers: localhost:3002

> block current
block: 02546d1e58257eccf3141ac6d0bafcda02925b7554a2c2715cbb6875e3271fce
{
  "height": 1,
  "ts": 1757061175860,
  "prev": "091c83073b570c5865a11ddf73976839d03a85190ca92df33a7364138ec426df",
  "dataHex": "48656c6c6f576f726c64",
  "dataUtf8": "HelloWorld"
}
```

## Technical Details

### Block Structure

Each block contains:

```ts
interface BlockData {
  height: number;
  ts: number;
  prev: Uint8Array;
  data: Uint8Array;
}
```

- **Height**: Block number in the chain
- **Timestamp**: Unix timestamp of block creation
- **Previous Hash**: SHA-256 hash of the previous block
- **Data**: Variable-length data payload (max 1024 bytes by default)

### Serialization Format

Blocks are serialized as:

- Bytes 0-7: Height (64-bit big-endian integer)
- Bytes 8-15: Timestamp (64-bit big-endian integer)
- Bytes 16-47: Previous hash (32 bytes)
- Bytes 48+: Data (variable length)

### P2P Protocol

The network uses WebSocket connections with JSON messages:

```ts
interface Message {
  id?: number;
  type: "inventory" | "block" | "response";
  data: Record<string, any>;
}
```

- **inventory**: Broadcast new block summaries
- **block**: Request specific blocks by hash
- **response**: Response to requests

### Genesis Block

The genesis block contains the famous Bitcoin genesis message:

> "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks"

## Testing

Run the test suite:

```bash
pnpm test
```

## Configuration

Modify `src/config.json` to adjust blockchain parameters:

```json
{
  "maxDataBytes": 1024 // max data bytes per block
}
```
