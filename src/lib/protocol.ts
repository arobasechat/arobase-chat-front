import {
  concat,
  hexToBytes,
  keccak256,
  numberToHex,
  recoverTypedDataAddress,
  size,
  slice,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";

export const KIND = {
  POST: 0,
  COMMENT: 1,
  NOTE: 2,
  PROFILE: 3,
  REPOST: 4,
  RETRACT: 5,
  VOTE: 6,
  REACT: 10,
  FOLLOW: 11,
  MOD_VOTE: 12,
  ENC_KEY: 13,
  RATE_NOTE: 15,
  ROLE: 20,
  DM: 30,
} as const;

export const CONTENT_KINDS = new Set<number>([KIND.POST, KIND.COMMENT, KIND.NOTE, KIND.REPOST]);
export const POLL_MAX_OPTIONS = 4;

export const ROLE = { USER: 0, MODERATOR: 1, ADMIN: 2 } as const;

export const ZERO32 = `0x${"0".repeat(64)}` as Hex;

export const domain = { name: "arobase.chat", version: "1" } as const;

export const types = {
  Message: [
    { name: "author", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "parentId", type: "bytes32" },
    { name: "ts", type: "uint64" },
    { name: "payloadHash", type: "bytes32" },
  ],
  Action: [
    { name: "author", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "target", type: "bytes32" },
    { name: "value", type: "int8" },
    { name: "nonce", type: "uint64" },
  ],
  Session: [
    { name: "key", type: "address" },
    { name: "expiry", type: "uint64" },
  ],
  Name: [
    { name: "author", type: "address" },
    { name: "name", type: "string" },
    { name: "nonce", type: "uint64" },
  ],
  Save: [
    { name: "author", type: "address" },
    { name: "key", type: "bytes32" },
    { name: "version", type: "uint64" },
    { name: "dataHash", type: "bytes32" },
  ],
  Private: [
    { name: "author", type: "address" },
    { name: "conv", type: "bytes32" },
    { name: "ts", type: "uint64" },
    { name: "payloadHash", type: "bytes32" },
  ],
  Revoke: [
    { name: "author", type: "address" },
    { name: "key", type: "address" },
  ],
} as const;

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const MENTION_RE = /@(0x[a-fA-F0-9]{40})/g;
export const TAG_RE = /#([A-Za-z0-9_\u0080-\u{10FFFF}]+)/gu;

const encoder = new TextEncoder();

export const normalizeTag = (t: string) => t.replace(/[A-Z]/g, (c) => c.toLowerCase());

export const validTag = (t: string) => {
  const n = encoder.encode(t).length;
  return n >= 2 && n <= 50;
};

export function extractTags(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const t = normalizeTag(m[1]);
    if (validTag(t) && !out.includes(t)) out.push(t);
    if (out.length === 10) break;
  }
  return out;
}

export const tagHash = (t: string) => keccak256(toHex(encoder.encode(normalizeTag(t))));

export async function signName(signer: Signer, name: string, nonce: bigint): Promise<Hex> {
  const raw = await signer.account.signTypedData({
    domain,
    types,
    primaryType: "Name",
    message: { author: signer.author, name, nonce },
  });
  return withDelegation(raw, signer.delegation);
}

export async function signSave(signer: Signer, key: Hex, version: bigint, data: Hex): Promise<Hex> {
  const raw = await signer.account.signTypedData({
    domain,
    types,
    primaryType: "Save",
    message: { author: signer.author, key, version, dataHash: keccak256(data) },
  });
  return withDelegation(raw, signer.delegation);
}

export async function signRevoke(signer: Signer, key: Address): Promise<Hex> {
  const raw = await signer.account.signTypedData({
    domain,
    types,
    primaryType: "Revoke",
    message: { author: signer.author, key },
  });
  return withDelegation(raw, signer.delegation);
}

export type Body = {
  v: number;
  ts: number;
  text?: string;
  media?: string[];
  parentId?: Hex;
  name?: string;
  bio?: string;
  avatar?: string;
  conv?: Hex;
  quote?: Hex;
  poll?: { options: string[]; end: number };
};

export type MessageStatus = "confirmed" | "pending" | "failed";

export type Message = {
  id: Hex;
  author: Address;
  kind: number;
  parentId: Hex;
  ts: number;
  body: Body;
  payload: Hex;
  sig: Hex;
  signer: Address;
  sessionExpiry?: number;
  locations: Record<number, number>;
  status: MessageStatus;
  invalid?: string;
};

export type Delegation = { key: Address; expiry: number; sig: Hex };

export type Signer = {
  author: Address;
  account: LocalAccount;
  delegation?: Delegation;
};

const te = new TextEncoder();
const td = new TextDecoder();

export const encodeBody = (body: Body): Hex => toHex(te.encode(JSON.stringify(body)));

export function decodeBody(payload: Hex): Body | null {
  try {
    const parsed = JSON.parse(td.decode(hexToBytes(payload)));
    return parsed && typeof parsed === "object" ? (parsed as Body) : null;
  } catch {
    return null;
  }
}

export const addressTarget = (a: Address): Hex => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
export const targetAddress = (t: Hex): Address => `0x${t.slice(26)}` as Address;

const withDelegation = (sig: Hex, delegation?: Delegation): Hex =>
  delegation ? concat([sig, delegation.sig, numberToHex(delegation.expiry, { size: 8 })]) : sig;

