export class SyncronizedQueue {
  private queue: (() => Promise<void>)[] = []

  public async schedule<T>(_: (() => Promise<T>) | (() => T)): Promise<T> {
    let resolve: (value: T | PromiseLike<T>) => void = null as any
    const promise = new Promise<T>(r => { resolve = r })

    const promiseTask = () => {
      const result = Promise.resolve(_())
      resolve(result)
      return result
    }

    this.queue.push(() => promiseTask().then(() => this.callNext()))
    if (this.queue.length === 1) {
      this.queue[0]?.()
    }

    return promise
  }

  private callNext() {
    this.queue.shift()
    if (this.queue.length > 0) {
      this.queue[0]?.()
    }
  }
}

