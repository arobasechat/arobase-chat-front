import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAbiItem, type Address, type Hex } from "viem";
import { contentAbi, socialAbi } from "@/abi";
import { useViewer } from "@/identity/store";
import type { Network, Networks } from "@/lib/chains";
import { platformOf, type AppConfig } from "@/lib/config";
import { db, kvGet, kvSet, type NotificationType, type StoredNotification } from "@/lib/db";
import { addressTarget, KIND } from "@/lib/protocol";
import { authorStreams, fetchPage, getLogsChunked } from "@/lib/reader";
import { useConfig, useNetworks } from "./core";
import { qk } from "./keys";
import { useSettings } from "@/lib/settings";
import { useHiddenAuthors } from "@/lib/safety";
import { setSyncRunner } from "@/lib/sync-trigger";

const notifyEvent = getAbiItem({ abi: contentAbi, name: "Notify" });
const actedEvent = getAbiItem({ abi: socialAbi, name: "Acted" });
const REASON: Record<number, NotificationType> = { 1: "mention", 2: "reply", 3: "note", 4: "repost", 5: "quote" };
const FIRST_WINDOW_SEC = 3 * 86_400;
const lc = (a: string) => a.toLowerCase();

type Clock = { latest: bigint; ts: number; spb: number };

async function clockOf(net: Network): Promise<Clock> {
  const head = await net.client.getBlock();
  const back = head.number > 2_000n ? head.number - 2_000n : 0n;
  const old = back === head.number ? head : await net.client.getBlock({ blockNumber: back });
  const spb = Number(head.timestamp - old.timestamp) / Math.max(1, Number(head.number - back));
  return { latest: head.number, ts: Number(head.timestamp), spb: spb > 0 ? spb : 1 };
}

const tsAt = (c: Clock, block: bigint) => Math.round(c.ts - Number(c.latest - block) * c.spb);

async function scan<T>(
  net: Network,
  config: AppConfig,
  cursorKey: string,
  fetcher: (from: bigint, to: bigint) => Promise<T[]>,
): Promise<{ logs: T[]; clock: Clock } | undefined> {
  const clock = await clockOf(net);
  const saved = await kvGet<string>(cursorKey);
  const deploy = BigInt(config.params.deployBlocks?.[String(net.cfg.chainId)] ?? 0);
  const windowStart = clock.latest - BigInt(Math.ceil(FIRST_WINDOW_SEC / clock.spb));
  const from = saved ? BigInt(saved) : windowStart > deploy ? windowStart : deploy;
  if (from > clock.latest) return { logs: [], clock };
  const logs = await getLogsChunked(fetcher, from, clock.latest, 10_000n);
  await kvSet(cursorKey, String(clock.latest + 1n));
  return { logs, clock };
}

async function myRecentPosts(networks: Networks, me: Address) {
  const page = await fetchPage(networks, authorStreams(networks, [me]), {}, 50);
  return page.items.filter((i) => i.kind === KIND.POST || i.kind === KIND.COMMENT).map((i) => i.id);
}

