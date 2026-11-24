# effect-ports

Runtime-neutral [Effect](https://effect.website) services with a layer for each place the code runs, and a contract check that every layer must pass.

Write a store or a handler once against a port. Give it the Cloudflare layer in the Worker, the Node layer in a script, and the memory layer in a test.

| Port | Cloudflare | Node | Memory |
| --- | --- | --- | --- |
| `BlobStore`: bytes and a content type under a key | `BlobStoreR2.layer(env.BUCKET)` | `BlobStoreNode.layer(directory)` | `BlobStore.layerMemory` |
| `SqlExecutor`: one statement in, rows out | `SqlExecutorD1.layer(env.DB)`, `SqlExecutorDurableObject.layer(ctx.storage)` | `SqlExecutorNode.layer(path)` | `SqlExecutorNode.layer()` |
| `KeepAlive`: background work that outlives the response | `KeepAlive.layer(ctx)` | the default (does nothing) | the default |

Also included:

- `WorkerRuntime.make(build)`: one `ManagedRuntime` for each Worker isolate, built from `env` the first time it is seen.
- `Contract.blobStore` and `Contract.sqlExecutor`: Effects that check a layer against the port's rules.

Requires `effect` 4.1 or later. ESM only. The Cloudflare modules type bindings structurally, so the package depends on no Cloudflare package.

## Install

```bash
pnpm add effect-ports effect
```

Until the first npm release, install from GitHub (it builds itself on install):

```bash
npm install github:steventsao/effect-ports
```

## Use

```ts
import { Effect, Layer } from "effect"
import * as BlobStore from "effect-ports/BlobStore"
import * as BlobStoreR2 from "effect-ports/BlobStoreR2"
import * as KeepAlive from "effect-ports/KeepAlive"
import * as SqlExecutor from "effect-ports/SqlExecutor"
import * as SqlExecutorD1 from "effect-ports/SqlExecutorD1"
import * as WorkerRuntime from "effect-ports/WorkerRuntime"

// Written once, against ports.
const saveUpload = (name: string, body: Uint8Array) =>
  Effect.gen(function* () {
    const blobs = yield* BlobStore.BlobStore
    const sql = yield* SqlExecutor.SqlExecutor
    const size = yield* blobs.put(`uploads/${name}`, body, "application/pdf")
    yield* sql.exec("INSERT INTO uploads (name, size) VALUES (?, ?)", name, size)
    // Runs after the response is sent; the Worker stays alive until it settles.
    yield* KeepAlive.background(Effect.log(`stored ${name}`))
    return size
  })

// Assembled once for each isolate, from the Worker's bindings.
const runtimeFor = WorkerRuntime.make((env: Env) =>
  Layer.mergeAll(BlobStoreR2.layer(env.BUCKET), SqlExecutorD1.layer(env.DB))
)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const body = new Uint8Array(await request.arrayBuffer())
    const size = await runtimeFor(env).runPromise(
      saveUpload("report.pdf", body).pipe(Effect.provide(KeepAlive.layer(ctx)))
    )
    return Response.json({ size })
  }
}
```

The same `saveUpload` in a test, with no emulator:

```ts
import * as SqlExecutorNode from "effect-ports/SqlExecutorNode"

const TestLayer = Layer.mergeAll(BlobStore.layerMemory, SqlExecutorNode.layer())
```

`effect-ports` (the root import) re-exports every module except the two Node ones, so it is safe to import in a Worker. Import `effect-ports/BlobStoreNode` and `effect-ports/SqlExecutorNode` by path.

## Contract checks

A layer is only interchangeable if it behaves like the others. Each port ships an Effect that states its rules: a missing key returns `undefined`, a listing is ordered by key, a failing statement carries its query. Provide a layer and run it. It uses no test framework, so it also runs inside workerd against real bindings.

```ts
import { it } from "@effect/vitest"
import * as Contract from "effect-ports/Contract"

it.effect("my S3 store is a BlobStore", () =>
  Contract.blobStore.pipe(Effect.provide(MyS3BlobStore.layer(client))))
```

A broken rule fails with `ContractViolation`, whose `message` names the rule.

To add a backend, pass five functions to `BlobStore.make` (or one to `SqlExecutor.make`) and run the contract against the result. `make` supplies the shared rules: it refuses empty keys, turns bodies into bytes, and filters and orders listings.

## When to use something else

- For a typed wrapper around each Cloudflare binding (KV, Queues, Workflows, Vectorize and the rest), use [effect-cf](https://github.com/danieljvdm/effect-cf). This package covers only the ports that have a second runtime to move to.
- For a full SQL client with transactions and migrations, use `effect/unstable/sql` with `@effect/sql-d1` or `@effect/sql-sqlite-do`. `SqlExecutor` is deliberately one function wide, so that the same store can run in a Durable Object, on D1 and on `node:sqlite`.

## Develop

```bash
pnpm install
```

```bash
pnpm check && pnpm test && pnpm build
```

The tests run each contract against memory, a temporary directory, `node:sqlite`, and stand-ins shaped like R2, D1 and Durable Object storage (the SQL ones backed by a real SQLite). `test/cloudflare-types.test-d.ts` checks at compile time that the real `@cloudflare/workers-types` bindings fit. Nothing here has been run inside workerd yet.

## License

MIT
