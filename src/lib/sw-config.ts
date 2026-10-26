import { useEffect } from "react";
import { useViewer } from "@/identity/store";
import { platformOf } from "./config";
import { useConfig, useNetworks } from "@/queries/core";
import { useConversationTagKeys } from "@/queries/dm";

export const SW_CACHE = "arobase-sw";

export function useServiceWorkerConfig() {
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  const tagKeys = useConversationTagKeys();
  useEffect(() => {
    if (!("caches" in window) || !("serviceWorker" in navigator)) return;
    const value = {
      v: 1,
      me: viewer ?? null,
      platform: platformOf(config.params) ?? null,
      social: { chainId: networks.social.cfg.chainId, address: config.social, rpcs: networks.social.cfg.rpcs },
      tk: tagKeys ?? {},
      chains: Object.fromEntries(networks.content.map((n) => [n.cfg.chainId, { content: n.cfg.content, inbox: n.cfg.inbox, rpcs: n.cfg.rpcs }])),
    };
    void navigator.serviceWorker.ready
      .then(async (reg) => {
        const cache = await caches.open(SW_CACHE);
        await cache.put(`${reg.scope}__arobase/sw-config`, new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
      })
      .catch(() => undefined);
  }, [networks, config, viewer, tagKeys]);
}
