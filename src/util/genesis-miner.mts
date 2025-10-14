import { Block } from "../domain/block/block.mts";
import { hex } from "./crypto.mts";

const genesisBlock = Block.deserialize(Block.GENESIS_BLOCK);
if (genesisBlock.isProofValid()) {
  console.log(`genesis block already mined: ${hex(genesisBlock.hash())}\n${JSON.stringify(genesisBlock.display(), null, 2)}`);

} else {
  const miner = genesisBlock.mine()
  const result = await miner;
  if (result == null) {
    throw new Error('genesis block mining cancelled')
  }
  console.log(genesisBlock.isProofValid())

  console.log(`genesis block mined: ${hex(result.hash())}\n${JSON.stringify(result.display(), null, 2)}`)
}