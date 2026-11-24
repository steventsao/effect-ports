/**
 * One `ManagedRuntime` for each Worker isolate.
 *
 * A Worker receives its bindings as an `env` argument, so layers that wrap bindings
 * cannot be built at module scope. Building them on every request throws away every
 * memoised service. `make` builds the layer the first time it sees an `env` and reuses
 * that runtime for as long as the isolate passes the same `env` object.
 *
 * @since 0.1.0
 */
import { ManagedRuntime, type Layer } from "effect"

/**
 * @since 0.1.0
 * @example
 * const runtimeFor = WorkerRuntime.make((env: Env) =>
 *   Layer.mergeAll(BlobStoreR2.layer(env.BUCKET), SqlExecutorD1.layer(env.DB))
 * )
 *
 * export default {
 *   fetch: (request: Request, env: Env) => runtimeFor(env).runPromise(handle(request))
 * }
 */
export const make = <Env extends object, A, E>(
  build: (env: Env) => Layer.Layer<A, E>
): ((env: Env) => ManagedRuntime.ManagedRuntime<A, E>) => {
  const runtimes = new WeakMap<Env, ManagedRuntime.ManagedRuntime<A, E>>()
  return (env) => {
    let runtime = runtimes.get(env)
    if (runtime === undefined) {
      runtime = ManagedRuntime.make(build(env))
      runtimes.set(env, runtime)
    }
    return runtime
  }
}
