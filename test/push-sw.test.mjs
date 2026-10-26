import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";
import { BLOCK, BOB, config, CONV, id, logs, PLATFORM, proof } from "./push-fixtures.mjs";

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
const SCOPE = "https://arobase.chat/";

function worker({ cfg = config(), receipt } = {}) {
  const store = new Map();
  const shown = [];
  const handlers = {};
  if (cfg) store.set(`${SCOPE}__arobase/sw-config`, JSON.stringify(cfg));
  const self = {
    registration: {
      scope: SCOPE,
      showNotification: async (title, opts) => shown.push({ title, ...opts }),
      getNotifications: async () => shown,
    },
    clients: { matchAll: async () => [] },
    navigator: {},
    addEventListener: (type, fn) => (handlers[type] = fn),
  };
  const caches = {
    open: async () => ({
      match: async (url) => (store.has(url) ? new Response(store.get(url)) : undefined),
      put: async (url, res) => store.set(url, await res.text()),
    }),
  };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.method, "eth_getTransactionReceipt");
    const result = receipt ? { status: "0x1", blockNumber: `0x${BLOCK.toString(16)}`, logs: [{ ...receipt, logIndex: "0x2" }] } : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  const context = vm.createContext({ self, caches, fetch, crypto, BigInt, DataView, Uint8Array, Response, AbortSignal, TextDecoder, Date, JSON, Math, Number, String, URL });
  context.importScripts = (f) => vm.runInContext(read(f), context);
  vm.runInContext(read("push-sw.js"), context);
  const push = async (payload) => {
    let done;
    handlers.push({ data: { json: () => payload }, waitUntil: (p) => (done = p) });
    await done;
    return shown.at(-1);
  };
  return { push, shown };
}

describe("push service worker", () => {
  it("shows a verified notification with fixed texts and an internal link", async () => {
    const w = worker({ receipt: logs.notify() });
    const n = await w.push({ t: "mention", from: BOB, name: "bob", post: id(1), n: 1, lang: "fr", p: proof() });
    assert.equal(n.title, "Nouvelle mention");
    assert.equal(n.body, "@bob vous a mentionné");
    assert.equal(n.data.url, `https://arobase.chat/p/${id(1)}`);
  });

  it("falls back to a generic notification when the proof does not match", async () => {
    const w = worker({ receipt: logs.notify({ reason: 2 }) });
    const n = await w.push({ t: "mention", from: BOB, post: id(1), p: proof() });
    assert.equal(n.title, "arobase.chat");
    assert.equal(n.body, "Nouvelle activité sur arobase.chat.");
    assert.equal(n.tag, "generic");
  });

  it("falls back to a generic notification without proof, config or valid payload", async () => {
    assert.equal((await worker({ receipt: logs.notify() }).push({ t: "mention", from: BOB, post: id(1) })).tag, "generic");
    assert.equal((await worker({ cfg: null, receipt: logs.notify() }).push({ t: "mention", from: BOB, post: id(1), p: proof() })).tag, "generic");
    assert.equal((await worker({ receipt: logs.notify() }).push({ t: "<script>", x: "pwned" })).tag, "generic");
  });

  it("never displays relay-supplied text: names are validated, announcements come from the chain", async () => {
    const w = worker({ receipt: logs.notify() });
    const n = await w.push({ t: "mention", from: BOB, name: "Compte suspendu: evil.com", post: id(1), p: proof() });
    assert.equal(n.body, `${BOB.slice(0, 6)}…${BOB.slice(-4)} vous a mentionné`);
    const a = worker({ receipt: logs.message() });
    const ann = await a.push({ t: "announcement", from: PLATFORM, post: id(9), x: "Entrez votre clé ici", p: proof() });
    assert.equal(ann.title, "Annonce de arobase.chat");
    assert.equal(ann.body, "Maintenance ce soir à 22h");
  });

  it("links a direct message to the conversation found by its tag, never to a relay-supplied one", async () => {
    const w = worker({ receipt: logs.encrypted() });
    const n = await w.push({ t: "dm", conv: id(666), p: proof() });
    assert.equal(n.title, "Nouveau message privé");
    assert.equal(n.data.url, `https://arobase.chat/messages/${CONV}`);
    assert.equal(n.tag, `dm:${CONV}`);
    const forged = await worker({ receipt: logs.encrypted({ tag: id(7) }) }).push({ t: "dm", conv: CONV, p: proof() });
    assert.equal(forged.tag, "generic");
  });

  it("collapses a flood of notifications into a single one", async () => {
    const w = worker({ receipt: logs.notify() });
    for (let i = 0; i < 25; i++) await w.push({ t: "mention", from: BOB, post: id(1), p: { ...proof(), tx: id(1000 + i) } });
    const last = w.shown.at(-1);
    assert.equal(last.tag, "overflow");
    assert.match(last.body, /^\d+ nouvelles notifications/);
    assert.equal(w.shown.filter((n) => n.tag !== "overflow").length, 20);
  });
});
