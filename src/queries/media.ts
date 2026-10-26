import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isOnchainRef, loadOnchain } from "@/lib/media";
import { useConfig, useNetworks } from "./core";

export function useOnchainImage(ref: string | undefined) {
  const networks = useNetworks();
  const config = useConfig();
  const enabled = !!ref && isOnchainRef(ref);
  const { data, isError } = useQuery({
    queryKey: ["media", ref],
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    meta: { persist: false },
    queryFn: () => loadOnchain(networks, config, ref!),
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!data) return;
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  return { url: enabled ? url : undefined, isError };
}
