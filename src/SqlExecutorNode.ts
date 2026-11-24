/**
 * `SqlExecutor` on `node:sqlite` (Node 22.5 or later). The default is a private
 * in-memory database, which makes it the test double for the Cloudflare layers:
 * the same SQLite dialect, no emulator.
 *
 * @since 0.1.0
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { Effect, Layer } from "effect"
import { SqlExecutor, SqlExecutorError, make, type SqlBinding, type SqlRow } from "./SqlExecutor.ts"

const input = (binding: SqlBinding): SQLInputValue =>
  binding instanceof ArrayBuffer ? new Uint8Array(binding) : binding

/** @since 0.1.0 */
export const layer = (path = ":memory:"): Layer.Layer<SqlExecutor, SqlExecutorError> =>
  Layer.effect(
    SqlExecutor,
    Effect.map(
      Effect.acquireRelease(
        Effect.try({
          try: () => new DatabaseSync(path),
          catch: (cause) => new SqlExecutorError({ query: "", cause, message: `Unable to open SQLite database ${path}` })
        }),
        (database) => Effect.sync(() => database.close())
      ),
      (database) =>
        make((query, bindings) =>
          Effect.try({
            try: () => database.prepare(query).all(...bindings.map(input)) as Array<SqlRow>,
            catch: (cause) => new SqlExecutorError({ query, cause, message: "SQLite statement failed" })
          })
        )
    )
  )
