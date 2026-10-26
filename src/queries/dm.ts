import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bytesToHex, createPublicClient, getAbiItem, hexToBytes, http, keccak256, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256 } from "@noble/hashes/sha2.js";
import { inboxAbi, socialAbi } from "@/abi";
import { currentEnc, currentSender, requireSigner, useViewer } from "@/identity/store";
import { primaryContent, type Network, type Networks } from "@/lib/chains";
import type { AppConfig } from "@/lib/config";
import {
  bucketOf,
  checkEnvelope,
  convIdOf,
  decryptWith,
  directConvKey,
  encryptFor,
  openEnvelope,
  randomKey,
  sealEnvelope,
  tagAt,
  tagKeyOf,
  type EnvelopeBody,
} from "@/lib/crypto";
import { db, kvGet, kvSet, type Conversation, type DirectMessage } from "@/lib/db";
import { signPrivate, ZERO32, type PrivateMessage } from "@/lib/protocol";
import { getLogsChunked } from "@/lib/reader";
import { sponsorFor } from "@/lib/sponsor";
import { write } from "@/lib/tx";
import { verifier } from "@/lib/workers";
import { getNetworks, useConfig, useNetworks } from "./core";
import { qk } from "./keys";
import { tr } from "@/lib/i18n";

const inviteEvent = getAbiItem({ abi: inboxAbi, name: "Invite" });
const encryptedEvent = getAbiItem({ abi: inboxAbi, name: "Encrypted" });

type Inner = PrivateMessage & { sys?: "add" | "remove" | "rotate"; member?: Address };

const MAX_TOPICS = 100;

const startBlock = (config: AppConfig, chainId: number) => BigInt(config.params.deployBlocks?.[String(chainId)] ?? 0);

const sameAddr = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export class KeyMismatchError extends Error {}

const encKeyCache = new Map<string, Promise<Hex>>();

export function trustedEncKey(networks: Networks, config: AppConfig, user: Address): Promise<Hex> {
  const key = `${networks.social.cfg.chainId}:${user.toLowerCase()}`;
  let p = encKeyCache.get(key);
  if (!p) {
    p = readEncKeyQuorum(networks, config, user);
    encKeyCache.set(key, p);
    p.catch(() => encKeyCache.delete(key));
    setTimeout(() => encKeyCache.delete(key), 5 * 60_000);
  }
  return p;
}

async function readEncKeyQuorum(networks: Networks, config: AppConfig, user: Address): Promise<Hex> {
  const urls = networks.social.cfg.rpcs.slice(0, 4);
  const answers = await Promise.all(
    urls.map((url) =>
      createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 1 }) })
        .readContract({ address: config.social, abi: socialAbi, functionName: "encKey", args: [user] })
        .then((k) => k.toLowerCase() as Hex)
        .catch(() => undefined),
    ),
  );
  const got = answers.filter((a): a is Hex => !!a);
  if (!got.length) return (await networks.social.client.readContract({ address: config.social, abi: socialAbi, functionName: "encKey", args: [user] })).toLowerCase() as Hex;
  if (new Set(got).size > 1) throw new KeyMismatchError(tr("Les RPC ne s'accordent pas sur la clé de chiffrement de ce compte. Conversation bloquée par sécurité."));
  return got[0];
}

async function applyEnvelope(body: EnvelopeBody, net: Network, block: number, me: Address, prev: Conversation | undefined) {
  const peer =
    body.t === "dm" ? (sameAddr(body.from, me) ? (prev?.peer ?? body.members?.find((m) => !sameAddr(m, me))) : body.from) : undefined;
  const owner = body.t === "group" ? (prev?.owner ?? body.owner ?? body.from) : undefined;
  const conv: Conversation = {
    id: body.convId,
    type: body.t,
    chainId: prev?.chainId ?? net.cfg.chainId,
    name: body.name ?? prev?.name,
    peer: peer ?? prev?.peer,
    owner,
    members: body.members ?? prev?.members ?? (peer ? [me, peer] : [me]),
    epoch: Math.max(prev?.epoch ?? 0, body.epoch),
    keys: { ...prev?.keys, [body.epoch]: body.convKey },
    createdAt: prev?.createdAt ?? Date.now() / 1000,
    lastTs: prev?.lastTs ?? Date.now() / 1000,
    lastText: prev?.lastText,
    readTs: prev?.readTs ?? 0,
    fromBlock: Math.min(prev?.fromBlock ?? block, block),
  };
  await db.convs.put(conv);
}

