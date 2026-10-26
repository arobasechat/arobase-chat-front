import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Anchor, BarChart3, ImagePlus, Plus, X } from "lucide-react";
import { formatEther, type Hex } from "viem";
import { useViewer } from "@/identity/store";
import { KIND, POLL_MAX_OPTIONS, type Message } from "@/lib/protocol";
import { useSettings } from "@/lib/settings";
import { compressImage, isOnchainRef, mediaChain, uploadOnchain } from "@/lib/media";
import { humanError } from "@/lib/tx";
import { useConfig, useNetworks } from "@/queries/core";
import { sponsorFor } from "@/lib/sponsor";
import { resolveHandle, usePeopleSearch, useRecentPosts } from "@/queries/names";
import { short } from "@/lib/format";
import { usePublish } from "@/queries/actions";
import { Avatar } from "./Avatar";
import { QuotedPost } from "./PostExtras";
import { Badge, Button, Spinner } from "./ui";
import { useT } from "@/lib/i18n";

const MAX_CHARS = 2000;
const POLL_DURATIONS = [
  { hours: 1, label: "1 h" },
  { hours: 24, label: "1 jour" },
  { hours: 72, label: "3 jours" },
  { hours: 168, label: "7 jours" },
];

type Draft = { parts: string[]; poll: { options: string[]; hours: number } | null };

function useAnchorEstimate(chainId: number, bytes: number, enabled: boolean) {
  const networks = useNetworks();
  return useQuery({
    queryKey: ["anchor-estimate", chainId, Math.ceil(bytes / 256)],
    enabled,
    staleTime: 60_000,
    meta: { persist: false },
    queryFn: async () => {
      const net = networks.byId.get(chainId)!;
      const price = await net.client.getGasPrice();
      return price * BigInt(160_000 + bytes * 40);
    },
  });
}

function AnchorChip({ chainId, name, selected, onToggle, bytes }: { chainId: number; name: string; selected: boolean; onToggle: () => void; bytes: number }) {
  const t = useT();
  const config = useConfig();
  const free = !!sponsorFor(config.params, chainId);
  const { data } = useAnchorEstimate(chainId, bytes, selected && !free);
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        free
          ? t("Copie offerte sur une chain qui ne peut ni disparaître ni être contrôlée par une seule entité. Recommandé pour les contenus sensibles.")
          : t("Copie payante sur une chain qui ne peut ni disparaître ni être contrôlée par une seule entité. Recommandé pour les contenus sensibles.")
      }
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
        selected ? "border-ok bg-ok/10 text-ok" : "border-line text-muted hover:text-fg",
      )}
    >
      <Anchor className="size-3.5" />
      {name}
      {free ? (
        <span className="font-normal">{t("offert")}</span>
      ) : (
        selected && data !== undefined && <span className="font-normal">≈ {Number(formatEther(data)).toPrecision(2)}</span>
      )}
    </button>
  );
}

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, d: Draft) {
  try {
    if (!d.parts.some((p) => p.trim()) && !d.poll) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(d));
  } catch {
    return;
  }
}

