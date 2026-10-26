import { create } from "zustand";
import { bytesToHex, hexToBytes, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, nonceManager, privateKeyToAccount } from "viem/accounts";
import { db } from "@/lib/db";
import { encKeypairFromSeed } from "@/lib/crypto";
import { signSession, type Delegation, type Signer } from "@/lib/protocol";
import { createPasskey, unlockPasskey } from "./passkey";

export type IdentityInfo = {
  address: Address;
  type: "passkey" | "dev";
  credentialId?: string;
  label?: string;
};

type Unlocked = { account: LocalAccount; privateKey: Hex; encSecret: Uint8Array; encPublic: Uint8Array };
type Session = { account: LocalAccount; delegation: Delegation; encSecret: Uint8Array; encPublic: Uint8Array };

type AuthState = {
  ready: boolean;
  identity: IdentityInfo | null;
  unlocked: Unlocked | null;
  session: Session | null;
  init: () => Promise<void>;
  createWithPasskey: (name: string) => Promise<void>;
  unlock: () => Promise<Unlocked>;
  importDevKey: (pk: Hex, label?: string) => Promise<void>;
  createSession: (days?: number) => Promise<void>;
  dropSession: () => Promise<void>;
  logout: () => Promise<void>;
};

const IDENTITY_KEY = "arobase:identity";
const DEV_PK_KEY = "arobase:dev-pk";
const SESSION_SECRET = "session";
const WRAP_KEY = "wrap-key";

const accountOf = (pk: Hex) => privateKeyToAccount(pk, { nonceManager });

function unlockedFrom(pk: Hex, encSeed: Uint8Array): Unlocked {
  const enc = encKeypairFromSeed(encSeed);
  return { account: accountOf(pk), privateKey: pk, encSecret: enc.secretKey, encPublic: enc.publicKey };
}

async function wrapKey(): Promise<CryptoKey> {
  const existing = (await db.secrets.get(WRAP_KEY))?.value as CryptoKey | undefined;
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await db.secrets.put({ key: WRAP_KEY, value: key });
  return key;
}

type StoredSession = { iv: Uint8Array; ct: ArrayBuffer; delegation: Delegation; author: Address };

async function saveSession(author: Address, pk: Hex, encSecret: Uint8Array, delegation: Delegation) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ pk, enc: bytesToHex(encSecret) }));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrapKey(), plain);
  await db.secrets.put({ key: SESSION_SECRET, value: { iv, ct, delegation, author } satisfies StoredSession });
}

async function loadSession(author: Address): Promise<Session | null> {
  const stored = (await db.secrets.get(SESSION_SECRET))?.value as StoredSession | undefined;
  if (!stored || stored.author.toLowerCase() !== author.toLowerCase()) return null;
  if (stored.delegation.expiry * 1000 < Date.now()) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: stored.iv as Uint8Array<ArrayBuffer> }, await wrapKey(), stored.ct);
    const { pk, enc } = JSON.parse(new TextDecoder().decode(plain)) as { pk: Hex; enc: Hex };
    const encSecret = hexToBytes(enc);
    const { x25519 } = await import("@noble/curves/ed25519.js");
    return { account: accountOf(pk), delegation: stored.delegation, encSecret, encPublic: x25519.getPublicKey(encSecret) };
  } catch {
    return null;
  }
}