function acceptable(body: EnvelopeBody, prev: Conversation | undefined, me: Address) {
  if (body.epoch === 0 && convIdOf(body.convKey) !== body.convId) return false;
  if (!prev) {
    if (body.t === "dm") return body.epoch === 0 && (!body.members || body.members.length <= 2);
    return body.members?.some((m) => sameAddr(m, me)) ?? false;
  }
  if (prev.type !== body.t) return false;
  if (prev.type === "dm") return body.epoch === 0 && sameAddr(body.convId, prev.id);
  if (!sameAddr(body.from, prev.owner)) return body.epoch <= prev.epoch && !body.members && !body.name && prev.keys[body.epoch] === body.convKey;
  return true;
}

const inboxChains = (networks: Networks) =>
  (networks.free.length ? networks.free : networks.content).filter(
    (n) => n.cfg.inbox && n.cfg.inbox !== "0x0000000000000000000000000000000000000000",
  );

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

async function syncInvites(networks: Networks, config: AppConfig, me: Address, secret: Uint8Array) {
  await Promise.allSettled(
    inboxChains(networks).map(async (net) => {
      const cursorKey = `invites:${net.cfg.chainId}:${me.toLowerCase()}`;
      const from = (await kvGet<string>(cursorKey)) ?? String(startBlock(config, net.cfg.chainId));
      const latest = await net.client.getBlockNumber();
      if (BigInt(from) > latest) return;
      const logs = await getLogsChunked(
        (f, t) => net.client.getLogs({ address: net.cfg.inbox, event: inviteEvent, fromBlock: f, toBlock: t, strict: true }),
        BigInt(from),
        latest,
        10_000n,
      );
      for (const log of logs) {
        const body = openEnvelope(secret, log.args.envelope);
        if (!body || !checkEnvelope(secret, body)) continue;
        const senderKey = await trustedEncKey(networks, config, body.from).catch(() => undefined);
        if (!senderKey || senderKey !== body.fromEnc.toLowerCase()) continue;
        const prev = await db.convs.get(body.convId);
        if (!acceptable(body, prev, me)) continue;
        await applyEnvelope(body, net, Number(log.blockNumber), me, prev);
      }
      await kvSet(cursorKey, String(latest + 1n));
    }),
  );
}

type TagRef = { conv: Conversation; epoch: number; key: Hex };

function tagIndex(list: Conversation[], from: bigint, to: bigint) {
  const map = new Map<Hex, TagRef>();
  for (const conv of list) {
    for (const [epoch, key] of Object.entries(conv.keys)) {
      const tk = tagKeyOf(key);
      for (let b = bucketOf(from) > 0n ? bucketOf(from) - 1n : 0n; b <= bucketOf(to); b++) map.set(tagAt(tk, b), { conv, epoch: Number(epoch), key });
    }
  }
  return map;
}

