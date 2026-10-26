import { wrap } from "./worker-rpc";
import type { VerifyHandlers } from "@/workers/verify.worker";
import type { PowHandlers } from "@/workers/pow.worker";
import type { NotesHandlers } from "@/workers/notes.worker";

export const verifier = wrap<VerifyHandlers>(
  () => new Worker(new URL("../workers/verify.worker.ts", import.meta.url), { type: "module" }),
);

export const pow = wrap<PowHandlers>(
  () => new Worker(new URL("../workers/pow.worker.ts", import.meta.url), { type: "module" }),
);

export const notesScorer = wrap<NotesHandlers>(
  () => new Worker(new URL("../workers/notes.worker.ts", import.meta.url), { type: "module" }),
);
