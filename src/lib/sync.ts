import { bytesToHex, getAbiItem, hexToBytes, stringToHex, type Address, type Hex } from "viem";
import { vaultAbi } from "@/abi";
import { currentEnc, currentSender, requireSigner } from "@/identity/store";
import type { Networks } from "./chains";
import type { AppConfig } from "./config";
import { decryptWith, derive, encryptFor } from "./crypto";
import { db, kvGet, kvSet } from "./db";
import { signSave } from "./protocol";
import { useSafety, type Flag } from "./safety";
import { write } from "./tx";
import { tr } from "./i18n";

const savedEvent = getAbiItem({ abi: vaultAbi, name: "Saved" });
const SLOT = stringToHex("sync", { size: 32 });
const MAX_BYTES = 15_000;

type Snapshot = { v: 1; ts: number; b: [Hex, number, 0 | 1][]; m: [string, number, 0 | 1][]; k: [string, number, 0 | 1][] };

const lc = (a: string) => a.toLowerCase();

function syncKey() {
  const enc = currentEnc();
  return enc ? derive(enc.secret, "arobase:sync:key") : null;
}

function vaultOf(networks: Networks, config: AppConfig) {
  const v = config.params.vault;
  const net = v && networks.byId.get(v.chainId);
  return v && net ? { net, address: v.address } : undefined;
}

async function deflate(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return bytesToHex(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function inflate(hex: Hex) {
  const stream = new Blob([hexToBytes(hex) as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const toFlags = (rows: [string, number, 0 | 1][]) => Object.fromEntries(rows.map(([a, ts, on]) => [lc(a), { ts, on: on === 1 } as Flag]));
const fromFlags = (flags: Record<string, Flag>) => Object.entries(flags).map(([a, f]) => [a, f.ts, f.on ? 1 : 0] as [string, number, 0 | 1]);

async function localSnapshot(me: Address): Promise<Snapshot> {
  const owner = lc(me);
  const rows = await db.bookmarks.where("[me+ts]").between([owner, 0], [owner, Number.MAX_SAFE_INTEGER]).reverse().toArray();
  const lists = useSafety.getState().byUser[owner] ?? { muted: {}, blocked: {} };
  return {
    v: 1,
    ts: Date.now(),
    b: rows.map((r) => [r.postId, r.ts, r.removed ? 0 : 1]),
    m: fromFlags(lists.muted),
    k: fromFlags(lists.blocked),
  };
}

async function applySnapshot(me: Address, snap: Snapshot) {
  const owner = lc(me);
  let changed = useSafety.getState().merge(me, { muted: toFlags(snap.m ?? []), blocked: toFlags(snap.k ?? []) });
  const ids = (snap.b ?? []).map(([id]) => `${owner}:${id}`);
  const existing = await db.bookmarks.bulkGet(ids);
  const updates = (snap.b ?? [])
    .map(([postId, ts, on], i) => ({ prev: existing[i], row: { id: ids[i], me: owner, postId, ts, removed: on === 0 } }))
    .filter(({ prev, row }) => !prev || prev.ts < row.ts)
    .map(({ row }) => row);
  if (updates.length) {
    await db.bookmarks.bulkPut(updates);
    changed = true;
  }
  return changed;
}

export async function pullSync(networks: Networks, config: AppConfig, me: Address) {
  const key = syncKey();
  const vault = vaultOf(networks, config);
  if (!key || !vault) return false;
  const entry = await vault.net.client.readContract({ address: vault.address, abi: vaultAbi, functionName: "entry", args: [me, SLOT] });
  const seenKey = `sync:${lc(me)}:${vault.address}`;
  if (entry.version === 0n || entry.version <= BigInt((await kvGet<string>(seenKey)) ?? "0")) return false;
  const logs = await vault.net.client.getLogs({
    address: vault.address,
    event: savedEvent,
    args: { author: me, key: SLOT },
    fromBlock: entry.blockNumber,
    toBlock: entry.blockNumber,
    strict: true,
  });
  const log = logs.find((l) => l.args.version === entry.version);
  if (!log) return false;
  await kvSet(seenKey, String(entry.version));
  const wrapped = decryptWith<{ z: Hex }>(key, log.args.data);
  if (!wrapped?.z) return false;
  try {
    const snap = JSON.parse(await inflate(wrapped.z)) as Snapshot;
    return snap.v === 1 && (await applySnapshot(me, snap));
  } catch {
    return false;
  }
}

export async function pushSync(networks: Networks, config: AppConfig, me: Address) {
  const key = syncKey();
  const vault = vaultOf(networks, config);
  const account = currentSender();
  if (!key || !vault || !account) return;
  await pullSync(networks, config, me);
  const snap = await localSnapshot(me);
  let z = await deflate(JSON.stringify(snap));
  while ((z.length - 2) / 2 > MAX_BYTES && snap.b.length) {
    const tomb = snap.b.findLastIndex((b) => b[2] === 0);
    snap.b.splice(tomb >= 0 ? tomb : snap.b.length - 1, 1);
    z = await deflate(JSON.stringify(snap));
  }
  const data = encryptFor(key, { z });
  const entry = await vault.net.client.readContract({ address: vault.address, abi: vaultAbi, functionName: "entry", args: [me, SLOT] });
  const version = entry.version + 1n;
  const signer = await requireSigner();
  const sig = await signSave(signer, SLOT, version, data);
  await write({
    net: vault.net,
    account,
    params: config.params,
    label: tr("Synchronisation chiffrée"),
    address: vault.address,
    abi: vaultAbi,
    functionName: "save",
    args: [me, SLOT, version, data, sig],
    silent: true,
  });
  await kvSet(`sync:${lc(me)}:${vault.address}`, String(version));
}