export async function signSession(identity: LocalAccount, key: Address, expiry: number): Promise<Delegation> {
  const sig = await identity.signTypedData({
    domain,
    types,
    primaryType: "Session",
    message: { key, expiry: BigInt(expiry) },
  });
  return { key, expiry, sig };
}

export async function createMessage(
  signer: Signer,
  kind: number,
  content: Omit<Body, "v" | "ts" | "parentId">,
  parentId: Hex = ZERO32,
): Promise<Message> {
  const ts = Math.floor(Date.now() / 1000);
  const body: Body = { v: 1, ...content, ...(parentId !== ZERO32 ? { parentId } : {}), ts };
  const payload = encodeBody(body);
  const raw = await signer.account.signTypedData({
    domain,
    types,
    primaryType: "Message",
    message: { author: signer.author, kind, parentId, ts: BigInt(ts), payloadHash: keccak256(payload) },
  });
  const sig = withDelegation(raw, signer.delegation);
  return {
    id: keccak256(sig),
    author: signer.author,
    kind,
    parentId,
    ts,
    body,
    payload,
    sig,
    signer: signer.account.address,
    sessionExpiry: signer.delegation?.expiry,
    locations: {},
    status: "pending",
  };
}

export async function signAction(signer: Signer, kind: number, target: Hex, value: number, nonce: bigint) {
  const raw = await signer.account.signTypedData({
    domain,
    types,
    primaryType: "Action",
    message: { author: signer.author, kind, target, value, nonce },
  });
  return { author: signer.author, kind, target, value, nonce, sig: withDelegation(raw, signer.delegation) };
}

export type PrivateMessage = { a: Address; p: Hex; s: Hex };

export async function signPrivate(signer: Signer, conv: Hex, text: string): Promise<PrivateMessage & { ts: number; id: Hex }> {
  const ts = Math.floor(Date.now() / 1000);
  const payload = encodeBody({ v: 1, text, conv, ts });
  const raw = await signer.account.signTypedData({
    domain,
    types,
    primaryType: "Private",
    message: { author: signer.author, conv, ts: BigInt(ts), payloadHash: keccak256(payload) },
  });
  const sig = withDelegation(raw, signer.delegation);
  return { a: signer.author, p: payload, s: sig, ts, id: keccak256(sig) };
}

export async function verifyPrivate(m: PrivateMessage, conv: Hex): Promise<Verified> {
  const body = decodeBody(m.p);
  if (!body || typeof body.ts !== "number") return { ok: false, reason: "payload illisible" };
  if (body.conv?.toLowerCase() !== conv.toLowerCase()) return { ok: false, reason: "conversation incohérente" };
  const hash = {
    domain,
    types,
    primaryType: "Private" as const,
    message: { author: m.a, conv, ts: BigInt(body.ts), payloadHash: keccak256(m.p) },
  };
  return checkSignature(hash, m.a, m.s, body.ts, body);
}

type TypedHash = Parameters<typeof recoverTypedDataAddress>[0];

async function checkSignature(hash: Omit<TypedHash, "signature">, author: Address, sig: Hex, ts: number, body: Body): Promise<Verified> {
  try {
    const len = size(sig);
    if (len === 65) {
      const signer = await recoverTypedDataAddress({ ...hash, signature: sig } as TypedHash);
      if (signer.toLowerCase() !== author.toLowerCase()) return { ok: false, reason: "signature invalide" };
      return { ok: true, signer, body };
    }
    if (len === 138) {
      const signer = await recoverTypedDataAddress({ ...hash, signature: slice(sig, 0, 65) } as TypedHash);
      const expiry = Number(BigInt(slice(sig, 130, 138)));
      const delegator = await recoverTypedDataAddress({
        domain,
        types,
        primaryType: "Session",
        message: { key: signer, expiry: BigInt(expiry) },
        signature: slice(sig, 65, 130),
      });
      if (delegator.toLowerCase() !== author.toLowerCase()) return { ok: false, reason: "délégation invalide" };
      if (ts > expiry) return { ok: false, reason: "clé de session expirée" };
      return { ok: true, signer, sessionExpiry: expiry, body };
    }
  } catch {
    return { ok: false, reason: "signature malformée" };
  }
  return { ok: false, reason: "format de signature inconnu" };
}

export type RawLog = {
  id: Hex;
  author: Address;
  kind: number;
  payload: Hex;
  sig: Hex;
  parentId: Hex;
  ts: number;
};

export type Verified =
  | { ok: true; signer: Address; sessionExpiry?: number; body: Body }
  | { ok: false; reason: string };

export async function verifyRaw(m: RawLog): Promise<Verified> {
  if (keccak256(m.sig) !== m.id) return { ok: false, reason: "id ≠ hash(signature)" };
  const body = decodeBody(m.payload);
  if (!body) return { ok: false, reason: "payload illisible" };
  if (body.ts !== m.ts) return { ok: false, reason: "horodatage incohérent" };
  if ((body.parentId ?? ZERO32).toLowerCase() !== m.parentId.toLowerCase())
    return { ok: false, reason: "parent incohérent" };
  const hash = {
    domain,
    types,
    primaryType: "Message" as const,
    message: {
      author: m.author,
      kind: m.kind,
      parentId: m.parentId,
      ts: BigInt(m.ts),
      payloadHash: keccak256(m.payload),
    },
  };
  return checkSignature(hash, m.author, m.sig, m.ts, body);
}
