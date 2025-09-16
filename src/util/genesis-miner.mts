import { Block } from "../block.mts";
import { hex } from "./crypto.mts";

const genesisBlock = Block.deserialize(Block.GENESIS_BLOCK);
if (genesisBlock.isProofValid()) {
  console.log(`genesis block already mined: ${hex(genesisBlock.hash())}\n${JSON.stringify(genesisBlock.display(), null, 2)}`);

} else {
  const miner = genesisBlock.mine()
  const resut = await miner;
  console.log(genesisBlock.isProofValid())

  console.log(`genesis block mined: ${hex(resut.hash())}\n${JSON.stringify(resut.display(), null, 2)}`)
}