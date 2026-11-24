/**
 * `SqlExecutor` on a Cloudflare D1 binding: `layer(env.DB)`.
 *
 * @since 0.1.0
 */
import { Effect, Layer } from "effect"
import { SqlExecutor, SqlExecutorError, make, type SqlRow } from "./SqlExecutor.ts"

/** @since 0.1.0 */
export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...values: Array<unknown>): {
      all(): Promise<{ readonly results?: ReadonlyArray<unknown> | null | undefined }>
    }
  }
}

/** @since 0.1.0 */
export const layer = (database: D1DatabaseLike): Layer.Layer<SqlExecutor> =>
  Layer.succeed(
    SqlExecutor,
    make((query, bindings) =>
      Effect.tryPromise({
        try: async () => {
          const result = await database.prepare(query).bind(...bindings).all()
          return (result.results ?? []) as ReadonlyArray<SqlRow>
        },
        catch: (cause) => new SqlExecutorError({ query, cause, message: "D1 statement failed" })
      })
    )
  )
