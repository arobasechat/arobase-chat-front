import { useMemo } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import type { Address, Hex } from "viem";
import { socialAbi } from "@/abi";
import { buildNetworks, type Networks } from "@/lib/chains";
import { fetchConfig, platformOf, type AppConfig } from "@/lib/config";
import { createBatcher, memoBy } from "@/lib/batcher";
import { latestOfKind } from "@/lib/reader";
import { KIND, type Message } from "@/lib/protocol";
import { useSettings } from "@/lib/settings";
import { useViewer } from "@/identity/store";
import { qk } from "./keys";

let bootConfig: AppConfig | undefined;
export const setBootConfig = (c: AppConfig | undefined) => (bootConfig = c);

let networksRef: Networks | undefined;
let configRef: AppConfig | undefined;
export const getNetworks = () => networksRef;
export const getConfig = () => configRef;

export function useConfig(): AppConfig {
  const { data } = useSuspenseQuery({
    queryKey: qk.config,
    queryFn: () => fetchConfig(bootConfig),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    meta: { persist: false },
  });
  configRef = data;
  return data;
}

export function usePlatform() {
  return platformOf(useConfig().params);
}

export function useNetworks(): Networks {
  const config = useConfig();
  const overrides = useSettings(
    useShallow((s) => ({ extraRpcs: s.extraRpcs, disabledChains: s.disabledChains, chainsOverride: s.chainsOverride })),
  );
  const networks = useMemo(() => buildNetworks(config, overrides), [config, overrides]);
  networksRef = networks;
  return networks;
}

export type PostStats = {
  likes: number;
  dislikes: number;
  hideScore: number;
  flags: number;
  viewerReaction: number;
  viewerVote: number;
  customFlags: number;
};

export type UserStats = {
  followers: number;
  following: number;
  role: number;
  viewerFollows: boolean;
  followsViewer: boolean;
  encKey: Hex;
  nonce: number;
  firstSeen: number;
  weight: number;
};

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export const postStatsBatcher = memoBy(
  (networks: Networks, social: Address, viewer: Address | undefined, moderators: Address[]) =>
    createBatcher<{ id: Hex; author: Address }, PostStats>(
      async (keys) => {
        const ids = keys.map((k) => k.id);
        const [stats, flags] = await Promise.all([
          networks.social.client.readContract({
            address: social,
            abi: socialAbi,
            functionName: "postStats",
            args: [ids, keys.map((k) => k.author), viewer ?? ZERO],
          }),
          moderators.length
            ? networks.social.client.readContract({
                address: social,
                abi: socialAbi,
                functionName: "flagsBy",
                args: [ids, moderators],
              })
            : Promise.resolve(ids.map(() => 0n)),
        ]);
        return stats.map((s, i) => ({
          likes: Number(s.likes),
          dislikes: Number(s.dislikes),
          hideScore: Number(s.hideScore),
          flags: s.flags,
          viewerReaction: s.viewerReaction,
          viewerVote: s.viewerVote,
          customFlags: Number(flags[i] > 0n ? 1 : 0),
        }));
      },
      { max: 300, keyOf: (k) => k.id },
    ),
  (n, s, v, m) => `${n.key}|${s}|${v ?? "-"}|${m.join(",")}`,
);

export const userStatsBatcher = memoBy(
  (networks: Networks, social: Address, viewer: Address | undefined) =>
    createBatcher<Address, UserStats>(
      async (users) => {
        const stats = await networks.social.client.readContract({
          address: social,
          abi: socialAbi,
          functionName: "userStats",
          args: [users, viewer ?? ZERO],
        });
        return stats.map((s) => ({
          followers: Number(s.followers),
          following: Number(s.following),
          role: s.role,
          viewerFollows: s.viewerFollows,
          followsViewer: s.followsViewer,
          encKey: s.encKey,
          nonce: Number(s.nonce),
          firstSeen: Number(s.firstSeen),
          weight: Number(s.weight),
        }));
      },
      { max: 300, keyOf: (a) => a.toLowerCase() },
    ),
  (n, s, v) => `${n.key}|${s}|${v ?? "-"}`,
);

export const profileBatcher = memoBy(
  (networks: Networks) =>
    createBatcher<Address, Message | null>(
      async (authors) => (await latestOfKind(networks, authors, KIND.PROFILE)).map((m) => m ?? null),
      { max: 150, keyOf: (a) => a.toLowerCase() },
    ),
  (n) => n.key,
);

export function useModerators(): Address[] {
  const { mode, custom } = useSettings(useShallow((s) => ({ mode: s.moderationMode, custom: s.customModerators })));
  return mode === "custom" ? custom : [];
}

export function usePostStats(id: Hex, author: Address, enabled = true) {
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  const moderators = useModerators();
  return useQuery({
    queryKey: qk.stats(viewer, id),
    queryFn: () => postStatsBatcher(networks, config.social, viewer, moderators)({ id, author }),
    staleTime: 20_000,
    enabled,
  });
}

export function useUserStats(addr: Address | undefined) {
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  return useQuery({
    queryKey: qk.user(viewer, addr ?? ZERO),
    queryFn: () => userStatsBatcher(networks, config.social, viewer)(addr!),
    enabled: !!addr,
    staleTime: 30_000,
  });
}

export type Profile = { name?: string; bio?: string; avatar?: string; ts?: number; id?: Hex };

export function useProfile(addr: Address | undefined) {
  const networks = useNetworks();
  return useQuery({
    queryKey: qk.profile(addr ?? ZERO),
    queryFn: async (): Promise<Profile> => {
      const m = await profileBatcher(networks)(addr!);
      return m ? { name: m.body.name, bio: m.body.bio, avatar: m.body.avatar, ts: m.ts, id: m.id } : {};
    },
    enabled: !!addr,
    staleTime: 5 * 60_000,
  });
}
