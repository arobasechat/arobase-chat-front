import { memo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  Anchor,
  Ban,
  Bookmark,
  Quote,
  Repeat2,
  Trash2,
  VolumeX,
  CheckCircle2,
  Copy,
  EyeOff,
  Flag,
  Heart,
  Info,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Message } from "@/lib/protocol";
import { compact, fullDate, timeAgo } from "@/lib/format";
import { visibility } from "@/lib/moderation";
import { useOverlay } from "@/lib/social-queue";
import { useSettings } from "@/lib/settings";
import { useViewer } from "@/identity/store";
import { preloadPage } from "@/routes";
import { permalink } from "@/lib/links";
import { useConfig, useNetworks, usePostStats, useUserStats, type PostStats } from "@/queries/core";
import { useThreadSummary } from "@/queries/notes";
import { useReplicate, useRetryPublish, useSocialActions } from "@/queries/actions";
import { useBookmarkIds, useToggleBookmark } from "@/queries/collections";
import { usePostExtras, useRepost, useRetract } from "@/queries/extras";
import { useHiddenAuthors, useSafety } from "@/lib/safety";
import { scheduleSync } from "@/lib/sync-trigger";
import { MediaGrid, Poll, QuotedPost, RetractedNotice, useCompose } from "./PostExtras";
import { qk } from "@/queries/keys";
import { Avatar } from "./Avatar";
import { DisplayName, HandleText, UserLink } from "./UserLink";
import { RichText } from "./RichText";
import { Menu } from "./Menu";
import { Badge } from "./ui";
import { useT } from "@/lib/i18n";

function applyOverlay(stats: PostStats | undefined, reaction: number | undefined, vote: number | undefined) {
  if (!stats) return undefined;
  let { likes, dislikes } = stats;
  const current = stats.viewerReaction;
  if (reaction !== undefined && reaction !== current) {
    if (current === 1) likes--;
    if (current === -1) dislikes--;
    if (reaction === 1) likes++;
    if (reaction === -1) dislikes++;
  }
  return {
    ...stats,
    likes,
    dislikes,
    viewerReaction: reaction ?? current,
    viewerVote: vote ?? stats.viewerVote,
  };
}

function ChainBadges({ m }: { m: Message }) {
  const t = useT();
  const networks = useNetworks();
  const ids = Object.keys(m.locations).map(Number);
  if (m.status === "pending")
    return (
      <Badge tone="warn">
        <Loader2 className="size-3 animate-spin" /> {t("inclusion…")}
      </Badge>
    );
  return (
    <>
      {ids
        .map((id) => networks.byId.get(id))
        .filter((n) => n?.cfg.role === 2)
        .map((n) => (
          <span key={n!.cfg.chainId} title={t("Copie ancrée sur {name}", { name: n!.cfg.name })}>
            <Badge tone="ok">
              <Anchor className="size-3" />
              {n!.cfg.name}
            </Badge>
          </span>
        ))}
    </>
  );
}

