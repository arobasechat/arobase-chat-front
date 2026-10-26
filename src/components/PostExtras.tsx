import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Check, ImageOff, Repeat2, Undo2 } from "lucide-react";
import type { Address, Hex } from "viem";
import { create } from "zustand";
import { useViewer } from "@/identity/store";
import { timeAgo } from "@/lib/format";
import { gatewayUrl, isCid } from "@/lib/ipfs";
import { isOnchainRef } from "@/lib/media";
import type { Message } from "@/lib/protocol";
import { useConfig } from "@/queries/core";
import { useOnchainImage } from "@/queries/media";
import { type PostExtras, useVote } from "@/queries/extras";
import { useMessage } from "@/queries/feed";
import { Avatar } from "./Avatar";
import { RichText } from "./RichText";
import { DisplayName, UserLink } from "./UserLink";
import { useT } from "@/lib/i18n";

export const useCompose = create<{ open: boolean; quote?: Message; openWith: (quote?: Message) => void; close: () => void }>((set) => ({
  open: false,
  openWith: (quote) => set({ open: true, quote }),
  close: () => set({ open: false, quote: undefined }),
}));

function OnchainImage({ refId, single }: { refId: string; single: boolean }) {
  const t = useT();
  const { url, isError } = useOnchainImage(refId);
  if (isError)
    return (
      <div className="flex h-40 items-center justify-center gap-2 bg-elevated text-sm text-muted">
        <ImageOff className="size-4" /> {t("Image indisponible")}
      </div>
    );
  if (!url) return <div className={clsx("skeleton w-full", single ? "h-64" : "h-40")} />;
  return <img src={url} alt="" decoding="async" className="max-h-[480px] w-full object-cover" />;
}

export function MediaGrid({ items }: { items: string[] }) {
  const gateways = useConfig().params.ipfsGateways ?? [];
  const valid = items.filter((m) => isCid(m) || isOnchainRef(m)).slice(0, 4);
  if (!valid.length) return null;
  return (
    <div
      className={clsx("mt-3 grid gap-0.5 overflow-hidden rounded-2xl border border-line", valid.length > 1 && "grid-cols-2")}
      onClick={(e) => e.stopPropagation()}
    >
      {valid.map((m) =>
        isOnchainRef(m) ? (
          <OnchainImage key={m} refId={m} single={valid.length === 1} />
        ) : (
          <img key={m} src={gatewayUrl(gateways, m)} alt="" loading="lazy" decoding="async" className="max-h-[480px] w-full object-cover" />
        ),
      )}
    </div>
  );
}

export function QuotedPost({ id }: { id: Hex }) {
  const t = useT();
  const { data, isPending, isError } = useMessage(id);
  if (isPending) return <div className="skeleton mt-3 h-20 rounded-xl" />;
  if (isError || !data) return <div className="mt-3 rounded-xl border border-line px-3 py-2 text-sm text-muted">{t("Post cité introuvable.")}</div>;
  return (
    <Link
      to={`/p/${id}`}
      onClick={(e) => e.stopPropagation()}
      className="mt-3 block rounded-xl border border-line px-3 py-2.5 transition hover:bg-elevated/50"
    >
      <div className="flex items-center gap-2 text-sm">
        <Avatar address={data.author} size={20} />
        <DisplayName address={data.author} className="truncate font-semibold" />
        <span className="text-muted">· {timeAgo(data.ts)}</span>
      </div>
      {data.body.text && <RichText text={data.body.text} className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-[15px]" />}
      {data.body.media && <MediaGrid items={data.body.media} />}
    </Link>
  );
}

export function Poll({ m, extras }: { m: Message; extras?: PostExtras }) {
  const t = useT();
  const viewer = useViewer();
  const vote = useVote();
  const poll = m.body.poll!;
  const options = poll.options.slice(0, 4);
  const counts = options.map((_, i) => extras?.poll[i] ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const ended = Date.now() / 1000 > poll.end;
  const mine = (extras?.viewerChoice ?? 0) - 1;
  const showResults = ended || mine >= 0 || !viewer;
  const [, tick] = useState(0);
  useEffect(() => {
    if (ended) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(60_000, Math.max(1_000, (poll.end - Date.now() / 1000) * 1000)));
    return () => clearTimeout(timer);
  });
  const left = poll.end - Date.now() / 1000;
  return (
    <div className="mt-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {options.map((label, i) => {
        const pct = total ? Math.round((counts[i] / total) * 100) : 0;
        return showResults ? (
          <button
            key={i}
            disabled={ended || !viewer}
            onClick={() => vote.mutate({ poll: m, choice: i })}
            className="relative flex w-full items-center justify-between overflow-hidden rounded-lg border border-line px-3 py-2 text-left text-sm enabled:hover:border-accent/60"
          >
            <span className={clsx("absolute inset-y-0 left-0 bg-accent/15 transition-all", mine === i && "bg-accent/30")} style={{ width: `${pct}%` }} />
            <span className="relative flex items-center gap-1.5 font-medium">
              {label} {mine === i && <Check className="size-3.5 text-accent" />}
            </span>
            <span className="relative tabular-nums text-muted">{pct} %</span>
          </button>
        ) : (
          <button
            key={i}
            onClick={() => vote.mutate({ poll: m, choice: i })}
            className="w-full rounded-full border border-accent/60 px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/10"
          >
            {label}
          </button>
        );
      })}
      <p className="text-xs text-muted">
        {total > 1 ? t("{n} votes", { n: total }) : t("{n} vote", { n: total })} ·{" "}
        {ended ? t("Sondage terminé") : left > 86_400 ? t("{n} j restants", { n: Math.ceil(left / 86_400) }) : left > 3600 ? t("{n} h restantes", { n: Math.ceil(left / 3600) }) : t("{n} min restantes", { n: Math.max(1, Math.ceil(left / 60)) })}
        {mine >= 0 && !ended && ` · ${t("touchez une autre option pour changer")}`}
      </p>
    </div>
  );
}

export function RepostHeader({ author }: { author: Address }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 px-4 pt-2.5 text-[13px] font-medium text-muted">
      <Repeat2 className="ml-6 size-4" />
      <UserLink address={author} className="hover:underline">
        <DisplayName address={author} />
      </UserLink>
      {t("a reposté")}
    </div>
  );
}

export function RetractedNotice({ onReveal }: { onReveal?: () => void }) {
  const t = useT();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onReveal?.();
      }}
      className="mt-2 flex w-full items-center gap-2 rounded-xl border border-line bg-elevated/60 px-3 py-2.5 text-left text-sm text-muted hover:bg-elevated"
    >
      <Undo2 className="size-4" /> {t("Retiré par son auteur. Il reste lisible onchain — afficher quand même")}
    </button>
  );
}
