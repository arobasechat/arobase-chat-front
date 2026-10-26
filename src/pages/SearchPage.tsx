import { useSearchParams } from "react-router-dom";
import { Hash, Search as SearchIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { normalizeTag } from "@/lib/protocol";
import { short } from "@/lib/format";
import { usePeopleSearch, useRecentPosts } from "@/queries/names";
import { usePostSearch } from "@/queries/search";
import { PageHeader } from "@/components/Layout";
import { PostList } from "@/components/PostList";
import { Avatar } from "@/components/Avatar";
import { Empty, inputClass, Tabs } from "@/components/ui";
import { useT } from "@/lib/i18n";

type Tab = "posts" | "people" | "tags";

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const tab = (params.get("t") as Tab) || "posts";
  const posts = usePostSearch(tab === "posts" ? q : "");
  const people = usePeopleSearch(tab === "people" ? q : "");
  const recent = useRecentPosts(tab === "tags" && q.length > 0);
  const tagQuery = normalizeTag(q.replace(/^#/, ""));
  const tags = (recent.data?.tags ?? []).filter((t) => t.tag.includes(tagQuery));
  const t = useT();
  const update = (patch: Record<string, string>) => setParams({ q, t: tab, ...patch }, { replace: true });

  return (
    <>
      <PageHeader title={t("Recherche")} subtitle={t("Dans les posts lus par ce navigateur et ceux des dernières 24 h")} />
      <div className="border-b border-line px-4 py-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder={t("Mots, @pseudo, #hashtag…")}
            className={`${inputClass} pl-9`}
            aria-label={t("Rechercher")}
          />
        </div>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={(v) => update({ t: v })}
        items={[
          { value: "posts", label: t("Posts") },
          { value: "people", label: t("Personnes") },
          { value: "tags", label: t("Hashtags") },
        ]}
      />
      {q.trim().length < 2 ? (
        <Empty title={t("Que cherchez-vous ?")} icon={<SearchIcon className="size-8" />}>
          {t("Il n'y a pas de serveur de recherche : arobase.chat cherche dans les posts déjà lus par votre navigateur et dans ceux des dernières 24 h.")}
        </Empty>
      ) : tab === "posts" ? (
        <PostList
          items={posts.data ?? []}
          loading={posts.isPending}
          empty={<Empty title={t("Aucun post trouvé")}>{t("Essayez d'autres mots, ou ouvrez le fil Explorer pour charger plus de posts.")}</Empty>}
        />
      ) : tab === "people" ? (
        <ul>
          {(people.data ?? []).map((p) => (
            <li key={p.address}>
              <Link to={p.handle ? `/u/@${p.handle}` : `/u/${p.address}`} className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-elevated/50">
                <Avatar address={p.address} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name ?? (p.handle ? `@${p.handle}` : short(p.address))}</span>
                  <span className="block truncate text-sm text-muted">{p.handle ? `@${p.handle}` : short(p.address, 6)}</span>
                </span>
              </Link>
            </li>
          ))}
          {people.data?.length === 0 && <Empty title={t("Personne trouvé")} />}
        </ul>
      ) : (
        <ul>
          {tagQuery.length >= 2 && !tags.some((x) => x.tag === tagQuery) && (
            <li>
              <Link to={`/explorer?tag=${encodeURIComponent(tagQuery)}`} className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-elevated/50">
                <Hash className="size-5 text-accent" /> #{tagQuery}
              </Link>
            </li>
          )}
          {tags.map((x) => (
            <li key={x.tag}>
              <Link to={`/explorer?tag=${encodeURIComponent(x.tag)}`} className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-elevated/50">
                <Hash className="size-5 text-accent" />
                <span>
                  <span className="block font-medium">#{x.tag}</span>
                  <span className="text-xs text-muted">
                    {x.posts > 1 ? t("{n} posts", { n: x.posts }) : t("{n} post", { n: x.posts })} · {x.authors > 1 ? t("{n} personnes", { n: x.authors }) : t("{n} personne", { n: x.authors })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
