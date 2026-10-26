import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { encodeFunctionData, getAbiItem, isAddress, stringToHex, toHex, type Address, type Hex } from "viem";
import { Shield } from "lucide-react";
import { registryAbi, socialAbi } from "@/abi";
import { KIND, ROLE } from "@/lib/protocol";
import { short } from "@/lib/format";
import { useViewer } from "@/identity/store";
import { useConfig, useNetworks, usePlatform, useUserStats } from "@/queries/core";
import { useStaff } from "@/queries/misc";
import { useMessage } from "@/queries/feed";
import { useSocialActions } from "@/queries/actions";
import { PageHeader } from "@/components/Layout";
import { PostCard } from "@/components/PostCard";
import { DisplayName, UserLink } from "@/components/UserLink";
import { Avatar } from "@/components/Avatar";
import { AdminStats } from "@/components/AdminStats";
import { Badge, Button, Empty, Field, inputClass } from "@/components/ui";
import { useT } from "@/lib/i18n";

const actedEvent = getAbiItem({ abi: socialAbi, name: "Acted" });

function useRecentReports() {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: ["reports", networks.key],
    staleTime: 30_000,
    meta: { persist: false },
    queryFn: async () => {
      const latest = await networks.social.client.getBlockNumber();
      const from = latest > 50_000n ? latest - 50_000n : 0n;
      const logs = await networks.social.client.getLogs({
        address: config.social,
        event: actedEvent,
        args: { kind: KIND.MOD_VOTE },
        fromBlock: from,
        toBlock: latest,
        strict: true,
      });
      const byTarget = new Map<Hex, number>();
      for (const l of logs) if (l.args.value === 1) byTarget.set(l.args.target, (byTarget.get(l.args.target) ?? 0) + 1);
      return [...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    },
  });
}

function Report({ id, count }: { id: Hex; count: number }) {
  const { data } = useMessage(id);
  const t = useT();
  if (!data) return null;
  return (
    <div className="relative">
      <span className="absolute right-4 top-3 z-10">
        <Badge tone="danger">{t("{n} signalement(s)", { n: count })}</Badge>
      </span>
      <PostCard message={data} />
    </div>
  );
}

export default function Admin() {
  const viewer = useViewer();
  const me = useUserStats(viewer).data;
  const staff = useStaff();
  const reports = useRecentReports();
  const config = useConfig();
  const actions = useSocialActions();
  const [target, setTarget] = useState("");
  const [role, setRole] = useState<0 | 1 | 2>(1);
  const [paramKey, setParamKey] = useState("");
  const [paramValue, setParamValue] = useState("");
  const t = useT();
  const platform = usePlatform();

  if (!me || me.role < ROLE.MODERATOR) return <Empty title={t("Réservé à la modération")} icon={<Shield className="size-8" />} />;
  const isAdmin = me.role === ROLE.ADMIN;

  const paramData =
    paramKey && paramValue
      ? (() => {
          try {
            return encodeFunctionData({
              abi: registryAbi,
              functionName: "setParam",
              args: [stringToHex(paramKey, { size: 32 }), toHex(JSON.stringify(JSON.parse(paramValue)))],
            });
          } catch {
            return undefined;
          }
        })()
      : undefined;

  return (
    <>
      <PageHeader title={t("Administration")} subtitle={isAdmin ? t("Administrateur") : t("Modérateur")} />
      <AdminStats />
      <section className="border-b border-line p-4">
        <h2 className="mb-2 font-bold">{t("Compte de la plateforme")}</h2>
        {platform ? (
          <div className="flex items-center gap-3">
            <UserLink address={platform}>
              <Avatar address={platform} size={32} />
            </UserLink>
            <DisplayName address={platform} className="flex-1 truncate font-semibold" />
          </div>
        ) : (
          <p className="text-sm text-muted">{t("Aucun compte plateforme défini.")}</p>
        )}
        <p className="mt-2 text-xs text-muted">
          {t("Tout le monde le suit automatiquement : ses posts apparaissent dans le fil « Abonnements » et en notification. C'est le paramètre « platform » du Registry, modifiable avec « pnpm propose set-param platform '\"0x…\"' ».")}
        </p>
      </section>
      <section className="border-b border-line p-4">
        <h2 className="mb-2 font-bold">{t("Équipe")}</h2>
        <ul className="space-y-2">
          {staff.data?.map((s) => (
            <li key={s.address} className="flex items-center gap-3">
              <UserLink address={s.address}>
                <Avatar address={s.address} size={32} />
              </UserLink>
              <DisplayName address={s.address} className="flex-1 truncate font-semibold" />
              <Badge tone="accent">{s.role === 2 ? t("admin") : t("modérateur")}</Badge>
              {isAdmin && s.address.toLowerCase() !== viewer?.toLowerCase() && (
                <Button size="sm" variant="ghost" onClick={() => actions.setRole(s.address, 0)}>
                  {t("Retirer")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <div className="mt-4 flex flex-wrap gap-2">
            <input className={`${inputClass} flex-1`} value={target} onChange={(e) => setTarget(e.target.value.trim())} placeholder={t("0x… adresse")} />
            <select className={`${inputClass} w-auto`} value={role} onChange={(e) => setRole(Number(e.target.value) as 0 | 1 | 2)}>
              <option value={1}>{t("Modérateur")}</option>
              <option value={2}>{t("Admin")}</option>
              <option value={0}>{t("Utilisateur")}</option>
            </select>
            <Button disabled={!isAddress(target)} onClick={() => (actions.setRole(target as Address, role), setTarget(""))}>
              {t("Attribuer")}
            </Button>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          {t("Chaque attribution est un message signé onchain (kind 20), public et traçable.")}
        </p>
      </section>

      <section>
        <h2 className="px-4 pt-4 font-bold">{t("Signalements récents")}</h2>
        <p className="px-4 pb-2 text-xs text-muted">{t("Votes « masquer » des ~50 000 derniers blocs. Masquer ici n'efface rien : la vue brute reste accessible.")}</p>
        {reports.data?.length === 0 && <Empty title={t("Aucun signalement")} />}
        {reports.data?.map(([id, count]) => (
          <Report key={id} id={id} count={count} />
        ))}
      </section>

      {isAdmin && (
        <section className="space-y-4 border-t border-line p-4">
          <h2 className="font-bold">{t("Proposer un changement de config (Safe + Timelock)")}</h2>
          <p className="text-sm text-muted">
            {t("Le Registry appartient au Timelock ({address} → owner). Générez le calldata puis soumettez-le via votre Safe", { address: short(config.registry) })}
            (<code>schedule</code> {t("puis")} <code>execute</code> {t("après le délai). Aucune clé unique ne peut modifier l'app.")}
          </p>
          <Field label={t("Paramètre")} hint={t("Valeur en JSON, ex. 10 ou [\"https://…\"]")}>
            <div className="flex gap-2">
              <input className={inputClass} placeholder={t("clé (ex. hideThreshold)")} value={paramKey} onChange={(e) => setParamKey(e.target.value)} />
              <input className={inputClass} placeholder={t("valeur JSON")} value={paramValue} onChange={(e) => setParamValue(e.target.value)} />
            </div>
          </Field>
          {paramData && (
            <code className="block break-all rounded-lg bg-elevated p-3 text-xs">
              target: {config.registry}
              <br />
              data: {paramData}
            </code>
          )}
          <div className="text-xs text-muted">
            {t("Paramètres actuels :")}
            <pre className="mt-1 overflow-x-auto rounded-lg bg-elevated p-3">{JSON.stringify(config.params, null, 2)}</pre>
          </div>
        </section>
      )}
    </>
  );
}
