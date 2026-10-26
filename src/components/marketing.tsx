import { Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Anchor, ChevronDown, Gift, Heart, Lock, MessageCircle, Moon, PenLine, Search, Sun, ThumbsDown, Users } from "lucide-react";
import { formatEther } from "viem";
import { contentAbi } from "@/abi";
import { env } from "@/env";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { compact } from "@/lib/format";
import { useAuth } from "@/identity/store";
import { useConfig, useNetworks } from "@/queries/core";
import { preloadPage } from "@/routes";

const ENTRYPOINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as const;
const balanceOfAbi = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("flex items-center gap-2", className)}>
      <img src="./icon.svg" alt="" className="size-6 rounded-md" />
      <span className="text-[17px] font-medium tracking-tight">arobase.chat</span>
    </span>
  );
}

export function MarketingHeader() {
  const t = useT();
  const identity = useAuth((s) => s.identity);
  const { theme, set } = useSettings();
  const dark = theme === "dark" || (theme === "system" && document.documentElement.classList.contains("dark"));
  return (
    <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-5">
        <Link to="/">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 whitespace-nowrap text-sm font-medium">
          <Link to="/comment-ca-marche" className="hidden rounded-md px-3 py-1.5 text-muted transition hover:text-fg md:block">
            {t("Comment ça marche")}
          </Link>
          <Link to="/comment-ca-marche#instance" className="hidden rounded-md px-3 py-1.5 text-muted transition hover:text-fg md:block">
            Open source
          </Link>
          <button
            onClick={() => set({ theme: dark ? "light" : "dark" })}
            className="rounded-md p-2 text-muted transition hover:text-fg"
            aria-label={t("Changer de thème")}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          {identity ? (
            <Link to="/" className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-fg transition hover:opacity-90">
              {t("Ouvrir arobase.chat")}
            </Link>
          ) : (
            <>
              <Link
                to="/bienvenue?mode=login"
                onMouseEnter={() => preloadPage("onboarding")}
                className="rounded-lg border border-line px-3 py-1.5 text-muted transition hover:border-subtle hover:text-fg"
              >
                {t("Connexion")}
              </Link>
              <Link
                to="/bienvenue"
                onMouseEnter={() => preloadPage("onboarding")}
                className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-fg transition hover:opacity-90"
              >
                {t("Ouvrir arobase.chat")}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("relative mx-auto max-w-[1200px] border-x border-line", className)}>{children}</div>;
}

export function DashedRule() {
  return <div aria-hidden className="dashed-x h-px w-full" />;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-md border border-tag-line bg-tag px-1.5 py-0.5 text-sm text-tag-fg">{children}</span>;
}

export function FeatureList({ items }: { items: { icon: ReactNode; label: ReactNode }[] }) {
  return (
    <ul className="mt-8 space-y-3.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-3 text-sm text-fg/90">
          <span className="text-accent">{it.icon}</span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function SplitSection({
  id,
  tag,
  title,
  text,
  features,
  visual,
  reverse,
}: {
  id?: string;
  tag: string;
  title: ReactNode;
  text: ReactNode;
  features?: { icon: ReactNode; label: ReactNode }[];
  visual: ReactNode;
  reverse?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-16 grid lg:grid-cols-2">
      <div className={clsx("flex flex-col justify-center px-6 py-20 sm:px-16 lg:py-32", reverse && "lg:order-2")}>
        <div>
          <Tag>{tag}</Tag>
        </div>
        <h2 className="display mt-5 text-[2.4rem] sm:text-[3.2rem]">{title}</h2>
        <p className="mt-6 max-w-md text-[17px] leading-[1.65] text-muted">{text}</p>
        {features && <FeatureList items={features} />}
      </div>
      <div className={clsx("hatch relative flex items-center justify-center overflow-hidden border-line px-6 py-16 lg:border-l", reverse && "lg:order-1 lg:border-l-0 lg:border-r")}>
        {visual}
      </div>
    </section>
  );
}

export function MockWindow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("relative w-full max-w-[460px] overflow-hidden rounded-xl border border-tag-line/60 bg-surface shadow-2xl shadow-black/40", className)}>
      <div className="dots h-6 border-b border-line bg-tag/60 opacity-80" />
      <div className="p-4">{children}</div>
    </div>
  );
}

const MOCK_POSTS = [
  { name: "Camille", handle: "0x7a3…91c", time: "2 min", text: "Premier post sur un réseau que personne ne peut couper. Signé, horodaté, pour toujours.", likes: 128, comments: 14, anchor: "Arbitrum" },
  { name: "Inès", handle: "0x2f8…0de", time: "11 min", text: "Les likes vivent sur une seule chain, le contenu sur plusieurs. Pas de double compte, pas de serveur.", likes: 64, comments: 7 },
  { name: "Noah", handle: "0xb51…4a2", time: "38 min", text: "Mes DM sont chiffrés de bout en bout dans le navigateur. Onchain : du bruit.", likes: 41, comments: 3 },
];

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);

