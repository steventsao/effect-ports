/**
 * Background work that must outlive the response.
 *
 * On Cloudflare a promise that nobody awaits is cancelled when the response is sent,
 * unless it was handed to `ctx.waitUntil`. `KeepAlive` carries that function through
 * the context so library code can start background work without knowing its host.
 * The default does nothing, which is right for Node, Bun and tests.
 *
 * @since 0.1.0
 */
import { Context, Effect, Layer } from "effect"

/** @since 0.1.0 */
export interface WaitUntilLike {
  waitUntil(promise: Promise<unknown>): void
}

/** @since 0.1.0 */
export const KeepAlive = Context.Reference<(work: Promise<unknown>) => void>("effect-ports/KeepAlive", {
  defaultValue: () => () => {}
})

/**
 * `layer(ctx)` for a Worker's `ExecutionContext` or a Durable Object's `DurableObjectState`.
 *
 * @since 0.1.0
 */
export const layer = (host: WaitUntilLike): Layer.Layer<never> =>
  Layer.succeed(KeepAlive, (work) => host.waitUntil(work))

/**
 * Starts `effect` in the background and keeps the host alive until it settles. Returns
 * at once. A failure is logged, never thrown: nothing is left to receive it.
 *
 * @since 0.1.0
 */
export const background = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const keepAlive = yield* KeepAlive
    const services = yield* Effect.context<R>()
    const logged = effect.pipe(
      Effect.catchCause((cause) => Effect.logError("Background work failed", cause)),
      Effect.provideContext(services)
    )
    keepAlive(Effect.runPromise(logged))
  })
