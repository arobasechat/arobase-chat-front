import { useEffect } from "react";
import { en } from "@/i18n/en";
import { useSettings } from "./settings";

export type Vars = Record<string, string | number>;

const format = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : s);

export function translate(lang: "fr" | "en", fr: string, vars?: Vars) {
  return format(lang === "en" ? (en[fr] ?? fr) : fr, vars);
}

export function tr(fr: string, vars?: Vars) {
  return translate(useSettings.getState().language, fr, vars);
}

export function useT() {
  const lang = useSettings((s) => s.language);
  return (fr: string, vars?: Vars) => translate(lang, fr, vars);
}

export function useLang() {
  return useSettings((s) => s.language);
}

export function useDocumentLang() {
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}
