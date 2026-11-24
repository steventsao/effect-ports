/**
 * The smallest SQL seam that Durable Object SQLite, D1 and `node:sqlite` all fit:
 * run one statement with positional bindings, get the rows back.
 *
 * Use it for stores that must run unchanged inside a Durable Object, against D1 and
 * in a Node test. For a full SQL client (transactions, a query builder, migrations)
 * use `effect/unstable/sql` with `@effect/sql-d1` or `@effect/sql-sqlite-do` instead.
 *
 * @since 0.1.0
 */
import { Context, Data, Effect } from "effect"

/** @since 0.1.0 */
export type SqlBinding = string | number | bigint | null | ArrayBuffer | Uint8Array

/** @since 0.1.0 */
export type SqlRow = Readonly<Record<string, unknown>>

/** @since 0.1.0 */
export class SqlExecutorError extends Data.TaggedError("SqlExecutorError")<{
  readonly query: string
  readonly message: string
  readonly cause?: unknown
}> {}

/** @since 0.1.0 */
export interface SqlExecutorShape {
  /** Runs one statement and returns every row (empty for statements that return none). */
  readonly exec: <Row extends SqlRow = SqlRow>(
    query: string,
    ...bindings: ReadonlyArray<SqlBinding>
  ) => Effect.Effect<ReadonlyArray<Row>, SqlExecutorError>
  /** The first row, or `undefined`. */
  readonly one: <Row extends SqlRow = SqlRow>(
    query: string,
    ...bindings: ReadonlyArray<SqlBinding>
  ) => Effect.Effect<Row | undefined, SqlExecutorError>
}

/** @since 0.1.0 */
export class SqlExecutor extends Context.Service<SqlExecutor, SqlExecutorShape>()("effect-ports/SqlExecutor") {}

/** @since 0.1.0 */
export const make = (
  exec: (query: string, bindings: ReadonlyArray<SqlBinding>) => Effect.Effect<ReadonlyArray<SqlRow>, SqlExecutorError>
): SqlExecutorShape => {
  const run = <Row extends SqlRow>(query: string, bindings: ReadonlyArray<SqlBinding>) =>
    exec(query, bindings) as Effect.Effect<ReadonlyArray<Row>, SqlExecutorError>
  return {
    exec: (query, ...bindings) => run(query, bindings),
    one: <Row extends SqlRow>(query: string, ...bindings: ReadonlyArray<SqlBinding>) =>
      Effect.map(run<Row>(query, bindings), (rows) => rows[0])
  }
}

/**
 * A synchronous driver whose `exec` returns something iterable over rows. This is the
 * shape of a Durable Object's `ctx.storage.sql`.
 *
 * @since 0.1.0
 */
export interface SyncSqlSource {
  exec(query: string, ...bindings: Array<any>): Iterable<unknown>
}

/** @since 0.1.0 */
export const makeFromSync = (source: SyncSqlSource): SqlExecutorShape =>
  make((query, bindings) =>
    Effect.try({
      try: () => Array.from(source.exec(query, ...bindings)) as Array<SqlRow>,
      catch: (cause) => new SqlExecutorError({ query, cause, message: "SQL statement failed" })
    })
  )
