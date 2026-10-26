import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  Bell,
  Bookmark,
  CheckCircle2,
  Compass,
  Home,
  HelpCircle,
  Loader2,
  Mail,
  Settings,
  Shield,
  User,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { useAuth, useViewer } from "@/identity/store";
import { useSocialQueue } from "@/lib/social-queue";
import { useTxs } from "@/lib/tx";
import { txUrl } from "@/lib/chain-meta";
import { preloadPage, pageForPath } from "@/routes";
import { useUserStats } from "@/queries/core";
import { useEncryptedSync, useUnreadConversations, useUnreadNotifications } from "@/queries/notifications";
import { useServiceWorkerConfig } from "@/lib/sw-config";
import { Avatar } from "./Avatar";
import { PullToRefresh } from "./PullToRefresh";
import { Composer } from "./Composer";
import { useCompose } from "./PostExtras";
import { DisplayName } from "./UserLink";
import { SearchBox, TrendingTags } from "./Search";
import { Modal, Spinner } from "./ui";
import { useT } from "@/lib/i18n";

function Count({ n, className }: { n?: number; className?: string }) {
  if (!n) return null;
  return (
    <span
      className={clsx(
        "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-none text-accent-fg tabular-nums",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function useBadges(enabled: boolean) {
  const notifs = useUnreadNotifications();
  const dms = useUnreadConversations();
  const total = enabled ? notifs + dms : 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = total ? `(${total > 99 ? "99+" : total}) ${base}` : base;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (total) void nav.setAppBadge?.(total).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [total]);
  return { notifs, dms };
}

function NavItem({ to, icon: Icon, label, end, badge }: { to: string; icon: typeof Home; label: string; end?: boolean; badge?: number }) {
  const page = pageForPath(to);
  return (
    <NavLink
      to={to}
      end={end}
      onMouseEnter={() => page && preloadPage(page)}
      onFocus={() => page && preloadPage(page)}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-4 rounded-lg px-4 py-2.5 text-[15px] transition hover:bg-elevated",
          isActive ? "bg-elevated font-medium text-fg" : "text-muted hover:text-fg",
        )
      }
    >
      <span className="relative">
        <Icon className="size-6 shrink-0" />
        <Count n={badge} className="absolute -right-2 -top-1.5 xl:hidden" />
      </span>
      <span className="hidden xl:inline">{label}</span>
      <Count n={badge} className="ml-auto hidden xl:flex" />
    </NavLink>
  );
}

function ComposeModal() {
  const t = useT();
  const { open, quote, close } = useCompose();
  return (
    <Modal open={open} onClose={close} title={t("Citer ce post")}>
      <div className="-mx-4 -mb-4">{open && <Composer quote={quote} autoFocus onDone={close} compact />}</div>
    </Modal>
  );
}

function TxToasts() {
  const t = useT();
  const list = useTxs((s) => s.list);
  const dismiss = useTxs((s) => s.dismiss);
  const queued = useSocialQueue((s) => s.queued.length + s.inflight);
  const lastError = useSocialQueue((s) => s.lastError);
  useEffect(() => {
    const done = list.filter((tx) => tx.status === "confirmed" && Date.now() - tx.at > 0);
    if (!done.length) return;
    const timer = setTimeout(() => done.forEach((tx) => dismiss(tx.id)), 6000);
    return () => clearTimeout(timer);
  }, [list, dismiss]);
  const visible = list.slice(-4);
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2 sm:bottom-6">
      {queued > 0 && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lg">
          <Loader2 className="size-4 animate-spin text-accent" /> {t("{n} action(s) sociale(s) en file — envoi groupé", { n: queued })}
        </div>
      )}
      {lastError && queued === 0 && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-danger/40 bg-surface px-3 py-2 text-sm shadow-lg">
          <XCircle className="size-4 text-danger" /> {lastError}
          <button className="ml-auto text-muted" onClick={() => useSocialQueue.setState({ lastError: undefined })}>
            <X className="size-4" />
          </button>
        </div>
      )}
      {visible.map((tx) => (
        <div key={tx.id} className="pointer-events-auto flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lg">
          {tx.status === "confirmed" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
          ) : tx.status === "failed" ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {t(tx.label)} <span className="font-normal text-muted">· {tx.chainName}</span>
            </p>
            <p className="text-muted">
              {tx.status === "signing" && t("Préparation…")}
              {tx.status === "pending" && t("En attente d'inclusion dans un bloc…")}
              {tx.status === "confirmed" && (
                <>
                  {t("Inclus dans la chain.")}{" "}
                  {tx.hash && txUrl(tx.chainId, tx.hash) && (
                    <a href={txUrl(tx.chainId, tx.hash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {t("Voir la transaction")}
                    </a>
                  )}
                </>
              )}
              {tx.status === "failed" && <span className="break-words text-danger">{tx.error}</span>}
            </p>
          </div>
          <button className="text-muted hover:text-fg" onClick={() => dismiss(tx.id)} aria-label={t("Fermer")}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AccountChip() {
  const t = useT();
  const viewer = useViewer();
  const identity = useAuth((s) => s.identity);
  const navigate = useNavigate();
  if (!viewer)
    return (
      <button onClick={() => navigate("/bienvenue")} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-fg hover:opacity-90">
        <span className="hidden xl:inline">{t("Créer un compte")}</span>
        <User className="mx-auto size-5 xl:hidden" />
      </button>
    );
  return (
    <button onClick={() => navigate(`/u/${viewer}`)} className="flex w-full items-center gap-3 rounded-full p-2 hover:bg-elevated">
      <Avatar address={viewer} size={40} />
      <div className="hidden min-w-0 text-left xl:block">
        <DisplayName address={viewer} className="block truncate font-bold" />
        <span className="block truncate text-sm text-muted">{identity?.type === "dev" ? t("compte de dev") : "passkey"}</span>
      </div>
    </button>
  );
}

export function Layout() {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const onExplorer = location.pathname.startsWith("/explorer");
  const role = useUserStats(viewer).data?.role ?? 0;
  const badges = useBadges(!!viewer);
  useEncryptedSync();
  useServiceWorkerConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav: { to: string; icon: typeof Home; label: string; end?: boolean; badge?: number }[] = [
    { to: "/", icon: Home, label: t("Accueil"), end: true },
    { to: "/explorer", icon: Compass, label: t("Explorer") },
    ...(viewer
      ? [
          { to: "/notifications", icon: Bell, label: t("Notifications"), badge: badges.notifs },
          { to: "/messages", icon: Mail, label: t("Messages"), badge: badges.dms },
          { to: `/u/${viewer}`, icon: User, label: t("Profil") },
          { to: "/enregistres", icon: Bookmark, label: t("Enregistrés") },
          { to: "/portefeuille", icon: Wallet, label: t("Portefeuille") },
        ]
      : []),
    { to: "/reglages", icon: Settings, label: t("Réglages") },
    { to: "/comment-ca-marche", icon: HelpCircle, label: t("Comment ça marche") },
    ...(role >= 1 ? [{ to: "/admin", icon: Shield, label: t("Administration") }] : []),
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1280px] justify-center">
      <header className="sticky top-0 hidden h-dvh w-[88px] shrink-0 flex-col justify-between px-3 py-3 sm:flex xl:w-[260px]">
        <div className="space-y-1">
          <NavLink to="/" className="mb-2 flex items-center gap-2 px-4 py-2">
            <img src="./icon.svg" alt="" className="size-8" />
            <span className="hidden text-lg font-medium tracking-tight xl:inline">arobase.chat</span>
          </NavLink>
          <nav className="space-y-1">
            {nav.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
        </div>
        <AccountChip />
      </header>

      <main className="min-h-dvh w-full max-w-[600px] border-line pb-20 sm:border-x sm:pb-0">
        <Suspense
          fallback={
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      <aside className="sticky top-0 hidden h-dvh w-[350px] shrink-0 space-y-4 overflow-y-auto px-6 py-3 lg:block">
        <SearchBox />
        {onExplorer && <TrendingTags />}
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="font-medium">{t("Comment ça marche ?")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {t("arobase.chat tourne entièrement dans votre navigateur : chaque action est signée par votre clé et publiée sur des blockchains. Aucun serveur ne peut l'éteindre.")}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
            <NavLink to="/comment-ca-marche#chains" className="text-accent hover:underline">
              {t("Les chains")}
            </NavLink>
            <NavLink to="/comment-ca-marche#moderation" className="text-accent hover:underline">
              {t("La modération")}
            </NavLink>
            <NavLink to="/comment-ca-marche#instance" className="text-accent hover:underline">
              {t("Open source")}
            </NavLink>
          </div>
        </section>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {nav.slice(0, viewer ? 4 : 5).map(({ to, icon: Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx("relative p-3.5", isActive ? "text-fg" : "text-muted")}>
            <Icon className="size-6" />
            <Count n={badge} className="absolute right-1.5 top-1.5" />
          </NavLink>
        ))}
        {viewer && (
          <button onClick={() => setMenuOpen(true)} className={clsx("p-3", menuOpen ? "text-fg" : "text-muted")} aria-label={t("Menu")}>
            <Avatar address={viewer} size={30} />
          </button>
        )}
      </nav>
      {menuOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
            {nav.slice(4).map(({ to, icon: Icon, label, badge }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => clsx("flex items-center gap-4 rounded-lg px-4 py-3 text-[16px]", isActive ? "bg-elevated text-fg" : "text-muted")}
              >
                <Icon className="size-6" />
                <span className="flex-1">{label}</span>
                <Count n={badge} />
              </NavLink>
            ))}
          </div>
        </div>
      )}
      <TxToasts />
      <PullToRefresh />
      <ComposeModal />
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
