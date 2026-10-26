import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type Address } from "viem";
import { contentAbi, inboxAbi, mediaAbi, socialAbi } from "@/abi";
import type { Network, Networks } from "@/lib/chains";
import type { AppConfig } from "@/lib/config";
import { kvGet, kvSet } from "@/lib/db";
import { KIND } from "@/lib/protocol";
import { useConfig, useNetworks } from "./core";

export type DayStats = {
  posts: number;
  comments: number;
  reposts: number;
  votes: number;
  likes: number;
  follows: number;
  dms: number;
  images: number;
  newUsers: number;
  ops: number;
  active: string[];
  spent: Record<string, string>;
};

type Store = { v: 1; cursors: Record<string, string>; days: Record<string, DayStats>; known: string[] };

const messageEvent = getAbiItem({ abi: contentAbi, name: "Message" });
const actedEvent = getAbiItem({ abi: socialAbi, name: "Acted" });
const encryptedEvent = getAbiItem({ abi: inboxAbi, name: "Encrypted" });
const storedEvent = getAbiItem({ abi: mediaAbi, name: "Stored" });
const userOpEvent = {
  type: "event",
  name: "UserOperationEvent",
  inputs: [
    { name: "userOpHash", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "paymaster", type: "address", indexed: true },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "success", type: "bool", indexed: false },
    { name: "actualGasCost", type: "uint256", indexed: false },
    { name: "actualGasUsed", type: "uint256", indexed: false },
  ],
} as const;

const SPAN = 10_000n;
const MAX_HISTORY_SEC = 120 * 86_400;

export const dayKey = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const emptyDay = (): DayStats => ({ posts: 0, comments: 0, reposts: 0, votes: 0, likes: 0, follows: 0, dms: 0, images: 0, newUsers: 0, ops: 0, active: [], spent: {} });

type Log = { blockNumber: bigint };

async function scanChain<T extends Log>(
  store: Store,
  key: string,
  net: Network,
  start: bigint,
  latest: bigint,
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  onLog: (log: T, ts: number) => void,
) {
  let from = store.cursors[key] ? BigInt(store.cursors[key]) : start;
  let span = SPAN;
  while (from <= latest) {
    const to = from + span - 1n > latest ? latest : from + span - 1n;
    let logs: T[];
    try {
      logs = await fetch(from, to);
    } catch (err) {
      if (span <= 64n) throw err;
      span /= 4n;
      continue;
    }
    if (logs.length) {
      const [a, b] = await Promise.all([net.client.getBlock({ blockNumber: from }), net.client.getBlock({ blockNumber: to })]);
      const spb = to > from ? Number(b.timestamp - a.timestamp) / Number(to - from) : 0;
      for (const l of logs) onLog(l, Math.round(Number(a.timestamp) + Number(l.blockNumber - from) * spb));
    }
    store.cursors[key] = String(to + 1n);
    from = to + 1n;
    if (span < SPAN) span *= 2n;
  }
}

async function startBlock(net: Network, config: AppConfig, latest: bigint) {
  const deploy = BigInt(config.params.deployBlocks?.[String(net.cfg.chainId)] ?? 0);
  const head = await net.client.getBlock({ blockNumber: latest });
  const past = await net.client.getBlock({ blockNumber: latest > 5_000n ? latest - 5_000n : 0n });
  const spb = Number(head.timestamp - past.timestamp) / Math.max(1, Number(head.number - past.number)) || 1;
  const window = latest - BigInt(Math.ceil(MAX_HISTORY_SEC / spb));
  return window > deploy ? window : deploy;
}

