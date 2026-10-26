import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Address } from "viem";
import type { ChainCfg } from "./config";

export type ModerationMode = "instance" | "custom" | "raw";
export type Theme = "system" | "light" | "dark";

type SettingsState = {
  theme: Theme;
  moderationMode: ModerationMode;
  customModerators: Address[];
  extraRpcs: Record<number, string[]>;
  disabledChains: number[];
  chainsOverride: ChainCfg[] | null;
  anchorChains: number[];
  useSponsor: boolean;
  extraBundlers: Record<number, string[]>;
  syncEnabled: boolean;
  language: "fr" | "en";
  set: (patch: Partial<Omit<SettingsState, "set">>) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      moderationMode: "instance",
      customModerators: [],
      extraRpcs: {},
      disabledChains: [],
      chainsOverride: null,
      anchorChains: [],
      useSponsor: true,
      extraBundlers: {},
      syncEnabled: true,
      language: navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en",
      set: (patch) => set(patch),
    }),
    { name: "arobase:settings", version: 1 },
  ),
);
