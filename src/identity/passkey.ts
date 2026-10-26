import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, type Hex } from "viem";
import { derive } from "@/lib/crypto";
import { env } from "@/env";

const te = new TextEncoder();
const SALT_IDENTITY = sha256(te.encode("arobase:identity:v1"));
const SALT_ENC = sha256(te.encode("arobase:enc:v1"));

export type PrfSecrets = { credentialId: string; identityKey: Hex; encSeed: Uint8Array };

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const rpId = () => env.rpId ?? location.hostname;

export function passkeySupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

function toIdentityKey(prf: ArrayBuffer): Hex {
  let sk = derive(new Uint8Array(prf), "arobase:secp256k1");
  let i = 0;
  while (!secp256k1.utils.isValidSecretKey(sk)) sk = derive(sk, `arobase:secp256k1:${++i}`);
  return bytesToHex(sk);
}

type PrfResults = { results?: { first?: ArrayBuffer; second?: ArrayBuffer }; enabled?: boolean };

function readPrf(cred: PublicKeyCredential): PrfResults | undefined {
  return (cred.getClientExtensionResults() as { prf?: PrfResults }).prf;
}

const prfInput = { prf: { eval: { first: SALT_IDENTITY, second: SALT_ENC } } } as AuthenticationExtensionsClientInputs;

export async function createPasskey(displayName: string): Promise<PrfSecrets> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "arobase.chat", id: rpId() },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: displayName, displayName },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: prfInput,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Création de la passkey annulée.");
  const prf = readPrf(cred);
  if (prf?.enabled === false) throw new Error("Cet appareil ne supporte pas l'extension PRF (iOS 18+ / Chrome récent requis).");
  const credentialId = b64url(cred.rawId);
  if (prf?.results?.first && prf.results.second) {
    return {
      credentialId,
      identityKey: toIdentityKey(prf.results.first),
      encSeed: new Uint8Array(prf.results.second),
    };
  }
  return unlockPasskey(credentialId);
}

export async function unlockPasskey(credentialId?: string): Promise<PrfSecrets> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: rpId(),
      userVerification: "required",
      allowCredentials: credentialId ? [{ type: "public-key", id: fromB64url(credentialId) }] : [],
      extensions: prfInput,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Authentification annulée.");
  const prf = readPrf(cred);
  if (!prf?.results?.first || !prf.results.second)
    throw new Error("La passkey n'a pas renvoyé de secret PRF. Appareil ou navigateur non compatible.");
  return {
    credentialId: b64url(cred.rawId),
    identityKey: toIdentityKey(prf.results.first),
    encSeed: new Uint8Array(prf.results.second),
  };
}
