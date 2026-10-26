import type { Address } from "viem";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  registryAddress: (import.meta.env.VITE_REGISTRY_ADDRESS ?? "") as Address,
  registryChainId: Number(import.meta.env.VITE_REGISTRY_CHAIN_ID ?? 0),
  registryRpcs: list(import.meta.env.VITE_REGISTRY_RPCS),
  rpId: import.meta.env.VITE_RP_ID || undefined,
  devChains: import.meta.env.VITE_DEV_CHAINS === "true",
  hashRouter: import.meta.env.VITE_HASH_ROUTER === "true",
  repoUrl: import.meta.env.VITE_REPO_URL || "",
  clientVersion: 1,
} as const;

export const repo = (env.repoUrl || "https://github.com/arobasechat").replace(/\/$/, "");

export const isDevChain = (chainId: number) => env.devChains && chainId >= 31337 && chainId <= 31399;
