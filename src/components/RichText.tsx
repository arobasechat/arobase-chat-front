import { Fragment, memo } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { cleanName, short } from "@/lib/format";
import { normalizeTag } from "@/lib/protocol";
import { preloadPage } from "@/routes";
import { useProfile } from "@/queries/core";
import { useHandle } from "@/queries/names";

const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|@(0x[a-fA-F0-9]{40})|(0x[a-fA-F0-9]{40})|#([A-Za-z0-9_\p{L}\p{N}]{2,50})/gu;

function linkLabel(url: string) {
  try {
    const u = new URL(url);
    const rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`;
    return `${u.hostname}${rest.length > 32 ? `${rest.slice(0, 31)}…` : rest}`;
  } catch {
    return url.slice(0, 48);
  }
}

function Mention({ address }: { address: Address }) {
  const { data: handle } = useHandle(address);
  const { data: profile } = useProfile(address);
  const label = handle ? `@${handle}` : `@${short(address)}`;
  return (
    <Link
      to={handle ? `/u/@${handle}` : `/u/${address}`}
      onMouseEnter={() => preloadPage("profile")}
      onClick={(e) => e.stopPropagation()}
      className="font-medium text-accent hover:underline"
      title={profile?.name ? `${cleanName(profile.name)} · ${address}` : address}
    >
      {label}
    </Link>
  );
}

export const RichText = memo(function RichText({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const [full, url, mention, addr, tag] = m;
    if (url)
      parts.push(
        <a key={i} href={url} target="_blank" rel="noopener noreferrer nofollow ugc" onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
          {linkLabel(url)}
        </a>,
      );
    else if (mention) parts.push(<Mention key={i} address={mention as Address} />);
    else if (addr)
      parts.push(
        <Link key={i} to={`/u/${addr as Address}`} onClick={(e) => e.stopPropagation()} className="font-mono text-accent hover:underline">
          {short(addr)}
        </Link>,
      );
    else if (tag)
      parts.push(
        <Link
          key={i}
          to={`/explorer?tag=${encodeURIComponent(normalizeTag(tag))}`}
          onMouseEnter={() => preloadPage("home")}
          onClick={(e) => e.stopPropagation()}
          className="text-accent hover:underline"
        >
          #{tag}
        </Link>,
      );
    else parts.push(<Fragment key={i}>{full}</Fragment>);
    last = i + full.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className={className ?? "whitespace-pre-wrap break-words text-[15px] leading-relaxed"}>{parts}</p>;
});
