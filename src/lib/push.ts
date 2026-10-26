import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bytesToHex, concat, hexToBytes, keccak256, numberToHex, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { pushRelaysAbi } from "@/abi";
import { env } from "@/env";
import { currentSender, currentSigner, requireSigner } from "@/identity/store";
import type { Networks } from "./chains";
import type { AppConfig } from "./config";
import { sealTo } from "./crypto";
import { conversationTagKeys } from "@/queries/dm";
import { db } from "./db";
import { domain } from "./protocol";
import { useSettings } from "./settings";
import { sponsorFor } from "./sponsor";
import { write } from "./tx";
import { tr } from "./i18n";

export const PUSH_INFO = "arobase:push";
export const PUSH_TTL_SEC = 90 * 86_400;

export const pushTypes = {
  Push: [
    { name: "author", type: "address" },
    { name: "bodyHash", type: "bytes32" },
  ],
} as const;

export type PushRelay = {
  id: number;
  operator: Address;
  active: boolean;
  encKey: Hex;
  vapid: Hex;
  name: string;
  info: string;
  verified?: boolean;
};

export type PushParam = { chainId: number; address: Address; relays?: number[] };

type PushState = {
  author?: Address;
  relayId?: number;
  dev?: Hex;
  endpoint?: string;
  exp?: number;
  dms: boolean;
  convsHash?: Hex;
  set: (patch: Partial<Omit<PushState, "set">>) => void;
};

export const usePushState = create<PushState>()(
  persist((set) => ({ dms: true, set: (patch) => set(patch) }), { name: "arobase:push", version: 1 }),
);

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const pushParam = (config: AppConfig) => config.params.push as PushParam | undefined;

export async function fetchRelays(networks: Networks, config: AppConfig): Promise<PushRelay[]> {
  const p = pushParam(config);
  const net = p && networks.byId.get(p.chainId);
  if (!p || !net) return [];
  const list = await net.client.readContract({ address: p.address, abi: pushRelaysAbi, functionName: "all" });
  return list.map((r, id) => ({ id, ...r, verified: p.relays ? p.relays.includes(id) : undefined })).filter((r) => r.active);
}

export const MAX_PUSH_CONVS = 200;

const convsHashOf = (keys: Hex[]) => keccak256(toHex([...keys].sort().join(",")));

async function currentTagKeys() {
  const convs = (await db.convs.orderBy("lastTs").reverse().toArray()).slice(0, MAX_PUSH_CONVS);
  return Object.keys(conversationTagKeys(convs)) as Hex[];
}

async function browserSubscription(vapid: Hex) {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const key = hexToBytes(vapid);
  if (existing) {
    const current = existing.options.applicationServerKey;
    const same = current && bytesToHex(new Uint8Array(current)) === bytesToHex(key);
    if (same) return existing;
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
}

async function sendRecord(
  networks: Networks,
  config: AppConfig,
  relay: PushRelay,
  record: Record<string, unknown>,
  label: string,
) {
  const p = pushParam(config)!;
  const net = networks.byId.get(p.chainId)!;
  const signer = await requireSigner();
  const body = JSON.stringify({ v: 1, a: signer.author, ...record });
  const raw = await signer.account.signTypedData({
    domain,
    types: pushTypes,
    primaryType: "Push",
    message: { author: signer.author, bodyHash: keccak256(toHex(body)) },
  });
  const sig = signer.delegation ? concat([raw, signer.delegation.sig, numberToHex(signer.delegation.expiry, { size: 8 })]) : raw;
  const ciphertext = sealTo(hexToBytes(relay.encKey), PUSH_INFO, { b: body, s: sig });
  const account = sponsorFor(config.params, p.chainId) ? privateKeyToAccount(generatePrivateKey()) : currentSender()!;
  await write({
    net,
    account,
    params: config.params,
    label,
    address: p.address,
    abi: pushRelaysAbi,
    functionName: "subscribe",
    args: [BigInt(relay.id), ciphertext],
  });
  return signer.author;
}

export async function enablePush(networks: Networks, config: AppConfig, relay: PushRelay, dms: boolean) {
  if (!pushSupported()) throw new Error(tr("Ce navigateur ne gère pas les notifications push."));
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(tr("Autorisation refusée. Réactivez les notifications pour ce site dans le navigateur."));
  const sub = (await browserSubscription(relay.vapid)).toJSON();
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error(tr("Abonnement push incomplet."));
  const state = usePushState.getState();
  const dev = state.dev ?? bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const tk = dms ? await currentTagKeys() : [];
  const exp = Math.floor(Date.now() / 1000) + PUSH_TTL_SEC;
  const author = await sendRecord(
    networks,
    config,
    relay,
    {
      dev,
      exp,
      h: env.hashRouter ? 1 : 0,
      l: useSettings.getState().language,
      sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      tk,
    },
    tr("Activation des notifications push"),
  );
  state.set({ author, relayId: relay.id, dev, endpoint: sub.endpoint, exp, dms, convsHash: convsHashOf(tk) });
}

export async function disablePush(networks: Networks, config: AppConfig, relay: PushRelay | undefined) {
  const state = usePushState.getState();
  if (relay && state.dev) await sendRecord(networks, config, relay, { dev: state.dev, sub: null }, tr("Désactivation des notifications push"));
  const reg = await navigator.serviceWorker?.ready;
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  state.set({ author: undefined, relayId: undefined, endpoint: undefined, exp: undefined, convsHash: undefined });
}

export async function refreshPushIfNeeded(networks: Networks, config: AppConfig, me: Address, relays: PushRelay[]) {
  const state = usePushState.getState();
  if (state.relayId === undefined || !state.author || state.author.toLowerCase() !== me.toLowerCase()) return;
  const relay = relays.find((r) => r.id === state.relayId);
  if (!relay || Notification.permission !== "granted" || !currentSigner()) return;
  const tk = state.dms ? await currentTagKeys() : [];
  const expiring = (state.exp ?? 0) - Date.now() / 1000 < 14 * 86_400;
  if (!expiring && convsHashOf(tk) === state.convsHash) return;
  await enablePush(networks, config, relay, state.dms);
}
