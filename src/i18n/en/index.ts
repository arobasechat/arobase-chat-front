import { app } from "./app";
import { components } from "./components";
import { marketing } from "./marketing";

export const en: Record<string, string> = { ...marketing, ...components, ...app };
