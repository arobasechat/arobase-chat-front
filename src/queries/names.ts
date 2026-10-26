import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { contentAbi, namesAbi } from "@/abi";
import { createBatcher, memoBy } from "@/lib/batcher";
import type { Networks } from "@/lib/chains";
import { db, kvGet, kvSet } from "@/lib/db";
import { allStreams, fetchPage, hydrate, type Cursor } from "@/lib/reader";
import { extractTags, HANDLE_RE, KIND, signName, tagHash, type Message } from "@/lib/protocol";
import { write } from "@/lib/tx";
import { currentSender, requireIdentity, useViewer } from "@/identity/store";
import { getConfig, useConfig, useNetworks } from "./core";
import { tr } from "@/lib/i18n";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export const handleBatcher = memoBy(
  (networks: Networks, names: Address) =>
    createBatcher<Address, string>(
      async (users) => {
        const out = await networks.social.client.readContract({ address: names, abi: namesAbi, functionName: "namesOf", args: [users] });
        await Promise.all(out.map((h, i) => (h ? db.handles.put({ handle: h, owner: users[i] }) : null)));
        return [...out];
      },
      { max: 300, keyOf: (a) => a.toLowerCase() },
    ),
  (n, a) => `${n.key}|${a}`,
);

export function useHandle(addr: Address | undefined) {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: ["handle", addr?.toLowerCase()],
    enabled: !!addr && !!config.params.names,
    staleTime: 5 * 60_000,
    queryFn: async () => (await handleBatcher(networks, config.params.names!)(addr!)) || null,
  });
}

export async function resolveHandle(networks: Networks, handle: string): Promise<Address | null> {
  const names = getConfig()?.params.names;
  const h = handle.replace(/^@/, "").toLowerCase();
  const cached = await db.handles.get(h);
  if (cached) return cached.owner;
  if (!names || !HANDLE_RE.test(h)) return null;
  const owner = await networks.social.client.readContract({ address: names, abi: namesAbi, functionName: "resolve", args: [h] });
  if (owner === ZERO) return null;
  await db.handles.put({ handle: h, owner });
  return owner;
}

export function useResolveHandle(handle: string | undefined) {
  const networks = useNetworks();
  return useQuery({
    queryKey: ["resolve-handle", handle?.toLowerCase()],
    enabled: !!handle,
    staleTime: 60_000,
    queryFn: () => resolveHandle(networks, handle!),
  });
}

let syncing: Promise<void> | undefined;
export function syncHandles(networks: Networks, names: Address) {
  syncing ??= (async () => {
    const key = `handles:${names}`;
    let offset = BigInt((await kvGet<string>(key)) ?? "0");
    const total = await networks.social.client.readContract({ address: names, abi: namesAbi, functionName: "count" });
    while (offset < total) {
      const [list, owners] = await networks.social.client.readContract({
        address: names,
        abi: namesAbi,
        functionName: "page",
        args: [offset, 500n],
      });
      const rows = list.map((handle, i) => ({ handle, owner: owners[i] })).filter((r) => r.handle && r.owner !== ZERO);
      await db.transaction("rw", db.handles, async () => {
        for (const r of rows) {
          const previous = await db.handles.where("owner").equals(r.owner).toArray();
          await db.handles.bulkDelete(previous.filter((p) => p.handle !== r.handle).map((p) => p.handle));
          await db.handles.put(r);
        }
      });
      offset += BigInt(list.length || 500);
      await kvSet(key, offset.toString());
    }
  })().finally(() => (syncing = undefined));
  return syncing;
}

export function useHandleIndex() {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: ["handle-index", networks.key, config.params.names],
    enabled: !!config.params.names,
    staleTime: 60_000,
    refetchInterval: 120_000,
    meta: { persist: false },
    queryFn: async () => {
      await syncHandles(networks, config.params.names!).catch(() => undefined);
      return db.handles.count();
    },
  });
}

export type PersonHit = { address: Address; handle?: string; name?: string };

export async function searchPeople(q: string, limit = 6): Promise<PersonHit[]> {
  const query = q.trim().replace(/^@/, "").toLowerCase();
  if (!query) return [];
  const byHandle = await db.handles.where("handle").startsWith(query).limit(limit).toArray();
  const profiles = await db.messages
    .where("kind")
    .equals(KIND.PROFILE)
    .filter((m) => !m.invalid && !!m.body.name && m.body.name.toLowerCase().includes(query))
    .limit(50)
    .toArray();
  const latestByAuthor = new Map<string, Message>();
  for (const p of profiles) {
    const k = p.author.toLowerCase();
    if (!latestByAuthor.has(k) || latestByAuthor.get(k)!.ts < p.ts) latestByAuthor.set(k, p);
  }
  const hits = new Map<string, PersonHit>();
  for (const h of byHandle) hits.set(h.owner.toLowerCase(), { address: h.owner, handle: h.handle });
  for (const [k, p] of latestByAuthor) {
    const prev = hits.get(k);
    hits.set(k, { address: p.author, handle: prev?.handle, name: p.body.name });
  }
  const owners = [...hits.keys()];
  const handles = await db.handles.where("owner").anyOfIgnoreCase(owners).toArray();
  for (const h of handles) {
    const hit = hits.get(h.owner.toLowerCase());
    if (hit && !hit.handle) hit.handle = h.handle;
  }
  return [...hits.values()].slice(0, limit);
}

