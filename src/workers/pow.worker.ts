import { keccak_256 } from "@noble/hashes/sha3.js";
import { keccak256, numberToHex, type Address } from "viem";
import { expose } from "@/lib/worker-rpc";

const MAX = 2n ** 256n - 1n;

function mine(address: Address, nonce: number, gas: number, difficulty = 1) {
  const nonceHash = BigInt(keccak256(numberToHex(nonce, { size: 32 })));
  const addressHash = BigInt(keccak256(address));
  const base = nonceHash ^ addressHash;
  const divConstant = MAX / BigInt(difficulty);
  const target = BigInt(gas);
  const buf = new Uint8Array(32);
  for (let i = 0; i < 5_000_000; i++) {
    crypto.getRandomValues(buf);
    const candidate = BigInt(`0x${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}`);
    const resultHash = base ^ BigInt(keccak256(numberToHex(candidate, { size: 32 })));
    if (resultHash !== 0n && divConstant / resultHash >= target) return numberToHex(candidate);
  }
  throw new Error("PoW: aucune solution trouvée");
}

function leadingZeroBits(h: Uint8Array) {
  let bits = 0;
  for (const byte of h) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

function minePaymaster(prefix: Uint8Array, difficulty: number) {
  const buf = new Uint8Array(prefix.length + 32);
  buf.set(prefix);
  const view = new DataView(buf.buffer);
  const tail = prefix.length + 24;
  for (let n = 0; n < 2 ** 32; n++) {
    view.setUint32(tail + 4, n);
    if (leadingZeroBits(keccak_256(buf)) >= difficulty) return n;
  }
  throw new Error("PoW paymaster : aucune solution");
}

const handlers = { mine, minePaymaster };
export type PowHandlers = typeof handlers;
expose(handlers);
