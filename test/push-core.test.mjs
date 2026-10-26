import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "../public/push-core.js";
import { BLOCK, BOB, config, CONV, id, logs, ME, PLATFORM, proof, receiptRpc, TAG_KEY, tagFor } from "./push-fixtures.mjs";

const P = globalThis.arobasePush;

describe("sanitize", () => {
  it("keeps well-formed notifications", () => {
    const d = P.sanitize({ t: "mention", from: BOB, post: id(1), n: 3, name: "bob_42", h: 1, lang: "en", p: proof() });
    assert.deepEqual(d, { t: "mention", from: BOB, post: id(1), n: 3, name: "bob_42", h: 1, lang: "en", p: proof() });
  });

  it("rejects unknown types and malformed identifiers", () => {
    assert.equal(P.sanitize(null), null);
    assert.equal(P.sanitize({ t: "phishing", from: BOB, post: id(1) }), null);
    assert.equal(P.sanitize({ t: "mention", from: "0x123", post: id(1) }), null);
    assert.equal(P.sanitize({ t: "mention", from: BOB, post: "../reglages" }), null);
    assert.equal(P.sanitize({ t: "invite", p: proof() }), null);
    assert.equal(P.sanitize({ t: "dm", conv: "//evil.com" }).conv, undefined);
    assert.equal(P.sanitize({ t: "follow" }), null);
  });

  it("drops a name that is not a valid username, instead of showing it", () => {
    const d = P.sanitize({ t: "like", from: BOB, post: id(1), name: "Votre compte est suspendu, allez sur evil.com" });
    assert.equal(d.name, undefined);
  });

  it("clamps the counter and ignores a malformed proof", () => {
    assert.equal(P.sanitize({ t: "like", from: BOB, post: id(1), n: 1e9 }).n, 999);
    assert.equal(P.sanitize({ t: "like", from: BOB, post: id(1), n: -4 }).n, 1);
    assert.equal(P.sanitize({ t: "like", from: BOB, post: id(1), p: { c: "x", tx: "0x1", i: -1 } }).p, undefined);
  });
});

describe("cleanText", () => {
  it("removes links, control and direction-override characters, and caps the length", () => {
    assert.equal(P.cleanText("Hello‮ world https://evil.example/login www.evil.example"), "Hello world");
    assert.equal(P.cleanText("a\u0000b\nc"), "a b c");
    assert.equal(P.cleanText("x".repeat(500)).length, 140);
    assert.equal(P.cleanText("   "), undefined);
    assert.equal(P.cleanText(42), undefined);
  });
});

describe("pathOf", () => {
  it("only builds internal paths from validated identifiers", () => {
    assert.equal(P.pathOf({ t: "dm", conv: id(2) }), `/messages/${id(2)}`);
    assert.equal(P.pathOf({ t: "follow", from: BOB }), `/u/${BOB}`);
    assert.equal(P.pathOf({ t: "like", post: id(3) }), `/p/${id(3)}`);
  });
});

const d = (over) => P.sanitize({ t: "mention", from: BOB, post: id(1), p: proof(), ...over });

