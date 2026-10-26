import { getAbiItem, maxUint256, type Address, type Hex } from "viem";
import { contentAbi } from "@/abi";
import type { Network, Networks } from "./chains";
import { db, putMessages } from "./db";
import { addressTarget, ZERO32, type Message, type RawLog } from "./protocol";
import { verifier } from "./workers";

export const SOURCE = { ALL: 0, AUTHOR: 1, CHILDREN: 2, TAG: 3 } as const;

export type Stream = { chainId: number; source: number; key: Hex };
export type Cursor = Record<string, string>;

export type FeedItem = {
  id: Hex;
  author: Address;
  kind: number;
  parentId: Hex;
  ts: number;
  locations: Record<number, number>;
};

export type Page = { items: FeedItem[]; cursors: Cursor; hasMore: boolean; totals: Record<string, number> };

const messageEvent = getAbiItem({ abi: contentAbi, name: "Message" });

export const streamKey = (s: Stream) => `${s.chainId}:${s.source}:${s.key}`;

export const allStreams = (n: Networks): Stream[] =>
  n.content.map((c) => ({ chainId: c.cfg.chainId, source: SOURCE.ALL, key: ZERO32 }));

export const authorStreams = (n: Networks, authors: Address[]): Stream[] =>
  n.content.flatMap((c) =>
    authors.map((a) => ({ chainId: c.cfg.chainId, source: SOURCE.AUTHOR, key: addressTarget(a) })),
  );

export const childStreams = (n: Networks, parentId: Hex): Stream[] =>
  n.content.map((c) => ({ chainId: c.cfg.chainId, source: SOURCE.CHILDREN, key: parentId }));

export const tagStreams = (n: Networks, hash: Hex): Stream[] =>
  n.free.map((c) => ({ chainId: c.cfg.chainId, source: SOURCE.TAG, key: hash }));

export async function fetchPage(
  networks: Networks,
  streams: Stream[],
  cursors: Cursor,
  limit: number,
  filter?: (m: FeedItem) => boolean,
): Promise<Page> {
  const active = streams.filter((s) => cursors[streamKey(s)] !== "0" && networks.byId.has(s.chainId));
  const perStream = Math.max(3, Math.min(limit, Math.ceil((limit * 2) / Math.max(active.length, 1))));

  const results = await Promise.all(
    active.map(async (s) => {
      const net = networks.byId.get(s.chainId)!;
      const end = cursors[streamKey(s)] ? BigInt(cursors[streamKey(s)]) : maxUint256;
      try {
        const [ids, metas, total] = await net.client.readContract({
          address: net.cfg.content,
          abi: contentAbi,
          functionName: "page",
          args: [s.source, s.key, end, BigInt(perStream)],
        });
        const effectiveEnd = end > total ? total : end;
        return {
          s,
          end: effectiveEnd,
          total: Number(total),
          items: ids.map<FeedItem>((id, i) => ({
            id,
            author: metas[i].author,
            kind: metas[i].kind,
            parentId: metas[i].parentId,
            ts: Number(metas[i].ts),
            locations: { [s.chainId]: Number(metas[i].blockNumber) },
          })),
        };
      } catch {
        return { s, end, total: 0, items: [] as FeedItem[], failed: true };
      }
    }),
  );

  let boundary = 0;
  for (const r of results) {
    const hasMore = r.end - BigInt(r.items.length) > 0n;
    if (hasMore && r.items.length) boundary = Math.max(boundary, r.items[r.items.length - 1].ts);
  }

  const merged = new Map<Hex, FeedItem>();
  for (const r of results) {
    for (const it of r.items) {
      if (it.ts < boundary) continue;
      const prev = merged.get(it.id);
      if (prev) prev.locations = { ...prev.locations, ...it.locations };
      else merged.set(it.id, { ...it });
    }
  }
  const sorted = [...merged.values()].sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : 1)).slice(0, limit);
  const included = new Set(sorted.map((i) => i.id));
  const cutoffTs = sorted.length === limit ? sorted[sorted.length - 1].ts : boundary;

  const next: Cursor = { ...cursors };
  const totals: Record<string, number> = {};
  for (const r of results) {
    totals[streamKey(r.s)] = r.total;
    if ("failed" in r) continue;
    let consumed = 0;
    for (const it of r.items) {
      if (included.has(it.id) || it.ts > cutoffTs) consumed++;
      else break;
    }
    next[streamKey(r.s)] = String(r.end - BigInt(consumed));
  }
  const hasMore = active.some((s) => next[streamKey(s)] !== "0");
  return { items: filter ? sorted.filter(filter) : sorted, cursors: next, hasMore, totals };
}

async function logsAtBlock(net: Network, block: number, ids: Hex[]): Promise<RawLog[]> {
  const logs = await net.client.getLogs({
    address: net.cfg.content,
    event: messageEvent,
    args: { id: ids },
    fromBlock: BigInt(block),
    toBlock: BigInt(block),
    strict: true,
  });
  return logs.map((l) => ({
    id: l.args.id,
    author: l.args.author,
    kind: l.args.kind,
    payload: l.args.payload,
    sig: l.args.sig,
    parentId: ZERO32,
    ts: 0,
  }));
}

