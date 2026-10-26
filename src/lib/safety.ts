import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Address } from "viem";

export type Flag = { ts: number; on: boolean };
export type SafetyLists = { muted: Record<string, Flag>; blocked: Record<string, Flag> };

type SafetyState = {
  byUser: Record<string, SafetyLists>;
  set: (me: Address, list: keyof SafetyLists, who: Address, on: boolean) => void;
  merge: (me: Address, incoming: Partial<SafetyLists>) => boolean;
};

const lc = (a: string) => a.toLowerCase();
const empty = (): SafetyLists => ({ muted: {}, blocked: {} });

export function mergeFlags(a: Record<string, Flag>, b: Record<string, Flag> | undefined) {
  let changed = false;
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (!out[k] || out[k].ts < v.ts) {
      out[k] = v;
      changed = true;
    }
  }
  return { out, changed };
}

export const useSafety = create<SafetyState>()(
  persist(
    (set, get) => ({
      byUser: {},
      set: (me, list, who, on) =>
        set((s) => {
          const cur = s.byUser[lc(me)] ?? empty();
          return { byUser: { ...s.byUser, [lc(me)]: { ...cur, [list]: { ...cur[list], [lc(who)]: { ts: Date.now(), on } } } } };
        }),
      merge: (me, incoming) => {
        const cur = get().byUser[lc(me)] ?? empty();
        const muted = mergeFlags(cur.muted, incoming.muted);
        const blocked = mergeFlags(cur.blocked, incoming.blocked);
        if (!muted.changed && !blocked.changed) return false;
        set((s) => ({ byUser: { ...s.byUser, [lc(me)]: { muted: muted.out, blocked: blocked.out } } }));
        return true;
      },
    }),
    { name: "arobase:safety", version: 1 },
  ),
);

export const listOf = (lists: SafetyLists | undefined, key: keyof SafetyLists) =>
  Object.entries(lists?.[key] ?? {})
    .filter(([, f]) => f.on)
    .map(([a]) => a as Address);

export function useHiddenAuthors(me: Address | undefined) {
  const lists = useSafety((s) => (me ? s.byUser[lc(me)] : undefined));
  return { lists, isHidden: (a: string) => !!lists && (!!lists.muted[lc(a)]?.on || !!lists.blocked[lc(a)]?.on), isBlocked: (a: string) => !!lists?.blocked[lc(a)]?.on };
}

export function hiddenNow(me: Address | undefined, a: string) {
  if (!me) return false;
  const lists = useSafety.getState().byUser[lc(me)];
  return !!lists && (!!lists.muted[lc(a)]?.on || !!lists.blocked[lc(a)]?.on);
}

export function blockedNow(me: Address | undefined, a: string) {
  if (!me) return false;
  return !!useSafety.getState().byUser[lc(me)]?.blocked[lc(a)]?.on;
}
