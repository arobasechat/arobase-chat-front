import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Smartphone } from "lucide-react";
import { useViewer } from "@/identity/store";
import { disablePush, enablePush, fetchRelays, isIos, isStandalone, pushParam, pushSupported, usePushState } from "@/lib/push";
import { humanError } from "@/lib/tx";
import { useConfig, useNetworks } from "@/queries/core";
import { Badge, Button } from "./ui";
import { useT } from "@/lib/i18n";

export function useRelays() {
  const networks = useNetworks();
  const config = useConfig();
  return useQuery({
    queryKey: ["push-relays", networks.key, pushParam(config)?.address],
    enabled: !!pushParam(config),
    staleTime: 10 * 60_000,
    queryFn: () => fetchRelays(networks, config),
  });
}

export function usePushEnabled() {
  const viewer = useViewer();
  const state = usePushState();
  return state.relayId !== undefined && !!viewer && state.author?.toLowerCase() === viewer.toLowerCase();
}

export function PushSettings() {
  const t = useT();
  const networks = useNetworks();
  const config = useConfig();
  const relays = useRelays();
  const state = usePushState();
  const enabled = usePushEnabled();
  const [choice, setChoice] = useState<number>();
  const [dms, setDms] = useState(state.dms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const all = relays.data ?? [];
  const curated = all.some((r) => r.verified !== undefined);
  const unverified = all.filter((r) => r.verified === false);
  const list = curated && !showAll ? all.filter((r) => r.verified || r.id === state.relayId) : all;
  const selected = all.find((r) => r.id === (choice ?? state.relayId ?? list[0]?.id));

  if (!pushParam(config)) return <p className="text-sm text-muted">{t("Cette instance n'a pas encore de registre de relais push.")}</p>;
  if (!pushSupported())
    return (
      <p className="text-sm text-muted">
        {isIos() && !isStandalone()
          ? t("Sur iPhone, ajoutez d'abord arobase.chat à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvrez-le depuis l'icône.")
          : t("Ce navigateur ne gère pas les notifications push.")}
      </p>
    );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted">
        {t("Un relais surveille les chains et vous prévient quand l'app est fermée. Votre abonnement est chiffré pour ce relais et déposé onchain depuis une adresse jetable : personne d'autre ne peut le lire, et aucun serveur n'est contacté directement. Les messages privés restent chiffrés : le relais sait seulement qu'un message est arrivé.")}
      </p>
      {relays.isPending && <div className="skeleton h-14 rounded-lg" />}
      {!relays.isPending && list.length === 0 && <p className="text-sm text-muted">{t("Aucun relais actif pour le moment.")}</p>}
      {list.length > 0 && (
        <div className="space-y-2" role="radiogroup">
          {list.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-elevated/50">
              <input
                type="radio"
                className="mt-1"
                checked={selected?.id === r.id}
                disabled={enabled}
                onChange={() => setChoice(r.id)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">
                  {r.name || t("Relais n°{id}", { id: r.id })}
                  {r.verified && <Badge tone="ok">{t("vérifié")}</Badge>}
                  {r.verified === false && <Badge tone="warn">{t("non vérifié")}</Badge>}
                  {enabled && state.relayId === r.id && <Badge tone="ok">{t("actif sur cet appareil")}</Badge>}
                </span>
                {r.info && <span className="block truncate text-xs text-muted">{r.info}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      {curated && unverified.length > 0 && !enabled && (
        <button type="button" className="text-xs text-muted underline hover:text-fg" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t("Masquer les relais non vérifiés") : t("Afficher les relais non vérifiés ({n})", { n: unverified.length })}
        </button>
      )}
      {selected?.verified === false && !enabled && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs text-warn">
          {t("Ce relais n'a pas été vérifié par l'instance. Ses notifications sont contrôlées onchain avant affichage, mais son opérateur saura quand vous recevez de l'activité.")}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dms} disabled={enabled} onChange={(e) => setDms(e.target.checked)} />
        {t("Me prévenir aussi des messages privés (le relais connaît alors les identifiants de mes conversations)")}
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      {enabled ? (
        <Button variant="outline" loading={busy} onClick={() => void run(() => disablePush(networks, config, all.find((r) => r.id === state.relayId)))}>
          {t("Désactiver sur cet appareil")}
        </Button>
      ) : (
        <Button loading={busy} disabled={!selected} onClick={() => selected && void run(() => enablePush(networks, config, selected, dms))}>
          <BellRing className="size-4" /> {t("Activer sur cet appareil")}
        </Button>
      )}
    </div>
  );
}

export function PushBanner() {
  const t = useT();
  const config = useConfig();
  const enabled = usePushEnabled();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("arobase:push-banner") === "0";
    } catch {
      return false;
    }
  });
  if (enabled || hidden || !pushParam(config)) return null;
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3 text-sm">
      <Smartphone className="size-5 shrink-0 text-accent" />
      <p className="flex-1 text-muted">{t("Recevez ces notifications même quand arobase.chat est fermé.")}</p>
      <Link to="/reglages#push" className="font-semibold text-accent hover:underline">
        {t("Activer")}
      </Link>
      <button
        className="text-muted hover:text-fg"
        aria-label={t("Fermer")}
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem("arobase:push-banner", "0");
          } catch {
            return;
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
