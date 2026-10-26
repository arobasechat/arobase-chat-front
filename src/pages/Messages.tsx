import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Lock, MailPlus, Send, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { isAddress, type Address, type Hex } from "viem";
import { db, type Conversation } from "@/lib/db";
import { sameAddress, short, timeAgo } from "@/lib/format";
import { humanError } from "@/lib/tx";
import { ZERO32 } from "@/lib/protocol";
import { useAuth, useViewer } from "@/identity/store";
import { useUserStats } from "@/queries/core";
import { useQuery } from "@tanstack/react-query";
import { useHiddenAuthors } from "@/lib/safety";
import { safetyCode, useConversations, useDirectMessages, useGroupMembers, useSendDm, useStartConversation } from "@/queries/dm";
import { useConfig, useNetworks } from "@/queries/core";
import { useSocialActions } from "@/queries/actions";
import { qk } from "@/queries/keys";
import { Avatar } from "@/components/Avatar";
import { PageHeader } from "@/components/Layout";
import { DisplayName } from "@/components/UserLink";
import { Button, Empty, Field, inputClass, Modal, Spinner } from "@/components/ui";
import { useT } from "@/lib/i18n";

function ConvTitle({ conv, me }: { conv: Conversation; me: Address }) {
  const t = useT();
  if (conv.type === "group") return <span>{conv.name ?? t("Groupe")}</span>;
  const peer = conv.peer ?? conv.members.find((m) => !sameAddress(m, me));
  return peer ? <DisplayName address={peer} /> : <span>{t("Conversation")}</span>;
}

function SafetyCode({ peer }: { peer: Address }) {
  const networks = useNetworks();
  const config = useConfig();
  const t = useT();
  const q = useQuery({
    queryKey: ["safety-code", peer],
    meta: { persist: false },
    queryFn: () => safetyCode(networks, config, peer),
  });
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted">{t("Comparez ce code avec votre correspondant, de vive voix ou par un autre canal. S'il est identique des deux côtés, personne ne s'est interposé.")}</p>
      {q.data ? <p className="font-mono text-lg tracking-wider">{q.data}</p> : q.error ? <p className="text-danger">{humanError(q.error)}</p> : <Spinner />}
    </div>
  );
}

