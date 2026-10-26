import {
  encodeAbiParameters,
  hexToBytes,
  http,
  keccak256,
  numberToHex,
  type Abi,
  type Address,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
} from "viem";
import { createBundlerClient, toSimple7702SmartAccount } from "viem/account-abstraction";
import type { PrivateKeyAccount } from "viem/accounts";
import { encodeFunctionData } from "viem";
import type { Network } from "./chains";
import type { Params } from "./config";
import { useSettings } from "./settings";
import { pow } from "./workers";
import { tr } from "./i18n";

export type SponsorConfig = { entryPoint: Address; paymaster: Address; bundlers: string[] };

const SIMPLE_7702 = "0xe6Cae83BdE06E4c305530e199D7217f42808555B";
const delegated = new Set<string>();

async function authorizationFor(net: Network, owner: LocalAccount) {
  const key = `${net.cfg.chainId}:${owner.address}`;
  if (delegated.has(key)) return undefined;
  const code = await net.client.getCode({ address: owner.address });
  if (code?.toLowerCase() === `0xef0100${SIMPLE_7702.slice(2)}`.toLowerCase()) {
    delegated.add(key);
    return undefined;
  }
  const nonce = await net.client.getTransactionCount({ address: owner.address, blockTag: "pending" });
  return owner.signAuthorization!({ address: SIMPLE_7702, chainId: net.cfg.chainId, nonce });
}

const userOpEvent = {
  type: "event",
  name: "UserOperationEvent",
  inputs: [
    { name: "userOpHash", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "paymaster", type: "address", indexed: true },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "success", type: "bool", indexed: false },
    { name: "actualGasCost", type: "uint256", indexed: false },
    { name: "actualGasUsed", type: "uint256", indexed: false },
  ],
} as const;

export class SponsoredSubmittedError extends Error {}

