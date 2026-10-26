import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck } from "lucide-react";
import type { Address } from "viem";
import { cleanName, short } from "@/lib/format";
import { preloadPage } from "@/routes";
import { usePlatform, useProfile } from "@/queries/core";
import { useHandle } from "@/queries/names";

export function useDisplayName(address: Address) {
  const { data } = useProfile(address);
  return cleanName(data?.name) || short(address);
}

export function UserLink({ address, children, className }: { address: Address; children?: ReactNode; className?: string }) {
  return (
    <Link
      to={`/u/${address}`}
      onMouseEnter={() => preloadPage("profile")}
      onFocus={() => preloadPage("profile")}
      onClick={(e) => e.stopPropagation()}
      className={className}
    >
      {children}
    </Link>
  );
}

export function DisplayName({ address, className }: { address: Address; className?: string }) {
  const name = useDisplayName(address);
  const official = usePlatform()?.toLowerCase() === address.toLowerCase();
  return (
    <span className={className}>
      {name}
      {official && <BadgeCheck className="ml-1 inline size-[1.05em] align-[-0.15em] text-accent" aria-label="officiel" />}
    </span>
  );
}

export function HandleText({ address, className }: { address: Address; className?: string }) {
  const { data } = useHandle(address);
  if (!data) return null;
  return <span className={className ?? "truncate text-muted"}>@{data}</span>;
}
