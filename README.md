# Simple Blockchain Implementation

A simple blockchain implementation in TypeScript with P2P networking and Proof-of-Work mining.

## Features

- **Blockchain Core**: Complete block structure with serialization/deserialization
- **P2P Networking**: WebSocket-based peer-to-peer communication, Automatic blockchain synchronization across peers
- **Proof-of-Work Mining**: Simple mining algorithm with adjustable difficulty
- **CLI Interface**: Interactive command-line interface for blockchain operations

## Project Structure

```
src/
├── cli.mts                # Command-line interface
├── block.mts              # Block implementation
├── node.mts               # Blockchain node with P2P networking
├── config.json            # Configuration file
├── config.mts             # Configuration management
├── lib
│   ├── miner.mts          # Proof-of-Work mining implementation
│   ├── queue.mts          # Synchronized queue for handling operations
│   └── p2p                # P2P networking
│       ├── index.mts
│       ├── peer.mts
│       ├── server.mts
│       └── types.mts
└── util
    ├── crypto.mts        # Cryptographic utilities (SHA-256, hex encoding)
    └── genesis-miner.mts # Genesis block miner
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

Mine a new block with the specified data (utf-8 encoded string).

```bash
mine <data>
```

Start mining loop.

```bash
mineloop <data>
```

Stop mining loop.

```bash
stoploop
```

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
block: 6038f6308a3437930d464efa8090837b8bc2710196e05d373fcb741cdc0a7534
{
  "height": 0,
  "ts": 1749376247272,
  "prev": "0000000000000000000000000000000000000000000000000000000000000000",
  "difficulty": 1,
  "nonce": "125c95cf5a41e63f6c1400cf6bbc14bc376bde4b8ac4e7fa3f071b7f0f7a592e",
  "dataHex": "5468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73",
  "dataUtf8": "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks"
}

> mine HelloWorld
new block: fe8bef47d4621151e9acd433cac054a11c6c26b8d44842c9b3fb625bb9d75b97
{
  "height": 1,
  "ts": 1758100640612,
  "prev": "6038f6308a3437930d464efa8090837b8bc2710196e05d373fcb741cdc0a7534",
  "difficulty": 2,
  "nonce": "0000000000000000000000000000000000000000000000000000000000000000",
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
  "ts": 1758100640612,
  "prev": "6038f6308a3437930d464efa8090837b8bc2710196e05d373fcb741cdc0a7534",
  "difficulty": 2,
  "nonce": "30d892692fe5d61e0acc821f1c9fef531ba6bd4ad05b5a7ec1f51fa486b53ee4",
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
  difficulty: number;
  nonce: Uint8Array;
  data: Uint8Array;
}
```

- **Height**: Block number in the chain
- **Timestamp**: Unix timestamp of block creation
- **Previous Hash**: SHA-256 hash of the previous block
- **Difficulty**: Mining difficulty level (number of leading zeros in hash)
- **Nonce**: Value used for mining (proof-of-work)
- **Data**: Variable-length data payload (max 1024 bytes by default)

### Serialization Format

Blocks are serialized as:

- Bytes 0-7: Height (64-bit big-endian integer)
- Bytes 8-15: Timestamp (64-bit big-endian integer)
- Bytes 16-47: Previous hash (32 bytes)
- Bytes 48-48: Difficulty (1 byte)
- Bytes 49-80: Nonce (32 bytes)
- Bytes 81+: Data (variable length)

### P2P Protocol

The network uses WebSocket connections with JSON messages:

```ts
interface Message {
  id?: number;
  type: "inventory" | "getblock" | "getpeers" | "nodeinfo" | "response";
  data: Record<string, any>;
}
```

- **inventory**: Broadcast new block summaries
- **getblock**: Request specific blocks by hash
- **getpeers**: Request the list of connected peers
- **nodeinfo**: Send information about the node on connection
- **response**: Response to requests

### Genesis Block

The genesis block contains the famous Bitcoin genesis message:

> "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks"

You can modify the genesis block data in `src/block.mts`, and run `npx tsx src/util/genesis-miner.mts` to mine a valid nonce.

## Testing

Run the test suite:

```bash
pnpm test
```

## Configuration

Modify `src/config.json` to adjust blockchain parameters:

```json
{
  "maxDataBytes": 1024, // max data bytes per block
  "listenAddress": "x.x.x.x:yyyy" // Publicly reachable address, Used for peer discovery and should be reachable by other nodes
}
```

**listenAddress**: You can also override it at runtime using the `BLOCKCHAIN_SERVER_LISTEN_ADDRESS` environment variable, for example:

```bash
BLOCKCHAIN_SERVER_LISTEN_ADDRESS="x.x.x.x:yyyy" pnpm start 3001
```
