import { useState } from "react";
import { Link } from "react-router-dom";
import { Gift, KeyRound, Layers, ShieldCheck, X } from "lucide-react";
import { useT } from "@/lib/i18n";

const KEY = "arobase:welcome";

const TIPS = [
  { icon: KeyRound, title: "Vos actions sont signées", text: "Chaque post ou like est signé par votre clé : personne ne peut écrire à votre place." },
  { icon: Layers, title: "Publiées onchain", text: "Vos posts vivent sur des blockchains publiques, pas sur nos serveurs. Ils ne peuvent pas être effacés." },
  { icon: Gift, title: "Gas offert", text: "Les frais sont sponsorisés. Une petite preuve de travail, calculée par votre navigateur, protège du spam." },
  { icon: ShieldCheck, title: "Votre modération", text: "Par défaut celle de l'instance. Changez-la à tout moment dans Réglages." },
];

export function WelcomeCard() {
  const t = useT();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  if (!open) return null;
  const close = () => {
    localStorage.removeItem(KEY);
    setOpen(false);
  };
  return (
    <section className="relative m-4 overflow-hidden rounded-xl border border-tag-line bg-surface p-5">
      <button onClick={close} className="absolute right-3 top-3 rounded-full p-1.5 text-muted hover:bg-elevated hover:text-fg" aria-label={t("Fermer")}>
        <X className="size-4" />
      </button>
      <h2 className="text-lg font-semibold tracking-tight">{t("Bienvenue sur arobase.chat 👋")}</h2>
      <p className="mt-1 text-sm text-muted">{t("Quatre choses à savoir, et vous êtes prêt.")}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {TIPS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-lg border border-line bg-bg p-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-accent" />
            <span>
              <b className="block text-sm">{t(title)}</b>
              <span className="text-[13px] leading-snug text-muted">{t(text)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <button onClick={close} className="rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-fg hover:opacity-90">
          {t("C'est parti")}
        </button>
        <Link to="/comment-ca-marche" className="font-semibold text-accent hover:underline">
          {t("En savoir plus")}
        </Link>
      </div>
    </section>
  );
}
