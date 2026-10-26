import { lazy, Suspense, useEffect } from "react";
import {
  createBrowserRouter,
  createHashRouter,
  Navigate,
  RouterProvider,
  useLocation,
  useRouteError,
  type RouteObject,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { env } from "@/env";
import { useAuth } from "@/identity/store";
import { configureSocialQueue } from "@/lib/social-queue";
import { useSettings } from "@/lib/settings";
import { useDocumentLang, useT } from "@/lib/i18n";
import { pages } from "@/routes";
import { getConfig, getNetworks, useConfig, useNetworks } from "@/queries/core";
import { Layout } from "@/components/Layout";
import { Button, Spinner } from "@/components/ui";

const lazyPage = (name: keyof typeof pages) => async () => ({ Component: (await pages[name]()).default });

const Landing = lazy(pages.landing);

function PageFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner />
    </div>
  );
}

function Root() {
  const identity = useAuth((s) => s.identity);
  const location = useLocation();
  if (identity) return <Shell />;
  if (location.pathname === "/")
    return (
      <Suspense fallback={<PageFallback />}>
        <Landing />
      </Suspense>
    );
  return <Navigate to={`/bienvenue?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
}

function RouteError() {
  const error = useRouteError();
  const t = useT();
  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold tracking-tight">{t("Quelque chose s'est mal passé")}</h1>
      <p className="mt-2 break-words text-sm text-muted">{error instanceof Error ? error.message : String(error)}</p>
      <p className="mt-4 text-sm text-muted">
        {t("Si les RPC publics sont bloqués ou saturés, ajoutez-en d'autres dans les réglages. Vos données restent onchain.")}
      </p>
      <div className="mt-4 flex gap-2">
        <Button onClick={() => location.reload()}>{t("Recharger")}</Button>
        <Button variant="outline" onClick={() => (location.href = env.hashRouter ? "#/reglages" : "/reglages")}>
          {t("Réglages")}
        </Button>
      </div>
    </div>
  );
}

function Shell() {
  const qc = useQueryClient();
  const t = useT();
  useConfig();
  useNetworks();
  useEffect(() => {
    configureSocialQueue({ queryClient: qc, networks: getNetworks, config: getConfig });
  }, [qc]);
  const config = useConfig();
  const outdated = (config.params.minClientVersion ?? 0) > env.clientVersion;
  return (
    <>
      {outdated && (
        <div className="bg-warn px-4 py-2 text-center text-sm font-semibold text-black">
          {t("Une nouvelle version de l'application est requise. Rechargez la page ou utilisez un miroir à jour.")}
        </div>
      )}
      <Layout />
    </>
  );
}

const routes: RouteObject[] = [
  { path: "/bienvenue", errorElement: <RouteError />, lazy: lazyPage("onboarding") },
  { path: "/comment-ca-marche", errorElement: <RouteError />, lazy: lazyPage("about") },
  {
    path: "/",
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: lazyPage("home") },
      { path: "explorer", lazy: lazyPage("home") },
      { path: "p/:id", lazy: lazyPage("post") },
      { path: "u/:address", lazy: lazyPage("profile") },
      { path: "notifications", lazy: lazyPage("notifications") },
      { path: "enregistres", lazy: lazyPage("saved") },
      { path: "recherche", lazy: lazyPage("search") },
      { path: "messages", lazy: lazyPage("messages") },
      { path: "messages/:convId", lazy: lazyPage("messages") },
      { path: "portefeuille", lazy: lazyPage("wallet") },
      { path: "reglages", lazy: lazyPage("settings") },
      { path: "admin", lazy: lazyPage("admin") },
      { path: "*", lazy: lazyPage("notFound") },
    ],
  },
];

const router = env.hashRouter ? createHashRouter(routes) : createBrowserRouter(routes);

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

export function App() {
  useTheme();
  useDocumentLang();
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted">
          <img src="./icon.svg" alt="" className="size-12" />
          <Spinner />
          <p className="text-sm">{t("Lecture de la configuration onchain…")}</p>
        </div>
      }
    >
      <RouterProvider router={router} />
    </Suspense>
  );
}
