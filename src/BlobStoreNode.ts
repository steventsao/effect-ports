/**
 * `BlobStore` on a local directory, for Node, Bun and Deno.
 *
 * Each key becomes two files: `<encoded key>.blob` holds the bytes and
 * `<encoded key>.metadata` holds the content type.
 *
 * @since 0.1.0
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { BlobStore, BlobStoreError, make, type BlobMetadata, type BlobStoreMethod } from "./BlobStore.ts"

const DATA = ".blob"
const METADATA = ".metadata"

const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "ENOENT"

/** @since 0.1.0 */
export const layer = (directory: string): Layer.Layer<BlobStore, BlobStoreError> => {
  const dataPath = (key: string) => join(directory, `${encodeURIComponent(key)}${DATA}`)
  const metadataPath = (key: string) => join(directory, `${encodeURIComponent(key)}${METADATA}`)

  const attempt = <A>(method: BlobStoreMethod, key: string | undefined, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new BlobStoreError({
          method,
          key,
          cause,
          message: key === undefined ? `File ${method} failed in ${directory}` : `File ${method} failed for ${key}`
        })
    })

  const orMissing = async <A>(run: () => Promise<A>): Promise<A | undefined> => {
    try {
      return await run()
    } catch (cause) {
      if (isNotFound(cause)) return undefined
      throw cause
    }
  }

  const store = make({
    put: (key, bytes, contentType) =>
      attempt("put", key, async () => {
        await Promise.all([writeFile(dataPath(key), bytes), writeFile(metadataPath(key), contentType, "utf8")])
      }),
    get: (key) =>
      attempt("get", key, () =>
        orMissing(async () => {
          const [bytes, contentType] = await Promise.all([readFile(dataPath(key)), readFile(metadataPath(key), "utf8")])
          return { key, contentType, bytes: new Uint8Array(bytes), size: bytes.byteLength }
        })
      ),
    head: (key) =>
      attempt("head", key, () =>
        orMissing(async () => {
          const [info, contentType] = await Promise.all([stat(dataPath(key)), readFile(metadataPath(key), "utf8")])
          return { key, contentType, size: info.size }
        })
      ),
    delete: (key) =>
      attempt("delete", key, async () => {
        await Promise.all([rm(dataPath(key), { force: true }), rm(metadataPath(key), { force: true })])
      }),
    list: () =>
      attempt("list", undefined, async () => {
        const entries = await readdir(directory)
        const items = await Promise.all(
          entries
            .filter((entry) => entry.endsWith(METADATA))
            .map((entry) =>
              orMissing(async (): Promise<BlobMetadata> => {
                const key = decodeURIComponent(entry.slice(0, -METADATA.length))
                const [info, contentType] = await Promise.all([
                  stat(dataPath(key)),
                  readFile(join(directory, entry), "utf8")
                ])
                return { key, contentType, size: info.size }
              })
            )
        )
        // A key deleted while the listing ran is simply absent.
        return items.filter((item) => item !== undefined)
      })
  })

  return Layer.effect(
    BlobStore,
    Effect.as(
      attempt("list", undefined, () => mkdir(directory, { recursive: true })),
      store
    )
  )
}
