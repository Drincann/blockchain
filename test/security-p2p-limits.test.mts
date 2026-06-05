import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Node } from "../src/infra/node/node.mts"

describe("security: p2p message limits", () => {
  it("does not request transactions for an oversized tx inventory", async () => {
    const node = new Node()
    let requested = false
    const txids = Array.from({ length: 2_000 }, (_, i) => i.toString(16).padStart(64, "0"))

    await node["onNewTxs"]({
      data: { txids },
      peer: { address: "oversized-peer" },
      request: async () => {
        requested = true
        return { txs: [] }
      }
    } as any)

    assert.equal(requested, false)
  })
})