export async function hydrate(networks: Networks, items: FeedItem[]): Promise<Map<Hex, Message>> {
  const out = new Map<Hex, Message>();
  if (!items.length) return out;
  const cached = await db.messages.bulkGet(items.map((i) => i.id));
  const missing: FeedItem[] = [];
  const toUpdate: Message[] = [];
  items.forEach((it, i) => {
    const c = cached[i];
    if (c) {
      const merged = { ...c.locations, ...it.locations };
      const changed = Object.keys(merged).length !== Object.keys(c.locations).length;
      const m = changed ? { ...c, locations: merged, status: "confirmed" as const } : c;
      if (changed) toUpdate.push(m);
      out.set(it.id, m);
    } else missing.push(it);
  });
  if (toUpdate.length) void putMessages(toUpdate);
  if (!missing.length) return out;

  const groups = new Map<string, { net: Network; block: number; ids: Hex[] }>();
  for (const it of missing) {
    const [chainId, block] = Object.entries(it.locations)
      .map(([c, b]) => [Number(c), b] as const)
      .sort((a, b) => (networks.byId.get(a[0])?.cfg.role ?? 9) - (networks.byId.get(b[0])?.cfg.role ?? 9))[0];
    const net = networks.byId.get(chainId);
    if (!net) continue;
    const k = `${chainId}:${block}`;
    const g = groups.get(k) ?? { net, block, ids: [] };
    g.ids.push(it.id);
    groups.set(k, g);
  }

  const raw = (await Promise.all([...groups.values()].map((g) => logsAtBlock(g.net, g.block, g.ids).catch(() => []))))
    .flat();
  const byId = new Map(missing.map((m) => [m.id, m]));
  const logs = raw
    .filter((l) => byId.has(l.id))
    .map((l) => ({ ...l, parentId: byId.get(l.id)!.parentId, ts: byId.get(l.id)!.ts }));
  const verdicts = await verifier.verifyMany(logs);

  const fresh: Message[] = logs.map((l, i) => {
    const v = verdicts[i];
    const meta = byId.get(l.id)!;
    return {
      id: l.id,
      author: l.author,
      kind: l.kind,
      parentId: l.parentId,
      ts: l.ts,
      body: v.ok ? v.body : { v: 1, ts: l.ts },
      payload: l.payload,
      sig: l.sig,
      signer: v.ok ? v.signer : l.author,
      sessionExpiry: v.ok ? v.sessionExpiry : undefined,
      locations: meta.locations,
      status: "confirmed",
      invalid: v.ok ? undefined : v.reason,
    };
  });
  await putMessages(fresh);
  for (const m of fresh) out.set(m.id, m);
  return out;
}

export async function locate(networks: Networks, ids: Hex[]): Promise<FeedItem[]> {
  if (!ids.length) return [];
  const results = await Promise.all(
    networks.content.map((net) =>
      net.client
        .readContract({ address: net.cfg.content, abi: contentAbi, functionName: "getMetas", args: [ids] })
        .then((metas) => ({ net, metas }))
        .catch(() => ({ net, metas: [] as const })),
    ),
  );
  const found = new Map<Hex, FeedItem>();
  for (const { net, metas } of results) {
    metas.forEach((m, i) => {
      if (m.author === "0x0000000000000000000000000000000000000000") return;
      const prev = found.get(ids[i]);
      const loc = { [net.cfg.chainId]: Number(m.blockNumber) };
      if (prev) prev.locations = { ...prev.locations, ...loc };
      else
        found.set(ids[i], {
          id: ids[i],
          author: m.author,
          kind: m.kind,
          parentId: m.parentId,
          ts: Number(m.ts),
          locations: loc,
        });
    });
  }
  return [...found.values()];
}

export async function fetchMessages(networks: Networks, ids: Hex[]): Promise<Map<Hex, Message>> {
  const cached = await db.messages.bulkGet(ids);
  const out = new Map<Hex, Message>();
  const missing: Hex[] = [];
  ids.forEach((id, i) => (cached[i] ? out.set(id, cached[i]!) : missing.push(id)));
  if (missing.length) {
    const located = await locate(networks, missing);
    for (const [id, m] of await hydrate(networks, located)) out.set(id, m);
  }
  return out;
}

export async function latestOfKind(networks: Networks, authors: Address[], kind: number) {
  const results = await Promise.all(
    networks.content.map((net) =>
      net.client
        .readContract({ address: net.cfg.content, abi: contentAbi, functionName: "latestMany", args: [authors, kind] })
        .catch(() => authors.map(() => ZERO32)),
    ),
  );
  const ids = authors.map((_, i) => results.map((r) => r[i]).filter((id) => id !== ZERO32));
  const unique = [...new Set(ids.flat())];
  const msgs = await fetchMessages(networks, unique);
  return authors.map((_, i) =>
    ids[i]
      .map((id) => msgs.get(id))
      .filter((m): m is Message => !!m && !m.invalid)
      .sort((a, b) => b.ts - a.ts)[0],
  );
}

export async function getLogsChunked<T>(
  fetcher: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  initialSpan = 50_000n,
): Promise<T[]> {
  const out: T[] = [];
  let span = initialSpan;
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + span - 1n > to ? to : cursor + span - 1n;
    try {
      out.push(...(await fetcher(cursor, end)));
      cursor = end + 1n;
      if (span < initialSpan) span *= 2n;
    } catch (err) {
      if (span <= 16n) throw err;
      span /= 4n;
    }
  }
  return out;
}
