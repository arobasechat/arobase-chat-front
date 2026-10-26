import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { paymasterAbi } from "@/abi";
import { useConfig, useNetworks } from "./core";

export const entryPointAbi = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "depositTo", inputs: [{ type: "address" }], outputs: [], stateMutability: "payable" },
] as const;

export const ACTION_GAS = {
  social: 220_000n,
  image: 1_300_000n,
  post: 300_000n,
  dm: 130_000n,
  anchor: 250_000n,
};

export type PaymasterRow = {
  chainId: number;
  name: string;
  entryPoint: Address;
  paymaster: Address;
  deposit: bigint | null;
  dailyBudget: bigint | null;
  remainingToday: bigint | null;
  gasPrice: bigint | null;
  social: boolean;
  content: boolean;
};

async function bundlerGasPrice(url: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "pimlico_getUserOperationGasPrice", params: [] }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as { result?: { standard?: { maxFeePerGas: Hex }; fast?: { maxFeePerGas: Hex } } };
  const price = json.result?.standard?.maxFeePerGas ?? json.result?.fast?.maxFeePerGas;
  if (!price) throw new Error("no price");
  return BigInt(price);
}

export function usePaymasters() {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: ["paymasters", networks.key, JSON.stringify(config.params.aa ?? {})],
    staleTime: 60_000,
    refetchInterval: 60_000,
    meta: { persist: false },
    queryFn: async (): Promise<PaymasterRow[]> => {
      const entries = Object.entries(config.params.aa ?? {}).filter(([id]) => networks.byId.has(Number(id)));
      return Promise.all(
        entries.map(async ([id, aa]) => {
          const net = networks.byId.get(Number(id))!;
          const read = <T,>(p: Promise<T>) => p.catch(() => null);
          const [deposit, dailyBudget, remainingToday, gasPrice] = await Promise.all([
            read(net.client.readContract({ address: aa.entryPoint, abi: entryPointAbi, functionName: "balanceOf", args: [aa.paymaster] })),
            read(net.client.readContract({ address: aa.paymaster, abi: paymasterAbi, functionName: "dailyBudget" })),
            read(net.client.readContract({ address: aa.paymaster, abi: paymasterAbi, functionName: "remainingToday" })),
            (aa.bundlers[0] ? bundlerGasPrice(aa.bundlers[0]) : Promise.reject(new Error())).catch(() => read(net.client.getGasPrice())),
          ]);
          return {
            chainId: net.cfg.chainId,
            name: net.cfg.name,
            entryPoint: aa.entryPoint,
            paymaster: aa.paymaster,
            deposit,
            dailyBudget,
            remainingToday,
            gasPrice,
            social: net.cfg.chainId === networks.social.cfg.chainId,
            content: networks.free.some((n) => n.cfg.chainId === net.cfg.chainId),
          };
        }),
      );
    },
  });
}
