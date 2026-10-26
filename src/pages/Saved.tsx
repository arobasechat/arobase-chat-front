import { useSearchParams } from "react-router-dom";
import { Bookmark, Heart } from "lucide-react";
import { useBookmarks, useLikedPosts } from "@/queries/collections";
import { PageHeader } from "@/components/Layout";
import { PostList } from "@/components/PostList";
import { Empty, Tabs } from "@/components/ui";
import { useT } from "@/lib/i18n";

type Tab = "signets" | "likes";

function Bookmarks() {
  const { data, isPending } = useBookmarks();
  const t = useT();
  return (
    <PostList
      items={data ?? []}
      loading={isPending}
      empty={
        <Empty title={t("Aucun signet")} icon={<Bookmark className="size-8" />}>
          {t("Touchez l'icône signet sous un post pour le retrouver ici. Vos signets restent privés, dans ce navigateur.")}
        </Empty>
      }
    />
  );
}

function Likes() {
  const { data, isPending, isFetching } = useLikedPosts();
  const t = useT();
  return (
    <PostList
      items={data ?? []}
      loading={isPending}
      empty={
        <Empty title={isFetching ? t("Lecture de vos likes onchain…") : t("Aucun like")} icon={<Heart className="size-8" />}>
          {t("Les posts que vous aimez apparaîtront ici.")}
        </Empty>
      }
    />
  );
}

export default function Saved() {
  const [params, setParams] = useSearchParams();
  const t = useT();
  const tab: Tab = params.get("tab") === "likes" ? "likes" : "signets";
  return (
    <>
      <PageHeader title={t("Enregistrés")} subtitle={tab === "likes" ? t("Les posts que vous avez aimés, lus onchain") : t("Privés, stockés dans ce navigateur")} />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams(t === "likes" ? { tab: "likes" } : {}, { replace: true })}
        items={[
          { value: "signets", label: t("Signets") },
          { value: "likes", label: t("J'aime") },
        ]}
      />
      {tab === "likes" ? <Likes /> : <Bookmarks />}
    </>
  );
}
