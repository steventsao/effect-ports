// Stand-ins shaped like the Cloudflare bindings. D1 and Durable Object SQLite are backed by
// node:sqlite, so the SQL the contract runs is executed by a real SQLite.
import { DatabaseSync } from "node:sqlite"
import type { R2BucketLike, R2ObjectLike } from "../src/BlobStoreR2.ts"
import type { D1DatabaseLike } from "../src/SqlExecutorD1.ts"
import type { DurableObjectStorageLike } from "../src/SqlExecutorDurableObject.ts"

export const fakeR2 = (pageSize = 1): R2BucketLike & { readonly listCalls: () => number } => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>()
  let listCalls = 0
  const describe = (key: string, entry: { bytes: Uint8Array; contentType: string | undefined }): R2ObjectLike => ({
    key,
    size: entry.bytes.byteLength,
    httpMetadata: { contentType: entry.contentType }
  })
  return {
    listCalls: () => listCalls,
    put: async (key, value, options) => {
      objects.set(key, { bytes: new Uint8Array(value.slice(0)), contentType: options?.httpMetadata?.contentType })
    },
    get: async (key) => {
      const entry = objects.get(key)
      if (entry === undefined) return null
      return { ...describe(key, entry), arrayBuffer: async () => entry.bytes.slice().buffer as ArrayBuffer }
    },
    head: async (key) => {
      const entry = objects.get(key)
      return entry === undefined ? null : describe(key, entry)
    },
    delete: async (key) => void objects.delete(key),
    list: async (options) => {
      listCalls += 1
      const keys = [...objects.keys()].filter((key) => key.startsWith(options?.prefix ?? "")).sort()
      const start = options?.cursor === undefined ? 0 : Number(options.cursor)
      const page = keys.slice(start, start + pageSize)
      const truncated = start + pageSize < keys.length
      return {
        objects: page.map((key) => describe(key, objects.get(key)!)),
        truncated,
        ...(truncated ? { cursor: String(start + pageSize) } : {})
      }
    }
  }
}

export const fakeD1 = (): D1DatabaseLike => {
  const database = new DatabaseSync(":memory:")
  return {
    prepare: (query) => ({
      bind: (...values) => ({
        all: async () => ({ results: database.prepare(query).all(...(values as Array<never>)) })
      })
    })
  }
}

export const fakeDurableObjectStorage = (): DurableObjectStorageLike => {
  const database = new DatabaseSync(":memory:")
  return {
    sql: {
      // Like the real cursor: iterable, and blobs come back as ArrayBuffer.
      exec: (query, ...bindings) =>
        database
          .prepare(query)
          .all(...(bindings as Array<never>))
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([name, value]) => [
                name,
                value instanceof Uint8Array ? (value.slice().buffer as ArrayBuffer) : value
              ])
            )
          )
          [Symbol.iterator]()
    }
  }
}
