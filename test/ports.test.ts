import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as BlobStore from "../src/BlobStore.ts"
import * as BlobStoreNode from "../src/BlobStoreNode.ts"
import * as BlobStoreR2 from "../src/BlobStoreR2.ts"
import * as Contract from "../src/Contract.ts"
import * as KeepAlive from "../src/KeepAlive.ts"
import * as SqlExecutor from "../src/SqlExecutor.ts"
import * as SqlExecutorD1 from "../src/SqlExecutorD1.ts"
import * as SqlExecutorDurableObject from "../src/SqlExecutorDurableObject.ts"
import * as SqlExecutorNode from "../src/SqlExecutorNode.ts"
import * as WorkerRuntime from "../src/WorkerRuntime.ts"
import { fakeD1, fakeDurableObjectStorage, fakeR2 } from "./fakes.ts"

describe("BlobStore contract", () => {
  it.effect("memory", () => Contract.blobStore.pipe(Effect.provide(BlobStore.layerMemory)))

  it.effect("R2", () => Contract.blobStore.pipe(Effect.provide(BlobStoreR2.layer(fakeR2()))))

  it.effect("Node directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "effect-ports-"))
    return Contract.blobStore.pipe(
      Effect.provide(BlobStoreNode.layer(directory)),
      Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true, force: true })))
    )
  })

  it.effect("a store that loses the content type is caught", () => {
    const broken = Layer.effect(
      BlobStore.BlobStore,
      Effect.map(BlobStore.BlobStore, (store) => ({
        ...store,
        get: (key: string) =>
          Effect.map(store.get(key), (object) => object && { ...object, contentType: "application/octet-stream" })
      }))
    ).pipe(Layer.provide(BlobStore.layerMemory))
    return Effect.gen(function* () {
      const error = yield* Effect.flip(Contract.blobStore.pipe(Effect.provide(broken)))
      expect(error._tag).toBe("ContractViolation")
      expect(error.message).toBe("the content type round-trips")
    })
  })
})

describe("BlobStoreR2", () => {
  it.effect("follows the cursor through every page of a listing", () => {
    const bucket = fakeR2(2)
    return Effect.gen(function* () {
      const store = yield* BlobStore.BlobStore
      for (const name of ["e", "a", "d", "b", "c"]) yield* store.put(`p/${name}`, name, "text/plain")
      const listed = yield* store.list("p/")
      expect(listed.map((item) => item.key)).toEqual(["p/a", "p/b", "p/c", "p/d", "p/e"])
      expect(bucket.listCalls()).toBe(3)
    }).pipe(Effect.provide(BlobStoreR2.layer(bucket)))
  })

  it.effect("turns a rejected binding call into a BlobStoreError", () => {
    const bucket = { ...fakeR2(), get: () => Promise.reject(new Error("boom")) }
    return Effect.gen(function* () {
      const store = yield* BlobStore.BlobStore
      const error = yield* Effect.flip(store.get("k"))
      expect(error).toBeInstanceOf(BlobStore.BlobStoreError)
      expect(error.method).toBe("get")
      expect(error.key).toBe("k")
      expect((error.cause as Error).message).toBe("boom")
    }).pipe(Effect.provide(BlobStoreR2.layer(bucket)))
  })
})

describe("SqlExecutor contract", () => {
  it.effect("node:sqlite", () => Contract.sqlExecutor.pipe(Effect.provide(SqlExecutorNode.layer())))
  it.effect("D1", () => Contract.sqlExecutor.pipe(Effect.provide(SqlExecutorD1.layer(fakeD1()))))
  it.effect("Durable Object SQLite", () =>
    Contract.sqlExecutor.pipe(Effect.provide(SqlExecutorDurableObject.layer(fakeDurableObjectStorage()))))

  it.effect("a store written once runs on every layer", () => {
    const visits = Effect.gen(function* () {
      const sql = yield* SqlExecutor.SqlExecutor
      yield* sql.exec("CREATE TABLE IF NOT EXISTS visits (page TEXT PRIMARY KEY, n INTEGER NOT NULL)")
      for (let i = 0; i < 3; i++) {
        yield* sql.exec("INSERT INTO visits (page, n) VALUES (?, 1) ON CONFLICT(page) DO UPDATE SET n = n + 1", "/home")
      }
      return (yield* sql.one<{ n: number }>("SELECT n FROM visits WHERE page = ?", "/home"))?.n
    })
    return Effect.gen(function* () {
      expect(yield* visits.pipe(Effect.provide(SqlExecutorNode.layer()))).toBe(3)
      expect(yield* visits.pipe(Effect.provide(SqlExecutorD1.layer(fakeD1())))).toBe(3)
      expect(yield* visits.pipe(Effect.provide(SqlExecutorDurableObject.layer(fakeDurableObjectStorage())))).toBe(3)
    })
  })
})

describe("KeepAlive", () => {
  it.live("hands background work to waitUntil and returns before it finishes", () =>
    Effect.gen(function* () {
      const held: Array<Promise<unknown>> = []
      let done = false
      const slow = Effect.sleep("20 millis").pipe(Effect.andThen(Effect.sync(() => void (done = true))))
      yield* KeepAlive.background(slow).pipe(
        Effect.provide(KeepAlive.layer({ waitUntil: (promise) => void held.push(promise) }))
      )
      expect(held).toHaveLength(1)
      expect(done).toBe(false)
      yield* Effect.promise(() => held[0]!)
      expect(done).toBe(true)
    }))

  it.live("background work keeps the services of the caller, and a failure does not reject", () =>
    Effect.gen(function* () {
      const held: Array<Promise<unknown>> = []
      const work = Effect.gen(function* () {
        const store = yield* BlobStore.BlobStore
        yield* store.put("seen", "yes", "text/plain")
        return yield* Effect.fail("late failure")
      })
      const layers = Layer.mergeAll(
        BlobStore.layerMemory,
        KeepAlive.layer({ waitUntil: (promise) => void held.push(promise) })
      )
      const size = yield* Effect.gen(function* () {
        yield* KeepAlive.background(work)
        yield* Effect.promise(() => held[0]!)
        return (yield* (yield* BlobStore.BlobStore).head("seen"))?.size
      }).pipe(Effect.provide(layers))
      expect(size).toBe(3)
    }))

  it.effect("does nothing special without a host", () =>
    Effect.gen(function* () {
      yield* KeepAlive.background(Effect.void)
    }))
})

describe("WorkerRuntime", () => {
  it("builds the layer once for each env object", async () => {
    let builds = 0
    const runtimeFor = WorkerRuntime.make((env: { readonly bucket: BlobStoreR2.R2BucketLike }) => {
      builds += 1
      return BlobStoreR2.layer(env.bucket)
    })
    const first = { bucket: fakeR2() }
    const second = { bucket: fakeR2() }
    const put = Effect.gen(function* () {
      return yield* (yield* BlobStore.BlobStore).put("k", "v", "text/plain")
    })
    const has = Effect.gen(function* () {
      return (yield* (yield* BlobStore.BlobStore).head("k")) !== undefined
    })

    expect(runtimeFor(first)).toBe(runtimeFor(first))
    await runtimeFor(first).runPromise(put)
    expect(await runtimeFor(first).runPromise(has)).toBe(true)
    expect(await runtimeFor(second).runPromise(has)).toBe(false)
    expect(builds).toBe(2)
  })
})
