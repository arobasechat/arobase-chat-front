import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient } from "viem";
import type { AppConfig, ChainCfg } from "./config";

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export type Network = { cfg: ChainCfg; chain: Chain; client: PublicClient };

export type Networks = {
  social: Network;
  content: Network[];
  free: Network[];
  anchored: Network[];
  byId: Map<number, Network>;
  key: string;
};

type Overrides = {
  extraRpcs: Record<number, string[]>;
  disabledChains: number[];
  chainsOverride: ChainCfg[] | null;
};

const clientCache = new Map<string, Network>();

function makeNetwork(cfg: ChainCfg): Network {
  const cacheKey = `${cfg.chainId}|${cfg.rpcs.join(",")}`;
  const hit = clientCache.get(cacheKey);
  if (hit) return { ...hit, cfg };
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.name,
    nativeCurrency: { name: "Gas", symbol: "GAS", decimals: 18 },
    rpcUrls: { default: { http: cfg.rpcs } },
    contracts: { multicall3: { address: MULTICALL3 } },
  });
  const transports = cfg.rpcs.map((u) =>
    http(u, { batch: { batchSize: 100, wait: 8 }, retryCount: 1, retryDelay: 250, timeout: 12_000 }),
  );
  const client = createPublicClient({
    chain,
    transport: fallback(transports, { rank: transports.length > 1 ? { interval: 60_000, sampleCount: 5 } : false }),
    batch: { multicall: { wait: 8, batchSize: 8192 } },
    pollingInterval: 2_000,
    cacheTime: 2_000,
  }) as PublicClient;
  const network = { cfg, chain, client };
  clientCache.set(cacheKey, network);
  return network;
}

export function buildNetworks(config: AppConfig, o: Overrides): Networks {
  const base = o.chainsOverride?.length ? o.chainsOverride : config.chains;
  const effective = base
    .filter((c) => c.active && !o.disabledChains.includes(c.chainId))
    .map((c) => ({ ...c, rpcs: [...new Set([...(o.extraRpcs[c.chainId] ?? []), ...c.rpcs])] }));

  const socialCfg =
    effective.find((c) => c.role === 0) ??
    config.chains.find((c) => c.role === 0) ?? {
      chainId: config.registryChainId,
      name: "Social",
      content: config.social,
      inbox: config.social,
      role: 0 as const,
      active: true,
      rpcs: [],
    };

  const social = makeNetwork(socialCfg);
  let content = effective.filter((c) => c.role !== 0).map(makeNetwork);
  if (!content.length) content = config.chains.filter((c) => c.active && c.role !== 0).map(makeNetwork);
  const byId = new Map<number, Network>([[social.cfg.chainId, social], ...content.map((n) => [n.cfg.chainId, n] as const)]);
  return {
    social,
    content,
    free: content.filter((n) => n.cfg.role === 1),
    anchored: content.filter((n) => n.cfg.role === 2),
    byId,
    key: [social, ...content].map((n) => `${n.cfg.chainId}:${n.cfg.rpcs.join(",")}`).join("|"),
  };
}

export const primaryContent = (n: Networks) => n.free[0] ?? n.content[0];
