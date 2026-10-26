import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAbiItem, type Address, type Hex } from "viem";
import { socialAbi } from "@/abi";
import { useViewer } from "@/identity/store";
import type { Networks } from "@/lib/chains";
import type { AppConfig } from "@/lib/config";
import { db, kvGet, kvSet } from "@/lib/db";
import { KIND, type Message } from "@/lib/protocol";
import { fetchMessages, getLogsChunked } from "@/lib/reader";
import { scheduleSync } from "@/lib/sync-trigger";
import { useConfig, useNetworks } from "./core";

const lc = (a: string) => a.toLowerCase();
const actedEvent = getAbiItem({ abi: socialAbi, name: "Acted" });

export function useBookmarks() {
  const me = useViewer();
  const networks = useNetworks();
  return useQuery({
    queryKey: ["bookmarks", lc(me ?? "0x0")],
    enabled: !!me,
    meta: { persist: false },
    queryFn: async () => {
      const owner = lc(me!);
      const rows = (await db.bookmarks.where("[me+ts]").between([owner, 0], [owner, Number.MAX_SAFE_INTEGER]).reverse().toArray()).filter((r) => !r.removed);
      const msgs = await fetchMessages(networks, rows.map((r) => r.postId));
      return rows.map((r) => msgs.get(r.postId)).filter((m): m is Message => !!m);
    },
  });
}

export function useBookmarkIds() {
  const me = useViewer();
  return useQuery({
    queryKey: ["bookmark-ids", lc(me ?? "0x0")],
    enabled: !!me,
    staleTime: Infinity,
    meta: { persist: false },
    queryFn: async () => {
      const owner = lc(me!);
      const rows = await db.bookmarks.where("[me+ts]").between([owner, 0], [owner, Number.MAX_SAFE_INTEGER]).toArray();
      return new Set(rows.filter((r) => !r.removed).map((r) => r.postId));
    },
  });
}

export function useToggleBookmark() {
  const me = useViewer();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, on }: { postId: Hex; on: boolean }) => {
      const owner = lc(me!);
      const id = `${owner}:${postId}`;
      await db.bookmarks.put({ id, me: owner, postId, ts: Date.now(), removed: !on });
      scheduleSync();
    },
    onMutate: ({ postId, on }) => {
      qc.setQueryData<Set<Hex>>(["bookmark-ids", lc(me!)], (prev) => {
        const next = new Set(prev);
        if (on) next.add(postId);
        else next.delete(postId);
        return next;
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["bookmark-ids", lc(me!)] });
      void qc.invalidateQueries({ queryKey: ["bookmarks", lc(me!)] });
    },
  });
}

type LikeState = { cursor: string; likes: Record<string, number> };

let likesSync: Promise<LikeState> | undefined;

async function syncLikes(networks: Networks, config: AppConfig, me: Address): Promise<LikeState> {
  const key = `likes:${lc(me)}:${config.social}`;
  const saved = (await kvGet<LikeState>(key)) ?? {
    cursor: String(config.params.deployBlocks?.[String(networks.social.cfg.chainId)] ?? 0),
    likes: {},
  };
  const latest = await networks.social.client.getBlockNumber();
  const from = BigInt(saved.cursor);
  if (from > latest) return saved;
  const logs = await getLogsChunked(
    (fromBlock, toBlock) =>
      networks.social.client.getLogs({
        address: config.social,
        event: actedEvent,
        args: { author: me, kind: KIND.REACT },
        fromBlock,
        toBlock,
        strict: true,
      }),
    from,
    latest,
    10_000n,
  );
  const likes = { ...saved.likes };
  for (const l of logs) {
    if (l.args.value === 1) likes[l.args.target] = Number(l.blockNumber);
    else delete likes[l.args.target];
  }
  const next = { cursor: String(latest + 1n), likes };
  await kvSet(key, next);
  return next;
}

export function useLikedPosts() {
  const me = useViewer();
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: ["liked", lc(me ?? "0x0"), networks.key],
    enabled: !!me,
    staleTime: 30_000,
    meta: { persist: false },
    queryFn: async () => {
      likesSync ??= syncLikes(networks, config, me!).finally(() => (likesSync = undefined));
      const state = await likesSync;
      const ids = Object.entries(state.likes)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id as Hex)
        .slice(0, 300);
      const msgs = await fetchMessages(networks, ids);
      return ids.map((id) => msgs.get(id)).filter((m): m is Message => !!m);
    },
  });
}
