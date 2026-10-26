import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Hash } from "lucide-react";
import { extractTags } from "@/lib/protocol";
import { useConfig, useNetworks } from "@/queries/core";
import { useRecentPosts } from "@/queries/names";
import { useFeed } from "@/queries/feed";
import { Composer } from "./Composer";
import { PostList } from "./PostList";
import { Empty } from "./ui";
import { useT } from "@/lib/i18n";

export function TagFeed({ tag }: { tag: string }) {
  const networks = useNetworks();
  return networks.free.length > 0 ? <OnchainTagFeed tag={tag} /> : <RecentTagFeed tag={tag} />;
}

function TagHeader({ tag, subtitle }: { tag: string; subtitle: string }) {
  const t = useT();
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex items-center gap-4 px-4 py-3">
        <Link to="/explorer" className="rounded-md p-1.5 hover:bg-elevated" aria-label={t("Retour")}>
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">#{tag}</h1>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function OnchainTagFeed({ tag }: { tag: string }) {
  const t = useT();
  const feed = useFeed("tag", tag);
  const totals = feed.data?.pages[0]?.totals ?? {};
  const total = Math.max(0, ...Object.values(totals));
  return (
    <>
      <TagHeader tag={tag} subtitle={feed.isPending ? t("Lecture de l'index onchain…") : total > 1 ? t("{n} posts au total · index onchain, tout l'historique", { n: total }) : t("{n} post au total · index onchain, tout l'historique", { n: total })} />
      <Composer placeholder={t("Écrire avec #{tag}…", { tag })} key={tag} />
      <PostList
        items={feed.items}
        loading={feed.isPending}
        hasNextPage={feed.hasNextPage}
        isFetchingNextPage={feed.isFetchingNextPage}
        fetchNextPage={feed.fetchNextPage}
        empty={
          <Empty title={t("Aucun post avec #{tag}", { tag })} icon={<Hash className="size-8" />}>
            {t("Soyez le premier à l'utiliser : les hashtags sont indexés onchain à la publication.")}
          </Empty>
        }
      />
    </>
  );
}

function RecentTagFeed({ tag }: { tag: string }) {
  const t = useT();
  const config = useConfig();
  const recent = useRecentPosts();
  const hours = Math.round((config.params.globalWindowSec ?? 86_400) / 3600);
  const items = useMemo(
    () => (recent.data?.posts ?? []).filter((p) => extractTags(p.body.text).includes(tag)).sort((a, b) => b.ts - a.ts),
    [recent.data, tag],
  );
  const authors = new Set(items.map((p) => p.author.toLowerCase())).size;
  return (
    <>
      <TagHeader
        tag={tag}
        subtitle={recent.isPending ? t("Recherche dans les posts récents…") : `${items.length > 1 ? t("{n} posts", { n: items.length }) : t("{n} post", { n: items.length })} · ${authors > 1 ? t("{n} personnes", { n: authors }) : t("{n} personne", { n: authors })} · ${t("dernières {n} h", { n: hours })}`}
      />
      <Composer placeholder={t("Écrire avec #{tag}…", { tag })} key={tag} />
      <PostList
        items={items}
        loading={recent.isPending}
        empty={
          <Empty title={t("Aucun post récent avec #{tag}", { tag })} icon={<Hash className="size-8" />}>
            {t("Les hashtags sont calculés dans votre navigateur à partir des posts des dernières {n} heures. Soyez le premier à l'utiliser.", { n: hours })}
          </Empty>
        }
      />
    </>
  );
}
