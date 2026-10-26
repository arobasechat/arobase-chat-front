export function createBatcher<K, V>(
  fetchMany: (keys: K[]) => Promise<V[]>,
  opts: { wait?: number; max?: number; keyOf?: (k: K) => string } = {},
) {
  const { wait = 6, max = 200, keyOf = (k: K) => String(k) } = opts;
  let queue: { key: K; resolve: (v: V) => void; reject: (e: unknown) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    timer = undefined;
    const batch = queue;
    queue = [];
    const unique = [...new Map(batch.map((b) => [keyOf(b.key), b.key])).values()];
    for (let i = 0; i < unique.length; i += max) {
      const chunk = unique.slice(i, i + max);
      try {
        const values = await fetchMany(chunk);
        const byKey = new Map(chunk.map((k, j) => [keyOf(k), values[j]]));
        for (const b of batch) if (byKey.has(keyOf(b.key))) b.resolve(byKey.get(keyOf(b.key))!);
      } catch (err) {
        const keys = new Set(chunk.map(keyOf));
        for (const b of batch) if (keys.has(keyOf(b.key))) b.reject(err);
      }
    }
  };

  return (key: K) =>
    new Promise<V>((resolve, reject) => {
      queue.push({ key, resolve, reject });
      if (queue.length >= max) {
        clearTimeout(timer);
        void flush();
      } else if (!timer) timer = setTimeout(flush, wait);
    });
}

export function memoBy<A extends unknown[], R>(fn: (...args: A) => R, keyOf: (...args: A) => string) {
  const cache = new Map<string, R>();
  return (...args: A) => {
    const k = keyOf(...args);
    let v = cache.get(k);
    if (v === undefined) {
      v = fn(...args);
      cache.set(k, v);
    }
    return v;
  };
}
