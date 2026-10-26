import { create } from "zustand";
import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  createWalletClient,
  encodeAbiParameters,
  concat,
  formatEther,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
} from "viem";
import { isDevChain } from "@/env";
import type { Network } from "./chains";
import type { Params } from "./config";
import { pow } from "./workers";
import { sendSponsored, SponsoredSubmittedError, SponsorUnavailableError, sponsorFor, SPONSORABLE } from "./sponsor";
import { useAuth } from "@/identity/store";
import { chainMeta } from "./chain-meta";
import { tr } from "./i18n";

export type TxStatus = "signing" | "pending" | "confirmed" | "failed";
export type TxEntry = {
  id: number;
  label: string;
  chainId: number;
  chainName: string;
  hash?: Hex;
  status: TxStatus;
  error?: string;
  at: number;
};

type TxStore = {
  list: TxEntry[];
  push: (e: Omit<TxEntry, "id" | "at">) => number;
  update: (id: number, patch: Partial<TxEntry>) => void;
  dismiss: (id: number) => void;
};

let seq = 0;
export const useTxs = create<TxStore>((set) => ({
  list: [],
  push: (e) => {
    const id = ++seq;
    set((s) => ({ list: [...s.list.slice(-8), { ...e, id, at: Date.now() }] }));
    return id;
  },
  update: (id, patch) => set((s) => ({ list: s.list.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  dismiss: (id) => set((s) => ({ list: s.list.filter((t) => t.id !== id) })),
}));

export async function tracked(net: Network, label: string, send: () => Promise<Hex>): Promise<TransactionReceipt> {
  const txs = useTxs.getState();
  const id = txs.push({ label, chainId: net.cfg.chainId, chainName: net.cfg.name, status: "signing" });
  try {
    const hash = await send();
    txs.update(id, { hash, status: "pending" });
    const receipt = await net.client.waitForTransactionReceipt({ hash, pollingInterval: 1_000, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(tr("Transaction annulée par la chain (revert)."));
    txs.update(id, { status: "confirmed" });
    return receipt;
  } catch (err) {
    txs.update(id, { status: "failed", error: humanError(err) });
    throw err;
  }
}

export class GasError extends Error {
  constructor(
    public chainName: string,
    public address: Address,
    public needed: bigint,
    public chainId = 0,
  ) {
    const meta = chainMeta(chainId, chainName);
    const amount = Number(formatEther(needed));
    const shown = amount < 0.0001 ? tr("un tout petit peu de") : tr("au moins {amount}", { amount: amount.toLocaleString("fr", { maximumSignificantDigits: 2 }) });
    super(tr("Pas assez de {asset} sur {network}. Envoyez {shown} {asset} sur le réseau « {network} » à votre adresse (voir Portefeuille).", { asset: meta.asset, network: meta.network, shown }));
  }
}

export function humanError(err: unknown): string {
  if (err instanceof GasError || err instanceof SponsorUnavailableError) return err.message;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof InsufficientFundsError)) return tr("Solde insuffisant pour payer le gas.");
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return tr("Refusé par le contrat : {name}", { name: revert.data.errorName });
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

async function claimSfuel(net: Network, account: LocalAccount, params: Params) {
  const faucet = params.faucets?.[String(net.cfg.chainId)];
  if (!faucet) return false;
  const client = net.client;
  const nonce = await client.getTransactionCount({ address: account.address });
  const gas = 100_000;
  const gasPrice = await pow.mine(account.address, nonce, gas);
  const data = concat([faucet.selector, encodeAbiParameters([{ type: "address" }], [account.address])]);
  const wallet = createWalletClient({ account, chain: net.chain, transport: () => client.transport as never });
  const hash = await wallet.sendTransaction({
    to: faucet.address,
    data,
    gas: BigInt(gas),
    gasPrice: BigInt(gasPrice),
    nonce,
  });
  await client.waitForTransactionReceipt({ hash });
  return true;
}

export async function devFund(net: Network, address: Address, amount = "10") {
  await net.client.request({
    method: "anvil_setBalance" as never,
    params: [address, toHex(parseEther(amount))] as never,
  });
}

const walletCache = new WeakMap<LocalAccount, Map<number, ReturnType<typeof createWalletClient>>>();
function walletFor(net: Network, account: LocalAccount) {
  let byChain = walletCache.get(account);
  if (!byChain) walletCache.set(account, (byChain = new Map()));
  let w = byChain.get(net.cfg.chainId);
  if (!w) {
    w = createWalletClient({ account, chain: net.chain, transport: () => net.client.transport as never });
    byChain.set(net.cfg.chainId, w);
  }
  return w;
}

export async function estimateCost(
  net: Network,
  account: Address,
  call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint },
) {
  const [gas, gasPrice] = await Promise.all([
    net.client.estimateContractGas({ ...call, account } as never).catch((err) => {
      if (isDevChain(net.cfg.chainId) && String(err).includes("gas floor")) return 2_000_000n;
      throw err;
    }),
    net.client.getGasPrice(),
  ]);
  return { gas, gasPrice, cost: gas * gasPrice };
}

export async function write<
  const abi extends Abi,
  functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(opts: {
  net: Network;
  account: LocalAccount;
  params: Params;
  label: string;
  address: Address;
  abi: abi;
  functionName: functionName;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>;
  value?: bigint;
  silent?: boolean;
}): Promise<TransactionReceipt> {
  const { net, params } = opts;
  let account = opts.account;
  const txs = useTxs.getState();
  const id = opts.silent
    ? 0
    : txs.push({ label: opts.label, chainId: net.cfg.chainId, chainName: net.cfg.name, status: "signing" });
  try {
    const call = {
      address: opts.address,
      abi: opts.abi as Abi,
      functionName: opts.functionName as string,
      args: opts.args as readonly unknown[],
      value: opts.value,
    };
    let sponsorError: SponsorUnavailableError | undefined;
    const sponsor = !opts.value && SPONSORABLE.has(call.functionName) ? sponsorFor(params, net.cfg.chainId) : undefined;
    if (sponsor) {
      try {
        const receipt = await sendSponsored(net, account, sponsor, call, (hash) => {
          if (id) txs.update(id, { status: "pending", label: tr("{label} (sponsorisé)", { label: opts.label }), hash });
        });
        if (id) txs.update(id, { status: "confirmed", hash: receipt.transactionHash });
        return receipt;
      } catch (err) {
        if (err instanceof SponsoredSubmittedError) throw err;
        if (err instanceof SponsorUnavailableError) sponsorError = err;
        console.warn("Sponsoring ERC-4337 indisponible, repli sur le paiement direct", err);
      }
    }
    let estimate = await estimateCost(net, account.address, call);
    let balance = await net.client.getBalance({ address: account.address });
    let needed = (estimate.cost * 12n) / 10n + (opts.value ?? 0n);
    const identity = useAuth.getState().identity;
    if (balance < needed && estimate.gasPrice > 0n && identity && account.address.toLowerCase() !== identity.address.toLowerCase()) {
      const identityBalance = await net.client.getBalance({ address: identity.address });
      if (identityBalance >= needed) {
        account = (await useAuth.getState().unlock()).account;
        estimate = await estimateCost(net, account.address, call);
        balance = identityBalance;
        needed = (estimate.cost * 12n) / 10n + (opts.value ?? 0n);
      }
    }
    if (balance < needed && estimate.gasPrice > 0n) {
      if (isDevChain(net.cfg.chainId)) await devFund(net, account.address);
      else if (!(await claimSfuel(net, account, params)))
        throw sponsorError ?? new GasError(net.cfg.name, identity?.address ?? account.address, needed, net.cfg.chainId);
      estimate = await estimateCost(net, account.address, call);
      balance = await net.client.getBalance({ address: account.address });
      if (balance < needed) throw new GasError(net.cfg.name, identity?.address ?? account.address, needed, net.cfg.chainId);
    }
    const hash = await walletFor(net, account).writeContract({
      ...call,
      gas: (estimate.gas * 13n) / 10n,
      chain: net.chain,
      account,
    } as never);
    if (id) txs.update(id, { hash, status: "pending" });
    const receipt = await net.client.waitForTransactionReceipt({ hash, pollingInterval: 1_000, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(tr("Transaction annulée par la chain (revert)."));
    if (id) txs.update(id, { status: "confirmed" });
    return receipt;
  } catch (err) {
    if (id) txs.update(id, { status: "failed", error: humanError(err) });
    throw err;
  }
}
