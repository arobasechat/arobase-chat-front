importScripts("push-core.js");

const TITLES = {
  mention: "Nouvelle mention",
  reply: "Nouvelle réponse",
  note: "Note de communauté sur votre post",
  like: "Nouveau like",
  follow: "Nouvel abonné",
  dm: "Nouveau message privé",
  repost: "Nouveau repost",
  quote: "Votre post a été cité",
  announcement: "Annonce de arobase.chat",
};

const VERBS = {
  mention: "vous a mentionné",
  reply: "a répondu à votre post",
  note: "a proposé une note sur votre post",
  like: "a aimé votre post",
  follow: "vous suit",
  repost: "a reposté votre post",
  quote: "a cité votre post",
  announcement: "a publié une annonce",
};

const TITLES_EN = {
  mention: "New mention",
  reply: "New reply",
  note: "Community note on your post",
  like: "New like",
  follow: "New follower",
  dm: "New direct message",
  repost: "New repost",
  quote: "Your post was quoted",
  announcement: "arobase.chat announcement",
};

const VERBS_EN = {
  mention: "mentioned you",
  reply: "replied to your post",
  note: "proposed a note on your post",
  like: "liked your post",
  follow: "followed you",
  repost: "reposted your post",
  quote: "quoted your post",
  announcement: "posted an announcement",
};

const BODIES = {
  encrypted: "Chiffré de bout en bout. Ouvrez arobase.chat pour le lire.",
  open: "Ouvrez arobase.chat pour voir.",
  generic: "Nouvelle activité sur arobase.chat.",
  overflow: "{n} nouvelles notifications. Ouvrez arobase.chat pour les voir.",
};

const BODIES_EN = {
  encrypted: "End-to-end encrypted. Open arobase.chat to read it.",
  open: "Open arobase.chat to see it.",
  generic: "New activity on arobase.chat.",
  overflow: "{n} new notifications. Open arobase.chat to see them.",
};

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const P = self.arobasePush;
const CACHE = "arobase-sw";
const scoped = (path) => `${self.registration.scope}__arobase/${path}`;

async function readJson(path) {
  try {
    const res = await (await caches.open(CACHE)).match(scoped(path));
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}

async function writeJson(path, value) {
  try {
    await (await caches.open(CACHE)).put(scoped(path), new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
  } catch {
    return;
  }
}

function rpcFor(cfg) {
  return async (chainId, method, params) => {
    const urls = cfg.social && cfg.social.chainId === chainId ? cfg.social.rpcs : (cfg.chains[String(chainId)] || {}).rpcs;
    for (const url of urls || []) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(6000),
        });
        const json = await res.json();
        if (json && "result" in json) return json.result;
      } catch {
        continue;
      }
    }
    throw new Error("rpc");
  };
}

function render(d, verified, lang) {
  const en = lang === "en";
  const titles = en ? TITLES_EN : TITLES;
  const verbs = en ? VERBS_EN : VERBS;
  const bodies = en ? BODIES_EN : BODIES;
  if (d.t === "dm") return { title: titles.dm, body: bodies.encrypted };
  if (d.t === "announcement") return { title: titles.announcement, body: verified.text || bodies.open };
  const who = d.name ? `@${d.name}` : short(d.from);
  const count = d.n > 1 ? ` (+${d.n - 1})` : "";
  return { title: titles[d.t], body: `${who} ${verbs[d.t]}${count}` };
}

self.addEventListener("push", (event) => {
  let raw = null;
  try {
    raw = event.data ? event.data.json() : null;
  } catch {
    raw = null;
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.some((w) => w.visibilityState === "visible" && w.focused)) return;
      const d = P.sanitize(raw);
      const lang = d ? d.lang : raw && raw.lang === "en" ? "en" : "fr";
      const bodies = lang === "en" ? BODIES_EN : BODIES;
      const base = self.registration.scope.replace(/\/$/, "");
      const icon = `${base}/icon.svg`;
      const cfg = await readJson("sw-config");
      const verified = d && cfg ? await P.verify(d, cfg, rpcFor(cfg)) : { ok: false };
      if (verified.conv) d.conv = verified.conv;
      const key = d && d.p ? `${d.p.c}:${d.p.tx}:${d.p.i}` : undefined;
      const limit = P.throttle((await readJson("sw-state")) || {}, Date.now(), verified.ok ? key : undefined);
      await writeJson("sw-state", limit.state);

      if (!verified.ok) {
        await self.registration.showNotification("arobase.chat", { body: bodies.generic, tag: "generic", icon, badge: icon, data: { url: `${base}/${d && d.h ? "#/" : ""}notifications` } });
      } else if (limit.over) {
        await self.registration.showNotification("arobase.chat", {
          body: bodies.overflow.replace("{n}", String(limit.state.overflow + P.MAX_PER_HOUR)),
          tag: "overflow",
          icon,
          badge: icon,
          data: { url: `${base}/${d.h ? "#/" : ""}notifications` },
        });
      } else {
        const { title, body } = render(d, verified, lang);
        const path = P.pathOf(d);
        await self.registration.showNotification(title, {
          body,
          tag: d.t === "dm" ? `dm:${d.conv}` : `${d.t}:${d.post || d.from}`,
          icon,
          badge: icon,
          data: { url: d.h ? `${base}/#${path}` : `${base}${path}` },
        });
      }
      if (self.navigator.setAppBadge) {
        const shown = await self.registration.getNotifications();
        await self.navigator.setAppBadge(shown.length).catch(() => undefined);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  const base = self.registration.scope.replace(/\/$/, "");
  if (!url || !url.startsWith(base)) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
