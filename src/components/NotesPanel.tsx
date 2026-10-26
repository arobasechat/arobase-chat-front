import { useState } from "react";
import clsx from "clsx";
import { Info, ThumbsDown, ThumbsUp } from "lucide-react";
import type { Address, Hex } from "viem";
import { KIND } from "@/lib/protocol";
import { useOverlay } from "@/lib/social-queue";
import { timeAgo } from "@/lib/format";
import { useViewer } from "@/identity/store";
import { useThreadSummary, type NoteView } from "@/queries/notes";
import { useSocialActions } from "@/queries/actions";
import { Composer } from "./Composer";
import { DisplayName, UserLink } from "./UserLink";
import { RichText } from "./RichText";
import { Badge, Button } from "./ui";
import { useT } from "@/lib/i18n";

const STATUS = {
  helpful: { label: "Affichée", tone: "ok" },
  "not-helpful": { label: "Jugée peu utile", tone: "danger" },
  "needs-ratings": { label: "En évaluation", tone: "warn" },
} as const;

function NoteRow({ note, postId }: { note: NoteView; postId: Hex }) {
  const t = useT();
  const viewer = useViewer();
  const actions = useSocialActions();
  const overlay = useOverlay(`rate:${note.message.id}`);
  const rating = overlay ?? note.viewerRating;
  const status = STATUS[note.score.status];
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <Badge tone={status.tone}>{t(status.label)}</Badge>
        <span className="text-muted">
          {t("par")}{" "}
          <UserLink address={note.message.author} className="hover:underline">
            <DisplayName address={note.message.author} />
          </UserLink>{" "}
          · {timeAgo(note.message.ts)}
        </span>
      </div>
      <RichText text={note.message.body.text ?? ""} className="whitespace-pre-wrap break-words text-[15px]" />
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="text-muted">{t("Utile ?")}</span>
        <button
          disabled={!viewer}
          onClick={() => actions.rateNote(note.message.id, postId, rating === 1 ? 0 : 1)}
          className={clsx("inline-flex items-center gap-1 rounded-full border px-2.5 py-1", rating === 1 ? "border-ok text-ok" : "border-line text-muted")}
        >
          <ThumbsUp className="size-3.5" /> {note.helpful + (overlay === 1 && note.viewerRating !== 1 ? 1 : 0)}
        </button>
        <button
          disabled={!viewer}
          onClick={() => actions.rateNote(note.message.id, postId, rating === -1 ? 0 : -1)}
          className={clsx("inline-flex items-center gap-1 rounded-full border px-2.5 py-1", rating === -1 ? "border-danger text-danger" : "border-line text-muted")}
        >
          <ThumbsDown className="size-3.5" /> {note.notHelpful + (overlay === -1 && note.viewerRating !== -1 ? 1 : 0)}
        </button>
        <span className="ml-auto text-xs text-muted" title={t("Score « bridging » : une note n'est affichée que si des personnes habituellement en désaccord la jugent utile.")}>
          {t("score {score} · {n} avis", { score: note.score.intercept.toFixed(2), n: note.score.ratings })}
        </span>
      </div>
    </div>
  );
}

export function NotesPanel({ postId, postAuthor, openComposer }: { postId: Hex; postAuthor: Address; openComposer?: boolean }) {
  const t = useT();
  const { data } = useThreadSummary(postId, postAuthor);
  const viewer = useViewer();
  const isOwn = !!viewer && viewer.toLowerCase() === postAuthor.toLowerCase();
  const [writing, setWriting] = useState(!!openComposer && !isOwn);
  const notes = data?.notes ?? [];
  if (!notes.length && !writing && (!viewer || isOwn)) return null;
  return (
    <section className="border-b border-line">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="flex items-center gap-2 font-bold">
          <Info className="size-4 text-accent" /> {t("Notes de la communauté")}
          {notes.length > 0 && <span className="text-sm font-normal text-muted">({notes.length})</span>}
        </h2>
        {viewer && !isOwn && !writing && (
          <Button size="sm" variant="outline" onClick={() => setWriting(true)}>
            {t("Proposer une note")}
          </Button>
        )}
      </div>
      {writing && (
        <Composer kind={KIND.NOTE} parentId={postId} compact autoFocus placeholder={t("Ajoutez du contexte vérifiable, avec des sources…")} onDone={() => setWriting(false)} />
      )}
      {notes.map((n) => (
        <NoteRow key={n.message.id} note={n} postId={postId} />
      ))}
    </section>
  );
}