export function Composer({
  kind = KIND.POST,
  parentId,
  quote,
  placeholder = "Quoi de neuf ?",
  autoFocus,
  onDone,
  compact,
}: {
  kind?: number;
  parentId?: Hex;
  quote?: Message;
  placeholder?: string;
  autoFocus?: boolean;
  onDone?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const viewer = useViewer();
  const networks = useNetworks();
  const config = useConfig();
  const { anchorChains } = useSettings();
  const draftKey = `arobase:draft:${kind}:${parentId ?? quote?.id ?? "root"}`;
  const initial = useRef(readDraft(draftKey));
  const [parts, setParts] = useState<string[]>(initial.current?.parts?.length ? initial.current.parts : [""]);
  const [poll, setPoll] = useState<Draft["poll"]>(initial.current?.poll ?? null);
  const [media, setMedia] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<number[]>(anchorChains);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [active, setActive] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const publish = usePublish();
  const areas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const mentionMap = useRef(new Map<string, Address>());
  const pendingCaret = useRef<{ index: number; pos: number } | null>(null);
  const canThread = kind === KIND.POST && !quote;
  const canPoll = kind === KIND.POST && !quote;
  const onchainMedia = !!mediaChain(networks, config);
  const canAttach = onchainMedia;

  useEffect(() => {
    const t = setTimeout(() => writeDraft(draftKey, { parts, poll }), 400);
    return () => clearTimeout(t);
  }, [draftKey, parts, poll]);

  useLayoutEffect(() => {
    if (!pendingCaret.current) return;
    const { index, pos } = pendingCaret.current;
    pendingCaret.current = null;
    const el = areas.current[index];
    el?.focus();
    el?.setSelectionRange(pos, pos);
  }, [parts]);

  const [token, setToken] = useState<{ kind: "@" | "#"; query: string; start: number; index: number } | null>(null);
  const [activeHit, setActiveHit] = useState(0);
  const people = usePeopleSearch(token?.kind === "@" ? token.query : "");
  const recent = useRecentPosts(token?.kind === "#");
  const suggestions =
    token?.kind === "@"
      ? (people.data ?? []).map((p) => ({ key: p.address, label: p.handle ? `@${p.handle}` : `@${p.name}`, sub: p.name && p.handle ? p.name : short(p.address), insert: p.handle ?? (p.name ?? "").replace(/\s+/g, "_"), address: p.address as Address | undefined }))
      : token?.kind === "#"
        ? (recent.data?.tags ?? [])
            .filter((tg) => tg.tag.startsWith(token.query.toLowerCase()))
            .slice(0, 6)
            .map((tg) => ({ key: tg.tag, label: `#${tg.tag}`, sub: tg.authors > 1 ? t("{n} personnes", { n: tg.authors }) : t("{n} personne", { n: tg.authors }), insert: tg.tag, address: undefined }))
        : [];

  const detectToken = (index: number, value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)([@#])([\p{L}\p{N}_]{1,30})$/u);
    if (!m) return setToken(null);
    setToken({ kind: m[2] as "@" | "#", query: m[3], start: caret - m[3].length - 1, index });
    setActiveHit(0);
  };

  const setPart = (index: number, value: string) => setParts((p) => p.map((x, i) => (i === index ? value : x)));

  const applySuggestion = (s: (typeof suggestions)[number]) => {
    if (!token) return;
    const text = parts[token.index];
    const caret = areas.current[token.index]?.selectionStart ?? text.length;
    const insert = `${token.kind}${s.insert} `;
    if (s.address) mentionMap.current.set(s.insert.toLowerCase(), s.address);
    pendingCaret.current = { index: token.index, pos: token.start + insert.length };
    setPart(token.index, text.slice(0, token.start) + insert + text.slice(caret));
    setToken(null);
  };

  const encodeMentions = async (raw: string) => {
    const tokens = [...new Set([...raw.matchAll(/(^|\s)@([\p{L}\p{N}_]{3,30})/gu)].map((m) => m[2]))];
    let out = raw;
    for (const t of tokens) {
      const addr = mentionMap.current.get(t.toLowerCase()) ?? (await resolveHandle(networks, t).catch(() => null));
      if (addr) out = out.replace(new RegExp(`(^|\\s)@${t}(?![\\p{L}\\p{N}_])`, "gu"), `$1@${addr}`);
    }
    return out;
  };

  if (!viewer) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4">
        <p className="text-sm text-muted">{t("Créez un compte en 10 secondes avec Face ID ou votre empreinte.")}</p>
        <Link to="/bienvenue">
          <Button size="sm">{t("Commencer")}</Button>
        </Link>
      </div>
    );
  }

  const text = parts[0];
  const bytes = new TextEncoder().encode(parts.join("")).length;
  const over = parts.some((p) => p.length > MAX_CHARS);
  const pollOptions = poll?.options.map((o) => o.trim()).filter(Boolean) ?? [];
  const pollValid = !poll || pollOptions.length >= 2;
  const canSend = (text.trim().length > 0 || media.length > 0 || !!quote) && !over && !uploading && pollValid;

  const submit = async () => {
    if (!canSend) return;
    setError(undefined);
    const encoded = await Promise.all(parts.map((p) => encodeMentions(p.trim())));
    const extra = {
      ...(quote ? { quote: quote.id } : {}),
      ...(poll ? { poll: { options: pollOptions.slice(0, POLL_MAX_OPTIONS), end: Math.floor(Date.now() / 1000) + poll.hours * 3600 } } : {}),
    };
    const first = { kind, text: encoded[0], media, parentId, extra, anchorChains: kind === KIND.POST ? anchors : [] };
    const rest = encoded.slice(1).filter(Boolean);
    setParts([""]);
    setPoll(null);
    setMedia([]);
    setToken(null);
    mentionMap.current.clear();
    writeDraft(draftKey, { parts: [""], poll: null });
    onDone?.();
    try {
      let prev = await publish.mutateAsync(first);
      for (const t of rest) prev = await publish.mutateAsync({ kind: KIND.COMMENT, text: t, parentId: prev.id });
    } catch (e) {
      setError(humanError(e));
    }
  };

  const onFiles = async (files: FileList) => {
    setUploading(true);
    setError(undefined);
    try {
      for (const file of [...files].slice(0, 4 - media.length)) {
        const ref = await uploadOnchain(networks, config, await compressImage(file));
        setMedia((m) => [...m, ref].slice(0, 4));
      }
    } catch (e) {
      setError(humanError(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className={clsx("flex gap-3 border-b border-line px-4", compact ? "py-3" : "py-4")}>
      {!compact && <Avatar address={viewer} />}
      <div className="min-w-0 flex-1">
        {parts.map((part, index) => (
          <div key={index} className={clsx("relative", index > 0 && "mt-2 border-l-2 border-line pl-3")}>
            <textarea
              ref={(el) => {
                areas.current[index] = el;
              }}
              value={part}
              autoFocus={index === 0 ? autoFocus : index === parts.length - 1}
              onFocus={() => setActive(index)}
              onChange={(e) => {
                setPart(index, e.target.value);
                detectToken(index, e.target.value, e.target.selectionStart);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onClick={(e) => detectToken(index, e.currentTarget.value, e.currentTarget.selectionStart)}
              onBlur={() => setTimeout(() => setToken(null), 150)}
              onKeyDown={(e) => {
                if (token && token.index === index && suggestions.length) {
                  if (e.key === "ArrowDown") return (e.preventDefault(), setActiveHit((a) => Math.min(a + 1, suggestions.length - 1)));
                  if (e.key === "ArrowUp") return (e.preventDefault(), setActiveHit((a) => Math.max(a - 1, 0)));
                  if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), applySuggestion(suggestions[activeHit]));
                  if (e.key === "Escape") return setToken(null);
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
              }}
              placeholder={index === 0 ? (quote ? t("Ajoutez un commentaire") : t(placeholder)) : t("Suite du fil…")}
              rows={compact ? 1 : 2}
              className="w-full resize-none bg-transparent pt-1.5 text-[17px] outline-none placeholder:text-muted"
            />
            {index > 0 && (
              <button
                type="button"
                onClick={() => setParts((p) => p.filter((_, i) => i !== index))}
                className="absolute right-0 top-1 rounded-full p-1 text-muted hover:bg-elevated hover:text-fg"
                aria-label={t("Retirer cette partie")}
              >
                <X className="size-4" />
              </button>
            )}
            {part.length > MAX_CHARS * 0.8 && (
              <span className={clsx("block text-right text-xs tabular-nums", part.length > MAX_CHARS ? "text-danger" : "text-muted")}>{MAX_CHARS - part.length}</span>
            )}
            {token && token.index === index && suggestions.length > 0 && (
              <div role="listbox" className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-2xl">
                {suggestions.map((s, i) => (
                  <button
                    key={s.key}
                    role="option"
                    aria-selected={i === activeHit}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveHit(i)}
                    onClick={() => applySuggestion(s)}
                    className={clsx("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm", i === activeHit && "bg-elevated")}
                  >
                    {s.address ? <Avatar address={s.address} size={28} /> : <span className="flex size-7 items-center justify-center rounded-md border border-tag-line bg-tag text-tag-fg">#</span>}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.label}</span>
                      <span className="block truncate text-[12px] text-muted">{s.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {poll && (
          <div className="mt-2 space-y-2 rounded-xl border border-line p-3">
            {poll.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={o}
                  maxLength={40}
                  onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })}
                  placeholder={t("Option {n}", { n: i + 1 })}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
                />
                {poll.options.length > 2 && (
                  <button type="button" onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })} className="text-muted hover:text-fg" aria-label={t("Retirer l'option")}>
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {poll.options.length < POLL_MAX_OPTIONS ? (
                <button type="button" onClick={() => setPoll({ ...poll, options: [...poll.options, ""] })} className="text-sm font-semibold text-accent">
                  + {t("Ajouter une option")}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted">{t("Durée")}</span>
                {POLL_DURATIONS.map((d) => (
                  <button
                    key={d.hours}
                    type="button"
                    onClick={() => setPoll({ ...poll, hours: d.hours })}
                    className={clsx("rounded-full border px-2 py-0.5", poll.hours === d.hours ? "border-accent text-accent" : "border-line text-muted")}
                  >
                    {t(d.label)}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => setPoll(null)} className="text-xs text-muted hover:text-danger">
              {t("Retirer le sondage")}
            </button>
          </div>
        )}

        {quote && <QuotedPost id={quote.id} />}

        {media.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {media.map((ref) => (
              <Badge key={ref}>
                {isOnchainRef(ref) ? t("image onchain") : `${ref.slice(0, 10)}…`}
                <button onClick={() => setMedia((m) => m.filter((c) => c !== ref))} aria-label={t("Retirer")}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {kind === KIND.POST && networks.anchored.length > 0 && text.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">{t("Ancrer une copie :")}</span>
            {networks.anchored.map((n) => (
              <AnchorChip
                key={n.cfg.chainId}
                chainId={n.cfg.chainId}
                name={n.cfg.name}
                bytes={bytes}
                selected={anchors.includes(n.cfg.chainId)}
                onToggle={() => setAnchors((a) => (a.includes(n.cfg.chainId) ? a.filter((x) => x !== n.cfg.chainId) : [...a, n.cfg.chainId]))}
              />
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2">
          <div className="flex items-center gap-1 text-accent">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files?.length && void onFiles(e.target.files)} />
            <button
              type="button"
              disabled={!canAttach || uploading || media.length >= 4}
              title={canAttach ? t("Ajouter une image (compressée puis stockée onchain)") : t("Aucun stockage d'images configuré")}
              onClick={() => fileRef.current?.click()}
              className="rounded-full p-2 hover:bg-accent/10 disabled:opacity-40"
              aria-label={t("Ajouter une image")}
            >
              {uploading ? <Spinner className="size-5" /> : <ImagePlus className="size-5" />}
            </button>
            {canPoll && !poll && (
              <button type="button" onClick={() => setPoll({ options: ["", ""], hours: 24 })} className="rounded-full p-2 hover:bg-accent/10" aria-label={t("Ajouter un sondage")} title={t("Sondage")}>
                <BarChart3 className="size-5" />
              </button>
            )}
            {canThread && (
              <button
                type="button"
                disabled={!parts[parts.length - 1].trim() || parts.length >= 10}
                onClick={() => {
                  setParts((p) => [...p, ""]);
                  setActive(parts.length);
                }}
                className="rounded-full p-2 hover:bg-accent/10 disabled:opacity-40"
                aria-label={t("Ajouter au fil")}
                title={t("Continuer en fil (chaque partie est publiée en réponse à la précédente)")}
              >
                <Plus className="size-5" />
              </button>
            )}
            {parts.length > 1 && <span className="ml-1 text-xs text-muted">{t("Fil de {n} posts · partie {part}", { n: parts.length, part: active + 1 })}</span>}
          </div>
          <Button size="sm" disabled={!canSend} loading={uploading} onClick={() => void submit()}>
            {kind === KIND.COMMENT ? t("Répondre") : kind === KIND.NOTE ? t("Proposer la note") : parts.length > 1 ? t("Publier le fil") : quote ? t("Citer") : t("Publier")}
          </Button>
        </div>
      </div>
    </div>
  );
}
