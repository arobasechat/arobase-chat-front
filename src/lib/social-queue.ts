import { create } from "zustand";
import { decodeEventLog, type Hex } from "viem";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { socialAbi } from "@/abi";
import { currentSender, requireIdentity, requireSigner } from "@/identity/store";
import type { Networks } from "./chains";
import type { AppConfig } from "./config";
import { signAction } from "./protocol";
import { humanError, write } from "./tx";

export type QueuedAction = {
  key: string;
  kind: number;
  target: Hex;
  value: number;
  label: string;
  invalidate: QueryKey[];
  identity?: boolean;
};

type QueueState = {
  overlay: Record<string, number>;
  queued: QueuedAction[];
  inflight: number;
  lastError?: string;
};

export const useSocialQueue = create<QueueState>(() => ({ overlay: {}, queued: [], inflight: 0 }));

type Deps = { queryClient: QueryClient; networks: () => Networks | undefined; config: () => AppConfig | undefined };
let deps: Deps | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let localNonce: bigint | undefined;
let flushing: Promise<void> | undefined;

export function configureSocialQueue(d: Deps) {
  deps = d;
}

export function useOverlay(key: string): number | undefined {
  return useSocialQueue((s) => s.overlay[key]);
}

export function enqueueSocial(action: QueuedAction) {
  useSocialQueue.setState((s) => ({
    overlay: { ...s.overlay, [action.key]: action.value },
    queued: [...s.queued.filter((q) => q.key !== action.key), action],
  }));
  const delay = deps?.config()?.params.socialBatchMs ?? 1200;
  clearTimeout(timer);
  const size = useSocialQueue.getState().queued.length;
  timer = setTimeout(() => void flushSocial(), size >= 25 ? 0 : delay);
}

export async function flushSocial(): Promise<void> {
  if (flushing) {
    await flushing;
    if (useSocialQueue.getState().queued.length) return flushSocial();
    return;
  }
  const batch = useSocialQueue.getState().queued;
  if (!batch.length || !deps) return;
  useSocialQueue.setState((s) => ({ queued: [], inflight: s.inflight + batch.length }));
  flushing = run(batch).finally(() => {
    flushing = undefined;
    useSocialQueue.setState((s) => ({ inflight: s.inflight - batch.length }));
  });
  return flushing;
}

function clearOverlay(batch: QueuedAction[]) {
  const queuedKeys = new Set(useSocialQueue.getState().queued.map((q) => q.key));
  useSocialQueue.setState((s) => {
    const overlay = { ...s.overlay };
    for (const a of batch) if (!queuedKeys.has(a.key) && overlay[a.key] === a.value) delete overlay[a.key];
    return { overlay };
  });
}

async function run(batch: QueuedAction[]) {
  const { queryClient, networks: getNetworks, config: getConfig } = deps!;
  const networks = getNetworks();
  const config = getConfig();
  if (!networks || !config) return;
  const net = networks.social;
  try {
    const signer = batch.some((a) => a.identity) ? await requireIdentity() : await requireSigner();
    const account = currentSender()!;
    const chainNonce = await net.client.readContract({
      address: config.social,
      abi: socialAbi,
      functionName: "nonces",
      args: [signer.author],
    });
    let nonce = localNonce !== undefined && localNonce > chainNonce ? localNonce : chainNonce;
    const actions = [];
    for (const a of batch) actions.push(await signAction(signer, a.kind, a.target, a.value, nonce++));
    localNonce = nonce;
    const receipt = await write({
      net,
      account,
      params: config.params,
      label: batch.length === 1 ? batch[0].label : `${batch.length} actions sociales`,
      address: config.social,
      abi: socialAbi,
      functionName: "submitBatch",
      args: [actions],
    });
    const rejected = new Set<number>();
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: socialAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Rejected") rejected.add(Number(ev.args.index));
      } catch {
        continue;
      }
    }
    if (rejected.size) localNonce = undefined;
    await Promise.all(
      batch.flatMap((a) => a.invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
    );
    useSocialQueue.setState({ lastError: rejected.size ? `${rejected.size} action(s) refusée(s) par le contrat` : undefined });
  } catch (err) {
    localNonce = undefined;
    useSocialQueue.setState({ lastError: humanError(err) });
    await Promise.all(
      batch.flatMap((a) => a.invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
    );
  } finally {
    clearOverlay(batch);
  }
}
