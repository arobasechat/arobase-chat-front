import { contentAbi } from "@/abi";
import { currentSender } from "@/identity/store";
import type { Network } from "./chains";
import type { AppConfig } from "./config";
import { db, putMessages } from "./db";
import type { Message } from "./protocol";
import { humanError, write } from "./tx";
import { tr } from "./i18n";

const KIND_LABEL: Record<number, string> = {
  0: "Post",
  1: "Commentaire",
  2: "Note de communauté",
  3: "Profil",
  4: "Repost",
  5: "Retrait du post",
  6: "Vote",
  7: "Vote",
  8: "Vote",
  9: "Vote",
};

export async function publishTo(net: Network, config: AppConfig, m: Message): Promise<number> {
  const account = currentSender();
  if (!account) throw new Error(tr("Compte verrouillé."));
  try {
    const receipt = await write({
      net,
      account,
      params: config.params,
      label: `${KIND_LABEL[m.kind] ? tr(KIND_LABEL[m.kind]) : tr("Message")} → ${net.cfg.name}`,
      address: net.cfg.content,
      abi: contentAbi,
      functionName: "publish",
      args: [m.author, m.kind, m.parentId, BigInt(m.ts), m.payload, m.sig],
    } as never);
    return Number(receipt.blockNumber);
  } catch (err) {
    if (humanError(err).includes("AlreadyPublished")) {
      const meta = await net.client.readContract({
        address: net.cfg.content,
        abi: contentAbi,
        functionName: "posts",
        args: [m.id],
      });
      return Number(meta[1]);
    }
    throw err;
  }
}

export async function publishMessage(config: AppConfig, m: Message, targets: Network[], onUpdate?: (m: Message) => void) {
  await putMessages([m]);
  const results = await Promise.allSettled(targets.map((net) => publishTo(net, config, m)));
  const locations = { ...m.locations };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") locations[targets[i].cfg.chainId] = r.value;
  });
  const ok = Object.keys(locations).length > 0;
  const updated: Message = { ...m, locations, status: ok ? "confirmed" : "failed" };
  await db.messages.put(updated);
  onUpdate?.(updated);
  if (!ok) {
    const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason ?? new Error(tr("Publication échouée"));
  }
  return updated;
}
