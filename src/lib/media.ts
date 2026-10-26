import { createStore, get, set } from "idb-keyval";
import { bytesToHex, getAbiItem, hexToBytes, keccak256, parseEventLogs, type Address, type Hex } from "viem";
import { mediaAbi } from "@/abi";
import { currentSender } from "@/identity/store";
import type { Networks } from "./chains";
import type { AppConfig } from "./config";
import { sponsorFor } from "./sponsor";
import { write } from "./tx";
import { tr } from "./i18n";

export const MAX_MEDIA_BYTES = 80_000;
const MAX_DIM = 1600;
const storedEvent = getAbiItem({ abi: mediaAbi, name: "Stored" });
const cache = createStore("arobase-media", "blobs");

export type OnchainRef = { chainId: number; block: bigint; id: Hex };

export const isOnchainRef = (s: string) => /^onchain:\d+:\d+:0x[0-9a-fA-F]{64}$/.test(s);

export function parseRef(s: string): OnchainRef | null {
  const m = s.match(/^onchain:(\d+):(\d+):(0x[0-9a-fA-F]{64})$/);
  return m ? { chainId: Number(m[1]), block: BigInt(m[2]), id: m[3] as Hex } : null;
}

async function encode(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((r) => canvas.toBlob(r, type, quality));
}

export const AVATAR = { maxDim: 400, maxBytes: 40_000, square: true };

export async function compressImage(file: File, opts: { maxDim?: number; maxBytes?: number; square?: boolean } = {}): Promise<Blob> {
  const maxDim = opts.maxDim ?? MAX_DIM;
  const maxBytes = opts.maxBytes ?? MAX_MEDIA_BYTES;
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const src = opts.square
    ? { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, w: side, h: side }
    : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  let scale = Math.min(1, maxDim / Math.max(src.w, src.h));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(src.w * scale));
    const h = Math.max(1, Math.round(src.h * scale));
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.58, 0.45]) {
      let blob = await encode(canvas, "image/webp", q);
      if (!blob || blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg", q);
      if (blob && blob.size <= maxBytes) {
        bitmap.close();
        return blob;
      }
    }
    scale *= 0.7;
  }
  bitmap.close();
  throw new Error(tr("Image trop lourde, même compressée."));
}

export function mediaChain(networks: Networks, config: AppConfig) {
  const entries = Object.entries((config.params.media ?? {}) as Record<string, Address>).filter(([id]) => networks.byId.has(Number(id)));
  const sorted = entries.sort(([a], [b]) => Number(!!sponsorFor(config.params, Number(b))) - Number(!!sponsorFor(config.params, Number(a))));
  const [id, address] = sorted[0] ?? [];
  return id ? { net: networks.byId.get(Number(id))!, address } : undefined;
}

export async function uploadOnchain(networks: Networks, config: AppConfig, blob: Blob): Promise<string> {
  const target = mediaChain(networks, config);
  if (!target) throw new Error(tr("Cette instance n'a pas encore de stockage d'images onchain."));
  const account = currentSender();
  if (!account) throw new Error(tr("Compte verrouillé."));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const receipt = await write({
    net: target.net,
    account,
    params: config.params,
    label: tr("Image ({size} Ko) → {chain}", { size: Math.round(bytes.length / 1024), chain: target.net.cfg.name }),
    address: target.address,
    abi: mediaAbi,
    functionName: "store",
    args: [blob.type, bytesToHex(bytes)],
  });
  const id = keccak256(bytes);
  const [log] = parseEventLogs({ abi: mediaAbi, eventName: "Stored", logs: receipt.logs });
  if (log && log.args.id !== id) throw new Error(tr("Empreinte de l'image incohérente."));
  await set(id, blob, cache).catch(() => undefined);
  return `onchain:${target.net.cfg.chainId}:${receipt.blockNumber}:${id}`;
}

const inflight = new Map<string, Promise<Blob>>();

export function sniffImage(bytes: Uint8Array): string | undefined {
  const at = (i: number, ...sig: number[]) => sig.every((b, j) => bytes[i + j] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return undefined;
}

async function safeImage(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) throw new Error(tr("Format d'image non pris en charge"));
  return blob.type === type ? blob : new Blob([blob], { type });
}

export function loadOnchain(networks: Networks, config: AppConfig, ref: string): Promise<Blob> {
  const r = parseRef(ref);
  if (!r) return Promise.reject(new Error(tr("Référence invalide")));
  let p = inflight.get(r.id);
  if (!p) {
    p = (async () => {
      const cached = await get<Blob>(r.id, cache).catch(() => undefined);
      if (cached) return safeImage(cached);
      const net = networks.byId.get(r.chainId);
      const address = (config.params.media as Record<string, Address> | undefined)?.[String(r.chainId)];
      if (!net) throw new Error(tr("Chain de l'image indisponible"));
      const logs = await net.client.getLogs({
        ...(address ? { address } : {}),
        event: storedEvent,
        args: { id: r.id },
        fromBlock: r.block,
        toBlock: r.block,
        strict: true,
      });
      const log = logs.find((l) => keccak256(l.args.data) === r.id);
      if (!log) throw new Error(tr("Image introuvable"));
      const blob = await safeImage(new Blob([hexToBytes(log.args.data) as BlobPart]));
      await set(r.id, blob, cache).catch(() => undefined);
      return blob;
    })().finally(() => setTimeout(() => inflight.delete(r.id), 0));
    inflight.set(r.id, p);
  }
  return p;
}
