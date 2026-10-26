import clsx from "clsx";
import { Check, Loader2, X } from "lucide-react";
import { useHandleAvailability } from "@/queries/names";
import { useT } from "@/lib/i18n";
import { Field, inputClass } from "./ui";

export function useHandleState(handle: string) {
  return useHandleAvailability(handle);
}

export function HandleField({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const state = useHandleAvailability(value).state;
  const hint = {
    empty: t("Unique, en minuscules : lettres, chiffres et _ (3 à 20). Il sert à vous mentionner et à vous retrouver."),
    invalid: t("3 à 20 caractères : lettres minuscules, chiffres et _ uniquement."),
    checking: t("Vérification de la disponibilité onchain…"),
    available: t("Disponible."),
    yours: t("C'est déjà votre nom d'utilisateur."),
    taken: t("Déjà utilisé par quelqu'un d'autre."),
  }[state];
  return (
    <Field
      label={label ?? t("Nom d'utilisateur")}
      hint={<span className={clsx(state === "available" && "text-ok", (state === "taken" || state === "invalid") && "text-danger")}>{hint}</span>}
    >
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">@</span>
        <input
          className={clsx(inputClass, "pl-7 pr-9", state === "taken" && "border-danger focus:border-danger")}
          value={value}
          autoFocus={autoFocus}
          maxLength={20}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          placeholder="camille"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          {state === "checking" && <Loader2 className="size-4 animate-spin text-subtle" />}
          {(state === "available" || state === "yours") && <Check className="size-4 text-ok" />}
          {state === "taken" && <X className="size-4 text-danger" />}
        </span>
      </div>
    </Field>
  );
}

export const handleUsable = (state: string) => state === "available" || state === "yours";
