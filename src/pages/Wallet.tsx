import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { renderSVG } from "uqr";
import clsx from "clsx";
import { Anchor, Check, ChevronDown, Copy, Droplets, ExternalLink, Gift, KeyRound, Lock, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { createWalletClient, parseEther, type Address } from "viem";
import { stakeAbi } from "@/abi";
import { isDevChain } from "@/env";
import { chainMeta, formatAmount } from "@/lib/chain-meta";
import { devFund, humanError, tracked, write } from "@/lib/tx";
import { useSettings } from "@/lib/settings";
import { useAuth, useViewer } from "@/identity/store";
import { useConfig, useNetworks } from "@/queries/core";
import { useBalances, useStake } from "@/queries/misc";
import { PageHeader } from "@/components/Layout";
import { Funding } from "@/components/Funding";
import { Badge, Button, Field, inputClass, Tag } from "@/components/ui";
import { useLang, useT } from "@/lib/i18n";

const ACTION_GAS: Record<number, bigint> = { 0: 150_000n, 1: 300_000n, 2: 300_000n };
const USAGE = [
  { icon: Users, title: "Likes, abonnements, votes", what: "action sociale", whats: "actions sociales" },
  { icon: Gift, title: "Posts, commentaires, messages privés", what: "post", whats: "posts" },
  { icon: Anchor, title: "Copie permanente d'un post (optionnelle)", what: "post ancré", whats: "posts ancrés" },
];

function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2.5 text-left font-mono text-[13px] transition hover:border-subtle"
    >
      <span className="break-all">{address}</span>
      {copied ? <Check className="size-4 shrink-0 text-ok" /> : <Copy className="size-4 shrink-0 text-subtle group-hover:text-fg" />}
    </button>
  );
}

