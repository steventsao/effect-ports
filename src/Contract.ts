/**
 * Contract checks: one Effect for each port that any layer of that port must pass.
 *
 * They use no test framework, so they run under Vitest, `node:test`, Bun, or inside
 * workerd against real bindings. Provide your layer and run the Effect; a broken
 * contract fails it with a `ContractViolation` that names the rule.
 *
 * @since 0.1.0
 * @example
 * it.effect("R2 store honours the contract", () =>
 *   blobStore.pipe(Effect.provide(BlobStoreR2.layer(env.BUCKET))))
 */
import { Data, Effect } from "effect"
import { BlobStore, BlobStoreError } from "./BlobStore.ts"
import { SqlExecutor, SqlExecutorError } from "./SqlExecutor.ts"

/** @since 0.1.0 */
export class ContractViolation extends Data.TaggedError("ContractViolation")<{
  readonly port: string
  readonly message: string
}> {}

const checker = (port: string) => (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(new ContractViolation({ port, message }))

/** The failure of an effect that is expected to fail, or `undefined` if it succeeded. */
const failureOf = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<E | undefined, never, R> =>
  Effect.match(effect, { onFailure: (error) => error, onSuccess: () => undefined })

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])

/**
 * Writes under the given key prefix and removes what it wrote.
 *
 * @since 0.1.0
 */
export const blobStoreWith = (
  prefix: string
): Effect.Effect<void, ContractViolation | BlobStoreError, BlobStore> =>
  Effect.gen(function* () {
    const check = checker("BlobStore")
    const store = yield* BlobStore
    const key = (name: string) => `${prefix}${name}`

    yield* check((yield* store.get(key("missing"))) === undefined, "get of a missing key returns undefined")
    yield* check((yield* store.head(key("missing"))) === undefined, "head of a missing key returns undefined")

    const binary = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
    yield* check((yield* store.put(key("docs/zeta.pdf"), binary, "application/pdf")) === 6, "put returns the byte count")
    yield* check((yield* store.put(key("docs/alpha.txt"), "héllo", "text/plain")) === 6, "a string body is stored as UTF-8")
    yield* store.put(key("other.bin"), new Uint8Array([7]).buffer, "application/octet-stream")

    const stored = yield* store.get(key("docs/zeta.pdf"))
    yield* check(stored !== undefined && sameBytes(stored.bytes, binary), "bytes round-trip unchanged")
    yield* check(stored?.contentType === "application/pdf", "the content type round-trips")
    yield* check(stored?.key === key("docs/zeta.pdf") && stored.size === 6, "get reports the key and size")

    const head = yield* store.head(key("docs/zeta.pdf"))
    yield* check(head?.size === 6 && head.contentType === "application/pdf", "head reports size and content type")
    yield* check(head !== undefined && !("bytes" in head), "head carries no bytes")

    yield* store.put(key("docs/alpha.txt"), "bye", "text/markdown")
    const replaced = yield* store.get(key("docs/alpha.txt"))
    yield* check(
      replaced !== undefined && new TextDecoder().decode(replaced.bytes) === "bye" && replaced.contentType === "text/markdown",
      "put replaces an existing key"
    )

    const listed = yield* store.list(key("docs/"))
    yield* check(
      listed.length === 2 && listed[0]?.key === key("docs/alpha.txt") && listed[1]?.key === key("docs/zeta.pdf"),
      "list returns only the prefix, ordered by key"
    )
    yield* check(listed[0]?.size === 3 && listed[1]?.contentType === "application/pdf", "list reports size and content type")

    yield* store.delete(key("docs/zeta.pdf"))
    yield* check((yield* store.get(key("docs/zeta.pdf"))) === undefined, "delete removes the key")
    yield* store.delete(key("docs/zeta.pdf"))
    yield* store.delete(key("docs/alpha.txt"))
    yield* store.delete(key("other.bin"))
    yield* check((yield* store.list(prefix)).length === 0, "nothing is left after deleting every key")

    const error = yield* failureOf(store.get(""))
    yield* check(
      error instanceof BlobStoreError && error.method === "get" && error.key === "",
      "an empty key fails with a BlobStoreError that names the method"
    )
  })

/** @since 0.1.0 */
export const blobStore: Effect.Effect<void, ContractViolation | BlobStoreError, BlobStore> =
  blobStoreWith("effect-ports-contract/")

/**
 * Creates, uses and drops the table `effect_ports_contract`.
 *
 * @since 0.1.0
 */
export const sqlExecutor: Effect.Effect<void, ContractViolation | SqlExecutorError, SqlExecutor> = Effect.gen(
  function* () {
    const check = checker("SqlExecutor")
    const sql = yield* SqlExecutor

    yield* sql.exec("DROP TABLE IF EXISTS effect_ports_contract")
    const created = yield* sql.exec(
      "CREATE TABLE effect_ports_contract (id INTEGER PRIMARY KEY, label TEXT, score REAL, data BLOB)"
    )
    yield* check(created.length === 0, "a statement that returns no rows yields an empty array")

    yield* sql.exec("INSERT INTO effect_ports_contract (id, label, score, data) VALUES (?, ?, ?, ?)", 2, "two", 2.5, null)
    yield* sql.exec(
      "INSERT INTO effect_ports_contract (id, label, score, data) VALUES (?, ?, ?, ?)",
      1,
      "one",
      1,
      new Uint8Array([1, 2, 3])
    )

    const rows = yield* sql.exec<{ id: number; label: string }>("SELECT id, label FROM effect_ports_contract ORDER BY id")
    yield* check(rows.length === 2 && rows[0]?.id === 1 && rows[1]?.label === "two", "exec returns every row in order")

    const one = yield* sql.one<{ label: string; score: number; data: unknown }>(
      "SELECT label, score, data FROM effect_ports_contract WHERE id = ?",
      2
    )
    yield* check(one?.label === "two" && one.score === 2.5, "text and real values round-trip")
    yield* check(one?.data === null, "null round-trips")

    const blob = yield* sql.one<{ data: ArrayBuffer | Uint8Array }>("SELECT data FROM effect_ports_contract WHERE id = ?", 1)
    const bytes = blob === undefined ? undefined : blob.data instanceof Uint8Array ? blob.data : new Uint8Array(blob.data)
    yield* check(bytes !== undefined && sameBytes(new Uint8Array(bytes), new Uint8Array([1, 2, 3])), "blob values round-trip")

    yield* check(
      (yield* sql.one("SELECT id FROM effect_ports_contract WHERE id = ?", 99)) === undefined,
      "one returns undefined when no row matches"
    )

    const error = yield* failureOf(sql.exec("SELECT nope FROM effect_ports_missing_table"))
    yield* check(
      error instanceof SqlExecutorError && error.query.includes("effect_ports_missing_table"),
      "a failing statement fails with a SqlExecutorError that carries the query"
    )

    yield* sql.exec("DROP TABLE effect_ports_contract")
  }
)
