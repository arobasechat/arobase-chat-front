import Dexie, { type EntityTable } from "dexie";
import type { Address, Hex } from "viem";
import type { Message } from "./protocol";

export type Conversation = {
  id: Hex;
  type: "dm" | "group";
  chainId: number;
  name?: string;
  peer?: Address;
  owner?: Address;
  members: Address[];
  epoch: number;
  keys: Record<number, Hex>;
  createdAt: number;
  lastTs: number;
  lastText?: string;
  readTs: number;
  fromBlock: number;
};

export type DirectMessage = {
  id: string;
  convId: Hex;
  from: Address;
  text: string;
  ts: number;
  status: "confirmed" | "pending" | "failed" | "invalid";
};

export type NotificationType = "mention" | "reply" | "note" | "like" | "follow" | "repost" | "quote" | "announcement";

export type StoredNotification = {
  id: string;
  me: string;
  type: NotificationType;
  from: Address;
  postId?: Hex;
  ts: number;
};

export type Bookmark = { id: string; me: string; postId: Hex; ts: number; removed?: boolean };

export type KV = { key: string; value: unknown };
export type HandleEntry = { handle: string; owner: Address };
export type StoredRating = { note: Hex; rater: Address; value: 1 | -1 };
export type Secret = { key: string; value: unknown };

class ArobaseDB extends Dexie {
  messages!: EntityTable<Message, "id">;
  kv!: EntityTable<KV, "key">;
  ratings!: EntityTable<StoredRating, "note">;
  convs!: EntityTable<Conversation, "id">;
  dms!: EntityTable<DirectMessage, "id">;
  secrets!: EntityTable<Secret, "key">;
  handles!: EntityTable<HandleEntry, "handle">;
  notifs!: EntityTable<StoredNotification, "id">;
  bookmarks!: EntityTable<Bookmark, "id">;

  constructor() {
    super("arobase");
    this.version(1).stores({
      messages: "id, author, kind, ts, [author+kind], [parentId+ts], status",
      kv: "key",
      ratings: "[note+rater], note, rater",
      convs: "id, lastTs",
      dms: "id, [convId+ts]",
      secrets: "key",
    });
    this.version(2).stores({ handles: "&handle, owner" });
    this.version(3).stores({ notifs: "id, [me+ts]" });
    this.version(4).stores({ bookmarks: "id, [me+ts]" });
  }
}

export const db = new ArobaseDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown) {
  await db.kv.put({ key, value });
}

export async function putMessages(list: Message[]) {
  if (!list.length) return;
  await db.transaction("rw", db.messages, async () => {
    const existing = await db.messages.bulkGet(list.map((m) => m.id));
    await db.messages.bulkPut(
      list.map((m, i) => {
        const prev = existing[i];
        if (!prev) return m;
        return {
          ...prev,
          ...m,
          locations: { ...prev.locations, ...m.locations },
          status: prev.status === "confirmed" || m.status === "confirmed" ? "confirmed" : m.status,
        };
      }),
    );
  });
}
