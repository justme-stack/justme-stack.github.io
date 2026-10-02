// Service Worker fuer den iPad-Modus (nur im mobile-Build registriert).
// - /mobile/previews/*  : Cache zuerst (die App legt sie beim Laden der
//                         Bibliothek dort ab), sonst Netz
// - /ipad/*             : Netz zuerst, Rueckfall Cache (App-Huelle offline)
// - alles andere        : nur Netz (API, library.json)
const SHELL = "so-shell-v1";
const PREVIEWS = "so-previews-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== "GET") return;
  if (url.pathname.startsWith("/mobile/previews/")) {
    e.respondWith(
      caches.open(PREVIEWS).then((c) =>
        c.match(e.request.url).then((hit) => hit || fetch(e.request).then((res) => {
          if (res.ok) c.put(e.request.url, res.clone());
          return res;
        }))
      )
    );
    return;
  }
  if (url.pathname.startsWith("/ipad/")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("/ipad/") : undefined)))
    );
  }
});