async function syncMessages(networks: Networks, config: AppConfig, me: Address) {
  const convs = await db.convs.toArray();
  const byChain = new Map<number, Conversation[]>();
  for (const c of convs) byChain.set(c.chainId, [...(byChain.get(c.chainId) ?? []), c]);
  await Promise.allSettled(
    [...byChain.entries()].map(async ([chainId, list]) => {
      const net = networks.byId.get(chainId);
      if (!net) return;
      const latest = await net.client.getBlockNumber();
      const cursors = await Promise.all(list.map((c) => kvGet<string>(`dm:${c.id}`)));
      const from = list.reduce((min, c, i) => {
        const b = BigInt(cursors[i] ?? c.fromBlock ?? startBlock(config, chainId));
        return b < min ? b : min;
      }, latest + 1n);
      if (from > latest) return;
      const found: { ref: TagRef; ciphertext: Hex }[] = [];
      await getLogsChunked(
        async (f, t) => {
          const index = tagIndex(list, f, t);
          const logs = (
            await Promise.all(
              chunk([...index.keys()], MAX_TOPICS).map((tag) =>
                net.client.getLogs({ address: net.cfg.inbox, event: encryptedEvent, args: { tag }, fromBlock: f, toBlock: t, strict: true }),
              ),
            )
          ).flat();
          for (const log of logs) {
            const ref = index.get(log.args.tag);
            const tk = ref && tagKeyOf(ref.key);
            const b = bucketOf(log.blockNumber);
            if (ref && tk && (tagAt(tk, b) === log.args.tag || (b > 0n && tagAt(tk, b - 1n) === log.args.tag))) found.push({ ref, ciphertext: log.args.ciphertext });
          }
          return [];
        },
        from,
        latest,
        10_000n,
      );
      const decoded: { conv: Conversation; inner: Inner }[] = [];
      for (const { ref, ciphertext } of found) {
        const inner = decryptWith<Inner>(hexToBytes(ref.key), ciphertext);
        if (inner?.a && inner.p && inner.s) decoded.push({ conv: ref.conv, inner });
      }
      const verdicts = await verifier.verifyPrivateMany(decoded.map(({ conv, inner }) => ({ m: { a: inner.a, p: inner.p, s: inner.s }, conv: conv.id })));
      const dms: DirectMessage[] = decoded.map(({ conv, inner }, i) => {
        const v = verdicts[i];
        const body = v.ok ? v.body : null;
        const member =
          conv.type === "dm" ? !conv.peer || sameAddr(inner.a, me) || sameAddr(inner.a, conv.peer) : conv.members.some((m) => sameAddr(m, inner.a));
        return {
          id: keccak256(inner.s),
          convId: conv.id,
          from: inner.a,
          text: body?.text ?? "",
          ts: body?.ts ?? 0,
          status: v.ok && member ? "confirmed" : "invalid",
        };
      });
      await db.dms.bulkPut(dms);
      for (const c of list) {
        const last = dms.filter((d) => d.convId === c.id && d.status === "confirmed").sort((a, b) => b.ts - a.ts)[0];
        if (last)
          await db.convs.update(c.id, {
            lastTs: Math.max(last.ts, c.lastTs),
            lastText: last.ts >= c.lastTs ? last.text : c.lastText,
            ...(sameAddr(last.from, me) && last.ts >= c.readTs ? { readTs: last.ts } : {}),
          });
        await kvSet(`dm:${c.id}`, String(latest + 1n));
      }
    }),
  );
}

let syncing: Promise<void> | undefined;

function syncInbox(networks: Networks, config: AppConfig, me: Address) {
  const enc = currentEnc();
  if (!enc) return Promise.resolve();
  syncing ??= (async () => {
    await syncInvites(networks, config, me, enc.secret);
    await syncMessages(networks, config, me);
  })().finally(() => (syncing = undefined));
  return syncing;
}

function useConversationList<T = Conversation[]>(select?: (list: Conversation[]) => T) {
  const me = useViewer();
  return useQuery({
    queryKey: qk.convs(me ?? "0x0"),
    enabled: !!me,
    meta: { persist: false },
    queryFn: () => db.convs.orderBy("lastTs").reverse().toArray(),
    select,
  });
}

export function conversationTagKeys(list: Conversation[]) {
  const out: Record<Hex, Hex> = {};
  for (const c of list) for (const key of Object.values(c.keys)) out[bytesToHex(tagKeyOf(key))] = c.id;
  return out;
}

export function useConversationTagKeys() {
  return useConversationList(conversationTagKeys).data;
}