function ChainRow({
  row,
  address,
  sponsored,
  onDevFund,
  busy,
}: {
  row: { chainId: number; name: string; role: number; gasPrice: bigint | null; balances: (bigint | null)[] };
  address: Address;
  sponsored: boolean;
  onDevFund: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = chainMeta(row.chainId, row.name);
  const balance = row.balances[0];
  const perAction = row.gasPrice !== null ? row.gasPrice * ACTION_GAS[row.role] : null;
  const capacity = balance !== null && perAction ? Number(balance / perAction) : null;
  const usage = USAGE[row.role];
  const Icon = usage.icon;
  const funded = !!balance && balance > 0n;
  const t = useT();
  const lang = useLang();

  const status = sponsored
    ? { tone: "ok" as const, label: t("Sponsorisé · rien à envoyer") }
    : row.role === 2
      ? funded
        ? { tone: "ok" as const, label: t("Prêt pour l'ancrage") }
        : { tone: "muted" as const, label: t("Seulement si vous ancrez") }
      : funded
        ? { tone: "ok" as const, label: t("Approvisionné") }
        : { tone: "warn" as const, label: t("À approvisionner") };

  return (
    <div className="border-t border-line first:border-t-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-elevated/40" aria-expanded={open}>
        <span className={clsx("flex size-9 shrink-0 items-center justify-center rounded-lg border", row.role === 2 ? "border-ok/30 bg-ok/10 text-ok" : "border-tag-line bg-tag text-tag-fg")}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{meta.network}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">{t(usage.title)}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-mono text-sm tabular-nums">
            {balance === null ? "—" : formatAmount(balance)} <span className="text-muted">{meta.asset}</span>
          </span>
          {perAction !== null && (
            <span className="block text-[11px] text-subtle">
              {capacity !== null && capacity > 0 ? `≈ ${capacity.toLocaleString(lang)} ${t(capacity > 1 ? usage.whats : usage.what)}` : `≈ ${formatAmount(perAction, 6)} ${meta.asset} / ${t(usage.what)}`}
            </span>
          )}
        </span>
        <ChevronDown className={clsx("size-4 shrink-0 text-subtle transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-5 pl-[68px] text-sm">
          {sponsored && (
            <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/5 p-3 text-[13px]">
              <Gift className="mt-0.5 size-4 shrink-0 text-ok" />
              {t("Le gas est payé par le paymaster de l'instance. Vous n'avez besoin de {asset} que si le sponsoring est indisponible, ou pour un dépôt anti-spam.", { asset: meta.asset })}
            </p>
          )}
          <div>
            <p className="mb-2 font-medium">
              {t("Envoyer du {asset} sur {network}", { asset: meta.asset, network: meta.network })}
            </p>
            <p className="mb-3 text-[13px] text-muted">{t("Actif attendu : {name}.", { name: meta.assetName })}</p>
            <ol className="space-y-2 text-[13px] text-fg/85">
              {meta.howTo.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-muted">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
          <CopyAddress address={address} />
          <p className="flex items-start gap-2 text-[12px] text-warn">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {t("Choisissez exactement le réseau « {network} ». Un envoi sur un autre réseau ne sera pas visible ici.", { network: meta.network })}
          </p>
          <div className="flex flex-wrap gap-2">
            {meta.explorer && (
              <a href={`${meta.explorer}${address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
                {t("Voir sur l'explorateur")} <ExternalLink className="size-3.5" />
              </a>
            )}
            {isDevChain(row.chainId) && (
              <Button size="sm" variant="outline" loading={busy} onClick={onDevFund}>
                <Droplets className="size-3.5" /> {t("Créditer (chain locale)")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Wallet() {
  const viewer = useViewer()!;
  const { unlocked, session, unlock } = useAuth();
  const networks = useNetworks();
  const config = useConfig();
  const useSponsor = useSettings((s) => s.useSponsor);
  const qc = useQueryClient();
  const balances = useBalances([viewer, ...(session ? [session.account.address] : [])]);
  const stake = useStake(viewer);
  const [stakeAmount, setStakeAmount] = useState("1");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [exported, setExported] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const t = useT();
  const lang = useLang();
  const svg = useMemo(() => renderSVG(viewer, { border: 1 }), [viewer]);
  const sponsoredChains = new Set(useSponsor ? Object.keys(config.params.aa ?? {}).map(Number) : []);
  const socialMeta = chainMeta(networks.social.cfg.chainId, networks.social.cfg.name);
  const allSponsored = networks.free.length > 0 && sponsoredChains.has(networks.social.cfg.chainId) && networks.free.every((n) => sponsoredChains.has(n.cfg.chainId));

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["balances"] });
      await qc.invalidateQueries({ queryKey: ["stake"] });
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(undefined);
    }
  };

  const stakeAction = (fn: "deposit" | "requestWithdraw" | "withdraw") =>
    run(fn, async () => {
      const u = unlocked ?? (await unlock());
      const value = parseEther(stakeAmount);
      await write({
        net: networks.social,
        account: u.account,
        params: config.params,
        label: fn === "deposit" ? t("Dépôt anti-spam") : fn === "requestWithdraw" ? t("Demande de retrait") : t("Retrait"),
        address: config.stake,
        abi: stakeAbi,
        functionName: fn,
        args: fn === "requestWithdraw" ? [value] : [],
        value: fn === "deposit" ? value : undefined,
      } as never);
    });

  const topUpSession = (chainId: number) =>
    run(`top-${chainId}`, async () => {
      const u = unlocked ?? (await unlock());
      const net = networks.byId.get(chainId)!;
      const wallet = createWalletClient({ account: u.account, chain: net.chain, transport: () => net.client.transport as never });
      await tracked(net, t("Transfert vers la clé de session"), () => wallet.sendTransaction({ to: session!.account.address, value: parseEther("0.001") }));
    });

  const rows = balances.data ?? [];

  return (
    <>
      <PageHeader title={t("Portefeuille")} subtitle={t("Une seule adresse, sur toutes les chains")} />
      <div className="space-y-4 p-4">
        <section className={clsx("rounded-xl border p-4", allSponsored ? "border-ok/30 bg-ok/5" : "border-tag-line bg-tag")}>
          <p className="flex items-center gap-2 font-medium">
            {allSponsored ? <ShieldCheck className="size-4 text-ok" /> : <Gift className="size-4 text-tag-fg" />}
            {allSponsored ? t("Vous n'avez rien à payer pour utiliser arobase.chat.") : t("Le sponsoring ne couvre pas toutes les chains.")}
          </p>
          <p className="mt-1.5 text-sm text-muted">
            {allSponsored
              ? t("Vos posts, likes, abonnements et messages sont sponsorisés. Le gas ne sert que pour ancrer un post sur une chain permanente, pour un dépôt anti-spam, ou si le sponsoring est temporairement indisponible.")
              : t("Sur les chains marquées « À approvisionner », envoyez un peu de l'actif indiqué à votre adresse pour pouvoir publier.")}
          </p>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="flex gap-4">
            <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-white p-1" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("Votre adresse")}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {t("C'est la même adresse sur toutes les chains, et c'est aussi votre identité publique. C'est le")} <b className="text-fg">{t("réseau")}</b>{" "}
                {t("choisi lors de l'envoi qui détermine où arrivent les fonds.")}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <CopyAddress address={viewer} />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-medium">{t("Soldes et besoins par chain")}</h2>
            <span className="text-[12px] text-subtle">{t("Touchez une chain pour savoir quoi envoyer")}</span>
          </div>
          {balances.isPending && <div className="skeleton m-4 h-16 rounded-lg" />}
          {rows.map((row) => (
            <ChainRow
              key={row.chainId}
              row={row}
              address={viewer}
              sponsored={sponsoredChains.has(row.chainId)}
              busy={busy === `dev-${row.chainId}`}
              onDevFund={() =>
                run(`dev-${row.chainId}`, async () => {
                  const net = networks.byId.get(row.chainId)!;
                  await devFund(net, viewer);
                  if (session) await devFund(net, session.account.address);
                })
              }
            />
          ))}
        </section>

        <Funding />

        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{t("Dépôt anti-spam")}</h2>
            <Tag className="text-[11px]">{t("optionnel")}</Tag>
          </div>
          <p className="text-sm text-muted">
            {t("Un dépôt récupérable en {asset} sur {network} donne du poids à vos votes de modération et prouve que vous n'êtes pas un faux compte. Vous pouvez le retirer après {hours} h de préavis.", { asset: socialMeta.asset, network: socialMeta.network, hours: Math.round((stake.data?.cooldown ?? 0) / 3600) || t("quelques") })}
          </p>
          {stake.data && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-line bg-bg p-3">
                <p className="text-[12px] text-subtle">{t("Déposé")}</p>
                <p className="font-mono">
                  {formatAmount(stake.data.amount)} {socialMeta.asset}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-bg p-3">
                <p className="text-[12px] text-subtle">{t("En cours de retrait")}</p>
                <p className="font-mono">
                  {formatAmount(stake.data.pending)} {socialMeta.asset}
                </p>
                {stake.data.pending > 0n && stake.data.unlockAt * 1000 > Date.now() && (
                  <p className="text-[11px] text-subtle">{t("disponible le {date}", { date: new Date(stake.data.unlockAt * 1000).toLocaleString(lang) })}</p>
                )}
              </div>
            </div>
          )}
          <Field label={t("Montant ({asset})", { asset: socialMeta.asset })}>
            <input className={inputClass} value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} inputMode="decimal" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy === "deposit"} onClick={() => stakeAction("deposit")}>
              {t("Déposer {amount} {asset}", { amount: stakeAmount, asset: socialMeta.asset })}
            </Button>
            <Button size="sm" variant="outline" loading={busy === "requestWithdraw"} onClick={() => stakeAction("requestWithdraw")}>
              {t("Demander le retrait")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === "withdraw"}
              disabled={!stake.data?.pending || stake.data.unlockAt * 1000 > Date.now()}
              onClick={() => stakeAction("withdraw")}
            >
              {t("Retirer le stake")}
            </Button>
          </div>
        </section>

        {error && <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        <button onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-2 px-1 text-sm text-muted hover:text-fg">
          <ChevronDown className={clsx("size-4 transition", advanced && "rotate-180")} /> {t("Avancé : clé de session et clé de secours")}
        </button>
        {advanced && (
          <div className="space-y-4">
            {session && (
              <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
                <h2 className="flex items-center gap-2 font-medium">
                  <Lock className="size-4" /> {t("Clé de session de cet appareil")}
                </h2>
                <p className="text-sm text-muted">
                  {t("Elle signe vos actions sans Face ID jusqu'au {date}. Si elle n'a pas de gas, l'app vous demande Face ID et paie depuis votre adresse principale. Vous n'avez donc jamais besoin de l'approvisionner.", { date: new Date(session.delegation.expiry * 1000).toLocaleDateString(lang) })}
                </p>
                <p className="font-mono text-[12px] text-subtle">{session.account.address}</p>
                <div className="flex flex-wrap gap-2">
                  {rows
                    .filter((r) => !sponsoredChains.has(r.chainId))
                    .map((r) => (
                      <Button key={r.chainId} size="sm" variant="outline" loading={busy === `top-${r.chainId}`} onClick={() => topUpSession(r.chainId)}>
                        {t("Transférer 0,001 {asset} ({network})", { asset: chainMeta(r.chainId, r.name).asset, network: chainMeta(r.chainId, r.name).network })}
                      </Button>
                    ))}
                </div>
              </section>
            )}
            <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <h2 className="flex items-center gap-2 font-medium">
                <KeyRound className="size-4" /> {t("Clé de secours")}
              </h2>
              <p className="text-sm text-muted">
                {t("Votre passkey est liée au domaine de ce site. Pour utiliser un miroir (IPFS, autre domaine), exportez la clé et importez-la là-bas. Ne la partagez jamais : elle donne un accès total à votre compte et à vos fonds.")}
              </p>
              {exported ? (
                <code className="block break-all rounded-lg bg-elevated p-3 font-mono text-xs">{exported}</code>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === "export"}
                  onClick={() =>
                    run("export", async () => {
                      const u = unlocked ?? (await unlock());
                      setExported(u.privateKey);
                    })
                  }
                >
                  {t("Afficher la clé privée")}
                </Button>
              )}
            </section>
          </div>
        )}
        <p className="px-1 text-[12px] text-subtle">{t("Le nombre d'actions possibles est estimé d'après le prix du gas actuel sur chaque chain.")}</p>
      </div>
    </>
  );
}
