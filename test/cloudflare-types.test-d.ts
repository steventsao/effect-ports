// Compile-time only: the real Cloudflare binding types must fit the structural ones.
import type { D1Database, DurableObjectState, DurableObjectStorage, ExecutionContext, R2Bucket } from "@cloudflare/workers-types"
import * as BlobStoreR2 from "../src/BlobStoreR2.ts"
import * as KeepAlive from "../src/KeepAlive.ts"
import * as SqlExecutorD1 from "../src/SqlExecutorD1.ts"
import * as SqlExecutorDurableObject from "../src/SqlExecutorDurableObject.ts"

declare const bucket: R2Bucket
declare const database: D1Database
declare const storage: DurableObjectStorage
declare const executionContext: ExecutionContext
declare const state: DurableObjectState

export const layers = [
  BlobStoreR2.layer(bucket),
  SqlExecutorD1.layer(database),
  SqlExecutorDurableObject.layer(storage),
  KeepAlive.layer(executionContext),
  KeepAlive.layer(state)
]
