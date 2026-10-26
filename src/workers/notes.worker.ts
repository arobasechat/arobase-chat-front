import { expose } from "@/lib/worker-rpc";

export type Rating = { note: string; rater: string; value: 1 | -1 };
export type NoteStatus = "helpful" | "not-helpful" | "needs-ratings";
export type NoteScore = { intercept: number; factor: number; ratings: number; status: NoteStatus };

const LAMBDA_INTERCEPT = 0.15;
const LAMBDA_FACTOR = 0.03;
const HELPFUL_THRESHOLD = 0.4;
const MAX_FACTOR = 0.5;

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296 - 0.5;
  };
}

function score(ratings: Rating[], minRatings: number): Record<string, NoteScore> {
  const notes = new Map<string, number>();
  const raters = new Map<string, number>();
  for (const r of ratings) {
    if (!notes.has(r.note)) notes.set(r.note, notes.size);
    if (!raters.has(r.rater)) raters.set(r.rater, raters.size);
  }
  const rand = seeded(42);
  const iN = new Float64Array(notes.size);
  const iU = new Float64Array(raters.size);
  const fN = Float64Array.from({ length: notes.size }, () => rand() * 0.2);
  const fU = Float64Array.from({ length: raters.size }, () => rand() * 0.2);
  const counts = new Uint32Array(notes.size);
  const rows = ratings.map((r) => {
    const n = notes.get(r.note)!;
    counts[n]++;
    return { n, u: raters.get(r.rater)!, y: r.value === 1 ? 1 : 0 };
  });
  let mu = rows.reduce((s, r) => s + r.y, 0) / Math.max(rows.length, 1);
  const lr = 0.05;
  for (let epoch = 0; epoch < 400; epoch++) {
    for (const { n, u, y } of rows) {
      const err = y - (mu + iN[n] + iU[u] + fN[n] * fU[u]);
      mu += lr * err * 0.1;
      iN[n] += lr * (err - LAMBDA_INTERCEPT * iN[n]);
      iU[u] += lr * (err - LAMBDA_INTERCEPT * iU[u]);
      const fn = fN[n];
      fN[n] += lr * (err * fU[u] - LAMBDA_FACTOR * fN[n]);
      fU[u] += lr * (err * fn - LAMBDA_FACTOR * fU[u]);
    }
  }
  const out: Record<string, NoteScore> = {};
  for (const [note, n] of notes) {
    const intercept = iN[n];
    const factor = fN[n];
    let status: NoteStatus = "needs-ratings";
    if (counts[n] >= minRatings) {
      if (intercept >= HELPFUL_THRESHOLD && Math.abs(factor) < MAX_FACTOR) status = "helpful";
      else if (intercept <= -0.05 - 0.8 * Math.abs(factor)) status = "not-helpful";
    }
    out[note] = { intercept, factor, ratings: counts[n], status };
  }
  return out;
}

const handlers = { score };
export type NotesHandlers = typeof handlers;
expose(handlers);
