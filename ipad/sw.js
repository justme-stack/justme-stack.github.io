// Service Worker fuer den iPad-Modus (nur im mobile-Build registriert).
// - /mobile/previews/*  : Cache zuerst (die App legt sie beim Laden der
//                         Bibliothek dort ab), sonst Netz
// - /ipad/*             : Netz zuerst, Rueckfall Cache (App-Huelle offline)
// - alles andere        : nur Netz (API, library.json)
const SHELL = "so-shell-v1";
const PREVIEWS = "so-previews-v1";
const BASIS = "/ipad/";

// Die App-Huelle: Startseite plus alles, was sie einbindet (Skript, Stil,
// Manifest, Icons). Wird aus dem HTML gelesen, weil die Dateinamen bei jedem
// Bau einen neuen Hash bekommen.
function dateienDerHuelle(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/ipad\/[^"#?]+)"/g)) urls.add(m[1]);
  return [...urls];
}

// Huelle vollstaendig in den Cache legen und Reste frueherer Fassungen entfernen.
// html = Text der Startseite, die gerade aus dem Netz kam.
async function huelleAbgleichen(html) {
  const cache = await caches.open(SHELL);
  const dateien = dateienDerHuelle(html);
  let vollstaendig = true;
  await Promise.all(dateien.map(async (u) => {
    if (await cache.match(u)) return;
    try {
      const r = await fetch(u);
      if (r.ok) await cache.put(u, r); else vollstaendig = false;
    } catch (e) { vollstaendig = false; }
  }));
  if (!vollstaendig) return;            // nichts wegwerfen, solange die neue Fassung nicht komplett da ist
  const behalten = new Set([BASIS, ...dateien].map((u) => new URL(u, self.location.origin).href));
  for (const req of await cache.keys()) {
    if (!behalten.has(req.url)) await cache.delete(req);
  }
}

// Beim Installieren die Huelle gleich holen. Der allererste Aufruf der Seite
// laeuft noch am Service Worker vorbei - ohne diesen Schritt waere nach dem
// ersten Besuch nichts im Cache, und die App startete ohne Netz nicht.
async function huelleVorabLaden() {
  const res = await fetch(BASIS, { cache: "no-store" });
  if (!res.ok) return;
  const html = await res.clone().text();
  const cache = await caches.open(SHELL);
  await cache.put(BASIS, res);
  await huelleAbgleichen(html);
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(huelleVorabLaden().catch(() => {}));   // ohne Netz trotzdem installieren
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
  if (url.pathname.startsWith(BASIS)) {
    const seite = e.request.mode === "navigate";
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            // SOFORT klonen: ist die Antwort erst an die Seite uebergeben, laesst
            // sie sich nicht mehr kopieren ("Response body is already used") -
            // genau deshalb blieb dieser Cache frueher leer.
            const kopie = res.clone();
            const fuerAbgleich = seite ? res.clone() : null;
            e.waitUntil(
              caches.open(SHELL)
                .then((c) => c.put(seite ? BASIS : e.request, kopie))
                .then(() => (fuerAbgleich ? fuerAbgleich.text().then(huelleAbgleichen) : null))
                .catch(() => {})
            );
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || (seite ? caches.match(BASIS) : undefined)))
    );
  }
});
