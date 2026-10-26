import type { Address } from "viem";
import { useSettings } from "./settings";

const formatters = new Map<string, { rtf: Intl.RelativeTimeFormat; dtf: Intl.DateTimeFormat; tf: Intl.DateTimeFormat }>();

function fmt() {
  const lang = useSettings.getState().language;
  let f = formatters.get(lang);
  if (!f) {
    f = {
      rtf: new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" }),
      dtf: new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }),
      tf: new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }),
    };
    formatters.set(lang, f);
  }
  return f;
}

export function timeAgo(ts: number, now = Date.now() / 1000) {
  const { rtf, dtf } = fmt();
  const d = ts - now;
  const abs = Math.abs(d);
  if (abs < 45) return useSettings.getState().language === "en" ? "just now" : "à l'instant";
  if (abs < 3600) return rtf.format(Math.round(d / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(d / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(d / 86_400), "day");
  return dtf.format(ts * 1000);
}

export const fullDate = (ts: number) => `${fmt().dtf.format(ts * 1000)} · ${fmt().tf.format(ts * 1000)}`;

export const short = (a: string, n = 4) => (a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a);

export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const compacts = new Map<string, Intl.NumberFormat>();
export const compact = {
  format: (n: number) => {
    const lang = useSettings.getState().language;
    let c = compacts.get(lang);
    if (!c) compacts.set(lang, (c = new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 })));
    return c.format(n);
  },
};

export function addressHue(a: Address | string) {
  let h = 0;
  for (let i = 2; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) % 360;
  return h;
}

export const cleanName = (name: string | undefined) =>
  (name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/^[\s@＠]+/, "")
    .trim()
    .slice(0, 50);