export function AppMock() {
  const t = useT();
  return (
    <div className="relative mx-auto w-full max-w-[1120px]">
      <div aria-hidden className="absolute -inset-x-20 -top-10 h-64 rounded-full bg-[rgb(var(--glow)/0.25)] blur-[100px]" />
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/50">
        <div className="grid grid-cols-[200px_1fr_260px] max-lg:grid-cols-[1fr] text-[12px]">
          <aside className="border-r border-line p-3 max-lg:hidden">
            <div className="mb-4 flex items-center gap-2 px-2 pt-1">
              <img src="./icon.svg" alt="" className="size-4 rounded" />
              <span className="font-medium">arobase.chat</span>
              <span className="text-[10px] text-accent">v1</span>
            </div>
            <div className="mb-3 flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-subtle">
              <Search className="size-3" /> {t("Rechercher")}
            </div>
            {["Accueil", "Explorer", "Messages", "Profil", "Portefeuille", "Réglages"].map((n, i) => (
              <div key={n} className={clsx("rounded-md px-2 py-1.5", i === 0 ? "bg-elevated text-fg" : "text-muted")}>
                {t(n)}
              </div>
            ))}
          </aside>
          <main className="min-h-[380px] border-r border-line max-lg:border-r-0">
            <div className="flex border-b border-line text-[12px]">
              <div className="flex-1 border-b-2 border-accent py-2.5 text-center font-medium">{t("Abonnements")}</div>
              <div className="flex-1 py-2.5 text-center text-muted">Global</div>
            </div>
            {MOCK_POSTS.map((p) => (
              <div key={p.name} className="flex gap-2.5 border-b border-line px-4 py-3">
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, hsl(${hue(p.name)} 75% 60%), hsl(${(hue(p.name) + 70) % 360} 70% 45%))` }}
                >
                  {p.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-subtle">
                      {p.handle} · {t(p.time)}
                    </span>
                    {p.anchor && (
                      <span className="ml-1 inline-flex items-center gap-1 rounded border border-ok/30 bg-ok/10 px-1 text-[10px] text-ok">
                        <Anchor className="size-2.5" />
                        {p.anchor}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 leading-snug text-fg/90">{t(p.text)}</p>
                  <div className="mt-1.5 flex gap-6 text-subtle">
                    <span className="flex items-center gap-1">
                      <MessageCircle className="size-3" /> {p.comments}
                    </span>
                    <span className="flex items-center gap-1 text-danger">
                      <Heart className="size-3 fill-current" /> {p.likes}
                    </span>
                    <ThumbsDown className="size-3" />
                  </div>
                </div>
              </div>
            ))}
          </main>
          <aside className="space-y-3 p-3 max-lg:hidden">
            <div className="rounded-lg border border-line p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-subtle">Chains</p>
              {[
                ["Gnosis", "sociale", "accent"],
                ["Arc", "contenu", "accent"],
                ["Arbitrum", "ancrage", "ok"],
                ["Base", "ancrage", "ok"],
              ].map(([n, r, tone]) => (
                <div key={n} className="flex items-center justify-between py-1">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-ok shadow-[0_0_6px_var(--ok)]" />
                    {n}
                  </span>
                  <span className={tone === "ok" ? "text-ok" : "text-accent"}>{t(r)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-subtle">Gas</p>
              <p className="flex items-center gap-1.5 text-ok">
                <Gift className="size-3" /> {t("Sponsorisé")}
              </p>
              <p className="mt-1 text-subtle">{t("Paymaster ERC-4337, preuve de travail ~1 s")}</p>
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-subtle">Messages</p>
              <p className="flex items-center gap-1.5">
                <Lock className="size-3 text-accent" /> {t("Chiffrés de bout en bout")}
              </p>
            </div>
          </aside>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="flex items-center gap-1 rounded-full border border-line bg-elevated/90 p-1 text-[12px] shadow-xl backdrop-blur">
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted">
              <Users className="size-3" /> {t("Fil")}
            </span>
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted">
              <Lock className="size-3" /> Messages
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-medium text-primary-fg">
              <PenLine className="size-3" /> {t("Publier")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChainStripInner() {
  const t = useT();
  const config = useConfig();
  const sponsored = new Set(Object.keys(config.params.aa ?? {}).map(Number));
  const chains = config.chains.filter((c) => c.active);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-0 gap-y-3">
      {chains.map((c, i) => (
        <span key={c.chainId} className={clsx("flex items-center gap-2 px-6 text-[15px] font-medium sm:px-9", i > 0 && "sm:border-l sm:border-line")}>
          <span className={clsx("size-1.5 rounded-full shadow-[0_0_8px_currentColor]", c.role === 2 ? "bg-ok text-ok" : "bg-accent text-accent")} />
          {c.name}
          <span className="text-xs font-normal text-subtle">
            {c.role === 0 ? t("social") : c.role === 1 ? (sponsored.has(c.chainId) ? t("contenu · gratuit") : t("contenu")) : t("ancrage")}
          </span>
        </span>
      ))}
    </div>
  );
}

export function ChainStrip() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto h-6 w-2/3 rounded" />}>
      <ChainStripInner />
    </Suspense>
  );
}

function LiveStatsInner() {
  const t = useT();
  const config = useConfig();
  const networks = useNetworks();
  const { data } = useQuery({
    queryKey: ["landing-stats", networks.key],
    staleTime: 60_000,
    meta: { persist: false },
    queryFn: async () => {
      const counts = await Promise.all(
        networks.content.map((n) =>
          n.client.readContract({ address: n.cfg.content, abi: contentAbi, functionName: "count" }).catch(() => 0n),
        ),
      );
      const budgets = await Promise.all(
        Object.entries(config.params.aa ?? {}).map(async ([id, aa]) => {
          const net = networks.byId.get(Number(id));
          if (!net) return 0;
          const b = await net.client
            .readContract({ address: ENTRYPOINT, abi: balanceOfAbi, functionName: "balanceOf", args: [aa.paymaster] })
            .catch(() => 0n);
          return Number(formatEther(b));
        }),
      );
      return {
        messages: Number(counts.reduce((a, b) => (a > b ? a : b), 0n)),
        budget: budgets.reduce((a, b) => a + b, 0),
      };
    },
  });
  const stats = [
    { value: String(config.chains.filter((c) => c.active).length), label: "Blockchains" },
    { value: data ? compact.format(data.messages) : "—", label: t("Messages onchain") },
    { value: data ? `$${compact.format(data.budget)}` : "—", label: t("Budget de gas sponsorisé") },
    { value: "0", label: t("Serveur à couper") },
  ];
  return (
    <div className="grid grid-cols-2 gap-y-10 md:grid-cols-4">
      {stats.map((s, i) => (
        <div key={s.label} className={clsx("text-center", i > 0 && "md:border-l md:border-fg/15")}>
          <p className="text-[2.4rem] font-normal tracking-tight">{s.value}</p>
          <p className="mt-1 text-sm text-muted">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

export function LiveStats() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto h-16 w-3/4 rounded" />}>
      <LiveStatsInner />
    </Suspense>
  );
}

const ROLE_META = [
  { label: "Chain sociale", hint: "Likes, abonnements, rôles, votes. Une seule chain : rien ne compte double." },
  { label: "Contenu", hint: "Posts, commentaires, notes, messages privés. Gas sponsorisé." },
  { label: "Ancrage", hint: "Copie permanente optionnelle sur une chain majeure." },
];

function LiveChainsInner({ stacked }: { stacked?: boolean }) {
  const t = useT();
  const config = useConfig();
  const sponsored = new Set(Object.keys(config.params.aa ?? {}).map(Number));
  return (
    <div className={clsx("grid gap-px overflow-hidden rounded-xl border border-line bg-line", !stacked && "md:grid-cols-3")}>
      {[0, 1, 2].map((role) => (
        <div key={role} className="bg-surface p-5">
          <p className="text-sm font-medium">{t(ROLE_META[role].label)}</p>
          <div className="my-3 flex flex-wrap gap-1.5">
            {config.chains
              .filter((c) => c.active && c.role === role)
              .map((c) => (
                <span key={c.chainId} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-0.5 text-[13px]">
                  <span className={clsx("size-1.5 rounded-full", role === 2 ? "bg-ok" : "bg-accent")} />
                  {c.name}
                  {sponsored.has(c.chainId) && <Gift className="size-3 text-accent" aria-label={t("gas sponsorisé")} />}
                </span>
              ))}
          </div>
          <p className="text-[13px] leading-relaxed text-muted">{t(ROLE_META[role].hint)}</p>
        </div>
      ))}
    </div>
  );
}

export function LiveChains({ stacked }: { stacked?: boolean }) {
  return (
    <Suspense fallback={<div className="skeleton h-32 rounded-xl" />}>
      <LiveChainsInner stacked={stacked} />
    </Suspense>
  );
}

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((it, i) => (
        <div key={it.q}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className="flex w-full items-center justify-between gap-4 py-5 text-left text-[17px] font-medium"
          >
            {it.q}
            <ChevronDown className={clsx("size-4 shrink-0 text-subtle transition", open === i && "rotate-180")} />
          </button>
          {open === i && <div className="-mt-1 max-w-2xl pb-6 text-[15px] leading-relaxed text-muted">{it.a}</div>}
        </div>
      ))}
    </div>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-bg p-4 text-left font-mono text-[12.5px] leading-relaxed text-fg/85">
      <code>{children}</code>
    </pre>
  );
}

export function MarketingFooter() {
  const t = useT();
  return (
    <footer className="relative overflow-hidden">
      <Frame className="border-t border-line">
        <div className="relative z-10 grid gap-10 px-6 pb-40 pt-20 sm:px-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">{t("Un protocole ouvert. Cette instance n'est qu'une porte d'entrée parmi d'autres.")}</p>
          </div>
          <div>
            <p className="mb-5 text-sm font-medium">{t("Produit")}</p>
            <ul className="space-y-3 text-sm text-muted">
              <li>
                <Link to="/bienvenue" className="hover:text-fg">
                  {t("Créer un compte")}
                </Link>
              </li>
              <li>
                <Link to="/bienvenue?mode=login" className="hover:text-fg">
                  {t("Se connecter")}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-5 text-sm font-medium">{t("Comprendre")}</p>
            <ul className="space-y-3 text-sm text-muted">
              <li>
                <Link to="/comment-ca-marche" className="hover:text-fg">
                  {t("Comment ça marche")}
                </Link>
              </li>
              <li>
                <Link to="/comment-ca-marche#chains" className="hover:text-fg">
                  {t("Les chains")}
                </Link>
              </li>
              <li>
                <Link to="/comment-ca-marche#moderation" className="hover:text-fg">
                  {t("La modération")}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-5 text-sm font-medium">Open source</p>
            <ul className="space-y-3 text-sm text-muted">
              <li>
                <Link to="/comment-ca-marche#instance" className="hover:text-fg">
                  {t("Lancer une instance")}
                </Link>
              </li>
              {env.repoUrl && (
                <li>
                  <a href={env.repoUrl} target="_blank" rel="noreferrer" className="hover:text-fg">
                    GitHub
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div aria-hidden className="glow-bottom absolute inset-x-0 bottom-0 h-56" />
        <div aria-hidden className="dots mask-fade-y absolute inset-x-0 bottom-0 h-56 opacity-50" />
      </Frame>
    </footer>
  );
}
