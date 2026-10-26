import { useState } from "react";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { chainMeta, formatAmount } from "@/lib/chain-meta";
import { useNetworks } from "@/queries/core";
import { lastDays, useStats, type DayStats } from "@/queries/stats";
import { Spinner, Tabs } from "./ui";
import { useLang, useT } from "@/lib/i18n";

type Point = { key: string; ts: number; value: number };

function BarChart({ title, points, format }: { title: string; points: Point[]; format?: (v: number) => string }) {
  const lang = useLang();
  const [hover, setHover] = useState<number>();
  const fmt = format ?? ((v: number) => v.toLocaleString(lang));
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((a, p) => a + p.value, 0);
  const W = 600;
  const H = 120;
  const step = W / points.length;
  const gap = Math.min(2, step * 0.2);
  const shown = hover !== undefined ? points[hover] : undefined;
  const date = (ts: number, long = false) => new Date(ts * 1000).toLocaleDateString(lang, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
  return (
    <figure className="rounded-xl border border-line bg-bg p-3">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[12px] tabular-nums text-muted">
          {shown ? (
            <>
              {date(shown.ts, true)} · <b className="text-fg">{fmt(shown.value)}</b>
            </>
          ) : (
            <>
              Σ <b className="text-fg">{fmt(total)}</b>
            </>
          )}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H + 1}`}
        preserveAspectRatio="none"
        className="mt-2 h-28 w-full touch-none"
        role="img"
        aria-label={`${title} : ${points.map((p) => `${date(p.ts)} ${fmt(p.value)}`).join(", ")}`}
        onPointerLeave={() => setHover(undefined)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(points.length - 1, Math.floor(((e.clientX - r.left) / r.width) * points.length))));
        }}
      >
        {points.map((p, i) => {
          const h = p.value ? Math.max(2, (p.value / max) * H) : 0;
          return (
            <g key={p.key}>
              <rect x={i * step} y={0} width={step} height={H} className={clsx(hover === i ? "fill-elevated" : "fill-transparent")} />
              {h > 0 && (
                <rect x={i * step + gap / 2} y={H - h} width={Math.max(1, step - gap)} height={h} rx={Math.min(2, (step - gap) / 2)} className={clsx("fill-accent", hover !== undefined && hover !== i && "opacity-60")} />
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} className="stroke-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{date(points[0].ts)}</span>
        <span>max {fmt(max)}</span>
        <span>{date(points[points.length - 1].ts)}</span>
      </div>
    </figure>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}

export function AdminStats() {
  const t = useT();
  const lang = useLang();
  const networks = useNetworks();
  const [range, setRange] = useState<"14" | "30" | "90">("30");
  const stats = useStats(true);
  const days = lastDays(stats.data, Number(range));
  const series = (pick: (d: DayStats) => number): Point[] => days.map((x) => ({ key: x.key, ts: x.ts, value: pick(x.d) }));
  const sum = (pick: (d: DayStats) => number) => days.reduce((a, x) => a + pick(x.d), 0);
  const n = (v: number) => v.toLocaleString(lang);
  const today = days[days.length - 1].d;
  const spentByChain = new Map<string, bigint>();
  for (const x of days) for (const [id, v] of Object.entries(x.d.spent)) spentByChain.set(id, (spentByChain.get(id) ?? 0n) + BigInt(v));
  const spent = [...spentByChain.entries()].map(([id, v]) => `${formatAmount(v)} ${chainMeta(Number(id), networks.byId.get(Number(id))?.cfg.name ?? id).asset}`).join(" · ");

  return (
    <section className="border-b border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-bold">{t("Statistiques")}</h2>
        <button
          className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
          onClick={() => void stats.refetch()}
          disabled={stats.isFetching}
        >
          {stats.isFetching ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />} {t("Actualiser")}
        </button>
      </div>
      <Tabs
        value={range}
        onChange={setRange}
        items={[
          { value: "14", label: t("14 jours") },
          { value: "30", label: t("30 jours") },
          { value: "90", label: t("90 jours") },
        ]}
      />
      {stats.isPending ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted">
          <Spinner />
          {t("Lecture des événements onchain… La première fois peut prendre une minute, ensuite seuls les nouveaux blocs sont lus.")}
        </div>
      ) : stats.isError ? (
        <p className="py-6 text-sm text-danger">{t("Impossible de lire les statistiques pour le moment.")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label={t("Comptes au total")} value={n(stats.data?.known.length ?? 0)} />
            <Tile label={t("Nouveaux comptes")} value={n(sum((d) => d.newUsers))} hint={t("sur la période")} />
            <Tile label={t("Actifs aujourd'hui")} value={n(today.active.length)} />
            <Tile label={t("Posts et commentaires")} value={n(sum((d) => d.posts + d.comments))} hint={t("sur la période")} />
            <Tile label={t("Opérations sponsorisées")} value={n(sum((d) => d.ops))} hint={t("sur la période")} />
            <Tile label={t("Gas payé par la plateforme")} value={spent || "0"} hint={t("sur la période")} />
          </div>
          <BarChart title={t("Nouveaux comptes par jour")} points={series((d) => d.newUsers)} />
          <BarChart title={t("Comptes actifs par jour")} points={series((d) => d.active.length)} />
          <BarChart title={t("Posts par jour")} points={series((d) => d.posts)} />
          <BarChart title={t("Commentaires par jour")} points={series((d) => d.comments)} />
          <BarChart title={t("Likes par jour")} points={series((d) => d.likes)} />
          <BarChart title={t("Abonnements par jour")} points={series((d) => d.follows)} />
          <BarChart title={t("Messages privés chiffrés par jour")} points={series((d) => d.dms)} />
          <BarChart title={t("Images par jour")} points={series((d) => d.images)} />
          <BarChart title={t("Opérations sponsorisées par jour")} points={series((d) => d.ops)} />
          <p className="text-[12px] text-subtle">
            {t("Calculé dans votre navigateur à partir des événements publics des contrats (120 derniers jours au plus). Un compte est compté le jour de sa première action onchain. Les messages privés incluent la synchronisation chiffrée entre appareils.")}
          </p>
        </div>
      )}
    </section>
  );
}
