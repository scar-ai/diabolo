import { Effect, Layer, ManagedRuntime } from "effect";

export const memoMap = Effect.runSync(Layer.makeMemoMap);

export function makeRunPromise<I, S, E>(
  service: {
    readonly use: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) => Effect.Effect<A, Err, I>;
  },
  layer: Layer.Layer<I, E, never>,
) {
  let runtime: ManagedRuntime.ManagedRuntime<I, E> | undefined;

  return <A, Err>(
    fn: (svc: S) => Effect.Effect<A, Err, I>,
    options?: {
      readonly signal?: AbortSignal | undefined;
    },
  ) => {
    runtime ??= ManagedRuntime.make(layer, memoMap);
    return runtime.runPromise(service.use(fn), options);
  };
}
