import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Compass, Users } from "lucide-react";
import { useViewer } from "@/identity/store";
import { useFeed, useNewPostsCount, type FeedScope } from "@/queries/feed";
import { qk } from "@/queries/keys";
import { Composer } from "@/components/Composer";
import { WelcomeCard } from "@/components/WelcomeCard";
import { PageHeader } from "@/components/Layout";
import { PostList } from "@/components/PostList";
import { Empty, ErrorBox, Tabs } from "@/components/ui";
import { useConfig } from "@/queries/core";
import { TagFeed } from "@/components/TagFeed";
import { TrendingTags } from "@/components/Search";
import { useT } from "@/lib/i18n";

export default function Home() {
  const [search] = useSearchParams();
  const tag = search.get("tag");
  if (tag) return <TagFeed tag={tag.toLowerCase()} />;
  return <Feed />;
}

function Feed() {
  const viewer = useViewer();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = useConfig();
  const t = useT();
  const scope: FeedScope = location.pathname.startsWith("/explorer") || !viewer ? "global" : "following";
  const feed = useFeed(scope);
  const fresh = useNewPostsCount(scope, undefined, feed.isSuccess);
  const hours = Math.round((config.params.globalWindowSec ?? 86_400) / 3600);

  const showNew = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    void qc.resetQueries({ queryKey: ["feed", scope] });
    qc.setQueryData(qk.newCount(scope, scope === "following" ? viewer?.toLowerCase() : "-"), 0);
  };

  return (
    <>
      <PageHeader title={scope === "global" ? t("Explorer") : t("Accueil")}>
        <span className="text-xs text-muted">{scope === "global" ? t("dernières {hours} h", { hours }) : t("vos abonnements")}</span>
      </PageHeader>
      {viewer && (
        <Tabs
          value={scope}
          onChange={(v) => navigate(v === "global" ? "/explorer" : "/")}
          items={[
            { value: "following", label: t("Abonnements") },
            { value: "global", label: t("Global") },
          ]}
        />
      )}
      <WelcomeCard />
      {scope === "global" && <TrendingTags limit={5} className="m-4 lg:hidden" />}
      <Composer />
      {!!fresh.data && fresh.data > 0 && (
        <div className="sticky top-16 z-10 flex justify-center">
          <button
            onClick={showNew}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-lg"
          >
            <ArrowUp className="size-4" /> {fresh.data > 1 ? t("{n} nouveaux posts", { n: fresh.data }) : t("{n} nouveau post", { n: fresh.data })}
          </button>
        </div>
      )}
      {feed.isError && <ErrorBox error={feed.error} onRetry={() => feed.refetch()} />}
      <PostList
        items={feed.items}
        loading={feed.isPending}
        hasNextPage={feed.hasNextPage}
        isFetchingNextPage={feed.isFetchingNextPage}
        fetchNextPage={feed.fetchNextPage}
        empty={
          scope === "following" ? (
            <Empty title={t("Votre fil est vide")} icon={<Users className="size-8" />}>
              {t("Abonnez-vous à des comptes depuis l'onglet Global : leurs posts apparaîtront ici, lus directement onchain.")}
            </Empty>
          ) : (
            <Empty title={t("Rien de récent")} icon={<Compass className="size-8" />}>
              {t("Aucun post dans la fenêtre des dernières {hours} heures.", { hours })}
            </Empty>
          )
        }
      />
    </>
  );
}
