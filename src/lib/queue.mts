export class SyncronizedQueue {
  private queue: (() => Promise<unknown>)[] = []

  public async schedule<T>(_: (() => Promise<T>) | (() => T)): Promise<T> {
    let resolve: (value: T | PromiseLike<T>) => void = null as any
    let reject: (reason?: any) => void = null as any
    const promise = new Promise<T>((r, e) => { resolve = r; reject = e })

    const promiseTask = () => {
      let result: Promise<T>
      try {
        result = Promise.resolve(_())
      } catch (error) {
        reject(error)
        return Promise.reject(error)
      }
      result.then(resolve, reject)
      return result
    }

    this.queue.push(() => promiseTask().then(() => { }, () => { }).finally(() => this.callNext()))
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

