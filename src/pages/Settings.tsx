import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { del } from "idb-keyval";
import clsx from "clsx";
import { Ban, BellRing, Globe, Languages, Smartphone, KeyRound, LogOut, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";
import { isAddress, type Address } from "viem";
import { useSettings, type ModerationMode, type Theme } from "@/lib/settings";
import type { ChainCfg } from "@/lib/config";
import { db } from "@/lib/db";
import { short } from "@/lib/format";
import { humanError } from "@/lib/tx";
import { useAuth } from "@/identity/store";
import { useConfig } from "@/queries/core";
import { useSocialActions } from "@/queries/actions";
import { PageHeader } from "@/components/Layout";
import { PushSettings } from "@/components/PushSettings";
import { SafetySettings, SyncSettings } from "@/components/SafetySettings";
import { Badge, Button, Field, inputClass } from "@/components/ui";
import { useLang, useT } from "@/lib/i18n";

const ROLE_LABEL = ["Sociale", "Contenu gratuit", "Contenu ancré"];

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-4 py-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[] }) {
  return (
    <div className="grid gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={clsx("flex cursor-pointer gap-3 rounded-xl border p-3", value === o.value ? "border-accent bg-accent/5" : "border-line")}
        >
          <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-[var(--accent)]" />
          <span>
            <span className="block font-semibold">{o.label}</span>
            {o.hint && <span className="block text-sm text-muted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

function ChainRow({ c }: { c: ChainCfg }) {
  const { extraRpcs, disabledChains, set } = useSettings();
  const [rpc, setRpc] = useState("");
  const [loading, setLoading] = useState(false);
  const t = useT();
  const extra = extraRpcs[c.chainId] ?? [];
  const disabled = disabledChains.includes(c.chainId);
  const addRpcs = (list: string[]) => set({ extraRpcs: { ...extraRpcs, [c.chainId]: [...new Set([...extra, ...list])] } });

  const fromChainlist = async () => {
    setLoading(true);
    try {
      const res = await fetch("https://chainlist.org/rpcs.json");
      const all = (await res.json()) as { chainId: number; rpc: { url: string; tracking?: string }[] }[];
      const entry = all.find((x) => x.chainId === c.chainId);
      addRpcs((entry?.rpc ?? []).filter((r) => r.url.startsWith("https://") && !r.url.includes("${") && r.tracking !== "yes").map((r) => r.url).slice(0, 8));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={clsx("rounded-xl border border-line p-3", disabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold">
            {c.name} <span className="font-normal text-muted">#{c.chainId}</span>
          </p>
          <Badge tone={c.role === 2 ? "ok" : c.role === 0 ? "accent" : "muted"}>{t(ROLE_LABEL[c.role])}</Badge>
        </div>
        {c.role !== 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!disabled}
              onChange={(e) => set({ disabledChains: e.target.checked ? disabledChains.filter((x) => x !== c.chainId) : [...disabledChains, c.chainId] })}
            />
            {t("active")}
          </label>
        )}
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {[...extra, ...c.rpcs].map((u, i) => (
          <li key={u + i} className="flex items-center justify-between gap-2 font-mono text-muted">
            <span className="truncate">{u}</span>
            {i < extra.length && (
              <button onClick={() => set({ extraRpcs: { ...extraRpcs, [c.chainId]: extra.filter((x) => x !== u) } })} aria-label={t("Retirer")}>
                <Trash2 className="size-3.5 text-danger" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input className={clsx(inputClass, "text-sm")} placeholder={t("https://mon-rpc…")} value={rpc} onChange={(e) => setRpc(e.target.value.trim())} />
        <Button size="sm" variant="outline" disabled={!/^https?:\/\//.test(rpc)} onClick={() => (addRpcs([rpc]), setRpc(""))}>
          <Plus className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" loading={loading} onClick={fromChainlist} title={t("Ajouter des RPC publics depuis Chainlist")}>
          <Globe className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Settings() {
  const s = useSettings();
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { identity, session, createSession, dropSession, logout } = useAuth();
  const actions = useSocialActions();
  const [moderator, setModerator] = useState("");
  const [override, setOverride] = useState(s.chainsOverride ? JSON.stringify(s.chainsOverride, null, 2) : "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const t = useT();
  const lang = useLang();

  const setMode = (moderationMode: ModerationMode) => {
    s.set({ moderationMode });
    void qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const applyOverride = () => {
    try {
      if (!override.trim()) return s.set({ chainsOverride: null });
      const parsed = JSON.parse(override) as ChainCfg[];
      if (!Array.isArray(parsed) || !parsed.some((c) => c.active && c.role !== 0)) throw new Error(t("Au moins une chain de contenu active est requise."));
      s.set({ chainsOverride: parsed });
      setError(undefined);
    } catch (e) {
      setError(humanError(e));
    }
  };

  return (
    <>
      <PageHeader title={t("Réglages")} subtitle={t("Config onchain v{version}", { version: config.version })} />

      <div id="push">
        <Section title={t("Notifications push")} icon={<BellRing className="size-5" />}>
          <PushSettings />
        </Section>
      </div>

      <Section title={t("Comptes masqués et bloqués")} icon={<Ban className="size-5" />}>
        <SafetySettings />
      </Section>

      <Section title={t("Plusieurs appareils")} icon={<Smartphone className="size-5" />}>
        <SyncSettings />
      </Section>

      <Section title={t("Langue")} icon={<Languages className="size-5" />}>
        <Choice<"fr" | "en">
          value={s.language}
          onChange={(language) => s.set({ language })}
          options={[
            { value: "fr", label: "Français" },
            { value: "en", label: "English" },
          ]}
        />
      </Section>

      <Section title={t("Apparence")}>
        <Choice<Theme>
          value={s.theme}
          onChange={(theme) => s.set({ theme })}
          options={[
            { value: "system", label: t("Système") },
            { value: "dark", label: t("Sombre") },
            { value: "light", label: t("Clair") },
          ]}
        />
      </Section>

      <Section title={t("Modération")} icon={<Shield className="size-5" />}>
        <p className="text-sm text-muted">{t("La modération masque à l'affichage, elle ne supprime jamais rien onchain. Vous choisissez qui vous fait confiance.")}</p>
        <Choice<ModerationMode>
          value={s.moderationMode}
          onChange={setMode}
          options={[
            { value: "instance", label: t("Politique de l'instance"), hint: t("Modérateurs officiels + votes pondérés de la communauté.") },
            { value: "custom", label: t("Mes modérateurs"), hint: t("Uniquement les masquages des adresses que vous listez.") },
            { value: "raw", label: t("Vue brute"), hint: t("Aucun filtre : vous voyez tout ce qui est onchain.") },
          ]}
        />
        {s.moderationMode === "custom" && (
          <div className="space-y-2">
            {s.customModerators.map((m) => (
              <div key={m} className="flex items-center justify-between rounded-lg bg-elevated px-3 py-2 font-mono text-sm">
                {short(m, 8)}
                <button onClick={() => s.set({ customModerators: s.customModerators.filter((x) => x !== m) })}>
                  <Trash2 className="size-4 text-danger" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input className={inputClass} value={moderator} onChange={(e) => setModerator(e.target.value.trim())} placeholder={t("0x… modérateur")} />
              <Button
                variant="outline"
                disabled={!isAddress(moderator)}
                onClick={() => {
                  s.set({ customModerators: [...new Set([...s.customModerators, moderator as Address])] });
                  setModerator("");
                  void qc.invalidateQueries({ queryKey: ["stats"] });
                }}
              >
                {t("Ajouter")}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title={t("Chains & RPC")} icon={<Globe className="size-5" />}>
        <p className="text-sm text-muted">
          {t("Si un RPC est bloqué dans votre pays, ajoutez-en un autre. Vos RPC passent en priorité. La config de base est lue dans le contrat Registry.")}
        </p>
        <div className="space-y-2">
          {(s.chainsOverride ?? config.chains).map((c) => (
            <ChainRow key={c.chainId} c={c} />
          ))}
        </div>
        <Field label={t("Forcer ma propre liste de chains (JSON, avancé)")} hint={t("Laisser vide pour suivre le Registry onchain.")}>
          <textarea className={clsx(inputClass, "font-mono text-xs")} rows={4} value={override} onChange={(e) => setOverride(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={applyOverride}>
            {t("Appliquer")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOverride(JSON.stringify(config.chains, null, 2))}>
            {t("Partir de la config actuelle")}
          </Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {config.chains.some((c) => c.role === 2) && (
          <Field label={t("Ancrage par défaut des posts")}>
            <div className="flex flex-wrap gap-3">
              {config.chains
                .filter((c) => c.role === 2)
                .map((c) => (
                  <label key={c.chainId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s.anchorChains.includes(c.chainId)}
                      onChange={(e) =>
                        s.set({ anchorChains: e.target.checked ? [...s.anchorChains, c.chainId] : s.anchorChains.filter((x) => x !== c.chainId) })
                      }
                    />
                    {c.name}
                  </label>
                ))}
            </div>
          </Field>
        )}
      </Section>

      {Object.keys(config.params.aa ?? {}).length > 0 && (
        <Section title={t("Gas sponsorisé (ERC-4337)")}>
          <p className="text-sm text-muted">
            {t("Un paymaster onchain paie le gas de vos posts, likes et messages. Ses règles sont publiques : il ne sponsorise que les contrats arobase.chat, contre une petite preuve de travail calculée par votre navigateur. N'importe quel bundler peut transmettre vos opérations ; s'ils échouent tous, l'app repasse sur votre propre gas.")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.useSponsor} onChange={(e) => s.set({ useSponsor: e.target.checked })} />
            {t("Utiliser le gas sponsorisé")}
          </label>
          {Object.entries(config.params.aa ?? {}).map(([chainId, aa]) => {
            const id = Number(chainId);
            const extra = s.extraBundlers[id] ?? [];
            return (
              <div key={chainId} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-semibold">{config.chains.find((c) => c.chainId === id)?.name ?? chainId}</p>
                <p className="font-mono text-xs text-muted">paymaster {short(aa.paymaster, 6)}</p>
                <Field label={t("Bundlers (un par ligne, les vôtres en premier)")}>
                  <textarea
                    className={clsx(inputClass, "font-mono text-xs")}
                    rows={2}
                    defaultValue={extra.join("\n")}
                    placeholder={aa.bundlers.join("\n")}
                    onBlur={(e) =>
                      s.set({
                        extraBundlers: {
                          ...s.extraBundlers,
                          [id]: e.target.value.split("\n").map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x)),
                        },
                      })
                    }
                  />
                </Field>
              </div>
            );
          })}
        </Section>
      )}

      {identity && (
        <Section title={t("Compte & session")} icon={<KeyRound className="size-5" />}>
          <p className="font-mono text-sm">{identity.address}</p>
          <p className="text-sm text-muted">
            {identity.type === "passkey"
              ? t("Identité dérivée de votre passkey (PRF). Récupérable sur tout appareil synchronisé avec le même trousseau.")
              : t("Compte de développement : la clé privée est stockée en clair dans ce navigateur.")}
          </p>
          {identity.type === "passkey" && (
            <div className="rounded-xl border border-line p-3 text-sm">
              {session ? (
                <>
                  <p>
                    {t("Clé de session")} <span className="font-mono">{short(session.account.address)}</span>{" "}
                    {t("valable jusqu'au {date}.", { date: new Date(session.delegation.expiry * 1000).toLocaleDateString(lang) })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await createSession();
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RefreshCw className="size-4" /> {t("Renouveler")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await actions.revokeSession(session.account.address);
                          await dropSession();
                        } catch (err) {
                          console.warn(humanError(err));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t("Révoquer onchain")}
                    </Button>
                  </div>
                </>
              ) : (
                <Button size="sm" onClick={() => void createSession()}>
                  {t("Créer une clé de session (évite Face ID à chaque action)")}
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await Promise.all([db.messages.clear(), db.kv.clear(), db.ratings.clear(), del("arobase:query-cache")]);
                qc.clear();
                location.reload();
              }}
            >
              {t("Vider le cache local")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                const key = session?.account.address;
                if (key) await Promise.race([actions.revokeSession(key).catch(() => undefined), new Promise((r) => setTimeout(r, 20_000))]);
                await logout();
                await del("arobase:query-cache");
                qc.clear();
                navigate("/");
                location.reload();
              }}
            >
              <LogOut className="size-4" /> {t("Se déconnecter")}
            </Button>
          </div>
        </Section>
      )}
      <p className="px-4 py-6 text-center text-xs text-muted">
        Registry {short(config.registry)} · chain {config.registryChainId} · Social {short(config.social)}
      </p>
    </>
  );
}
