import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AtSign, Bell, Heart, Megaphone, MessageCircle, Quote, Repeat2, StickyNote, UserPlus } from "lucide-react";
import type { Address, Hex } from "viem";
import { timeAgo } from "@/lib/format";
import type { NotificationType } from "@/lib/db";
import { useMessage } from "@/queries/feed";
import { useViewer } from "@/identity/store";
import { useHiddenAuthors } from "@/lib/safety";
import {
  groupNotifications,
  useMarkNotificationsSeen,
  useNotifications,
  useNotificationsSync,
  type NotificationGroup,
} from "@/queries/notifications";
import { PageHeader } from "@/components/Layout";
import { PostCard } from "@/components/PostCard";
import { PushBanner } from "@/components/PushSettings";
import { RichText } from "@/components/RichText";
import { DisplayName, UserLink } from "@/components/UserLink";
import { Avatar } from "@/components/Avatar";
import { Empty, PostSkeleton, Spinner, Tabs } from "@/components/ui";
import { useT } from "@/lib/i18n";

const ICON: Record<NotificationType, { icon: typeof Heart; className: string }> = {
  like: { icon: Heart, className: "text-danger fill-danger" },
  follow: { icon: UserPlus, className: "text-accent" },
  mention: { icon: AtSign, className: "text-accent" },
  reply: { icon: MessageCircle, className: "text-accent" },
  note: { icon: StickyNote, className: "text-warn" },
  repost: { icon: Repeat2, className: "text-ok" },
  quote: { icon: Quote, className: "text-accent" },
  announcement: { icon: Megaphone, className: "text-accent" },
};

const VERB: Record<NotificationType, [string, string]> = {
  like: ["a aimé votre post", "ont aimé votre post"],
  follow: ["vous suit", "vous suivent"],
  mention: ["vous a mentionné", "vous ont mentionné"],
  reply: ["a répondu à votre post", "ont répondu à votre post"],
  note: ["a proposé une note de communauté sur votre post", "ont proposé une note sur votre post"],
  repost: ["a reposté votre post", "ont reposté votre post"],
  quote: ["a cité votre post", "ont cité votre post"],
  announcement: ["a publié une annonce", "ont publié une annonce"],
};

function Who({ from, type }: { from: Address[]; type: NotificationType }) {
  const others = from.length - 1;
  const t = useT();
  return (
    <p className="text-[15px]">
      <UserLink address={from[0]} className="font-semibold hover:underline">
        <DisplayName address={from[0]} />
      </UserLink>
      {others > 0 && (
        <span>
          {" "}
          {others > 1 ? t("et {n} autres", { n: others }) : t("et {n} autre", { n: others })}
        </span>
      )}{" "}
      <span className="text-muted">{t(VERB[type][others > 0 ? 1 : 0])}</span>
    </p>
  );
}

function Snippet({ id, to }: { id: Hex; to?: (parent: Hex) => string }) {
  const { data } = useMessage(id);
  if (!data) return <div className="skeleton mt-2 h-4 w-2/3 rounded" />;
  return (
    <Link to={to ? to(data.parentId) : `/p/${id}`} className="mt-1 block text-sm text-muted line-clamp-3 hover:text-fg">
      <RichText text={data.body.text ?? ""} />
    </Link>
  );
}

function RepostSnippet({ id }: { id: Hex }) {
  const { data } = useMessage(id);
  if (!data) return <div className="skeleton mt-2 h-4 w-2/3 rounded" />;
  return <Snippet id={data.parentId} />;
}

function EmbeddedPost({ id }: { id: Hex }) {
  const { data, isPending } = useMessage(id);
  if (isPending) return <PostSkeleton />;
  if (!data) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line">
      <PostCard message={data} variant="compact" />
    </div>
  );
}

function Row({ g }: { g: NotificationGroup }) {
  const { icon: Icon, className } = ICON[g.type];
  return (
    <li className={clsx("relative flex gap-3 border-b border-line px-4 py-3", g.unread && "bg-accent/5")}>
      {g.unread && <span className="absolute left-0 top-0 h-full w-0.5 bg-accent" />}
      <div className="flex w-10 shrink-0 justify-end pt-1">
        <Icon className={clsx("size-6", className)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex -space-x-2">
            {g.from.slice(0, 6).map((a) => (
              <UserLink key={a} address={a} className="rounded-full ring-2 ring-bg">
                <Avatar address={a} size={30} />
              </UserLink>
            ))}
          </div>
          <span className="shrink-0 text-xs text-muted">{timeAgo(g.ts)}</span>
        </div>
        <div className="mt-1.5">
          <Who from={g.from} type={g.type} />
        </div>
        {g.postId && g.type === "like" && <Snippet id={g.postId} />}
        {g.postId && g.type === "note" && <Snippet id={g.postId} to={(parent) => `/p/${parent}`} />}
        {g.postId && g.type === "repost" && <RepostSnippet id={g.postId} />}
        {g.postId && (g.type === "mention" || g.type === "reply" || g.type === "quote" || g.type === "announcement") && <EmbeddedPost id={g.postId} />}
      </div>
    </li>
  );
}

type Filter = "all" | "mentions";

export default function Notifications() {
  const sync = useNotificationsSync();
  const { data, isPending } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const viewer = useViewer();
  const { isHidden } = useHiddenAuthors(viewer);
  const groups = useMemo(() => {
    if (!data) return [];
    const items = filter === "mentions" ? data.items.filter((n) => n.type === "mention" || n.type === "reply" || n.type === "quote") : data.items;
    return groupNotifications({ items, seen: data.seen }, isHidden);
  }, [data, filter, isHidden]);
  useMarkNotificationsSeen(data?.items[0]?.ts);
  const t = useT();

  return (
    <>
      <PageHeader title={t("Notifications")} subtitle={t("Lues directement depuis les chains, sans serveur")}>
        {sync.isFetching && <Spinner className="size-4" />}
      </PageHeader>
      <PushBanner />
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        items={[
          { value: "all", label: t("Tout") },
          { value: "mentions", label: t("Mentions et réponses") },
        ]}
      />
      {isPending && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {!isPending && groups.length === 0 && (
        <Empty title={t("Rien pour l'instant")} icon={<Bell className="size-8" />}>
          {t("Les likes, réponses, mentions et nouveaux abonnés apparaîtront ici.")}
          {sync.isFetching && ` ${t("Lecture des chains en cours…")}`}
        </Empty>
      )}
      <ul>
        {groups.map((g) => (
          <Row key={g.key} g={g} />
        ))}
      </ul>
    </>
  );
}
