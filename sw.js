// App shell offline cache. Sheet and Google API calls always go to the network.
const VERSION = "agalot-v3";
const SHELL = ["./", "index.html", "style.css", "app.js", "hours.js", "config.js", "data/seed.js", "data/westbank.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];
const TILE_CACHE = "agalot-tiles", TILE_MAX = 400;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > TILE_MAX) await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => cache.delete(k)));
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("googleapis.com") && url.hostname !== "fonts.googleapis.com") return;
  if (url.hostname === "docs.google.com") return;
  if (url.hostname === "tile.openstreetmap.org") {
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) { c.put(req, r.clone()); trim(c); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // the app's own files: network first (always the latest version), cache only when offline
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(c =>
      fetch(req.url.split("?")[0], { cache: "no-cache" })
        .then(r => { if (r.ok) c.put(req, r.clone()); return r; })
        .catch(() => c.match(req, { ignoreSearch: true }))));
    return;
  }
  // stale-while-revalidate for Leaflet and fonts
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
