import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { contentAbi } from "@/abi";
import { requireSigner, useViewer } from "@/identity/store";
import { createBatcher, memoBy } from "@/lib/batcher";
import { primaryContent, type Networks } from "@/lib/chains";
import type { AppConfig } from "@/lib/config";
import { publishMessage } from "@/lib/publish";
import { createMessage, KIND, ZERO32, type Message } from "@/lib/protocol";
import { useConfig, useNetworks } from "./core";
import { prependToFeeds } from "./feed";

export type PostExtras = {
  reposts: number;
  quotes: number;
  retracted: boolean;
  viewerRepost?: Hex;
  viewerChoice: number;
  poll: number[];
};

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const EMPTY: PostExtras = { reposts: 0, quotes: 0, retracted: false, viewerChoice: 0, poll: [0, 0, 0, 0] };

export const extrasBatcher = memoBy(
  (networks: Networks, viewer: Address | undefined) =>
    createBatcher<Hex, PostExtras>(
      async (ids) => {
        const results = await Promise.all(
          networks.free.map((n) =>
            n.client
              .readContract({ address: n.cfg.content, abi: contentAbi, functionName: "extras", args: [ids, viewer ?? ZERO] })
              .catch(() => null),
          ),
        );
        return ids.map((_, i) => {
          const out: PostExtras = { ...EMPTY, poll: [0, 0, 0, 0] };
          for (const r of results) {
            const e = r?.[i];
            if (!e) continue;
            out.reposts = Math.max(out.reposts, e.reposts);
            out.quotes = Math.max(out.quotes, e.quotes);
            out.retracted ||= e.retracted;
            if (e.viewerRepost !== ZERO32) out.viewerRepost = e.viewerRepost;
            if (e.viewerChoice) out.viewerChoice = e.viewerChoice;
            out.poll = out.poll.map((v, j) => Math.max(v, e.poll[j] ?? 0));
          }
          return out;
        });
      },
      { max: 200 },
    ),
  (n, v) => `${n.key}|${v ?? "-"}`,
);

export const extrasKey = (viewer: Address | undefined, id: Hex) => ["extras", (viewer ?? "-").toLowerCase(), id] as const;

export function usePostExtras(id: Hex | undefined, enabled = true) {
  const networks = useNetworks();
  const viewer = useViewer();
  return useQuery({
    queryKey: extrasKey(viewer, id ?? "0x"),
    enabled: enabled && !!id,
    staleTime: 20_000,
    queryFn: () => extrasBatcher(networks, viewer)(id!),
  });
}

async function publishSmall(networks: Networks, config: AppConfig, kind: number, parentId: Hex, extra: Record<string, unknown> = {}) {
  const signer = await requireSigner();
  const m = await createMessage(signer, kind, extra, parentId);
  return publishMessage(config, m, [primaryContent(networks)]);
}

function patchExtras(qc: ReturnType<typeof useQueryClient>, viewer: Address | undefined, id: Hex, fn: (e: PostExtras) => PostExtras) {
  qc.setQueryData<PostExtras>(extrasKey(viewer, id), (prev) => fn(prev ?? { ...EMPTY, poll: [0, 0, 0, 0] }));
}

export function useRepost() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  return useMutation({
    mutationFn: async ({ target, undo }: { target: Message; undo?: Hex }) => {
      if (undo) return publishSmall(networks, config, KIND.RETRACT, undo);
      const m = await publishSmall(networks, config, KIND.REPOST, target.id);
      if (viewer) prependToFeeds(qc, m, viewer);
      return m;
    },
    onMutate: ({ target, undo }) =>
      patchExtras(qc, viewer, target.id, (e) => ({
        ...e,
        reposts: Math.max(0, e.reposts + (undo ? -1 : 1)),
        viewerRepost: undo ? undefined : (e.viewerRepost ?? ZERO32),
      })),
    onSettled: (_d, _e, { target, undo }) => {
      void qc.invalidateQueries({ queryKey: extrasKey(viewer, target.id) });
      if (undo) void qc.invalidateQueries({ queryKey: extrasKey(viewer, undo) });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

export function useRetract() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  return useMutation({
    mutationFn: (target: Message) => publishSmall(networks, config, KIND.RETRACT, target.id),
    onMutate: (target) => patchExtras(qc, viewer, target.id, (e) => ({ ...e, retracted: true })),
    onSettled: (_d, _e, target) => void qc.invalidateQueries({ queryKey: extrasKey(viewer, target.id) }),
  });
}

export function useVote() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  return useMutation({
    mutationFn: ({ poll, choice }: { poll: Message; choice: number }) => publishSmall(networks, config, KIND.VOTE + choice, poll.id),
    onMutate: ({ poll, choice }) =>
      patchExtras(qc, viewer, poll.id, (e) => {
        const counts = [...e.poll];
        if (e.viewerChoice) counts[e.viewerChoice - 1] = Math.max(0, counts[e.viewerChoice - 1] - 1);
        counts[choice]++;
        return { ...e, poll: counts, viewerChoice: choice + 1 };
      }),
    onSettled: (_d, _e, { poll }) => {
      setTimeout(() => void qc.invalidateQueries({ queryKey: extrasKey(viewer, poll.id) }), 4_000);
    },
  });
}
