import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";
import { env } from "./env";
import { readCachedConfig } from "./lib/config";
import { useAuth } from "./identity/store";
import { setBootConfig } from "./queries/core";
import { qk } from "./queries/keys";
import { App } from "./App";
import "./styles/index.css";

const PERSISTED = new Set(["feed", "stats", "profile", "user", "following", "followers", "notes", "staff", "msg"]);
const DAY = 24 * 60 * 60_000;

async function boot() {
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = JSON.parse(localStorage.getItem("arobase:settings") ?? "{}")?.state?.theme ?? "dark";
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark));

  const [cached] = await Promise.all([readCachedConfig().catch(() => undefined), useAuth.getState().init()]);
  setBootConfig(cached);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: DAY,
        retry: 2,
        retryDelay: (n) => Math.min(500 * 2 ** n, 4_000),
        refetchOnWindowFocus: true,
        networkMode: "offlineFirst",
      },
      mutations: { networkMode: "offlineFirst" },
    },
  });
  if (cached) queryClient.setQueryData(qk.config, cached, { updatedAt: cached.fetchedAt });

  const persister = createAsyncStoragePersister({
    storage: { getItem: get, setItem: set, removeItem: del },
    key: "arobase:query-cache",
    throttleTime: 1500,
    serialize: (v) => v as never,
    deserialize: (v) => v as never,
  });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: DAY,
          buster: `${env.clientVersion}:${env.registryAddress}`,
          dehydrateOptions: {
            shouldDehydrateQuery: (q) =>
              q.state.status === "success" && q.meta?.persist !== false && PERSISTED.has(String(q.queryKey[0])),
          },
        }}
      >
        <App />
      </PersistQueryClientProvider>
    </StrictMode>,
  );

  if (import.meta.env.PROD) {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  }
}

void boot();
