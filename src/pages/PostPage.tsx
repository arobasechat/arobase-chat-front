import { useEffect } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CornerUpLeft, MessageCircle } from "lucide-react";
import type { Hex } from "viem";
import { KIND, ZERO32 } from "@/lib/protocol";
import { fullDate } from "@/lib/format";
import { useFeed, useMessage } from "@/queries/feed";
import { useNetworks } from "@/queries/core";
import { Composer } from "@/components/Composer";
import { PostCard } from "@/components/PostCard";
import { PostList } from "@/components/PostList";
import { NotesPanel } from "@/components/NotesPanel";
import { Empty, ErrorBox, PostSkeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";

function Parent({ id }: { id: Hex }) {
  const { data } = useMessage(id);
  if (!data) return <PostSkeleton />;
  return (
    <div className="relative">
      <PostCard message={data} variant="compact" showNotes={false} />
      <CornerUpLeft className="absolute left-7 top-[52px] size-4 text-muted" />
    </div>
  );
}

export default function PostPage() {
  const { id } = useParams() as { id: Hex };
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const networks = useNetworks();
  const message = useMessage(id);
  const comments = useFeed("thread", id);
  const m = message.data;
  const t = useT();
  useEffect(() => {
    if (m?.kind === KIND.REPOST) navigate(`/p/${m.parentId}`, { replace: true });
  }, [m, navigate]);

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center gap-6 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-md">
        <button onClick={() => (history.length > 1 ? navigate(-1) : navigate("/"))} className="rounded-full p-1.5 hover:bg-elevated" aria-label={t("Retour")}>
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-lg font-semibold tracking-tight">{m?.kind === KIND.COMMENT ? t("Commentaire") : t("Post")}</h1>
      </div>
      {message.isError && <ErrorBox error={message.error} onRetry={() => message.refetch()} />}
      {!m && message.isPending && <PostSkeleton />}
      {m && (
        <>
          {m.parentId !== ZERO32 && <Parent id={m.parentId} />}
          <PostCard message={m} variant="focus" showNotes={false} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-muted">
            <span>{fullDate(m.ts)}</span>
            {Object.entries(m.locations).map(([chainId, block]) => (
              <span key={chainId}>
                {networks.byId.get(Number(chainId))?.cfg.name ?? `chain ${chainId}`} · {t("bloc {block}", { block })}
              </span>
            ))}
            <span className="font-mono" title={m.id}>
              id {m.id.slice(0, 10)}…
            </span>
          </div>
          {m.kind === KIND.POST && <NotesPanel postId={m.id} postAuthor={m.author} openComposer={search.get("note") === "1"} />}
          <Composer kind={KIND.COMMENT} parentId={m.id} placeholder={t("Publier votre réponse")} compact />
          <PostList
            items={comments.items}
            loading={comments.isPending}
            hasNextPage={comments.hasNextPage}
            isFetchingNextPage={comments.isFetchingNextPage}
            fetchNextPage={comments.fetchNextPage}
            empty={<Empty title={t("Aucune réponse")} icon={<MessageCircle className="size-8" />} />}
          />
        </>
      )}
    </>
  );
}
