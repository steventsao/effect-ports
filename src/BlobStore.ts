/**
 * A runtime-neutral blob store: bytes plus a content type under a string key.
 *
 * Program against `BlobStore`; pick the backend where the app is assembled
 * (`BlobStoreR2.layer`, `BlobStoreNode.layer`, or `layerMemory` in tests).
 *
 * @since 0.1.0
 */
import { Context, Data, Effect, Layer } from "effect"

/** @since 0.1.0 */
export interface BlobMetadata {
  readonly key: string
  readonly contentType: string
  readonly size: number
}

/** @since 0.1.0 */
export interface BlobObject extends BlobMetadata {
  readonly bytes: Uint8Array
}

/** @since 0.1.0 */
export type BlobBody = string | Uint8Array | ArrayBuffer

/** @since 0.1.0 */
export type BlobStoreMethod = "put" | "get" | "head" | "delete" | "list"

/** @since 0.1.0 */
export class BlobStoreError extends Data.TaggedError("BlobStoreError")<{
  readonly method: BlobStoreMethod
  readonly message: string
  readonly key?: string | undefined
  readonly cause?: unknown
}> {}

/** @since 0.1.0 */
export interface BlobStoreShape {
  /** Stores the body and returns the number of bytes written. */
  readonly put: (key: string, body: BlobBody, contentType: string) => Effect.Effect<number, BlobStoreError>
  /** `undefined` when the key does not exist. */
  readonly get: (key: string) => Effect.Effect<BlobObject | undefined, BlobStoreError>
  /** Metadata only. `undefined` when the key does not exist. */
  readonly head: (key: string) => Effect.Effect<BlobMetadata | undefined, BlobStoreError>
  /** Deleting a missing key succeeds. */
  readonly delete: (key: string) => Effect.Effect<void, BlobStoreError>
  /** Every key with the prefix, ordered by key. */
  readonly list: (prefix?: string) => Effect.Effect<ReadonlyArray<BlobMetadata>, BlobStoreError>
}

/** @since 0.1.0 */
export class BlobStore extends Context.Service<BlobStore, BlobStoreShape>()("effect-ports/BlobStore") {}

/**
 * What a backend has to supply. `head` is optional: without it, `make` derives it from `get`.
 *
 * @since 0.1.0
 */
export interface BlobStoreBackend {
  readonly put: (key: string, bytes: Uint8Array, contentType: string) => Effect.Effect<void, BlobStoreError>
  readonly get: (key: string) => Effect.Effect<BlobObject | undefined, BlobStoreError>
  readonly head?: (key: string) => Effect.Effect<BlobMetadata | undefined, BlobStoreError>
  readonly delete: (key: string) => Effect.Effect<void, BlobStoreError>
  readonly list: (prefix: string | undefined) => Effect.Effect<ReadonlyArray<BlobMetadata>, BlobStoreError>
}

/** @since 0.1.0 */
export const toBytes = (body: BlobBody): Uint8Array =>
  typeof body === "string"
    ? new TextEncoder().encode(body)
    : body instanceof Uint8Array
      ? body
      : new Uint8Array(body)

const compareKeys = (left: BlobMetadata, right: BlobMetadata) =>
  left.key < right.key ? -1 : left.key > right.key ? 1 : 0

/**
 * Builds a `BlobStore` from a backend. The rules every backend shares live here, so
 * backends stay small: empty keys are refused, bodies are normalised to bytes, and
 * listings are filtered by prefix and ordered by key.
 *
 * @since 0.1.0
 */
export const make = (backend: BlobStoreBackend): BlobStoreShape => {
  const keyed = <A>(method: BlobStoreMethod, key: string, run: () => Effect.Effect<A, BlobStoreError>) =>
    key.length === 0
      ? Effect.fail(new BlobStoreError({ method, key, message: "Blob keys must not be empty" }))
      : Effect.suspend(run)

  return {
    put: (key, body, contentType) =>
      keyed("put", key, () => {
        const bytes = toBytes(body)
        return Effect.as(backend.put(key, bytes, contentType), bytes.byteLength)
      }),
    get: (key) => keyed("get", key, () => backend.get(key)),
    head: (key) =>
      keyed("head", key, () =>
        backend.head !== undefined
          ? backend.head(key)
          : Effect.map(backend.get(key), (object) =>
              object === undefined
                ? undefined
                : { key: object.key, contentType: object.contentType, size: object.size }
            )
      ),
    delete: (key) => keyed("delete", key, () => backend.delete(key)),
    list: (prefix) =>
      Effect.map(backend.list(prefix), (items) =>
        items.filter((item) => prefix === undefined || item.key.startsWith(prefix)).sort(compareKeys)
      )
  }
}

/**
 * A store that lives in memory for as long as the layer does. For tests and
 * short-lived runtimes. Bytes are copied on the way in and on the way out.
 *
 * @since 0.1.0
 */
export const layerMemory: Layer.Layer<BlobStore> = Layer.sync(BlobStore, () => {
  const objects = new Map<string, BlobObject>()
  return make({
    put: (key, bytes, contentType) =>
      Effect.sync(() => {
        const copy = new Uint8Array(bytes)
        objects.set(key, { key, bytes: copy, contentType, size: copy.byteLength })
      }),
    get: (key) =>
      Effect.sync(() => {
        const object = objects.get(key)
        return object === undefined ? undefined : { ...object, bytes: new Uint8Array(object.bytes) }
      }),
    delete: (key) => Effect.sync(() => void objects.delete(key)),
    list: () =>
      Effect.sync(() => [...objects.values()].map(({ key, contentType, size }) => ({ key, contentType, size })))
  })
})
