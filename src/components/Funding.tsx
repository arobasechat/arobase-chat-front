import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, HandCoins, HeartHandshake } from "lucide-react";
import { parseEther } from "viem";
import { addressUrl, chainMeta, formatAmount } from "@/lib/chain-meta";
import { short } from "@/lib/format";
import { humanError, write } from "@/lib/tx";
import { useAuth } from "@/identity/store";
import { useConfig, useNetworks } from "@/queries/core";
import { ACTION_GAS, entryPointAbi, usePaymasters, type PaymasterRow } from "@/queries/funding";
import { Button, inputClass } from "./ui";
import { useLang, useT } from "@/lib/i18n";

function Capacity({ row }: { row: PaymasterRow }) {
  const t = useT();
  const lang = useLang();
  if (row.deposit === null || !row.gasPrice) return null;
  const items = [
    ...(row.content
      ? [
          { label: t("posts ou commentaires"), gas: ACTION_GAS.post },
          { label: t("messages privés"), gas: ACTION_GAS.dm },
        ]
      : []),
    ...(!row.social && !row.content ? [{ label: t("posts ancrés"), gas: ACTION_GAS.anchor }] : []),
    ...(row.social
      ? [
          { label: t("likes, abonnements ou votes"), gas: ACTION_GAS.social },
          { label: t("images"), gas: ACTION_GAS.image },
        ]
      : []),
  ];
  const meta = chainMeta(row.chainId, row.name);
  return (
    <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
      {items.map((it) => {
        const cost = it.gas * row.gasPrice!;
        return (
          <li key={it.label} className="rounded-lg border border-line bg-bg p-2.5">
            <p className="font-mono tabular-nums">≈ {Number(row.deposit! / cost).toLocaleString(lang)}</p>
            <p className="text-[12px] text-muted">{it.label}</p>
            <p className="text-[11px] text-subtle">
              {t("{cost} {asset} l'unité", { cost: formatAmount(cost, 5), asset: meta.asset })}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function PaymasterCard({ row }: { row: PaymasterRow }) {
  const t = useT();
  const qc = useQueryClient();
  const networks = useNetworks();
  const config = useConfig();
  const { unlocked, unlock } = useAuth();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const meta = chainMeta(row.chainId, row.name);
  const url = addressUrl(row.chainId, row.paymaster);
  const budgetUsed = row.dailyBudget && row.remainingToday !== null ? Number(row.dailyBudget - row.remainingToday) / Number(row.dailyBudget) : null;

  const donate = async () => {
    setBusy(true);
    setError(undefined);
    setDone(false);
    try {
      const value = parseEther(amount.replace(",", "."));
      if (value <= 0n) throw new Error(t("Montant invalide"));
      const u = unlocked ?? (await unlock());
      await write({
        net: networks.byId.get(row.chainId)!,
        account: u.account,
        params: config.params,
        label: t("Don au paymaster"),
        address: row.entryPoint,
        abi: entryPointAbi,
        functionName: "depositTo",
        args: [row.paymaster],
        value,
      });
      setDone(true);
      await qc.invalidateQueries({ queryKey: ["paymasters"] });
      await qc.invalidateQueries({ queryKey: ["balances"] });
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line px-4 py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{meta.network}</p>
        <p className="font-mono text-sm tabular-nums">
          {row.deposit === null ? "—" : formatAmount(row.deposit)} <span className="text-muted">{meta.asset}</span>
        </p>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
        {t("Paymaster")} <span className="font-mono">{short(row.paymaster, 6)}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            {t("Voir sur l'explorateur")} <ExternalLink className="size-3.5" />
          </a>
        )}
      </p>
      {row.dailyBudget !== null && row.dailyBudget > 0n && row.remainingToday !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-[12px] text-muted">
            <span>{t("Budget du jour")}</span>
            <span className="font-mono tabular-nums">
              {t("{left} restant sur {total} {asset}", { left: formatAmount(row.remainingToday), total: formatAmount(row.dailyBudget), asset: meta.asset })}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, 1 - (budgetUsed ?? 0))) * 100}%` }} />
          </div>
        </div>
      )}
      <p className="mt-3 text-[12px] text-subtle">{t("Avec le dépôt actuel, au prix du gas actuel, cela finance environ :")}</p>
      <Capacity row={row} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input className={`${inputClass} !w-28`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label={t("Montant ({asset})", { asset: meta.asset })} />
        <Button size="sm" variant="outline" loading={busy} onClick={() => void donate()}>
          <HandCoins className="size-4" /> {t("Donner {amount} {asset}", { amount, asset: meta.asset })}
        </Button>
        {done && <span className="text-sm text-ok">{t("Merci !")}</span>}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function Funding() {
  const t = useT();
  const { data, isPending } = usePaymasters();
  if (!isPending && !data?.length) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 font-medium">
          <HeartHandshake className="size-4 text-accent" /> {t("Financement de la plateforme")}
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          {t("Le gas de vos actions est payé par les paymasters ci-dessous. Leurs adresses et leurs soldes sont publics : vous pouvez tout vérifier sur l'explorateur.")}
        </p>
        <p className="mt-1.5 text-sm text-muted">
          {t("arobase.chat est financé sur fonds propres. Les dons sont facultatifs et servent uniquement à payer les actions de tout le monde : ils vont directement dans le dépôt du paymaster, consommé au fil des actions. Seule la plateforme peut le retirer, via son timelock, et toute opération reste visible onchain. Une action coûte moins d'un centime, donc inutile de donner beaucoup.")}
        </p>
      </div>
      {isPending && <div className="skeleton m-4 h-24 rounded-lg" />}
      {data?.map((row) => <PaymasterCard key={row.chainId} row={row} />)}
    </section>
  );
}
