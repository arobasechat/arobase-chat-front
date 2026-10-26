import { useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { socialAbi } from "@/abi";
import type { Networks } from "@/lib/chains";
import type { AppConfig } from "@/lib/config";
import { db } from "@/lib/db";
import {
  allStreams,
  authorStreams,
  tagStreams,
  childStreams,
  fetchMessages,
  fetchPage,
  hydrate,
  streamKey,
  type Cursor,
  type FeedItem,
  type Page,
  type Stream,
} from "@/lib/reader";
import { CONTENT_KINDS, KIND, tagHash, type Message } from "@/lib/protocol";
import { useViewer } from "@/identity/store";
import { platformOf } from "@/lib/config";
import { postStatsBatcher, profileBatcher, useConfig, useModerators, useNetworks, userStatsBatcher } from "./core";
import { qk } from "./keys";
import { tr } from "@/lib/i18n";

export type FeedScope = "global" | "following" | "author" | "thread" | "tag";
export type FeedPage = Page & { messages: Message[] };

const PAGE_SIZE = 20;

async function prime(
  qc: QueryClient,
  networks: Networks,
  config: AppConfig,
  viewer: Address | undefined,
  moderators: Address[],
  items: FeedItem[],
) {
  const stats = postStatsBatcher(networks, config.social, viewer, moderators);
  const [messages] = await Promise.all([
    hydrate(networks, items),
    Promise.all(
      items.map((it) =>
        qc.getQueryData(qk.stats(viewer, it.id))
          ? null
          : stats({ id: it.id, author: it.author }).then((s) => qc.setQueryData(qk.stats(viewer, it.id), s)).catch(() => null),
      ),
    ),
  ]);
  for (const m of messages.values()) qc.setQueryData(qk.msg(m.id), m);
  const originals = [...new Set([...messages.values()].filter((m) => m.kind === KIND.REPOST).map((m) => m.parentId))].filter(
    (id) => !qc.getQueryData(qk.msg(id)),
  );
  if (originals.length) {
    const found = await fetchMessages(networks, originals).catch(() => new Map<Hex, Message>());
    for (const [id, m] of found) qc.setQueryData(qk.msg(id), m);
  }
  const authors = [...new Set(items.map((i) => i.author.toLowerCase()))] as Address[];
  for (const a of authors) {
    if (!qc.getQueryData(qk.profile(a))) {
      void qc.prefetchQuery({
        queryKey: qk.profile(a),
        queryFn: async () => {
          const m = await profileBatcher(networks)(a);
          return m ? { name: m.body.name, bio: m.body.bio, avatar: m.body.avatar, ts: m.ts, id: m.id } : {};
        },
        staleTime: 5 * 60_000,
      });
    }
  }
  return items.map((i) => messages.get(i.id)).filter((m): m is Message => !!m);
}

export function useFollowing(addr: Address | undefined) {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: qk.following(addr ?? "0x0"),
    enabled: !!addr,
    staleTime: 60_000,
    queryFn: async () => {
      const out: Address[] = [];
      for (let offset = 0n; ; offset += 500n) {
        const page = await networks.social.client.readContract({
          address: config.social,
          abi: socialAbi,
          functionName: "following",
          args: [addr!, offset, 500n],
        });
        out.push(...page);
        if (page.length < 500 || out.length >= 5000) break;
      }
      return out;
    },
  });
}

export function useFollowers(addr: Address | undefined) {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: qk.followers(addr ?? "0x0"),
    enabled: !!addr,
    staleTime: 60_000,
    queryFn: () =>
      networks.social.client.readContract({
        address: config.social,
        abi: socialAbi,
        functionName: "followers",
        args: [addr!, 0n, 500n],
      }),
  });
}

function useStreams(scope: FeedScope, key: string | undefined): { streams: Stream[] | null; cacheKey: string } {
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  const following = useFollowing(scope === "following" ? viewer : undefined);
  return useMemo(() => {
    if (scope === "global") return { streams: allStreams(networks), cacheKey: "-" };
    if (scope === "author" && key) return { streams: authorStreams(networks, [key as Address]), cacheKey: key.toLowerCase() };
    if (scope === "thread" && key) return { streams: childStreams(networks, key as Hex), cacheKey: key };
    if (scope === "tag" && key) return { streams: tagStreams(networks, tagHash(key)), cacheKey: key };
    if (scope === "following" && viewer) {
      if (!following.data) return { streams: null, cacheKey: viewer.toLowerCase() };
      const platform = platformOf(config.params);
      const authors = [...new Map([viewer, ...(platform ? [platform] : []), ...following.data].map((a) => [a.toLowerCase(), a])).values()];
      return { streams: authorStreams(networks, authors), cacheKey: viewer.toLowerCase() };
    }
    return { streams: null, cacheKey: "-" };
  }, [scope, key, networks, viewer, following.data, config.params.platform]);
}

