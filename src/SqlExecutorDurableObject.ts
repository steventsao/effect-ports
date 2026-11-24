/**
 * `SqlExecutor` on a SQLite-backed Durable Object: `layer(ctx.storage)`.
 *
 * @since 0.1.0
 */
import { Layer } from "effect"
import { SqlExecutor, makeFromSync, type SyncSqlSource } from "./SqlExecutor.ts"

/** @since 0.1.0 */
export interface DurableObjectStorageLike {
  readonly sql: SyncSqlSource
}

/** @since 0.1.0 */
export const layer = (storage: DurableObjectStorageLike): Layer.Layer<SqlExecutor> =>
  Layer.succeed(SqlExecutor, makeFromSync(storage.sql))