function persistIdentity(info: IdentityInfo | null) {
  if (info) localStorage.setItem(IDENTITY_KEY, JSON.stringify(info));
  else localStorage.removeItem(IDENTITY_KEY);
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  identity: null,
  unlocked: null,
  session: null,

  init: async () => {
    const raw = localStorage.getItem(IDENTITY_KEY);
    const identity = raw ? (JSON.parse(raw) as IdentityInfo) : null;
    let unlocked: Unlocked | null = null;
    let session: Session | null = null;
    if (identity?.type === "dev") {
      const pk = localStorage.getItem(DEV_PK_KEY) as Hex | null;
      if (pk) unlocked = unlockedFrom(pk, hexToBytes(pk));
    } else if (identity) {
      session = await loadSession(identity.address);
    }
    set({ ready: true, identity, unlocked, session });
  },

  createWithPasskey: async (name) => {
    const secrets = await createPasskey(name);
    const unlocked = unlockedFrom(secrets.identityKey, secrets.encSeed);
    const identity: IdentityInfo = {
      address: unlocked.account.address,
      type: "passkey",
      credentialId: secrets.credentialId,
      label: name,
    };
    persistIdentity(identity);
    set({ identity, unlocked });
    await get().createSession();
  },

  unlock: async () => {
    const current = get().unlocked;
    if (current) return current;
    const identity = get().identity;
    const secrets = await unlockPasskey(identity?.credentialId);
    const unlocked = unlockedFrom(secrets.identityKey, secrets.encSeed);
    if (identity && identity.address.toLowerCase() !== unlocked.account.address.toLowerCase()) {
      throw new Error("Cette passkey correspond à un autre compte.");
    }
    const info: IdentityInfo = identity ?? {
      address: unlocked.account.address,
      type: "passkey",
      credentialId: secrets.credentialId,
    };
    persistIdentity(info);
    set({ identity: info, unlocked });
    return unlocked;
  },

  importDevKey: async (pk, label) => {
    const unlocked = unlockedFrom(pk, hexToBytes(pk));
    const identity: IdentityInfo = { address: unlocked.account.address, type: "dev", label };
    localStorage.setItem(DEV_PK_KEY, pk);
    persistIdentity(identity);
    await db.secrets.delete(SESSION_SECRET);
    set({ identity, unlocked, session: null });
  },

  createSession: async (days = 30) => {
    const unlocked = get().unlocked ?? (await get().unlock());
    const pk = generatePrivateKey();
    const account = accountOf(pk);
    const expiry = Math.floor(Date.now() / 1000) + days * 86_400;
    const delegation = await signSession(unlocked.account, account.address, expiry);
    await saveSession(unlocked.account.address, pk, unlocked.encSecret, delegation);
    set({
      session: { account, delegation, encSecret: unlocked.encSecret, encPublic: unlocked.encPublic },
    });
  },

  dropSession: async () => {
    await db.secrets.delete(SESSION_SECRET);
    set({ session: null });
  },

  logout: async () => {
    await wipeLocalData();
    persistIdentity(null);
    set({ identity: null, unlocked: null, session: null });
  },
}));

export function currentSigner(): Signer | null {
  const { identity, unlocked, session } = useAuth.getState();
  if (!identity) return null;
  if (unlocked) return { author: identity.address, account: unlocked.account };
  if (session) return { author: identity.address, account: session.account, delegation: session.delegation };
  return null;
}

export function currentSender(): LocalAccount | null {
  const { unlocked, session } = useAuth.getState();
  return unlocked?.account ?? session?.account ?? null;
}

export function currentEnc(): { secret: Uint8Array; publicKey: Uint8Array } | null {
  const { unlocked, session } = useAuth.getState();
  const src = unlocked ?? session;
  return src ? { secret: src.encSecret, publicKey: src.encPublic } : null;
}

export async function requireIdentity(): Promise<Signer> {
  const { identity } = useAuth.getState();
  const unlocked = await useAuth.getState().unlock();
  return { author: identity?.address ?? unlocked.account.address, account: unlocked.account };
}

export async function wipeLocalData() {
  await Promise.all(
    [db.convs, db.dms, db.notifs, db.bookmarks, db.kv, db.secrets].map((t) => t.clear().catch(() => undefined)),
  );
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("arobase:") && key !== "arobase:settings") localStorage.removeItem(key);
  }
  if ("caches" in globalThis) await caches.delete("arobase-sw").catch(() => undefined);
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  await (await reg?.pushManager.getSubscription().catch(() => null))?.unsubscribe().catch(() => undefined);
}

export async function requireSigner(): Promise<Signer> {
  const s = currentSigner();
  if (s) return s;
  await useAuth.getState().unlock();
  return currentSigner()!;
}

export const useViewer = () => useAuth((s) => s.identity?.address);
