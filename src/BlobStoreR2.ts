/**
 * `BlobStore` on a Cloudflare R2 bucket binding.
 *
 * The bucket is typed structurally, so this module needs no Cloudflare package:
 * `env.MY_BUCKET` from `wrangler types` or `@cloudflare/workers-types` fits as is.
 *
 * @since 0.1.0
 */
import { Effect, Layer } from "effect"
import { BlobStore, BlobStoreError, make, type BlobMetadata, type BlobStoreMethod } from "./BlobStore.ts"

/** @since 0.1.0 */
export interface R2ObjectLike {
  readonly key: string
  readonly size: number
  readonly httpMetadata?: { readonly contentType?: string | undefined } | undefined
}

/** @since 0.1.0 */
export interface R2ObjectBodyLike extends R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>
}

/** @since 0.1.0 */
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectBodyLike | null>
  head(key: string): Promise<R2ObjectLike | null>
  delete(key: string): Promise<unknown>
  list(options?: { prefix?: string; cursor?: string; include?: Array<"httpMetadata"> }): Promise<{
    readonly objects: ReadonlyArray<R2ObjectLike>
    readonly truncated?: boolean
    readonly cursor?: string | undefined
  }>
}

const DEFAULT_CONTENT_TYPE = "application/octet-stream"

const metadata = (object: R2ObjectLike): BlobMetadata => ({
  key: object.key,
  contentType: object.httpMetadata?.contentType ?? DEFAULT_CONTENT_TYPE,
  size: object.size
})

/** @since 0.1.0 */
export const layer = (bucket: R2BucketLike): Layer.Layer<BlobStore> => {
  const attempt = <A>(method: BlobStoreMethod, key: string | undefined, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new BlobStoreError({
          method,
          key,
          cause,
          message: key === undefined ? `R2 ${method} failed` : `R2 ${method} failed for ${key}`
        })
    })

  return Layer.succeed(
    BlobStore,
    make({
      put: (key, bytes, contentType) =>
        attempt("put", key, async () => {
          // Copy into a plain ArrayBuffer: `bytes` may be a view over a larger or shared buffer.
          await bucket.put(key, bytes.slice().buffer as ArrayBuffer, { httpMetadata: { contentType } })
        }),
      get: (key) =>
        attempt("get", key, async () => {
          const object = await bucket.get(key)
          if (object === null) return undefined
          const bytes = new Uint8Array(await object.arrayBuffer())
          return { ...metadata(object), key, bytes, size: bytes.byteLength }
        }),
      head: (key) =>
        attempt("head", key, async () => {
          const object = await bucket.head(key)
          return object === null ? undefined : { ...metadata(object), key }
        }),
      delete: (key) =>
        attempt("delete", key, async () => {
          await bucket.delete(key)
        }),
      list: (prefix) =>
        attempt("list", undefined, async () => {
          const items: Array<BlobMetadata> = []
          let cursor: string | undefined
          do {
            const page = await bucket.list({
              ...(prefix === undefined ? {} : { prefix }),
              ...(cursor === undefined ? {} : { cursor }),
              include: ["httpMetadata"]
            })
            for (const object of page.objects) items.push(metadata(object))
            cursor = page.truncated ? page.cursor : undefined
            if (page.truncated && cursor === undefined) {
              throw new Error("R2 returned a truncated list without a cursor")
            }
          } while (cursor !== undefined)
          return items
        })
    })
  )
}