async function syncNotifications(networks: Networks, config: AppConfig, me: Address) {
  const owner = lc(me);
  const out: StoredNotification[] = [];
  const tasks: Promise<unknown>[] = [];

  for (const net of networks.free) {
    const id = net.cfg.chainId;
    const address = net.cfg.content;
    tasks.push(
      scan(net, config, `notif:${owner}:notify:${id}:${address}`, (fromBlock, toBlock) =>
        net.client.getLogs({ address, event: notifyEvent, args: { to: me }, fromBlock, toBlock, strict: true }),
      ).then((r) => {
        for (const l of r?.logs ?? []) {
          const type = REASON[l.args.reason];
          if (!type) continue;
          out.push({ id: `${type}:${l.args.postId}`, me: owner, type, from: l.args.from, postId: l.args.postId, ts: tsAt(r!.clock, l.blockNumber) });
        }
      }),
    );
  }

  const social = networks.social;
  tasks.push(
    scan(social, config, `notif:${owner}:follow`, (fromBlock, toBlock) =>
      social.client.getLogs({
        address: config.social,
        event: actedEvent,
        args: { kind: KIND.FOLLOW, target: addressTarget(me) },
        fromBlock,
        toBlock,
        strict: true,
      }),
    ).then((r) => {
      for (const l of r?.logs ?? []) {
        if (l.args.value !== 1 || lc(l.args.author) === owner) continue;
        out.push({ id: `follow:${lc(l.args.author)}`, me: owner, type: "follow", from: l.args.author, ts: tsAt(r!.clock, l.blockNumber) });
      }
    }),
  );

  tasks.push(
    myRecentPosts(networks, me).then(async (ids) => {
      if (!ids.length) return;
      const r = await scan(social, config, `notif:${owner}:like`, (fromBlock, toBlock) =>
        social.client.getLogs({
          address: config.social,
          event: actedEvent,
          args: { kind: KIND.REACT, target: ids },
          fromBlock,
          toBlock,
          strict: true,
        }),
      );
      for (const l of r?.logs ?? []) {
        if (l.args.value !== 1 || lc(l.args.author) === owner) continue;
        out.push({
          id: `like:${l.args.target}:${lc(l.args.author)}`,
          me: owner,
          type: "like",
          from: l.args.author,
          postId: l.args.target,
          ts: tsAt(r!.clock, l.blockNumber),
        });
      }
    }),
  );

  const platform = platformOf(config.params);
  if (platform && lc(platform) !== owner)
    tasks.push(
      fetchPage(networks, authorStreams(networks, [platform]), {}, 20).then((page) => {
        const since = Math.floor(Date.now() / 1000) - FIRST_WINDOW_SEC;
        for (const i of page.items)
          if (i.kind === KIND.POST && i.ts >= since) out.push({ id: `announcement:${i.id}`, me: owner, type: "announcement", from: platform, postId: i.id, ts: i.ts });
      }),
    );

  await Promise.allSettled(tasks);
  if (!out.length) return 0;
  const existing = new Set((await db.notifs.bulkGet(out.map((n) => n.id))).filter(Boolean).map((n) => n!.id));
  const fresh = out.filter((n) => !existing.has(n.id));
  await db.notifs.bulkPut(fresh);
  return fresh.length;
}

let running: Promise<number> | undefined;

const seenKey = (me: Address) => `notif:${lc(me)}:seen`;

export function useNotificationsSync() {
  const networks = useNetworks();
  const config = useConfig();
  const me = useViewer();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["notif-sync", me, networks.key],
    enabled: !!me,
    refetchInterval: 30_000,
    meta: { persist: false },
    queryFn: async () => {
      if (!(await kvGet<number>(seenKey(me!)))) await kvSet(seenKey(me!), Math.floor(Date.now() / 1000) - 86_400);
      running ??= syncNotifications(networks, config, me!).finally(() => (running = undefined));
      const added = await running;
      if (added) await qc.invalidateQueries({ queryKey: ["notifs", lc(me!)] });
      return Date.now();
    },
  });
}

export function useUnreadConversations() {
  const networks = useNetworks();
  const config = useConfig();
  const me = useViewer();
  const qc = useQueryClient();
  useQuery({
    queryKey: ["inbox-bg-sync", me, networks.key],
    enabled: !!me,
    refetchInterval: 30_000,
    meta: { persist: false },
    queryFn: async () => {
      const { backgroundInboxSync } = await import("./dm");
      await backgroundInboxSync(networks, config, me!);
      await qc.invalidateQueries({ queryKey: qk.convs(me!) });
      if (localStorage.getItem("arobase:push")?.includes('"relayId"')) {
        const push = await import("@/lib/push");
        await push
          .fetchRelays(networks, config)
          .then((relays) => push.refreshPushIfNeeded(networks, config, me!, relays))
          .catch((e) => console.warn("Renouvellement push", e));
      }
      return Date.now();
    },
  });
  return (
    useQuery({
      queryKey: qk.convs(me ?? "0x0"),
      enabled: !!me,
      meta: { persist: false },
      queryFn: () => db.convs.orderBy("lastTs").reverse().toArray(),
      select: (list) => list.filter((c) => c.lastTs > c.readTs).length,
    }).data ?? 0
  );
}

