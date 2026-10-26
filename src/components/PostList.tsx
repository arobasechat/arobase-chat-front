import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useViewer } from "@/identity/store";
import { KIND, type Message } from "@/lib/protocol";
import { useHiddenAuthors } from "@/lib/safety";
import { usePostExtras } from "@/queries/extras";
import { useMessage } from "@/queries/feed";
import { PostCard } from "./PostCard";
import { RepostHeader } from "./PostExtras";
import { PostSkeleton, Spinner } from "./ui";

function RepostItem({ m, variant }: { m: Message; variant?: "feed" | "compact" }) {
  const viewer = useViewer();
  const { isHidden } = useHiddenAuthors(viewer);
  const original = useMessage(m.parentId);
  const own = usePostExtras(m.id);
  if (own.data?.retracted || isHidden(m.author)) return null;
  if (original.isPending) return <PostSkeleton />;
  if (!original.data) return null;
  return (
    <div>
      <RepostHeader author={m.author} />
      <PostCard message={original.data} variant={variant} />
    </div>
  );
}

export function PostList({
  items,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  loading,
  empty,
  variant,
}: {
  items: Message[];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => unknown;
  loading?: boolean;
  empty?: React.ReactNode;
  variant?: "feed" | "compact";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => setOffset(listRef.current?.offsetTop ?? 0), []);

  const virtualizer = useWindowVirtualizer({
    count: items.length + (hasNextPage ? 1 : 0),
    estimateSize: () => 132,
    overscan: 6,
    scrollMargin: offset,
    getItemKey: (i) => items[i]?.id ?? "loader",
  });
  const virtualItems = virtualizer.getVirtualItems();
  const last = virtualItems[virtualItems.length - 1];

  useEffect(() => {
    if (!last || !hasNextPage || isFetchingNextPage) return;
    if (last.index >= items.length - 5) void fetchNextPage?.();
  }, [last, hasNextPage, isFetchingNextPage, items.length, fetchNextPage]);

  if (loading && !items.length)
    return (
      <div>
        {Array.from({ length: 6 }, (_, i) => (
          <PostSkeleton key={i} />
        ))}
      </div>
    );
  if (!items.length) return <>{empty}</>;

  return (
    <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualItems.map((v) => {
        const m = items[v.index];
        return (
          <div
            key={v.key}
            data-index={v.index}
            ref={virtualizer.measureElement}
            className="has-[[role=menu]]:z-30"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
          >
            {m ? (
              m.kind === KIND.REPOST ? (
                <RepostItem m={m} variant={variant} />
              ) : (
                <PostCard message={m} variant={variant} />
              )
            ) : (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