async function waitOnchain(net: Network, entryPoint: Address, userOpHash: Hex, timeoutMs = 180_000) {
  const start = Date.now();
  const fromBlock = (await net.client.getBlockNumber()) - 20n;
  while (Date.now() - start < timeoutMs) {
    const logs = await net.client
      .getLogs({ address: entryPoint, event: userOpEvent, args: { userOpHash }, fromBlock, toBlock: "latest", strict: true })
      .catch(() => []);
    if (logs.length) {
      const log = logs[0];
      if (!log.args.success) throw new SponsoredSubmittedError(tr("Opération incluse mais annulée par le contrat."));
      return net.client.getTransactionReceipt({ hash: log.transactionHash });
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new SponsoredSubmittedError(tr("Opération envoyée, confirmation toujours en attente. Elle apparaîtra dès son inclusion."));
}

export const SPONSORABLE = new Set(["publish", "submit", "submitBatch", "invite", "inviteMany", "send", "claim", "subscribe", "store", "save"]);

const paymasterAbi = [
  { type: "function", name: "difficulty", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

const difficultyCache = new Map<string, Promise<number>>();

const buildBundlers: Record<string, string[]> = (() => {
  try {
    return JSON.parse(import.meta.env.VITE_EXTRA_BUNDLERS || "{}");
  } catch {
    return {};
  }
})();

const incompatible = new Set<string>();

export class SponsorUnavailableError extends Error {}

export function sponsorFor(params: Params, chainId: number): SponsorConfig | undefined {
  const s = useSettings.getState();
  if (!s.useSponsor) return undefined;
  const cfg = params.aa?.[String(chainId)];
  if (!cfg) return undefined;
  const all = [...(s.extraBundlers[chainId] ?? []), ...(buildBundlers[String(chainId)] ?? []), ...cfg.bundlers];
  return { ...cfg, bundlers: [...new Set(all)].filter((u) => !incompatible.has(u)) };
}

async function paymasterData(net: Network, paymaster: Address, sender: Address, nonce: bigint, callData: Hex): Promise<Hex> {
  const key = `${net.cfg.chainId}:${paymaster}`;
  if (!difficultyCache.has(key)) {
    difficultyCache.set(
      key,
      net.client.readContract({ address: paymaster, abi: paymasterAbi, functionName: "difficulty" }).then(Number),
    );
  }
  const difficulty = await difficultyCache.get(key)!;
  const prefix = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
    [BigInt(net.cfg.chainId), paymaster, sender, nonce, keccak256(callData)],
  );
  const n = await pow.minePaymaster(hexToBytes(prefix), difficulty);
  return numberToHex(n, { size: 32 });
}

const lanes = new Map<string, Promise<unknown>>();

export function sendSponsored(
  net: Network,
  owner: LocalAccount,
  cfg: SponsorConfig,
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
  onHash?: (hash: Hex) => void,
): Promise<TransactionReceipt> {
  const key = `${net.cfg.chainId}:${owner.address.toLowerCase()}`;
  const run = (lanes.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => sendOne(net, owner, cfg, call, onHash));
  lanes.set(key, run);
  return run;
}

function paymasterValidationGas(callData: Hex) {
  const words = BigInt(Math.ceil((callData.length - 2) / 64));
  return 80_000n + words * 12n + (words * words) / 256n;
}

const LARGE_CALL = 20_000;

function explicitGas(data: Hex) {
  const bytes = BigInt((data.length - 2) / 2);
  if (bytes <= BigInt(LARGE_CALL)) return {};
  const words = (bytes + 31n) / 32n;
  return {
    verificationGasLimit: 100_000n + words * 12n + (words * words) / 256n,
    callGasLimit: ((60_000n + bytes * 10n + (words * words) / 256n) * 12n) / 10n,
    preVerificationGas: bytes * 42n + 100_000n,
  };
}

function calldataFloor(callData: Hex) {
  let tokens = 0n;
  for (let i = 2; i < callData.length; i += 2) tokens += callData.slice(i, i + 2) === "00" ? 1n : 4n;
  return tokens * 10n + 40_000n;
}

function describe(err: unknown) {
  const e = err as { details?: string; shortMessage?: string; message?: string };
  return (e?.details || e?.shortMessage || e?.message || String(err)).split("\n")[0].slice(0, 160);
}

async function sendOne(
  net: Network,
  owner: LocalAccount,
  cfg: SponsorConfig,
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
  onHash?: (hash: Hex) => void,
): Promise<TransactionReceipt> {
  const account = await toSimple7702SmartAccount({ client: net.client, owner: owner as PrivateKeyAccount });
  const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args } as never);
  const errors: { url: string; err: unknown }[] = [];
  for (const url of cfg.bundlers) {
    const transport = http(url, { timeout: 30_000, retryCount: 0 });
    const stub = async (p: { sender: Address; nonce: bigint; callData: Hex }) => ({
      paymaster: cfg.paymaster,
      paymasterData: await paymasterData(net, cfg.paymaster, p.sender, p.nonce, p.callData),
      paymasterVerificationGasLimit: paymasterValidationGas(p.callData),
      paymasterPostOpGasLimit: 120_000n,
      isFinal: true,
    });
    const bundler = createBundlerClient({
      account,
      client: net.client,
      transport,
      paymaster: { getPaymasterStubData: stub as never, getPaymasterData: stub as never },
      userOperation: {
        estimateFeesPerGas: async ({ bundlerClient }) => {
          try {
            const r = (await bundlerClient.request({ method: "pimlico_getUserOperationGasPrice" as never })) as {
              fast: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
            };
            return { maxFeePerGas: BigInt(r.fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(r.fast.maxPriorityFeePerGas) };
          } catch {
            return net.client.estimateFeesPerGas();
          }
        },
      },
    });
    let hash: Hex;
    try {
      const authorization = await authorizationFor(net, owner);
      const op = await bundler.prepareUserOperation({ calls: [{ to: call.address, data }], authorization, ...explicitGas(data) });
      const floor = calldataFloor(op.callData);
      if (op.preVerificationGas < floor) op.preVerificationGas = floor;
      op.signature = await account.signUserOperation(op as never);
      hash = await bundler.sendUserOperation(op as never);
    } catch (err) {
      if (/7702.*not supported|not supported.*7702/i.test(String(err))) incompatible.add(url);
      else errors.push({ url, err });
      console.warn(`Bundler ${new URL(url).host} a refusé l'opération`, err);
      continue;
    }
    onHash?.(hash);
    const receipt = await waitOnchain(net, cfg.entryPoint, hash);
    delegated.add(`${net.cfg.chainId}:${owner.address}`);
    return receipt;
  }
  const first = errors[0];
  const reason = first ? describe(first.err) : "";
  const busy = errors.length > 0 && errors.every((e) => /429|rate limit|Failed to fetch|NetworkError|Load failed/i.test(describe(e.err)));
  throw new SponsorUnavailableError(
    busy
      ? tr("Les bundlers sont saturés pour le moment. Réessayez dans une minute, ou ajoutez votre propre bundler dans Réglages.")
      : first
        ? tr("Le bundler {host} a refusé l'opération : {reason}", { host: new URL(first.url).host, reason })
        : tr("Aucun bundler compatible n'est configuré pour cette chain."),
  );
}