export function useEncryptedSync() {
  const networks = useNetworks();
  const config = useConfig();
  const me = useViewer();
  const qc = useQueryClient();
  const enabled = useSettings((s) => s.syncEnabled);
  useEffect(() => {
    if (!me || !enabled) return setSyncRunner(undefined);
    setSyncRunner(async () => {
      const sync = await import("@/lib/sync");
      await sync.pushSync(networks, config, me);
    });
    return () => setSyncRunner(undefined);
  }, [me, enabled, networks, config]);
  return useQuery({
    queryKey: ["enc-sync", me, networks.key],
    enabled: !!me && enabled,
    refetchInterval: 120_000,
    meta: { persist: false },
    queryFn: async () => {
      const sync = await import("@/lib/sync");
      if (await sync.pullSync(networks, config, me!)) {
        void qc.invalidateQueries({ queryKey: ["bookmark-ids"] });
        void qc.invalidateQueries({ queryKey: ["bookmarks"] });
      }
      return Date.now();
    },
  });
}

export type NotificationList = { items: StoredNotification[]; seen: number };

export function useNotifications<T = NotificationList>(select?: (d: NotificationList) => T) {
  const me = useViewer();
  return useQuery({
    queryKey: ["notifs", lc(me ?? "0x0")],
    enabled: !!me,
    meta: { persist: false },
    queryFn: async (): Promise<NotificationList> => {
      const owner = lc(me!);
      const [items, seen] = await Promise.all([
        db.notifs.where("[me+ts]").between([owner, 0], [owner, Number.MAX_SAFE_INTEGER]).reverse().limit(300).toArray(),
        kvGet<number>(seenKey(me!)),
      ]);
      return { items, seen: seen ?? 0 };
    },
    select,
  });
}

export function useUnreadNotifications() {
  useNotificationsSync();
  const me = useViewer();
  const { isHidden } = useHiddenAuthors(me);
  return useNotifications((d) => d.items.filter((n) => n.ts > d.seen && !isHidden(n.from)).length).data ?? 0;
}

export function useMarkNotificationsSeen(latest: number | undefined) {
  const me = useViewer();
  const qc = useQueryClient();
  useEffect(() => {
    if (!me || latest === undefined) return;
    const t = setTimeout(async () => {
      const prev = (await kvGet<number>(seenKey(me))) ?? 0;
      if (latest <= prev) return;
      await kvSet(seenKey(me), latest);
      await qc.invalidateQueries({ queryKey: ["notifs", lc(me)] });
    }, 1500);
    return () => clearTimeout(t);
  }, [me, latest, qc]);
}

export type NotificationGroup = {
  key: string;
  type: NotificationType;
  postId?: Hex;
  from: Address[];
  ts: number;
  unread: boolean;
};

export function groupNotifications({ items, seen }: NotificationList, hidden?: (a: string) => boolean): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  const out: NotificationGroup[] = [];
  for (const n of items) {
    if (hidden?.(n.from)) continue;
    const unread = n.ts > seen;
    const bucket = n.type === "like" ? `like:${n.postId}:${unread}` : n.type === "follow" ? `follow:${unread}` : n.id;
    const g = groups.get(bucket);
    if (g) {
      if (!g.from.some((f) => lc(f) === lc(n.from))) g.from.push(n.from);
      continue;
    }
    const created: NotificationGroup = { key: bucket, type: n.type, postId: n.postId, from: [n.from], ts: n.ts, unread };
    groups.set(bucket, created);
    out.push(created);
  }
  return out;
}
