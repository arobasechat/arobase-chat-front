import { createPublicClient, fallback, getAddress, hexToString, http, isAddress, type Address, type Hex } from "viem";
import { registryAbi } from "@/abi";
import { env } from "@/env";
import { kvGet, kvSet } from "./db";

export type ChainRole = 0 | 1 | 2;

export type ChainCfg = {
  chainId: number;
  name: string;
  content: Address;
  inbox: Address;
  role: ChainRole;
  active: boolean;
  rpcs: string[];
};

export type Params = {
  minClientVersion?: number;
  hideThreshold?: number;
  globalWindowSec?: number;
  globalMinWeight?: number;
  noteMinRatings?: number;
  ipfsGateways?: string[];
  faucets?: Record<string, { address: Address; selector: Hex }>;
  deployBlocks?: Record<string, number>;
  socialBatchMs?: number;
  names?: Address;
  tags?: Record<string, Address>;
  aa?: Record<string, { entryPoint: Address; paymaster: Address; bundlers: string[] }>;
  platform?: Address;
  vault?: { chainId: number; address: Address; deployBlock?: number };
  [key: string]: unknown;
};

export type AppConfig = {
  version: number;
  registry: Address;
  registryChainId: number;
  social: Address;
  stake: Address;
  chains: ChainCfg[];
  params: Params;
  fetchedAt: number;
};

export const platformOf = (params: Params): Address | undefined =>
  typeof params.platform === "string" && isAddress(params.platform) ? getAddress(params.platform) : undefined;

const CACHE_KEY = "config";

export const registryClient = () =>
  createPublicClient({
    transport: fallback(env.registryRpcs.map((u) => http(u, { batch: true, retryCount: 1, timeout: 8_000 }))),
  });

const decodeKey = (k: Hex) => hexToString(k, { size: 32 }).replace(/\0+$/, "");

function decodeParam(v: Hex): unknown {
  try {
    return JSON.parse(hexToString(v));
  } catch {
    return v;
  }
}

export async function readCachedConfig() {
  return kvGet<AppConfig>(CACHE_KEY);
}

export async function fetchRegistryVersion(): Promise<number> {
  const v = await registryClient().readContract({
    address: env.registryAddress,
    abi: registryAbi,
    functionName: "version",
  });
  return Number(v);
}

export async function fetchConfig(cached?: AppConfig): Promise<AppConfig> {
  if (cached) {
    const version = await fetchRegistryVersion();
    if (version === cached.version) return cached;
  }
  const [version, social, stake, chains, keys, values] = await registryClient().readContract({
    address: env.registryAddress,
    abi: registryAbi,
    functionName: "snapshot",
  });
  const params: Params = {};
  keys.forEach((k, i) => (params[decodeKey(k)] = decodeParam(values[i])));
  const config: AppConfig = {
    version: Number(version),
    registry: env.registryAddress,
    registryChainId: env.registryChainId,
    social,
    stake,
    chains: chains.map((c) => ({
      chainId: Number(c.chainId),
      name: c.name,
      content: c.content,
      inbox: c.inbox,
      role: c.role as ChainRole,
      active: c.active,
      rpcs: [...c.rpcs],
    })),
    params,
    fetchedAt: Date.now(),
  };
  if (!config.chains.some((c) => c.active && c.role !== 0)) {
    if (cached) return cached;
    throw new Error("Configuration refusée : aucune chain de contenu active.");
  }
  await kvSet(CACHE_KEY, config);
  return config;
}