export function useInboxSync(interval = 8_000) {
  const networks = useNetworks();
  const config = useConfig();
  const me = useViewer();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["inbox-sync", me, networks.key],
    enabled: !!me,
    refetchInterval: interval,
    meta: { persist: false },
    queryFn: async () => {
      await withTimeout(syncInbox(networks, config, me!), 25_000);
      await qc.invalidateQueries({ queryKey: qk.convs(me!) });
      return Date.now();
    },
  });
}

export function useConversations() {
  const list = useConversationList();
  const sync = useInboxSync();
  return { ...list, syncing: sync.isFetching && !sync.data };
}

export async function backgroundInboxSync(networks: Networks, config: AppConfig, me: Address) {
  await withTimeout(syncInbox(networks, config, me), 25_000);
}

export function useDirectMessages(convId: Hex | undefined) {
  return useQuery({
    queryKey: qk.dms(convId ?? "0x"),
    enabled: !!convId,
    meta: { persist: false },
    queryFn: () =>
      db.dms
        .where("[convId+ts]")
        .between([convId!, 0], [convId!, Number.MAX_SAFE_INTEGER])
        .toArray(),
  });
}

export async function safetyCode(networks: Networks, config: AppConfig, peer: Address) {
  const mine = bytesToHex(currentEnc()!.publicKey).toLowerCase();
  const theirs = await trustedEncKey(networks, config, peer);
  if (theirs === ZERO32) throw new Error(tr("Ce compte n'a pas encore publié de clé de chiffrement."));
  const digest = sha256(new Uint8Array([...[mine, theirs].sort().flatMap((k) => [...hexToBytes(k as Hex)])]));
  const digits = Array.from(digest.slice(0, 15), (b) => String(b % 100).padStart(2, "0")).join("");
  return digits.match(/.{5}/g)!.join(" ");
}

async function peerEncKey(networks: Networks, config: AppConfig, peer: Address) {
  const key = await trustedEncKey(networks, config, peer);
  if (key === ZERO32) throw new Error(tr("Ce compte n'a pas encore publié de clé de chiffrement."));
  return hexToBytes(key);
}

function inboxSender(config: AppConfig, chainId: number): LocalAccount {
  return sponsorFor(config.params, chainId) ? privateKeyToAccount(generatePrivateKey()) : currentSender()!;
}

async function sendInvites(net: Network, config: AppConfig, targets: { pub: Uint8Array; body: EnvelopeBody }[]) {
  const secret = currentEnc()!.secret;
  const envelopes = targets.map((t) => sealEnvelope(secret, t.pub, t.body));
  for (let i = envelopes.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [envelopes[i], envelopes[j]] = [envelopes[j], envelopes[i]];
  }
  await write({
    net,
    account: inboxSender(config, net.cfg.chainId),
    params: config.params,
    label: tr("Invitation chiffrée"),
    address: net.cfg.inbox,
    abi: inboxAbi,
    functionName: "invite",
    args: [envelopes],
  });
}

export function useStartConversation() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  return useMutation({
    mutationFn: async (input: { peers: Address[]; name?: string }) => {
      const signer = await requireSigner();
      const enc = currentEnc()!;
      const me = signer.author;
      const net = primaryContent(networks);
      const peers = [...new Set(input.peers.map((p) => p.toLowerCase() as Address))].filter((p) => p !== me.toLowerCase());
      if (!peers.length) throw new Error(tr("Ajoutez au moins un destinataire."));
      const pubs = await Promise.all(peers.map((p) => peerEncKey(networks, config, p)));
      const isDm = peers.length === 1 && !input.name;
      const convKey = isDm ? directConvKey(enc.secret, pubs[0]) : randomKey();
      const convId = convIdOf(convKey);
      const members = [me, ...peers] as Address[];
      const body: EnvelopeBody = {
        t: isDm ? "dm" : "group",
        from: me,
        fromEnc: bytesToHex(enc.publicKey),
        convKey: bytesToHex(convKey),
        convId,
        epoch: 0,
        ...(isDm ? { members } : { name: input.name || "Groupe", members, owner: me }),
      };
      const existing = await db.convs.get(convId);
      if (!existing) {
        await sendInvites(net, config, [{ pub: enc.publicKey, body }, ...pubs.map((pub) => ({ pub, body }))]);
        const block = Number(await net.client.getBlockNumber());
        await applyEnvelope(body, net, block, me, undefined);
        if (isDm) await db.convs.update(convId, { peer: peers[0], members });
      }
      await qc.invalidateQueries({ queryKey: qk.convs(me) });
      return convId;
    },
  });
}