describe("verify: onchain proof", () => {
  it("accepts a notification backed by the matching event", async () => {
    const rpc = receiptRpc(logs.notify());
    assert.deepEqual(await P.verify(d(), config(), rpc), { ok: true, text: undefined });
    assert.deepEqual(rpc.calls[0], { chainId: 5042, method: "eth_getTransactionReceipt", params: [proof().tx] });
  });

  it("rejects an event addressed to someone else", async () => {
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify({ to: BOB })))).ok, false);
  });

  it("rejects a mismatched reason, author, post or contract", async () => {
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify({ reason: 2 })))).ok, false);
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify({ from: ME })))).ok, false);
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify({ post: id(99) })))).ok, false);
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify({ address: "0x00000000000000000000000000000000000000ee" })))).ok, false);
  });

  it("rejects a reverted transaction, a wrong log index, or a missing proof", async () => {
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify(), { status: "0x0" }))).reason, "no-receipt");
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify(), { logIndex: 5 }))).reason, "mismatch");
    assert.equal((await P.verify(d({ p: undefined }), config(), receiptRpc(logs.notify()))).reason, "no-proof");
    assert.equal((await P.verify(d(), config({ me: null }), receiptRpc(logs.notify()))).reason, "no-proof");
    assert.equal((await P.verify(d(), config(), receiptRpc(logs.notify(), { fail: true }))).reason, "unreachable");
  });

  it("checks follows and likes on the social chain", async () => {
    const follow = P.sanitize({ t: "follow", from: BOB, p: proof(100) });
    assert.equal((await P.verify(follow, config(), receiptRpc(logs.acted()))).ok, true);
    assert.equal((await P.verify(follow, config(), receiptRpc(logs.acted({ value: 0 })))).ok, false);
    assert.equal((await P.verify(follow, config(), receiptRpc(logs.acted({ tgt: `0x${BOB.slice(2).padStart(64, "0")}` })))).ok, false);
    const like = P.sanitize({ t: "like", from: BOB, post: id(4), p: proof(100) });
    assert.equal((await P.verify(like, config(), receiptRpc(logs.acted({ kind: 10, tgt: id(4) })))).ok, true);
    assert.equal((await P.verify(like, config(), receiptRpc(logs.acted({ kind: 11, tgt: id(4) })))).ok, false);
    assert.equal((await P.verify({ ...like, p: proof(5042) }, config(), receiptRpc(logs.acted({ kind: 10, tgt: id(4) })))).ok, false);
  });

  it("only trusts announcements from the platform account, with the text read onchain", async () => {
    const ann = P.sanitize({ t: "announcement", from: PLATFORM, post: id(9), x: "texte inventé par le relais", p: proof() });
    assert.deepEqual(await P.verify(ann, config(), receiptRpc(logs.message())), { ok: true, text: "Maintenance ce soir à 22h" });
    assert.equal((await P.verify({ ...ann, from: BOB }, config(), receiptRpc(logs.message({ author: BOB })))).ok, false);
    assert.equal((await P.verify(ann, config(), receiptRpc(logs.message({ author: BOB })))).ok, false);
    assert.equal((await P.verify(ann, config({ platform: null }), receiptRpc(logs.message()))).ok, false);
    const phishing = await P.verify(ann, config(), receiptRpc(logs.message({ text: "Cliquez https://evil.example vite" })));
    assert.equal(phishing.text, "Cliquez vite");
  });

  it("resolves a direct message to a conversation only through its rotating tag", async () => {
    const dm = P.sanitize({ t: "dm", conv: id(999), p: proof() });
    assert.deepEqual(await P.verify(dm, config(), receiptRpc(logs.encrypted())), { ok: true, conv: CONV });
    const previous = logs.encrypted({ tag: tagFor(TAG_KEY, Math.floor(BLOCK / 4096) - 1) });
    assert.equal((await P.verify(dm, config(), receiptRpc(previous))).conv, CONV);
    const stale = logs.encrypted({ tag: tagFor(TAG_KEY, Math.floor(BLOCK / 4096) - 2) });
    assert.equal((await P.verify(dm, config(), receiptRpc(stale))).ok, false);
    assert.equal((await P.verify(dm, config(), receiptRpc(logs.encrypted({ tag: id(5) })))).ok, false);
    assert.equal((await P.verify(dm, config({ tk: {} }), receiptRpc(logs.encrypted()))).ok, false);
    assert.equal((await P.verify(dm, config(), receiptRpc(logs.invite()))).ok, false);
  });

  it("derives the same tags as the app", async () => {
    const key = Uint8Array.from(Buffer.from(TAG_KEY.slice(2), "hex"));
    assert.equal(await P.tagAt(key, 244n), tagFor(TAG_KEY, 244));
  });
});

describe("throttle", () => {
  it(`allows ${20} notifications per hour, then collapses the rest`, () => {
    let state = {};
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < P.MAX_PER_HOUR; i++) {
      const r = P.throttle(state, t0 + i, `k${i}`);
      assert.equal(r.over, false);
      state = r.state;
    }
    const over = P.throttle(state, t0 + 100, "k-over");
    assert.equal(over.over, true);
    assert.equal(over.state.overflow, 1);
    const later = P.throttle(over.state, t0 + 3_600_001 + 100, "k-later");
    assert.equal(later.over, false);
  });

  it("does not count a replayed proof twice", () => {
    const first = P.throttle({}, 1, "same");
    const again = P.throttle(first.state, 2, "same");
    assert.equal(again.duplicate, true);
    assert.equal(again.state.times.length, 1);
  });
});