function NewConversation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [peers, setPeers] = useState("");
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const start = useStartConversation();
  const t = useT();
  const list = peers
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const valid = list.length > 0 && list.every((p) => isAddress(p));
  return (
    <Modal open={open} onClose={onClose} title={t("Nouvelle conversation chiffrée")}>
      <div className="space-y-4">
        <Field label={t("Destinataire(s)")} hint={t("Une ou plusieurs adresses 0x…, séparées par des virgules. Plusieurs adresses = groupe.")}>
          <textarea className={inputClass} rows={2} value={peers} onChange={(e) => setPeers(e.target.value)} placeholder="0x…" />
        </Field>
        {list.length > 1 && (
          <Field label={t("Nom du groupe")}>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <p className="flex items-start gap-2 text-xs text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          {t("Chiffrement X25519 + XChaCha20-Poly1305. Onchain, seuls le ciphertext, l'heure et l'adresse d'envoi sont visibles.")}
        </p>
        {start.error && <p className="text-sm text-danger">{humanError(start.error)}</p>}
        <div className="flex justify-end">
          <Button
            disabled={!valid}
            loading={start.isPending}
            onClick={() =>
              start.mutate(
                { peers: list as Address[], name: list.length > 1 ? name || "Groupe" : undefined },
                {
                  onSuccess: (id) => {
                    onClose();
                    navigate(`/messages/${id}`);
                  },
                },
              )
            }
          >
            {t("Démarrer")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EncKeyBanner() {
  const viewer = useViewer();
  const { data } = useUserStats(viewer);
  const actions = useSocialActions();
  const enc = useAuth((s) => s.unlocked?.encPublic ?? s.session?.encPublic);
  const unlock = useAuth((s) => s.unlock);
  const t = useT();
  if (!data) return null;
  if (!enc)
    return (
      <div className="m-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
        {t("Déverrouillez votre compte pour lire vos messages.")}{" "}
        <button className="font-semibold underline" onClick={() => void unlock()}>
          {t("Déverrouiller")}
        </button>
      </div>
    );
  if (data.encKey !== ZERO32) return null;
  return (
    <div className="m-4 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
      {t("Publiez votre clé de chiffrement publique pour que les autres puissent vous écrire.")}
      <Button size="sm" className="ml-2" onClick={() => actions.publishEncKey()}>
        {t("Publier ma clé")}
      </Button>
    </div>
  );
}

function ConversationList({ activeId }: { activeId?: Hex }) {
  const viewer = useViewer()!;
  const { data, isPending, syncing } = useConversations();
  const { isBlocked } = useHiddenAuthors(viewer);
  const [creating, setCreating] = useState(false);
  const t = useT();
  return (
    <>
      <PageHeader title={t("Messages")} subtitle={t("Chiffrés de bout en bout")}>
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)} aria-label={t("Nouveau message")}>
          <MailPlus className="size-5" />
        </Button>
      </PageHeader>
      <EncKeyBanner />
      {isPending && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {syncing && (
        <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted">
          <Spinner className="size-3.5" /> {t("Recherche de nouvelles conversations onchain…")}
        </p>
      )}
      {data?.length === 0 && !syncing && (
        <Empty title={t("Aucune conversation")} icon={<Lock className="size-8" />}>
          {t("Démarrez une conversation avec l'adresse d'un compte qui a publié sa clé de chiffrement.")}
        </Empty>
      )}
      <ul>
        {data?.filter((c) => !(c.type === "dm" && c.peer && isBlocked(c.peer))).map((c) => {
          const peer = c.type === "dm" ? (c.peer ?? c.members.find((m) => !sameAddress(m, viewer))) : undefined;
          const unread = c.lastTs > c.readTs && c.id !== activeId;
          return (
            <li key={c.id}>
              <Link
                to={`/messages/${c.id}`}
                className={clsx("flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-elevated/50", c.id === activeId && "bg-elevated/60")}
              >
                {peer ? (
                  <Avatar address={peer} />
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-full bg-elevated">
                    <Users className="size-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={clsx("truncate", unread ? "font-semibold" : "font-medium")}>
                      <ConvTitle conv={c} me={viewer} />
                    </span>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(c.lastTs)}</span>
                  </div>
                  <p className={clsx("truncate text-sm", unread ? "text-fg" : "text-muted")}>{c.lastText ?? t("Nouvelle conversation")}</p>
                </div>
                {unread && <span className="size-2.5 rounded-full bg-accent" />}
              </Link>
            </li>
          );
        })}
      </ul>
      <NewConversation open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function ConversationView({ convId }: { convId: Hex }) {
  const viewer = useViewer()!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const convs = useConversations();
  const conv = convs.data?.find((c) => c.id === convId);
  const { data: messages } = useDirectMessages(convId);
  const send = useSendDm();
  const members = useGroupMembers();
  const [text, setText] = useState("");
  const [managing, setManaging] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [newMember, setNewMember] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  useEffect(() => {
    if (conv && conv.lastTs > conv.readTs) {
      void db.convs.update(conv.id, { readTs: conv.lastTs }).then(() => qc.invalidateQueries({ queryKey: qk.convs(viewer) }));
    }
  }, [conv, qc, viewer]);

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: qk.dms(convId) });
  }, [convs.dataUpdatedAt, convId, qc]);

  if (!conv)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );

  const owner = sameAddress(conv.owner, viewer);
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    send.mutate({ conv, text: value });
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-md">
        <button onClick={() => navigate("/messages")} className="rounded-full p-1.5 hover:bg-elevated" aria-label={t("Retour")}>
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold">
            <ConvTitle conv={conv} me={viewer} />
          </h1>
          <p className="flex items-center gap-1 text-xs text-muted">
            <Lock className="size-3" /> {conv.type === "group" ? t("{n} membres · clé époque {epoch}", { n: conv.members.length, epoch: conv.epoch }) : t("chiffré de bout en bout")}
          </p>
        </div>
        {conv.type === "group" ? (
          <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
            <Users className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setVerifying(true)} aria-label={t("Code de sécurité")}>
            <ShieldCheck className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-2 px-4 py-4">
        {messages?.map((m) => {
          const mine = sameAddress(m.from, viewer);
          return (
            <div key={m.id} className={clsx("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={clsx(
                  "max-w-[78%] rounded-2xl px-3.5 py-2 text-[15px]",
                  mine ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-elevated",
                  m.status === "invalid" && "border border-danger bg-danger/10 text-danger",
                )}
              >
                {!mine && conv.type === "group" && <DisplayName address={m.from} className="mb-0.5 block text-xs font-bold opacity-80" />}
                <p className="whitespace-pre-wrap break-words">{m.status === "invalid" ? t("Signature invalide") : m.text}</p>
                <p className={clsx("mt-0.5 text-right text-[11px]", mine ? "text-accent-fg/70" : "text-muted")}>
                  {m.status === "pending" ? t("envoi…") : m.status === "failed" ? t("échec") : timeAgo(m.ts)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {send.error && <p className="px-4 text-sm text-danger">{humanError(send.error)}</p>}
      <div className="sticky bottom-16 flex items-end gap-2 border-t border-line bg-bg px-4 py-3 sm:bottom-0">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("Message chiffré")}
          className={clsx(inputClass, "max-h-40 resize-none rounded-2xl")}
        />
        <Button onClick={submit} disabled={!text.trim()} aria-label={t("Envoyer")}>
          <Send className="size-4" />
        </Button>
      </div>
      {conv.type === "dm" && (conv.peer ?? conv.members.find((m) => !sameAddress(m, viewer))) && (
        <Modal open={verifying} onClose={() => setVerifying(false)} title={t("Code de sécurité")}>
          {verifying && <SafetyCode peer={(conv.peer ?? conv.members.find((m) => !sameAddress(m, viewer)))!} />}
        </Modal>
      )}
      <Modal open={managing} onClose={() => setManaging(false)} title={t("Membres du groupe")}>
        <ul className="mb-4 space-y-2">
          {conv.members.map((m) => (
            <li key={m} className="flex items-center gap-2">
              <Avatar address={m} size={28} />
              <DisplayName address={m} className="flex-1 truncate" />
              <span className="font-mono text-xs text-muted">{short(m)}</span>
              {owner && !sameAddress(m, viewer) && (
                <button
                  title={t("Retirer (rotation de la clé)")}
                  className="rounded-full p-1 text-danger hover:bg-danger/10"
                  onClick={() => members.mutate({ conv, remove: m })}
                >
                  <UserMinus className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!owner && <p className="text-sm text-muted">{t("Seul le créateur du groupe peut ajouter ou retirer des membres.")}</p>}
        <div className={clsx("flex gap-2", !owner && "hidden")}>
          <input className={inputClass} value={newMember} onChange={(e) => setNewMember(e.target.value.trim())} placeholder={t("0x… à ajouter")} />
          <Button
            disabled={!isAddress(newMember)}
            loading={members.isPending}
            onClick={() => members.mutate({ conv, add: newMember as Address }, { onSuccess: () => setNewMember("") })}
          >
            <UserPlus className="size-4" />
          </Button>
        </div>
        {members.error && <p className="mt-2 text-sm text-danger">{humanError(members.error)}</p>}
      </Modal>
    </div>
  );
}

export default function Messages() {
  const { convId } = useParams() as { convId?: Hex };
  return convId ? <ConversationView convId={convId} /> : <ConversationList />;
}
