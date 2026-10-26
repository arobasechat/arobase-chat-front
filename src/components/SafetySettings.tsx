import { Ban, VolumeX } from "lucide-react";
import { useViewer } from "@/identity/store";
import { listOf, useSafety } from "@/lib/safety";
import { useSettings } from "@/lib/settings";
import { scheduleSync } from "@/lib/sync-trigger";
import { Avatar } from "./Avatar";
import { DisplayName, UserLink } from "./UserLink";
import { Button } from "./ui";
import { useT } from "@/lib/i18n";

function Row({ address, onRemove, label }: { address: `0x${string}`; onRemove: () => void; label: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <UserLink address={address} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar address={address} size={32} />
        <DisplayName address={address} className="truncate font-medium" />
      </UserLink>
      <Button size="sm" variant="outline" onClick={onRemove}>
        {label}
      </Button>
    </li>
  );
}

export function SafetySettings() {
  const t = useT();
  const viewer = useViewer();
  const lists = useSafety((s) => (viewer ? s.byUser[viewer.toLowerCase()] : undefined));
  const set = useSafety((s) => s.set);
  const muted = listOf(lists, "muted");
  const blocked = listOf(lists, "blocked");
  if (!viewer) return null;
  const remove = (list: "muted" | "blocked", a: `0x${string}`) => {
    set(viewer, list, a, false);
    scheduleSync();
  };
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">
        <strong className="text-fg">{t("Masquer")}</strong> {t("cache les posts et les reposts d'un compte.")} <strong className="text-fg">{t("Bloquer")}</strong>{" "}
        {t("cache aussi ses réponses, mentions, notifications et messages privés. Ces listes sont privées : elles restent chiffrées et ne sont visibles que par vous.")}
      </p>
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <VolumeX className="size-4" /> {t("Comptes masqués ({n})", { n: muted.length })}
        </h3>
        {muted.length ? (
          <ul className="divide-y divide-line">
            {muted.map((a) => (
              <Row key={a} address={a} label={t("Réafficher")} onRemove={() => remove("muted", a)} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">{t("Aucun.")}</p>
        )}
      </div>
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <Ban className="size-4" /> {t("Comptes bloqués ({n})", { n: blocked.length })}
        </h3>
        {blocked.length ? (
          <ul className="divide-y divide-line">
            {blocked.map((a) => (
              <Row key={a} address={a} label={t("Débloquer")} onRemove={() => remove("blocked", a)} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">{t("Aucun.")}</p>
        )}
      </div>
    </div>
  );
}

export function SyncSettings() {
  const t = useT();
  const enabled = useSettings((s) => s.syncEnabled);
  const set = useSettings((s) => s.set);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted">
        {t("Votre passkey se synchronise déjà entre vos appareils (iCloud, Google, gestionnaire de mots de passe) : connectez-vous avec elle sur un autre appareil pour retrouver votre compte et vos messages. Sur un ordinateur, choisissez « Utiliser un téléphone » et scannez le QR code pour vous connecter avec la passkey de votre téléphone.")}
      </p>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={enabled} onChange={(e) => set({ syncEnabled: e.target.checked })} />
        <span>
          {t("Synchroniser mes signets et mes comptes masqués ou bloqués entre mes appareils. Ils sont chiffrés avec une clé dérivée de votre passkey, puis déposés onchain : personne d'autre ne peut les lire.")}
        </span>
      </label>
      {enabled && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            scheduleSync(0);
          }}
        >
          {t("Synchroniser maintenant")}
        </Button>
      )}
    </div>
  );
}

export function useSafetyFor(address: `0x${string}`) {
  const t = useT();
  const viewer = useViewer();
  const lists = useSafety((s) => (viewer ? s.byUser[viewer.toLowerCase()] : undefined));
  const set = useSafety((s) => s.set);
  const key = address.toLowerCase();
  const muted = !!lists?.muted[key]?.on;
  const blocked = !!lists?.blocked[key]?.on;
  const toggle = (list: "muted" | "blocked", on: boolean) => {
    if (!viewer) return;
    if (list === "blocked" && on && !confirm(t("Bloquer ce compte ? Ses posts, réponses, mentions et messages privés seront masqués pour vous."))) return;
    set(viewer, list, address, on);
    scheduleSync();
  };
  return { muted, blocked, toggle };
}
