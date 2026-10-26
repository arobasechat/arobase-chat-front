type Runner = () => Promise<void>;

let runner: Runner | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

export function setSyncRunner(r: Runner | undefined) {
  runner = r;
  if (r && dirty) scheduleSync();
}

export function scheduleSync(delay = 8_000) {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!runner) return;
    dirty = false;
    void runner().catch((e) => {
      dirty = true;
      console.warn("Synchronisation chiffrée", e);
    });
  }, delay);
}
