import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { socialAbi, stakeAbi } from "@/abi";
import { useConfig, useNetworks } from "./core";
import { qk } from "./keys";

export function useBalances(addresses: Address[]) {
  const networks = useNetworks();
  return useQuery({
    queryKey: [...qk.balances(addresses.join(",") as Address), networks.key],
    enabled: addresses.length > 0,
    refetchInterval: 15_000,
    meta: { persist: false },
    queryFn: async () => {
      const nets = [networks.social, ...networks.content];
      const rows = await Promise.all(
        nets.map(async (n) => ({
          chainId: n.cfg.chainId,
          name: n.cfg.name,
          role: n.cfg.role,
          gasPrice: await n.client.getGasPrice().catch(() => null as bigint | null),
          balances: await Promise.all(
            addresses.map((a) => n.client.getBalance({ address: a }).catch(() => null as bigint | null)),
          ),
        })),
      );
      return rows;
    },
  });
}

export function useStake(addr: Address | undefined) {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: qk.stake(addr ?? "0x0"),
    enabled: !!addr && !!config.stake,
    queryFn: async () => {
      const [position, cooldown] = await Promise.all([
        networks.social.client.readContract({
          address: config.stake,
          abi: stakeAbi,
          functionName: "positions",
          args: [addr!],
        }),
        networks.social.client.readContract({ address: config.stake, abi: stakeAbi, functionName: "cooldown" }),
      ]);
      const [amount, pending, since, unlockAt] = position;
      return { amount, pending, since: Number(since), unlockAt: Number(unlockAt), cooldown: Number(cooldown) };
    },
  });
}

export function useStaff() {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: qk.staff,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [list, roles] = await networks.social.client.readContract({
        address: config.social,
        abi: socialAbi,
        functionName: "staff",
      });
      return list.map((address, i) => ({ address, role: roles[i] }));
    },
  });
}