export function usePeopleSearch(q: string) {
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 120);
    return () => clearTimeout(t);
  }, [q]);
  useHandleIndex();
  return useQuery({
    queryKey: ["people-search", debounced.toLowerCase()],
    enabled: debounced.trim().replace(/^@/, "").length > 0,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    meta: { persist: false },
    queryFn: () => searchPeople(debounced),
  });
}

export function useHandleAvailability(handle: string) {
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  const [debounced, setDebounced] = useState(handle);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(handle), 300);
    return () => clearTimeout(t);
  }, [handle]);
  const valid = HANDLE_RE.test(debounced);
  const q = useQuery({
    queryKey: ["handle-available", debounced],
    enabled: valid && !!config.params.names,
    staleTime: 10_000,
    meta: { persist: false },
    queryFn: () =>
      networks.social.client.readContract({ address: config.params.names!, abi: namesAbi, functionName: "resolve", args: [debounced] }),
  });
  if (!handle) return { state: "empty" as const };
  if (!HANDLE_RE.test(handle)) return { state: "invalid" as const };
  if (debounced !== handle || q.isFetching || q.data === undefined) return { state: "checking" as const };
  if (q.data === ZERO) return { state: "available" as const };
  if (viewer && q.data.toLowerCase() === viewer.toLowerCase()) return { state: "yours" as const };
  return { state: "taken" as const };
}

export function useClaimHandle() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  return useMutation({
    mutationFn: async (handle: string) => {
      const names = config.params.names;
      if (!names) throw new Error(tr("Les noms d'utilisateur ne sont pas encore activés sur cette instance."));
      if (!HANDLE_RE.test(handle)) throw new Error(tr("3 à 20 caractères : lettres minuscules, chiffres et _."));
      const signer = await requireIdentity();
      const [nonce, owner] = await Promise.all([
        networks.social.client.readContract({ address: names, abi: namesAbi, functionName: "nonces", args: [signer.author] }),
        networks.social.client.readContract({ address: names, abi: namesAbi, functionName: "resolve", args: [handle] }),
      ]);
      if (owner !== ZERO && owner.toLowerCase() !== signer.author.toLowerCase()) throw new Error(tr("@{handle} est déjà pris.", { handle }));
      const sig = await signName(signer, handle, nonce);
      await write({
        net: networks.social,
        account: currentSender()!,
        params: config.params,
        label: tr("Nom d'utilisateur @{handle}", { handle }),
        address: names,
        abi: namesAbi,
        functionName: "claim",
        args: [signer.author, handle, nonce, sig],
      });
      await db.handles.where("owner").equalsIgnoreCase(signer.author).delete();
      await db.handles.put({ handle, owner: signer.author });
      return { handle, owner: signer.author };
    },
    onSuccess: ({ owner }) => {
      void qc.invalidateQueries({ queryKey: ["handle", owner.toLowerCase()] });
      void qc.invalidateQueries({ queryKey: ["handle-available"] });
    },
  });
}

export type RecentPosts = { posts: Message[]; tags: { tag: string; posts: number; authors: number; total?: number }[] };

export function useRecentPosts(enabled = true) {
  const networks = useNetworks();
  const config = useConfig();
  const windowSec = config.params.globalWindowSec ?? 86_400;
  return useQuery({
    queryKey: ["recent-posts", networks.key],
    enabled,
    staleTime: 2 * 60_000,
    refetchInterval: 3 * 60_000,
    queryFn: async (): Promise<RecentPosts> => {
      const since = Math.floor(Date.now() / 1000) - windowSec;
      const streams = allStreams(networks);
      const posts: Message[] = [];
      let cursors: Cursor = {};
      for (let i = 0; i < 12 && posts.length < 600; i++) {
        const page = await fetchPage(networks, streams, cursors, 50);
        const fresh = page.items.filter((it) => it.ts >= since && (it.kind === KIND.POST || it.kind === KIND.COMMENT));
        const map = await hydrate(networks, fresh);
        for (const it of fresh) {
          const m = map.get(it.id);
          if (m && !m.invalid) posts.push(m);
        }
        cursors = page.cursors;
        if (!page.hasMore || page.items.some((it) => it.ts < since)) break;
      }
      const stats = new Map<string, { posts: number; authors: Set<string> }>();
      for (const p of posts) {
        for (const tag of extractTags(p.body.text)) {
          const s = stats.get(tag) ?? { posts: 0, authors: new Set<string>() };
          s.posts++;
          s.authors.add(p.author.toLowerCase());
          stats.set(tag, s);
        }
      }
      const tags = [...stats.entries()]
        .map(([tag, s]) => ({ tag, posts: s.posts, authors: s.authors.size, total: undefined as number | undefined }))
        .sort((a, b) => b.authors - a.authors || b.posts - a.posts)
        .slice(0, 20);
      if (tags.length && networks.free.length) {
        const hashes = tags.map((t) => tagHash(t.tag));
        const counts = await Promise.all(
          networks.free.map((n) =>
            n.client
              .readContract({ address: n.cfg.content, abi: contentAbi, functionName: "tagCounts", args: [hashes] })
              .catch(() => hashes.map(() => 0n)),
          ),
        );
        tags.forEach((t, i) => (t.total = Math.max(...counts.map((c) => Number(c[i])))));
      }
      return { posts, tags };
    },
  });
}
