import { randomBytes } from "crypto";
import { Block } from "../../domain/block/block.mts";

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

  constructor(private block: Block, accept: (block: Block) => boolean = () => true) {
    const work = new Promise<Block | null>(resolve => this.run(resolve))
    this.promise = work.then(block => block && accept(block) ? block : null)
      .finally(() => { this.finished = true })
  }

  public then<T>(onFulfilled: (block: Block | null) => T, onRejected?: (error: unknown) => never): Promise<T> {
    return this.promise.then(onFulfilled, onRejected)
  }

  private run(onSuccess: (block: Block | null) => void) {
    setTimeout(() => {
      if (this.stop) return onSuccess(null);
      this.block.setTs(Date.now())
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