export const PostCard = memo(function PostCard({
  message: m,
  variant = "feed",
  showNotes = true,
}: {
  message: Message;
  variant?: "feed" | "focus" | "compact";
  showNotes?: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const viewer = useViewer();
  const config = useConfig();
  const networks = useNetworks();
  const mode = useSettings((s) => s.moderationMode);
  const confirmed = m.status === "confirmed";
  const { data: rawStats } = usePostStats(m.id, m.author, confirmed);
  const reactionOverlay = useOverlay(`react:${m.id}`);
  const voteOverlay = useOverlay(`vote:${m.id}`);
  const stats = applyOverlay(rawStats, reactionOverlay, voteOverlay);
  const summary = useThreadSummary(m.id, m.author, confirmed && showNotes && variant !== "compact");
  const viewerStats = useUserStats(viewer);
  const actions = useSocialActions();
  const replicate = useReplicate();
  const retry = useRetryPublish();
  const [reveal, setReveal] = useState(false);
  const bookmarks = useBookmarkIds();
  const toggleBookmark = useToggleBookmark();
  const saved = !!bookmarks.data?.has(m.id);
  const extrasQ = usePostExtras(m.id, m.status === "confirmed" && (m.kind === 0 || m.kind === 1));
  const extras = extrasQ.data;
  const repost = useRepost();
  const retract = useRetract();
  const compose = useCompose((s) => s.openWith);
  const { isHidden } = useHiddenAuthors(viewer);
  const setSafety = useSafety((s) => s.set);
  const [revealRetracted, setRevealRetracted] = useState(false);

  const isOwn = !!viewer && viewer.toLowerCase() === m.author.toLowerCase();
  const canReact = !!viewer && !isOwn;
  const vis = visibility(rawStats, mode, config.params.hideThreshold ?? 10);
  const isMod = (viewerStats.data?.role ?? 0) >= 1;
  const helpfulNotes = summary.data?.notes.filter((n) => n.score.status === "helpful") ?? [];

  const missingAnchors = networks.content.filter((n) => !(n.cfg.chainId in m.locations));
  const open = () => navigate(`/p/${m.id}`);
  const prefetch = () => {
    preloadPage("post");
    qc.setQueryData(qk.msg(m.id), m);
  };

  if (m.invalid) {
    return (
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-muted">
        <TriangleAlert className="size-4 text-warn" /> {t("Message rejeté : {reason}", { reason: m.invalid })}
      </div>
    );
  }

  if (variant !== "focus" && isHidden(m.author)) return null;
  const retracted = !!extras?.retracted && !revealRetracted;
  const reposted = !!extras?.viewerRepost;

  const header = (
    <div className="flex min-w-0 items-center gap-1.5 text-[15px]">
      <UserLink address={m.author} className="truncate font-semibold hover:underline">
        <DisplayName address={m.author} />
      </UserLink>
      <HandleText address={m.author} className="hidden truncate text-sm text-muted sm:inline" />
      <span className="text-muted">·</span>
      <time className="shrink-0 text-sm text-muted" dateTime={new Date(m.ts * 1000).toISOString()} title={fullDate(m.ts)}>
        {timeAgo(m.ts)}
      </time>
      <span className="ml-1 flex min-w-0 gap-1 overflow-hidden">
        <ChainBadges m={m} />
      </span>
    </div>
  );

  const body = retracted ? (
    <RetractedNotice onReveal={() => setRevealRetracted(true)} />
  ) : vis.hidden && !reveal ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setReveal(true);
        }}
        className="mt-2 flex w-full items-center gap-2 rounded-xl border border-line bg-elevated/60 px-3 py-2.5 text-left text-sm text-muted hover:bg-elevated"
      >
        <EyeOff className="size-4" /> {t(vis.reason ?? "")} — {t("afficher quand même")}
      </button>
    ) : (
      <>
        {m.body.text && (
          <RichText
            text={m.body.text}
            className={clsx("mt-0.5 whitespace-pre-wrap break-words leading-relaxed", variant === "focus" ? "text-[19px]" : "text-[15px]")}
          />
        )}
        {m.body.media && <MediaGrid items={m.body.media} />}
        {m.body.poll && <Poll m={m} extras={extras} />}
        {m.body.quote && variant !== "compact" && <QuotedPost id={m.body.quote} />}
      </>
    );

  return (
    <article
      onClick={variant === "focus" ? undefined : open}
      onMouseEnter={prefetch}
      className={clsx(
        "card-enter border-b border-line px-4 py-3 transition-colors",
        variant !== "focus" && "cursor-pointer hover:bg-elevated/40",
        m.status === "pending" && "opacity-80",
      )}
    >
      <div className="flex gap-3">
        <UserLink address={m.author} className="shrink-0">
          <Avatar address={m.author} size={variant === "compact" ? 32 : 40} />
        </UserLink>
        <div className="min-w-0 flex-1">
          {header}
          {body}

          {helpfulNotes.length > 0 && (
            <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-accent">
                <Info className="size-4" /> {t("Contexte ajouté par la communauté")}
              </div>
              <RichText text={helpfulNotes[0].message.body.text ?? ""} className="whitespace-pre-wrap break-words" />
              <Link to={`/p/${m.id}`} className="mt-1 inline-block text-xs text-muted hover:underline">
                {t("Évaluer cette note")}
              </Link>
            </div>
          )}

          {m.status === "failed" && (
            <div className="mt-2 flex items-center gap-2 text-sm text-danger">
              <TriangleAlert className="size-4" /> {t("Publication échouée")}
              <button
                className="inline-flex items-center gap-1 font-semibold underline"
                onClick={(e) => {
                  e.stopPropagation();
                  retry.mutate(m);
                }}
              >
                <RotateCcw className="size-3.5" /> {t("Réessayer")}
              </button>
            </div>
          )}

          {confirmed && (
            <div className="-ml-2 mt-1.5 flex max-w-md items-center justify-between text-muted" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={open}
                className="group flex items-center gap-1.5 rounded-full p-2 text-sm hover:text-accent"
                aria-label={t("Commenter")}
              >
                <MessageCircle className="size-[18px] group-hover:scale-110" />
                {summary.data && summary.data.comments > 0 && compact.format(summary.data.comments)}
              </button>
              <Menu
                align="left"
                trigger={
                  <button
                    disabled={!viewer}
                    className={clsx("group flex items-center gap-1.5 rounded-full p-2 text-sm transition enabled:hover:text-ok", reposted && "text-ok")}
                    aria-label={t("Reposter ou citer")}
                  >
                    <Repeat2 className="size-[18px] group-hover:scale-110" />
                    {!!extras?.reposts && compact.format(extras.reposts + (extras.quotes ?? 0))}
                  </button>
                }
                items={
                  viewer
                    ? [
                        {
                          label: reposted ? t("Annuler le repost") : t("Reposter"),
                          icon: <Repeat2 className="size-4" />,
                          onSelect: () =>
                            repost.mutate({ target: m, undo: reposted && extras?.viewerRepost !== `0x${"0".repeat(64)}` ? extras?.viewerRepost : undefined }),
                          disabled: reposted && extras?.viewerRepost === `0x${"0".repeat(64)}`,
                        },
                        { label: t("Citer"), icon: <Quote className="size-4" />, onSelect: () => compose(m) },
                      ]
                    : []
                }
              />
              <button
                onClick={() => canReact && actions.react(m.id, stats?.viewerReaction === 1 ? 0 : 1)}
                disabled={!canReact}
                title={isOwn ? t("Vous ne pouvez pas réagir à votre propre message") : undefined}
                className={clsx(
                  "group flex items-center gap-1.5 rounded-full p-2 text-sm transition enabled:hover:text-danger disabled:cursor-default",
                  stats?.viewerReaction === 1 && "text-danger",
                )}
                aria-pressed={stats?.viewerReaction === 1}
                aria-label={t("J'aime")}
              >
                <Heart className={clsx("size-[18px] group-hover:scale-110", stats?.viewerReaction === 1 && "fill-current")} />
                {!!stats?.likes && compact.format(stats.likes)}
              </button>
              <button
                onClick={() => canReact && actions.react(m.id, stats?.viewerReaction === -1 ? 0 : -1)}
                disabled={!canReact}
                title={isOwn ? t("Vous ne pouvez pas réagir à votre propre message") : undefined}
                className={clsx(
                  "group flex items-center gap-1.5 rounded-full p-2 text-sm transition enabled:hover:text-warn disabled:cursor-default",
                  stats?.viewerReaction === -1 && "text-warn",
                )}
                aria-pressed={stats?.viewerReaction === -1}
                aria-label={t("Je n'aime pas")}
              >
                <ThumbsDown className={clsx("size-[18px] group-hover:scale-110", stats?.viewerReaction === -1 && "fill-current")} />
                {!!stats?.dislikes && compact.format(stats.dislikes)}
              </button>
              {viewer && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBookmark.mutate({ postId: m.id, on: !saved });
                  }}
                  className={clsx("group rounded-full p-2 transition hover:text-accent", saved && "text-accent")}
                  aria-pressed={saved}
                  aria-label={saved ? t("Retirer des signets") : t("Ajouter aux signets")}
                  title={saved ? t("Retirer des signets") : t("Ajouter aux signets")}
                >
                  <Bookmark className={clsx("size-[18px] group-hover:scale-110", saved && "fill-current")} />
                </button>
              )}
              <Menu
                trigger={
                  <button className="rounded-full p-2 hover:bg-elevated hover:text-fg" aria-label={t("Plus d'actions")}>
                    <MoreHorizontal className="size-[18px]" />
                  </button>
                }
                items={[
                  isOwn &&
                    !extras?.retracted && {
                      label: t("Retirer ce post"),
                      icon: <Trash2 className="size-4" />,
                      danger: true,
                      onSelect: () => {
                        if (confirm(t("Retirer ce post ? Il sera masqué dans toutes les apps arobase.chat, mais reste inscrit sur la blockchain."))) retract.mutate(m);
                      },
                    },
                  viewer &&
                    !isOwn && {
                      label: t("Masquer ce compte"),
                      icon: <VolumeX className="size-4" />,
                      onSelect: () => {
                        setSafety(viewer, "muted", m.author, true);
                        scheduleSync();
                      },
                    },
                  viewer &&
                    !isOwn && {
                      label: t("Bloquer ce compte"),
                      icon: <Ban className="size-4" />,
                      danger: true,
                      onSelect: () => {
                        if (!confirm(t("Bloquer ce compte ? Ses posts, réponses, mentions et messages privés seront masqués pour vous."))) return;
                        setSafety(viewer, "blocked", m.author, true);
                        scheduleSync();
                      },
                    },
                  {
                    label: t("Copier le lien"),
                    icon: <Copy className="size-4" />,
                    onSelect: () => void navigator.clipboard.writeText(permalink(`/p/${m.id}`)),
                  },
                  ...missingAnchors.map((n) => ({
                    label: n.cfg.role === 2 ? t("Répliquer sur {name} (payant)", { name: n.cfg.name }) : t("Répliquer sur {name}", { name: n.cfg.name }),
                    icon: <Anchor className="size-4" />,
                    onSelect: () => replicate.mutate({ m, chainId: n.cfg.chainId }),
                    disabled: !viewer,
                  })),
                  viewer &&
                    !isOwn &&
                    variant !== "compact" && {
                      label: t("Ajouter une note de communauté"),
                      icon: <Info className="size-4" />,
                      onSelect: () => navigate(`/p/${m.id}?note=1`),
                    },
                  viewer &&
                    stats?.viewerVote !== 1 && {
                      label: isMod ? t("Masquer (modérateur)") : t("Voter pour masquer"),
                      icon: isMod ? <ShieldAlert className="size-4" /> : <Flag className="size-4" />,
                      onSelect: () => actions.modVote(m.id, 1),
                      danger: true,
                    },
                  viewer &&
                    stats?.viewerVote !== -1 &&
                    !isMod && {
                      label: t("Voter pour garder visible"),
                      icon: <ShieldCheck className="size-4" />,
                      onSelect: () => actions.modVote(m.id, -1),
                    },
                  viewer &&
                    !!stats?.viewerVote && {
                      label: isMod && stats.viewerVote === 1 ? t("Retirer le masquage") : t("Retirer mon vote"),
                      icon: <Undo2 className="size-4" />,
                      onSelect: () => actions.modVote(m.id, 0),
                    },
                ]}
              />
              {variant === "focus" && (
                <span className="flex items-center gap-1 text-xs" title={t("Signé par {signer}", { signer: m.signer })}>
                  <CheckCircle2 className="size-3.5 text-ok" /> {t("Signature vérifiée")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});
