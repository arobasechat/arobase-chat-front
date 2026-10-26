export const pages = {
  home: () => import("./pages/Home"),
  post: () => import("./pages/PostPage"),
  profile: () => import("./pages/Profile"),
  messages: () => import("./pages/Messages"),
  notifications: () => import("./pages/Notifications"),
  saved: () => import("./pages/Saved"),
  search: () => import("./pages/SearchPage"),
  wallet: () => import("./pages/Wallet"),
  settings: () => import("./pages/Settings"),
  admin: () => import("./pages/Admin"),
  onboarding: () => import("./pages/Onboarding"),
  notFound: () => import("./pages/NotFound"),
  landing: () => import("./pages/Landing"),
  about: () => import("./pages/About"),
};

const loaded = new Set<keyof typeof pages>();
export function preloadPage(name: keyof typeof pages) {
  if (loaded.has(name)) return;
  loaded.add(name);
  void pages[name]();
}

export function pageForPath(path: string): keyof typeof pages | undefined {
  if (path === "/" || path.startsWith("/explorer")) return "home";
  if (path.startsWith("/p/")) return "post";
  if (path.startsWith("/u/")) return "profile";
  if (path.startsWith("/messages")) return "messages";
  if (path.startsWith("/notifications")) return "notifications";
  if (path.startsWith("/enregistres")) return "saved";
  if (path.startsWith("/recherche")) return "search";
  if (path.startsWith("/portefeuille")) return "wallet";
  if (path.startsWith("/reglages")) return "settings";
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/bienvenue")) return "onboarding";
  if (path.startsWith("/comment-ca-marche")) return "about";
  return undefined;
}
