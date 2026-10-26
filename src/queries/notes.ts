import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { socialAbi } from "@/abi";
import { db } from "@/lib/db";
import { childStreams, fetchPage, hydrate } from "@/lib/reader";
import { KIND, type Message } from "@/lib/protocol";
import { notesScorer } from "@/lib/workers";
import type { NoteScore } from "@/workers/notes.worker";
import { useViewer } from "@/identity/store";
import { useConfig, useNetworks } from "./core";
import { qk } from "./keys";

export type NoteView = {
  message: Message;
  helpful: number;
  notHelpful: number;
  viewerRating: number;
  score: NoteScore;
};

export type ThreadSummary = { comments: number; notes: NoteView[] };

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function useThreadSummary(postId: Hex, postAuthor: Address, enabled = true) {
  const networks = useNetworks();
  const config = useConfig();
  const viewer = useViewer();
  const minRatings = config.params.noteMinRatings ?? 3;
  return useQuery({
    queryKey: qk.notes(postId),
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ThreadSummary> => {
      const page = await fetchPage(networks, childStreams(networks, postId), {}, 50);
      const comments = Math.max(0, ...Object.values(page.totals));
      const noteItems = page.items.filter((i) => i.kind === KIND.NOTE && i.author.toLowerCase() !== postAuthor.toLowerCase());
      if (!noteItems.length) return { comments, notes: [] };
      const ids = noteItems.map((n) => n.id);
      const [messages, stats, ratings] = await Promise.all([
        hydrate(networks, noteItems),
        networks.social.client.readContract({
          address: config.social,
          abi: socialAbi,
          functionName: "noteStats",
          args: [ids, viewer ?? ZERO],
        }),
        Promise.all(
          ids.map((id) =>
            networks.social.client.readContract({
              address: config.social,
              abi: socialAbi,
              functionName: "noteRatings",
              args: [id, 0n, 500n],
            }),
          ),
        ),
      ]);
      const rows = ids.flatMap((note, i) =>
        ratings[i][0]
          .map((rater, j) => ({ note, rater, value: ratings[i][1][j] as 1 | -1 | 0 }))
          .filter((r): r is { note: Hex; rater: Address; value: 1 | -1 } => r.value !== 0),
      );
      await db.ratings.bulkPut(rows);
      const all = await db.ratings.limit(20_000).toArray();
      const scores = await notesScorer.score(all, minRatings);
      return {
        comments: Math.max(0, comments - page.items.filter((i) => i.kind === KIND.NOTE).length),
        notes: ids
          .map((id, i) => ({
            message: messages.get(id)!,
            helpful: stats[i].helpful,
            notHelpful: stats[i].notHelpful,
            viewerRating: stats[i].viewerRating,
            score: scores[id] ?? { intercept: 0, factor: 0, ratings: 0, status: "needs-ratings" as const },
          }))
          .filter((n) => n.message && !n.message.invalid),
      };
    },
  });
}
