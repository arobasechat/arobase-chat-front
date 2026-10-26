import type { Address, Hex } from "viem";

const lc = (a?: string) => (a ?? "-").toLowerCase();

export const qk = {
  config: ["config"] as const,
  feed: (scope: string, key = "-") => ["feed", scope, key] as const,
  msg: (id: Hex) => ["msg", id] as const,
  stats: (viewer: Address | undefined, id: Hex) => ["stats", lc(viewer), id] as const,
  user: (viewer: Address | undefined, addr: Address) => ["user", lc(viewer), lc(addr)] as const,
  profile: (addr: Address) => ["profile", lc(addr)] as const,
  following: (addr: Address) => ["following", lc(addr)] as const,
  followers: (addr: Address) => ["followers", lc(addr)] as const,
  notes: (postId: Hex) => ["notes", postId] as const,
  staff: ["staff"] as const,
  balances: (addr: Address) => ["balances", lc(addr)] as const,
  stake: (addr: Address) => ["stake", lc(addr)] as const,
  convs: (addr: Address) => ["convs", lc(addr)] as const,
  dms: (convId: Hex) => ["dms", convId] as const,
  newCount: (scope: string, key = "-") => ["new", scope, key] as const,
};
