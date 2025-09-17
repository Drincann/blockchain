import { randomBytes } from "crypto";
import { Block } from "../block.mts";

export class BlockMiner {

  private stop = false

  private finished = false

  private promise: Promise<Block | null>

  public isNotFinish() {
    return !this.finished
  }

  public getBlock() {
    return this.block
  }

  constructor(private block: Block) {
    this.promise = new Promise(resolve => {
      this.run(resolve)
    })

    this.promise.finally(() => { this.finished = true })
  }

  public async then(onFulfilled: (block: Block | null) => void): Promise<Block | null> {
    this.promise.then(onFulfilled)
    return this.promise
  }

  private run(onSuccess: (block: Block | null) => void) {
    setTimeout(() => {
      if (this.stop) return onSuccess(null);
      for (let i = 0; i < 100; i++) {
        if (this.stop) return onSuccess(null);
        this.block.setNonce(randomBytes(32))
        if (this.block.isProofValid()) {
          return onSuccess(this.block)
        }
      }
      this.run(onSuccess)
    }, 0)
  }

  public cancel() {
    this.stop = true
  }
}
