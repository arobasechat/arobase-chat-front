import type { ModerationMode } from "./settings";
import type { PostStats } from "@/queries/core";

export type Visibility = { hidden: boolean; reason?: string };

export function visibility(stats: PostStats | undefined, mode: ModerationMode, threshold: number): Visibility {
  if (!stats || mode === "raw") return { hidden: false };
  if (mode === "custom") return stats.customFlags > 0 ? { hidden: true, reason: "Masqué par vos modérateurs" } : { hidden: false };
  if (stats.flags > 0) return { hidden: true, reason: "Masqué par la modération de l'instance" };
  if (stats.hideScore >= threshold) return { hidden: true, reason: "Masqué par vote de la communauté" };
  return { hidden: false };
}
