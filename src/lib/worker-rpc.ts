type Handlers = Record<string, (...args: never[]) => unknown>;

type Request = { id: number; method: string; args: unknown[] };
type Response = { id: number; result?: unknown; error?: string };

export function expose(handlers: Handlers) {
  self.onmessage = async (e: MessageEvent<Request>) => {
    const { id, method, args } = e.data;
    try {
      const result = await (handlers[method] as (...a: unknown[]) => unknown)(...args);
      (self as unknown as Worker).postMessage({ id, result } satisfies Response);
    } catch (err) {
      (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies Response);
    }
  };
}

export function wrap<H extends Handlers>(factory: () => Worker) {
  let worker: Worker | undefined;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const get = () => {
    if (!worker) {
      worker = factory();
      worker.onmessage = (e: MessageEvent<Response>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data.result);
      };
    }
    return worker;
  };
  return new Proxy({} as { [K in keyof H]: (...args: Parameters<H[K]>) => Promise<Awaited<ReturnType<H[K]>>> }, {
    get: (_, method: string) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = ++seq;
          pending.set(id, { resolve, reject });
          get().postMessage({ id, method, args } satisfies Request);
        }),
  });
}
