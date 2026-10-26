import { env } from "@/env";

export const permalink = (path: string) =>
  env.hashRouter ? `${location.origin}${location.pathname}#${path}` : `${location.origin}${path}`;