async function sendInner(net: Network, config: AppConfig, conv: Conversation, inner: Inner) {
  const key = conv.keys[conv.epoch];
  const tag = tagAt(tagKeyOf(key), bucketOf(await net.client.getBlockNumber()));
  await write({
    net,
    account: inboxSender(config, net.cfg.chainId),
    params: config.params,
    label: tr("Message privé"),
    address: net.cfg.inbox,
    abi: inboxAbi,
    functionName: "send",
    args: [tag, encryptFor(hexToBytes(key), inner)],
  });
}

export function useSendDm() {
  const qc = useQueryClient();
  const config = useConfig();
  return useMutation({
    mutationFn: async ({ conv, text }: { conv: Conversation; text: string }) => {
      const networks = getNetworks()!;
      const net = networks.byId.get(conv.chainId);
      if (!net) throw new Error(tr("Chain de la conversation indisponible."));
      const signer = await requireSigner();
      const m = await signPrivate(signer, conv.id, text);
      const dm: DirectMessage = { id: m.id, convId: conv.id, from: signer.author, text, ts: m.ts, status: "pending" };
      await db.dms.put(dm);
      await db.convs.update(conv.id, { lastTs: m.ts, lastText: text, readTs: m.ts });
      void qc.invalidateQueries({ queryKey: qk.dms(conv.id) });
      try {
        await sendInner(net, config, conv, { a: m.a, p: m.p, s: m.s });
        await db.dms.update(dm.id, { status: "confirmed" });
      } catch (err) {
        await db.dms.update(dm.id, { status: "failed" });
        throw err;
      } finally {
        void qc.invalidateQueries({ queryKey: qk.dms(conv.id) });
      }
    },
  });
}

export function useGroupMembers() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  return useMutation({
    mutationFn: async ({ conv, add, remove }: { conv: Conversation; add?: Address; remove?: Address }) => {
      const signer = await requireSigner();
      const enc = currentEnc()!;
      const net = networks.byId.get(conv.chainId)!;
      const me = signer.author;
      if (!sameAddr(conv.owner, me)) throw new Error(tr("Seul le créateur du groupe peut modifier ses membres."));
      let members = conv.members;
      let epoch = conv.epoch;
      let key = conv.keys[epoch];
      if (add) members = [...new Set([...members, add])];
      if (remove) {
        members = members.filter((m) => !sameAddr(m, remove));
        epoch += 1;
        key = bytesToHex(randomKey());
      }
      const pubs = await Promise.all(
        members.map((r) => (sameAddr(r, me) ? Promise.resolve(enc.publicKey) : peerEncKey(networks, config, r))),
      );
      const body: EnvelopeBody = {
        t: "group",
        from: me,
        fromEnc: bytesToHex(enc.publicKey),
        convKey: key,
        convId: conv.id,
        epoch,
        name: conv.name,
        members,
        owner: me,
      };
      await sendInvites(net, config, pubs.map((pub) => ({ pub, body })));
      const updated: Conversation = { ...conv, members, epoch, keys: { ...conv.keys, [epoch]: key } };
      await db.convs.put(updated);
      const sys = await signPrivate(signer, conv.id, add ? `a ajouté ${add}` : `a retiré ${remove}`);
      await sendInner(net, config, updated, { a: sys.a, p: sys.p, s: sys.s, sys: add ? "add" : "remove", member: add ?? remove });
      await qc.invalidateQueries({ queryKey: qk.convs(me) });
    },
  });
}
