import { join } from 'node:path'
import { BlockStorage } from '../../src/infra/persistence/storage.mts'

const store = new BlockStorage(join(process.argv[2], 'chain.sqlite'))
// Stop between removing an old branch and committing its replacement.
store.atomic(() => {
  store.rewind(0)
  process.stdout.write('uncommitted\n')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
})
