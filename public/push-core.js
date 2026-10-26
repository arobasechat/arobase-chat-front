(function (g) {
  const TYPES = ["mention", "reply", "note", "repost", "quote", "like", "follow", "dm", "announcement"];
  const ADDR = /^0x[0-9a-fA-F]{40}$/;
  const ID = /^0x[0-9a-fA-F]{64}$/;
  const TX = /^0x[0-9a-fA-F]{64}$/;
  const HANDLE = /^[a-z0-9_]{3,20}$/;
  const TOPICS = {
    Notify: "0x036d6acc1f3876e6b0fe1e7ba730ddf897de780a9422820a90022ed905a13a85",
    Acted: "0xcf533ccf15571bc915e28400f9db69c27f362003a99785737d4c76b5f354a241",
    Message: "0x1861b61e33e46701aede92c342b1aa243a8a1e12b8679de3e1ee71ae032f77ee",
    Encrypted: "0x9c8c77d44f5bf876fb283f9e9a6b6ea791f047a24381de0990f4415a6fe99961",
  };
  const REASON = { mention: 1, reply: 2, note: 3, repost: 4, quote: 5 };
  const KIND = { POST: 0, REACT: 10, FOLLOW: 11 };
  const MAX_PER_HOUR = 20;
  const MAX_TEXT = 140;
  const TAG_BUCKET = 4096n;

  const lc = (s) => String(s).toLowerCase();
  const word = (hex) => "0x" + lc(hex).replace(/^0x/, "").padStart(64, "0");
  const uintWord = (n) => "0x" + Number(n).toString(16).padStart(64, "0");
  const same = (a, b) => typeof a === "string" && typeof b === "string" && lc(a) === lc(b);

  function cleanText(text) {
    if (typeof text !== "string") return undefined;
    const out = text
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!out) return undefined;
    return out.length > MAX_TEXT ? out.slice(0, MAX_TEXT - 1) + "…" : out;
  }

  function sanitize(d) {
    if (!d || typeof d !== "object" || !TYPES.includes(d.t)) return null;
    const out = { t: d.t, lang: d.lang === "en" ? "en" : "fr", h: d.h ? 1 : 0, n: 1 };
    if (d.from !== undefined) {
      if (!ADDR.test(d.from)) return null;
      out.from = d.from;
    }
    if (d.post !== undefined) {
      if (!ID.test(d.post)) return null;
      out.post = d.post;
    }
    if (Number.isInteger(d.n) && d.n >= 1) out.n = Math.min(d.n, 999);
    if (typeof d.name === "string" && HANDLE.test(d.name)) out.name = d.name;
    if (d.p && Number.isInteger(d.p.c) && TX.test(d.p.tx) && Number.isInteger(d.p.i) && d.p.i >= 0) out.p = { c: d.p.c, tx: d.p.tx, i: d.p.i };
    const needs = { dm: [], follow: ["from"], like: ["from", "post"], announcement: ["from", "post"] };
    for (const k of needs[d.t] || ["from", "post"]) if (!out[k]) return null;
    return out;
  }

  function pathOf(d) {
    if (d.t === "dm") return d.conv && ID.test(d.conv) ? `/messages/${d.conv}` : "/messages";
    if (d.t === "follow") return `/u/${d.from}`;
    return `/p/${d.post}`;
  }

  function decodeBytesAt(dataHex, wordIndex) {
    const data = dataHex.replace(/^0x/, "");
    const offset = parseInt(data.slice(wordIndex * 64, wordIndex * 64 + 64), 16) * 2;
    const len = parseInt(data.slice(offset, offset + 64), 16);
    const hex = data.slice(offset + 64, offset + 64 + len * 2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  function announcementText(log) {
    try {
      const body = JSON.parse(new TextDecoder().decode(decodeBytesAt(log.data, 0)));
      return cleanText(body.text);
    } catch {
      return undefined;
    }
  }

  function check(d, log, cfg) {
    const chain = cfg.chains && cfg.chains[String(d.p.c)];
    const t = log.topics || [];
    const data = (log.data || "0x").replace(/^0x/, "");
    const me = cfg.me;
    if (REASON[d.t]) {
      return (
        !!chain && same(log.address, chain.content) && same(t[0], TOPICS.Notify) && same(t[1], word(me)) && same(t[2], word(d.from)) &&
        same(t[3], uintWord(REASON[d.t])) && same("0x" + data.slice(0, 64), d.post)
      );
    }
    if (d.t === "follow" || d.t === "like") {
      const social = cfg.social || {};
      const target = d.t === "follow" ? word(me) : d.post;
      return (
        social.chainId === d.p.c && same(log.address, social.address) && same(t[0], TOPICS.Acted) && same(t[1], word(d.from)) &&
        same(t[2], uintWord(d.t === "follow" ? KIND.FOLLOW : KIND.REACT)) && same(t[3], target) && same("0x" + data.slice(0, 64), uintWord(1))
      );
    }
    if (d.t === "announcement") {
      return (
        !!chain && ADDR.test(cfg.platform || "") && same(d.from, cfg.platform) && same(log.address, chain.content) && same(t[0], TOPICS.Message) &&
        same(t[1], d.post) && same(t[2], word(cfg.platform)) && same(t[3], uintWord(KIND.POST))
      );
    }
    if (d.t === "dm") return !!chain && same(log.address, chain.inbox) && same(t[0], TOPICS.Encrypted);
    return false;
  }

  function hexBytes(hex) {
    const h = lc(hex).replace(/^0x/, "");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  async function tagAt(tagKey, bucket) {
    const input = new Uint8Array(tagKey.length + 8);
    input.set(tagKey);
    new DataView(input.buffer).setBigUint64(tagKey.length, bucket);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    return "0x" + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function convOfTag(tag, blockNumber, tagKeys) {
    if (!ID.test(tag || "") || !tagKeys || typeof tagKeys !== "object") return undefined;
    const bucket = BigInt(blockNumber) / TAG_BUCKET;
    for (const [key, conv] of Object.entries(tagKeys)) {
      if (!/^0x[0-9a-fA-F]{32}$/.test(key) || !ID.test(conv)) continue;
      const k = hexBytes(key);
      if (same(await tagAt(k, bucket), tag) || (bucket > 0n && same(await tagAt(k, bucket - 1n), tag))) return conv;
    }
    return undefined;
  }

  async function verify(d, cfg, rpc) {
    if (!d.p || !cfg || !ADDR.test(cfg.me || "")) return { ok: false, reason: "no-proof" };
    let receipt;
    try {
      receipt = await rpc(d.p.c, "eth_getTransactionReceipt", [d.p.tx]);
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (!receipt || receipt.status !== "0x1") return { ok: false, reason: "no-receipt" };
    const log = (receipt.logs || []).find((l) => parseInt(l.logIndex, 16) === d.p.i);
    if (!log || !check(d, log, cfg)) return { ok: false, reason: "mismatch" };
    if (d.t === "dm") {
      const conv = await convOfTag(log.topics[1], receipt.blockNumber || log.blockNumber, cfg.tk);
      return conv ? { ok: true, conv } : { ok: false, reason: "mismatch" };
    }
    return { ok: true, text: d.t === "announcement" ? announcementText(log) : undefined };
  }

  function throttle(state, now, key) {
    const hour = now - 3600_000;
    const times = (state.times || []).filter((x) => x > hour);
    const seen = (state.seen || []).filter((s) => s[1] > now - 7 * 86_400_000);
    const duplicate = !!key && seen.some((s) => s[0] === key);
    const over = !duplicate && times.length >= MAX_PER_HOUR;
    if (!duplicate) times.push(now);
    if (key && !duplicate) seen.push([key, now]);
    return { state: { times, seen: seen.slice(-500), overflow: over ? (state.overflow || 0) + 1 : 0 }, duplicate, over };
  }

  g.arobasePush = { TYPES, TOPICS, MAX_PER_HOUR, cleanText, sanitize, pathOf, verify, check, throttle, word, uintWord, tagAt, convOfTag };
})(typeof self !== "undefined" ? self : globalThis);
