import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";
import { KIND, type Message } from "@/lib/protocol";
import { useRecentPosts } from "./names";

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function searchPosts(q: string, limit = 80): Promise<Message[]> {
  const words = fold(q).split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const rows = await db.messages
    .where("kind")
    .anyOf([KIND.POST, KIND.COMMENT])
    .filter((m) => !m.invalid && !!m.body.text && words.every((w) => fold(m.body.text!).includes(w)))
    .toArray();
  return rows.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function usePostSearch(q: string) {
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const recent = useRecentPosts(debounced.trim().length >= 2);
  return useQuery({
    queryKey: ["post-search", fold(debounced), recent.dataUpdatedAt],
    enabled: debounced.trim().length >= 2,
    placeholderData: (prev) => prev,
    meta: { persist: false },
    queryFn: () => searchPosts(debounced),
  });
}
