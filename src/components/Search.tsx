import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { FileText, Hash, Search as SearchIcon, TrendingUp, User } from "lucide-react";
import { isAddress, type Address } from "viem";
import { normalizeTag } from "@/lib/protocol";
import { short } from "@/lib/format";
import { useNetworks } from "@/queries/core";
import { resolveHandle, usePeopleSearch, useRecentPosts } from "@/queries/names";
import { Avatar } from "./Avatar";
import { inputClass, Spinner } from "./ui";
import { useT } from "@/lib/i18n";

type Hit =
  | { type: "person"; address: Address; handle?: string; name?: string }
  | { type: "tag"; tag: string; count?: number }
  | { type: "address"; address: Address }
  | { type: "post"; id: string }
  | { type: "text"; q: string };

export function SearchBox({ autoFocus }: { autoFocus?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const networks = useNetworks();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [resolving, setResolving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const v = q.trim();
  const people = usePeopleSearch(v.startsWith("#") ? "" : v);
  const recent = useRecentPosts(open && v.length > 0);

  const hits = useMemo<Hit[]>(() => {
    if (!v) return [];
    if (isAddress(v)) return [{ type: "address", address: v }];
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) return [{ type: "post", id: v }];
    const tagQuery = normalizeTag(v.replace(/^#/, ""));
    const tags: Hit[] = (recent.data?.tags ?? [])
      .filter((tg) => tagQuery && tg.tag.startsWith(tagQuery))
      .slice(0, v.startsWith("#") ? 6 : 3)
      .map((tg) => ({ type: "tag", tag: tg.tag, count: tg.authors }));
    if (v.startsWith("#") && tagQuery.length >= 2 && !tags.some((tg) => tg.type === "tag" && tg.tag === tagQuery)) tags.unshift({ type: "tag", tag: tagQuery });
    const persons: Hit[] = (people.data ?? []).map((p) => ({ type: "person", ...p }));
    const text: Hit[] = v.length >= 2 && !v.startsWith("@") ? [{ type: "text", q: v }] : [];
    return v.startsWith("#") ? [...tags, ...text] : [...persons, ...tags, ...text];
  }, [v, people.data, recent.data]);

  const go = async (hit?: Hit) => {
    setOpen(false);
    if (!hit) {
      const handle = v.replace(/^@/, "").toLowerCase();
      if (handle) {
        setResolving(true);
        const owner = await resolveHandle(networks, handle).catch(() => null);
        setResolving(false);
        if (owner) navigate(`/u/@${handle}`);
      }
      return;
    }
    setQ("");
    if (hit.type === "person") navigate(hit.handle ? `/u/@${hit.handle}` : `/u/${hit.address}`);
    else if (hit.type === "address") navigate(`/u/${hit.address}`);
    else if (hit.type === "post") navigate(`/p/${hit.id}`);
    else if (hit.type === "text") navigate(`/recherche?q=${encodeURIComponent(hit.q)}`);
    else navigate(`/explorer?tag=${encodeURIComponent(hit.tag)}`);
  };

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go(hits[active]);
        }}
      >
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <input
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={t("Personnes, @pseudo, #hashtag, adresse…")}
          className={clsx(inputClass, "pl-9")}
          aria-label={t("Rechercher")}
          role="combobox"
          aria-expanded={open && hits.length > 0}
        />
        {(resolving || people.isFetching) && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2" />}
      </form>
      {open && v && (
        <div role="listbox" className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-2xl">
          {hits.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted">
              {people.isFetching ? t("Recherche…") : t("Aucun résultat. Entrée pour chercher ce @pseudo onchain.")}
            </p>
          )}
          {hits.map((h, i) => (
            <button
              key={i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => void go(h)}
              className={clsx("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active && "bg-elevated")}
            >
              {h.type === "person" ? (
                <>
                  <Avatar address={h.address} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{h.name ?? (h.handle ? `@${h.handle}` : short(h.address))}</span>
                    <span className="block truncate text-[12px] text-muted">{h.handle ? `@${h.handle}` : short(h.address, 6)}</span>
                  </span>
                </>
              ) : h.type === "tag" ? (
                <>
                  <span className="flex size-8 items-center justify-center rounded-lg border border-tag-line bg-tag text-tag-fg">
                    <Hash className="size-4" />
                  </span>
                  <span>
                    <span className="block font-medium">#{h.tag}</span>
                    {h.count !== undefined && <span className="text-[12px] text-muted">{h.count > 1 ? t("{n} personnes en parlent", { n: h.count }) : t("{n} personne en parlent", { n: h.count })}</span>}
                  </span>
                </>
              ) : h.type === "text" ? (
                <>
                  <SearchIcon className="size-4 text-muted" /> {t("Rechercher « {q} » dans les posts", { q: h.q })}
                </>
              ) : h.type === "address" ? (
                <>
                  <User className="size-4 text-muted" /> {t("Voir le profil {address}", { address: short(h.address, 6) })}
                </>
              ) : (
                <>
                  <FileText className="size-4 text-muted" /> {t("Ouvrir le post")}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrendingTags({ limit = 8, className }: { limit?: number; className?: string }) {
  const t = useT();
  const { data, isPending } = useRecentPosts();
  const tags = data?.tags.slice(0, limit) ?? [];
  return (
    <section className={clsx("rounded-xl border border-line bg-surface", className)}>
      <h2 className="flex items-center gap-2 px-4 pt-3 font-medium">
        <TrendingUp className="size-4 text-accent" /> {t("Tendances · 24 h")}
      </h2>
      {isPending && <div className="skeleton m-4 h-20 rounded-lg" />}
      {!isPending && tags.length === 0 && <p className="px-4 pb-4 pt-2 text-sm text-muted">{t("Aucun hashtag récent. Lancez-en un avec # dans un post.")}</p>}
      <ol className="py-1">
        {tags.map((tg, i) => (
          <li key={tg.tag}>
            <Link to={`/explorer?tag=${encodeURIComponent(tg.tag)}`} className="flex items-baseline gap-3 px-4 py-2 hover:bg-elevated/50">
              <span className="w-4 text-right text-[12px] text-subtle">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">#{tg.tag}</span>
                <span className="text-[12px] text-muted">
                  {tg.authors > 1 ? t("{n} personnes", { n: tg.authors }) : t("{n} personne", { n: tg.authors })} · {tg.posts > 1 ? t("{n} posts", { n: tg.posts }) : t("{n} post", { n: tg.posts })}
                  {tg.total !== undefined && tg.total > tg.posts && ` · ${t("{n} au total", { n: tg.total })}`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="border-t border-line px-4 py-2 text-[11px] text-subtle">{t("Classement des 24 dernières heures, calculé dans votre navigateur. Les totaux viennent de l'index onchain.")}</p>
    </section>
  );
}
