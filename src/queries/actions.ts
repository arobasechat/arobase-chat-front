import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { bytesToHex } from "viem";
import { contentAbi, socialAbi } from "@/abi";
import { currentEnc, currentSender, requireIdentity, requireSigner, useViewer } from "@/identity/store";
import { createMessage, KIND, addressTarget, signRevoke, ZERO32, type Body, type Message } from "@/lib/protocol";
import type { Networks } from "@/lib/chains";
import type { AppConfig } from "@/lib/config";
import { write } from "@/lib/tx";
import { publishMessage, publishTo } from "@/lib/publish";
import { enqueueSocial } from "@/lib/social-queue";
import { primaryContent, type Network } from "@/lib/chains";
import { db } from "@/lib/db";
import { useSettings } from "@/lib/settings";
import { useConfig, useNetworks } from "./core";
import { prependToFeeds } from "./feed";
import { qk } from "./keys";
import { tr } from "@/lib/i18n";

export type PublishInput = {
  kind: number;
  text?: string;
  media?: string[];
  parentId?: Hex;
  extra?: Partial<Body>;
  anchorChains?: number[];
};

export function usePublish() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  const defaultAnchors = useSettings((s) => s.anchorChains);
  return useMutation({
    mutationFn: async (input: PublishInput) => {
      const signer = await requireSigner();
      const content: Omit<Body, "v" | "ts" | "parentId"> = { ...input.extra };
      if (input.text) content.text = input.text;
      if (input.media?.length) content.media = input.media;
      const m = await createMessage(signer, input.kind, content, input.parentId ?? ZERO32);
      const anchors = (input.anchorChains ?? defaultAnchors)
        .map((id) => networks.byId.get(id))
        .filter((n): n is Network => !!n && n.cfg.role === 2);
      const targets = [primaryContent(networks), ...anchors];
      prependToFeeds(qc, m, signer.author);
      return publishMessage(config, m, targets, (u) => {
        prependToFeeds(qc, u, signer.author);
      });
    },
    onSuccess: (m) => {
      if (m.kind === KIND.NOTE || m.kind === KIND.COMMENT) void qc.invalidateQueries({ queryKey: qk.notes(m.parentId) });
      if (m.kind === KIND.PROFILE && viewer) void qc.invalidateQueries({ queryKey: qk.profile(viewer) });
    },
  });
}

export function useRetryPublish() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  return useMutation({
    mutationFn: async (m: Message) => {
      const updated = await publishMessage(config, { ...m, status: "pending" }, [primaryContent(networks)]);
      prependToFeeds(qc, updated, m.author);
      return updated;
    },
  });
}

export function useReplicate() {
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  return useMutation({
    mutationFn: async ({ m, chainId }: { m: Message; chainId: number }) => {
      const net = networks.byId.get(chainId);
      if (!net) throw new Error(tr("Chain inconnue"));
      const block = await publishTo(net, config, m);
      const updated = { ...m, locations: { ...m.locations, [chainId]: block } };
      await db.messages.put(updated);
      qc.setQueryData(qk.msg(m.id), updated);
      return updated;
    },
  });
}

export async function revokeSessionKey(networks: Networks, config: AppConfig, key: Address) {
  let signer = await requireSigner();
  if (signer.delegation && signer.account.address.toLowerCase() !== key.toLowerCase()) signer = await requireIdentity();
  const sig = await signRevoke(signer, key);
  const account = currentSender()!;
  const args = [signer.author, key, sig] as const;
  const targets = [
    write({ net: networks.social, account, params: config.params, label: tr("Révocation de la clé de session"), address: config.social, abi: socialAbi, functionName: "revoke", args }),
    ...networks.content
      .filter((n) => n.cfg.content && (n.cfg.role !== 2 || config.params.aa?.[String(n.cfg.chainId)]))
      .map((n) =>
        write({ net: n, account, params: config.params, label: tr("Révocation sur {chain}", { chain: n.cfg.name }), address: n.cfg.content, abi: contentAbi, functionName: "revoke", args, silent: true }),
      ),
  ];
  const results = await Promise.allSettled(targets);
  if (results[0].status === "rejected") throw results[0].reason;
}

export function useSocialActions() {
  const viewer = useViewer();
  const networks = useNetworks();
  const config = useConfig();
  return {
    react: (id: Hex, value: -1 | 0 | 1) =>
      enqueueSocial({
        key: `react:${id}`,
        kind: KIND.REACT,
        target: id,
        value,
        label: value === 1 ? tr("J'aime") : value === -1 ? tr("Je n'aime pas") : tr("Retrait de réaction"),
        invalidate: [qk.stats(viewer, id)],
      }),
    follow: (addr: Address, value: 0 | 1) =>
      enqueueSocial({
        key: `follow:${addr.toLowerCase()}`,
        kind: KIND.FOLLOW,
        target: addressTarget(addr),
        value,
        label: value ? tr("Abonnement") : tr("Désabonnement"),
        invalidate: [["user"], viewer ? qk.following(viewer) : ["following"], qk.followers(addr), ["feed", "following"]],
      }),
    modVote: (id: Hex, value: -1 | 0 | 1) =>
      enqueueSocial({
        key: `vote:${id}`,
        kind: KIND.MOD_VOTE,
        target: id,
        value,
        label: value === 1 ? tr("Vote : masquer") : value === -1 ? tr("Vote : garder") : tr("Retrait du vote"),
        invalidate: [qk.stats(viewer, id)],
      }),
    rateNote: (noteId: Hex, postId: Hex, value: -1 | 0 | 1) =>
      enqueueSocial({
        key: `rate:${noteId}`,
        kind: KIND.RATE_NOTE,
        target: noteId,
        value,
        label: tr("Évaluation de note"),
        invalidate: [qk.notes(postId)],
      }),
    setRole: (addr: Address, role: 0 | 1 | 2) =>
      enqueueSocial({
        key: `role:${addr.toLowerCase()}`,
        kind: KIND.ROLE,
        target: addressTarget(addr),
        value: role,
        label: tr("Changement de rôle"),
        invalidate: [qk.staff, ["user"]],
        identity: true,
      }),
    publishEncKey: () => {
      const enc = currentEnc();
      if (!enc) return;
      enqueueSocial({
        key: "enc",
        kind: KIND.ENC_KEY,
        target: bytesToHex(enc.publicKey),
        value: 0,
        label: tr("Publication de la clé de chiffrement"),
        invalidate: [["user"]],
        identity: true,
      });
    },
    revokeSession: (key: Address) => revokeSessionKey(networks, config, key),
  };
}