async function collect(networks: Networks, config: AppConfig): Promise<Store> {
  const cacheKey = `stats:v1:${config.registry}`;
  const store: Store = (await kvGet<Store>(cacheKey)) ?? { v: 1, cursors: {}, days: {}, known: [] };
  const known = new Set(store.known);
  const day = (ts: number) => (store.days[dayKey(ts)] ??= emptyDay());
  const seen = (author: Address, ts: number) => {
    const a = author.toLowerCase();
    const d = day(ts);
    if (!d.active.includes(a)) d.active.push(a);
    if (!known.has(a)) {
      known.add(a);
      d.newUsers++;
    }
  };

  const chains = new Map<number, { net: Network; latest: bigint; start: bigint }>();
  const prepare = async (net: Network) => {
    if (chains.has(net.cfg.chainId)) return chains.get(net.cfg.chainId)!;
    const latest = await net.client.getBlockNumber();
    const entry = { net, latest, start: await startBlock(net, config, latest) };
    chains.set(net.cfg.chainId, entry);
    return entry;
  };

  const tasks: (() => Promise<void>)[] = [];
  const social = networks.social;
  tasks.push(async () => {
    const c = await prepare(social);
    await scanChain(
      store,
      `acted:${social.cfg.chainId}:${config.social}`,
      social,
      c.start,
      c.latest,
      (fromBlock, toBlock) => social.client.getLogs({ address: config.social, event: actedEvent, fromBlock, toBlock, strict: true }),
      (l, ts) => {
        seen(l.args.author, ts);
        if (l.args.value !== 1) return;
        if (l.args.kind === KIND.REACT) day(ts).likes++;
        if (l.args.kind === KIND.FOLLOW) day(ts).follows++;
      },
    );
  });

  for (const net of networks.free) {
    tasks.push(async () => {
      const c = await prepare(net);
      await scanChain(
        store,
        `msg:${net.cfg.chainId}:${net.cfg.content}`,
        net,
        c.start,
        c.latest,
        (fromBlock, toBlock) => net.client.getLogs({ address: net.cfg.content, event: messageEvent, fromBlock, toBlock, strict: true }),
        (l, ts) => {
          seen(l.args.author, ts);
          const k = l.args.kind;
          if (k === KIND.POST) day(ts).posts++;
          else if (k === KIND.COMMENT) day(ts).comments++;
          else if (k === KIND.REPOST) day(ts).reposts++;
          else if (k >= KIND.VOTE && k <= 9) day(ts).votes++;
        },
      );
    });
    tasks.push(async () => {
      const c = await prepare(net);
      await scanChain(
        store,
        `dm:${net.cfg.chainId}:${net.cfg.inbox}`,
        net,
        c.start,
        c.latest,
        (fromBlock, toBlock) => net.client.getLogs({ address: net.cfg.inbox, event: encryptedEvent, fromBlock, toBlock, strict: true }),
        (_l, ts) => void day(ts).dms++,
      );
    });
  }

  for (const [id, address] of Object.entries((config.params.media ?? {}) as Record<string, Address>)) {
    const net = networks.byId.get(Number(id));
    if (!net) continue;
    tasks.push(async () => {
      const c = await prepare(net);
      await scanChain(
        store,
        `media:${id}:${address}`,
        net,
        c.start,
        c.latest,
        (fromBlock, toBlock) => net.client.getLogs({ address, event: storedEvent, fromBlock, toBlock, strict: true }),
        (_l, ts) => void day(ts).images++,
      );
    });
  }

  for (const [id, aa] of Object.entries(config.params.aa ?? {})) {
    const net = networks.byId.get(Number(id));
    if (!net) continue;
    tasks.push(async () => {
      const c = await prepare(net);
      await scanChain(
        store,
        `ops:${id}:${aa.paymaster}`,
        net,
        c.start,
        c.latest,
        (fromBlock, toBlock) => net.client.getLogs({ address: aa.entryPoint, event: userOpEvent, args: { paymaster: aa.paymaster }, fromBlock, toBlock, strict: true }),
        (l, ts) => {
          const d = day(ts);
          d.ops++;
          d.spent[id] = String(BigInt(d.spent[id] ?? "0") + l.args.actualGasCost);
        },
      );
    });
  }

  const results = await Promise.allSettled(tasks.map((t) => t()));
  store.known = [...known];
  await kvSet(cacheKey, store);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length === results.length && failed.length) throw (failed[0] as PromiseRejectedResult).reason;
  return store;
}

export function useStats(enabled: boolean) {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: ["admin-stats", config.registry],
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    meta: { persist: false },
    queryFn: () => collect(networks, config),
  });
}

export function lastDays(store: Store | undefined, n: number) {
  const out: { key: string; ts: number; d: DayStats }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    const ts = Math.floor(date.getTime() / 1000);
    const key = dayKey(ts);
    out.push({ key, ts, d: store?.days[key] ?? emptyDay() });
  }
  return out;
}
