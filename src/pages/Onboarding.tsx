import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Check, Fingerprint, Gift, KeyRound, Lock, ShieldCheck, Wrench } from "lucide-react";
import { keccak256, toHex, type Hex } from "viem";
import { env } from "@/env";
import { passkeySupported } from "@/identity/passkey";
import { useAuth } from "@/identity/store";
import { useT } from "@/lib/i18n";
import { humanError } from "@/lib/tx";
import { KIND } from "@/lib/protocol";
import { usePublish, useSocialActions } from "@/queries/actions";
import { useConfig } from "@/queries/core";
import { useClaimHandle, useHandleAvailability } from "@/queries/names";
import { HandleField, handleUsable } from "@/components/HandleField";
import { Button, Field, inputClass } from "@/components/ui";

const DEV_ACCOUNTS = ["alice", "bob", "carol", "dave"];
const WELCOME_KEY = "arobase:welcome";

function Perk({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-tag-line bg-tag text-tag-fg">{icon}</span>
      <span className="text-[15px] leading-relaxed text-muted">{children}</span>
    </li>
  );
}

export default function Onboarding() {
  const t = useT();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const next = search.get("next") || "/";
  const { createWithPasskey, unlock, createSession, importDevKey } = useAuth();
  const publish = usePublish();
  const actions = useSocialActions();
  const [mode, setMode] = useState<"signup" | "login">(search.get("mode") === "login" ? "login" : "signup");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const config = useConfig();
  const namesEnabled = !!config.params.names;
  const handleState = useHandleAvailability(handle).state;
  const claim = useClaimHandle();
  const [pk, setPk] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [advanced, setAdvanced] = useState(env.devChains);
  const supported = passkeySupported();

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      const msg = humanError(e);
      setError(/NotAllowed|annul|aborted|timed out/i.test(msg) ? t("Opération annulée. Vous pouvez réessayer.") : msg);
    } finally {
      setBusy(undefined);
    }
  };

  const done = (isNew: boolean, displayName?: string, chosenHandle?: string) => {
    if (isNew) {
      localStorage.setItem(WELCOME_KEY, "1");
      actions.publishEncKey();
      if (chosenHandle) claim.mutate(chosenHandle);
      if (displayName) publish.mutate({ kind: KIND.PROFILE, extra: { name: displayName } });
    }
    navigate(next, { replace: true });
  };
  const canSignup = !!name.trim() && (!namesEnabled || handleUsable(handleState));

  return (
    <div className="grid min-h-dvh bg-bg text-fg lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div aria-hidden className="glow-top absolute inset-0" />
        <div aria-hidden className="dots mask-fade-b absolute inset-x-0 top-0 h-80 opacity-30" />
        <div aria-hidden className="glow-bottom absolute inset-x-0 bottom-0 h-56 opacity-60" />
        <Link to="/" className="relative flex items-center gap-2">
          <img src="./icon.svg" alt="" className="size-6 rounded-md" />
          <span className="text-[17px] font-medium tracking-tight">arobase.chat</span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="display text-[2.8rem]">{t("Un compte qui n'appartient qu'à vous.")}</h2>
          <ul className="mt-8 space-y-5">
            <Perk icon={<Fingerprint className="size-4" />}>
              <b className="text-fg">{t("Face ID ou empreinte")}</b>
              {t(", c'est tout. Pas d'email, pas de mot de passe, aucune donnée personnelle.")}
            </Perk>
            <Perk icon={<KeyRound className="size-4" />}>
              {t("Votre clé est créée")} <b className="text-fg">{t("sur votre appareil")}</b>{" "}
              {t("et synchronisée par iCloud ou Google. Personne d'autre ne la détient, pas même nous.")}
            </Perk>
            <Perk icon={<Gift className="size-4" />}>
              <b className="text-fg">{t("Gratuit")}</b>
              {t(" : le gas de vos posts, likes et messages est sponsorisé.")}
            </Perk>
            <Perk icon={<Lock className="size-4" />}>
              {t("Messages privés")} <b className="text-fg">{t("chiffrés de bout en bout")}</b>.
            </Perk>
          </ul>
        </div>
        <p className="relative text-sm text-muted">
          {t("Projet open source.")}{" "}
          <Link to="/comment-ca-marche" className="font-semibold text-fg hover:underline">
            {t("Comprendre comment ça marche")}
          </Link>
        </p>
      </aside>

      <main className="relative flex flex-col px-6 py-8 sm:px-12">
        <Link to="/" className="mb-10 inline-flex items-center gap-2 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {t("Accueil")}
        </Link>
        <div className="mx-auto w-full max-w-sm flex-1">
          <img src="./icon.svg" alt="" className="mb-6 size-10 rounded-lg lg:hidden" />
          <h1 className="display text-[2.2rem]">{mode === "signup" ? t("Créer votre compte") : t("Bon retour")}</h1>
          <p className="mt-2 text-muted">
            {mode === "signup" ? t("Moins de 10 secondes, avec la biométrie de votre appareil.") : t("Utilisez la passkey enregistrée sur cet appareil ou votre trousseau.")}
          </p>

          <div className="mt-8 grid grid-cols-2 rounded-lg border border-line bg-surface p-1 text-sm font-medium" role="tablist">
            {(["signup", "login"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => (setMode(m), setError(undefined))}
                className={clsx("rounded-md py-1.5 transition", mode === m ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg")}
              >
                {m === "signup" ? t("Inscription") : t("Connexion")}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-4">
            {mode === "signup" ? (
              <>
                {namesEnabled && <HandleField value={handle} onChange={setHandle} autoFocus />}
                <Field label={t("Nom affiché")} hint={t("Libre et modifiable plus tard, par exemple « Camille Dupont ».")}>
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && canSignup && document.getElementById("signup-btn")?.click()}
                    placeholder={t("ex. Camille")}
                    maxLength={50}
                    autoFocus={!namesEnabled}
                  />
                </Field>
                <Button
                  id="signup-btn"
                  className="h-12 w-full text-base"
                  disabled={!supported || !canSignup}
                  loading={busy === "create"}
                  onClick={() =>
                    run("create", async () => {
                      await createWithPasskey(name.trim());
                      done(true, name.trim(), namesEnabled ? handle : undefined);
                    })
                  }
                >
                  <Fingerprint className="size-5" /> {t("Créer avec une passkey")}
                </Button>
              </>
            ) : (
              <Button
                className="h-12 w-full text-base"
                disabled={!supported}
                loading={busy === "login"}
                onClick={() =>
                  run("login", async () => {
                    await unlock();
                    await createSession();
                    done(false);
                  })
                }
              >
                <KeyRound className="size-5" /> {t("Se connecter avec ma passkey")}
              </Button>
            )}
            {!supported && (
              <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">
                {t(
                  "Ce navigateur ne gère pas les passkeys. Utilisez un appareil récent (iOS 18+, Android ou Chrome à jour), ou importez une clé de secours ci-dessous.",
                )}
              </p>
            )}
            {error && <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          </div>

          <ul className="mt-8 space-y-2 text-sm text-muted">
            <li className="flex items-center gap-2">
              <Check className="size-4 text-ok" /> {t("Aucune donnée personnelle collectée")}
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-ok" /> {t("Votre clé ne quitte jamais votre appareil")}
            </li>
          </ul>

          <button onClick={() => setAdvanced((a) => !a)} className="mt-10 flex items-center gap-2 text-sm text-muted hover:text-fg">
            <Wrench className="size-4" /> {t("Options avancées")}
          </button>
          {advanced && (
            <div className="mt-3 space-y-4 rounded-lg border border-line bg-surface p-4">
              <Field label={t("Importer une clé de secours")} hint={t("Pour un miroir sur un autre domaine. Stockée en clair dans ce navigateur.")}>
                <div className="flex gap-2">
                  <input className={`${inputClass} font-mono text-xs`} value={pk} onChange={(e) => setPk(e.target.value.trim())} placeholder="0x…" type="password" autoComplete="off" />
                  <Button
                    variant="outline"
                    disabled={!/^0x[0-9a-fA-F]{64}$/.test(pk)}
                    onClick={() =>
                      run("import", async () => {
                        await importDevKey(pk as Hex);
                        done(false);
                      })
                    }
                  >
                    {t("Importer")}
                  </Button>
                </div>
              </Field>
              {env.devChains && (
                <div>
                  <p className="mb-2 text-sm font-semibold">{t("Comptes de démo (chains locales)")}</p>
                  <div className="flex flex-wrap gap-2">
                    {[...DEV_ACCOUNTS, "admin"].map((n) => (
                      <Button
                        key={n}
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          run(n, async () => {
                            await importDevKey(
                              n === "admin" ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" : keccak256(toHex(`arobase-dev:${n}`)),
                              n,
                            );
                            done(false);
                          })
                        }
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