export function useFeed(scope: FeedScope, key?: string) {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  const moderators = useModerators();
  const { streams, cacheKey } = useStreams(scope, key);
  const windowSec = config.params.globalWindowSec ?? 86_400;
  const minWeight = config.params.globalMinWeight ?? 0;

  const query = useInfiniteQuery({
    queryKey: qk.feed(scope, cacheKey),
    enabled: !!streams,
    initialPageParam: {} as Cursor,
    staleTime: 30_000,
    getNextPageParam: (last: FeedPage) => (last.hasMore ? last.cursors : undefined),
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const now = Math.floor(Date.now() / 1000);
      const kindFilter =
        scope === "thread"
          ? (i: FeedItem) => i.kind === KIND.COMMENT
          : scope === "tag"
            ? (i: FeedItem) => i.kind === KIND.POST || i.kind === KIND.COMMENT
            : (i: FeedItem) => i.kind === KIND.POST || i.kind === KIND.REPOST;
      let page = await fetchPage(networks, streams!, pageParam, PAGE_SIZE, kindFilter);
      if (scope === "global") {
        const fresh = page.items.filter((i) => i.ts >= now - windowSec);
        if (fresh.length < page.items.length) page = { ...page, hasMore: false };
        let items = fresh;
        if (minWeight > 0 && items.length) {
          const users = userStatsBatcher(networks, config.social, viewer);
          const weights = await Promise.all(items.map((i) => users(i.author).then((u) => u.weight).catch(() => 0)));
          items = items.filter((_, i) => weights[i] >= minWeight);
        }
        page = { ...page, items };
      }
      const messages = await prime(qc, networks, config, viewer, moderators, page.items);
      return { ...page, messages };
    },
  });

  const items = useMemo(() => {
    const seen = new Set<Hex>();
    const out: Message[] = [];
    for (const p of query.data?.pages ?? []) {
      for (const m of p.messages) {
        if (seen.has(m.id) || !CONTENT_KINDS.has(m.kind)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  }, [query.data]);

  return { ...query, items, streams };
}

export function useNewPostsCount(scope: FeedScope, key: string | undefined, enabled: boolean) {
  const networks = useNetworks();
  const qc = useQueryClient();
  const { streams, cacheKey } = useStreams(scope, key);
  return useQuery({
    queryKey: qk.newCount(scope, cacheKey),
    enabled: enabled && !!streams,
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
    meta: { persist: false },
    queryFn: async () => {
      const data = qc.getQueryData<InfiniteData<FeedPage, Cursor>>(qk.feed(scope, cacheKey));
      const first = data?.pages[0];
      if (!first) return 0;
      const page = await fetchPage(networks, streams!, {}, 1);
      let diff = 0;
      for (const s of streams!) {
        const k = streamKey(s);
        diff += Math.max(0, (page.totals[k] ?? 0) - (first.totals[k] ?? 0));
      }
      return diff;
    },
  });
}

export function useMessage(id: Hex | undefined) {
  const networks = useNetworks();
  return useQuery({
    queryKey: qk.msg(id ?? "0x"),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const local = await db.messages.get(id!);
      if (local && local.status === "confirmed") return local;
      const map = await fetchMessages(networks, [id!]);
      const m = map.get(id!) ?? local;
      if (!m) throw new Error(tr("Message introuvable sur les chains configurées."));
      return m;
    },
  });
}

export function prependToFeeds(qc: QueryClient, m: Message, viewer: Address) {
  const add = (data: InfiniteData<FeedPage, Cursor> | undefined) => {
    if (!data?.pages.length) return data;
    if (data.pages[0].messages.some((x) => x.id === m.id)) {
      return {
        ...data,
        pages: data.pages.map((p) => ({ ...p, messages: p.messages.map((x) => (x.id === m.id ? m : x)) })),
      };
    }
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...first, messages: [m, ...first.messages] }, ...rest] };
  };
  const targets =
    m.kind === KIND.COMMENT
      ? [qk.feed("thread", m.parentId)]
      : m.kind === KIND.POST || m.kind === KIND.REPOST
        ? [qk.feed("following", viewer.toLowerCase()), qk.feed("author", viewer.toLowerCase()), qk.feed("global")]
        : [];
  for (const t of targets) qc.setQueryData<InfiniteData<FeedPage, Cursor>>(t, add);
  qc.setQueryData(qk.msg(m.id), m);
}
