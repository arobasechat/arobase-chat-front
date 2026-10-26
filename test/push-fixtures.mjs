import { createHash } from "node:crypto";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const ME = privateKeyToAccount(generatePrivateKey()).address;
export const BOB = privateKeyToAccount(generatePrivateKey()).address;
export const PLATFORM = privateKeyToAccount(generatePrivateKey()).address;
export const SOCIAL = "0x00000000000000000000000000000000000000c1";
export const CONTENT = "0x00000000000000000000000000000000000000c2";
export const INBOX = "0x00000000000000000000000000000000000000c3";
export const id = (n) => `0x${n.toString(16).padStart(64, "0")}`;
export const TX = id(0xabc);
export const BLOCK = 1_000_000;
export const TAG_KEY = "0x000102030405060708090a0b0c0d0e0f";
export const CONV = id(200);
export const tagFor = (key, bucket) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(bucket));
  return `0x${createHash("sha256").update(Buffer.concat([Buffer.from(key.slice(2), "hex"), b])).digest("hex")}`;
};

export const config = (over = {}) => ({
  v: 1,
  me: ME,
  platform: PLATFORM,
  tk: { [TAG_KEY]: CONV },
  social: { chainId: 100, address: SOCIAL, rpcs: ["https://rpc.social"] },
  chains: { 5042: { content: CONTENT, inbox: INBOX, rpcs: ["https://rpc.content"] } },
  ...over,
});

const ev = {
  Notify: parseAbiItem("event Notify(address indexed to, address indexed from, uint8 indexed reason, bytes32 postId)"),
  Acted: parseAbiItem("event Acted(address indexed author, uint8 indexed kind, bytes32 indexed target, int8 value, uint64 nonce, address signer)"),
  Message: parseAbiItem("event Message(bytes32 indexed id, address indexed author, uint8 indexed kind, bytes payload, bytes sig)"),
  Invite: parseAbiItem("event Invite(bytes envelope)"),
  Encrypted: parseAbiItem("event Encrypted(bytes32 indexed tag, bytes ciphertext)"),
};

const target = (a) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;

export const logs = {
  notify: ({ to = ME, from = BOB, reason = 1, post = id(1), address = CONTENT } = {}) => ({
    address,
    topics: encodeEventTopics({ abi: [ev.Notify], eventName: "Notify", args: { to, from, reason } }),
    data: encodeAbiParameters([{ type: "bytes32" }], [post]),
  }),
  acted: ({ author = BOB, kind = 11, tgt = target(ME), value = 1, address = SOCIAL } = {}) => ({
    address,
    topics: encodeEventTopics({ abi: [ev.Acted], eventName: "Acted", args: { author, kind, target: tgt } }),
    data: encodeAbiParameters([{ type: "int8" }, { type: "uint64" }, { type: "address" }], [value, 7n, author]),
  }),
  message: ({ msgId = id(9), author = PLATFORM, kind = 0, text = "Maintenance ce soir à 22h", address = CONTENT } = {}) => ({
    address,
    topics: encodeEventTopics({ abi: [ev.Message], eventName: "Message", args: { id: msgId, author, kind } }),
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [toHex(JSON.stringify({ v: 1, text })), "0x1234"]),
  }),
  invite: ({ address = INBOX } = {}) => ({
    address,
    topics: encodeEventTopics({ abi: [ev.Invite], eventName: "Invite" }),
    data: encodeAbiParameters([{ type: "bytes" }], ["0xaa"]),
  }),
  encrypted: ({ tag = tagFor(TAG_KEY, Math.floor(BLOCK / 4096)), address = INBOX } = {}) => ({
    address,
    topics: encodeEventTopics({ abi: [ev.Encrypted], eventName: "Encrypted", args: { tag } }),
    data: encodeAbiParameters([{ type: "bytes" }], ["0xbb"]),
  }),
};

export function receiptRpc(log, { status = "0x1", logIndex = 2, fail = false } = {}) {
  const calls = [];
  const rpc = async (chainId, method, params) => {
    calls.push({ chainId, method, params });
    if (fail) throw new Error("down");
    return { status, blockNumber: `0x${BLOCK.toString(16)}`, logs: [{ ...log, logIndex: `0x${logIndex.toString(16)}` }] };
  };
  rpc.calls = calls;
  return rpc;
}

export const proof = (c = 5042, i = 2) => ({ c, tx: TX, i });
