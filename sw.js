// ============================================================
// Journal de Voyage — Service Worker (sw.js)
// Stratégies : Cache First (assets) + Stale While Revalidate (navigation)
// Background Sync pour l'outbox
// ============================================================

const CACHE_NAME = "pwa-voyage-v8";

// App Shell : fichiers à pré-cacher à l'installation
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/offline.html",
  "/manifest.json",
  "/voyage.md",
  "/images/bavella.jpg",
  "/images/piana.jpg",
  "/images/palombaggia.jpg",
];

// ============================================================
// INSTALL : pré-cacher l'App Shell
// On ne fait PAS skipWaiting() ici → la mise à jour est proposée à l'utilisateur
// ============================================================
self.addEventListener("install", (event) => {
  console.log("[SW] Install — cache de l'App Shell");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Pas de self.skipWaiting() : la page propose la mise à jour (bannière)
});

// ============================================================
// ACTIVATE : nettoyer les anciens caches
// ============================================================
self.addEventListener("activate", (event) => {
  console.log("[SW] Activate — nettoyage des anciens caches");
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log("[SW] Suppression ancien cache :", key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH : routage des stratégies de cache
// - Navigation HTML → Stale While Revalidate + fallback offline.html
// - Assets statiques (css, js, png, jpg, ico, woff2) → Cache First
// - Reste → Network first (tentative réseau, fallback cache)
// ============================================================
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ne pas intercepter les requêtes vers d'autres origines (API, CDN)
  // sauf les assets statiques de notre CDN idb
  if (url.origin !== location.origin) return;

  // --- Navigation HTML : Stale While Revalidate ---
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        const fetchPromise = fetch(event.request)
          .then((response) => {
            // Mettre à jour le cache en arrière-plan
            cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => {
            // Hors ligne et pas en cache → page de secours
            if (!cached) {
              return cache.match("/offline.html");
            }
            return null; // cached sera retourné ci-dessous
          });

        // Retourner le cache immédiatement, ou attendre le réseau
        return cached || fetchPromise;
      })
    );
    return;
  }

  // --- Assets statiques : Cache First ---
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|ico|woff2|webp)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        // Pas en cache → tenter le réseau et mettre en cache
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // --- Autres requêtes : Cache First (manifest.json, etc.) ---
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ============================================================
// SYNC : vider l'outbox quand le réseau revient (Background Sync)
// ============================================================
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-etapes") {
    console.log("[SW] Background Sync : sync-etapes");
    event.waitUntil(syncOutbox());
  }
});

/**
 * Vide le store outbox : envoie chaque élément au serveur,
 * puis le supprime de l'outbox et marque l'étape comme synchronisée.
 */
async function syncOutbox() {
  // Importer idb dans le SW via importScripts (nécessaire car le SW n'a pas accès au DOM)
  if (typeof idb === "undefined") {
    importScripts("https://cdn.jsdelivr.net/npm/idb@8/build/umd.js");
  }

  const db = await idb.openDB("journal-voyage-db", 2);
  const pending = await db.getAll("outbox");

  for (const item of pending) {
    try {
      const response = await fetch("https://httpbin.org/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.data),
      });

      if (response.ok) {
        // Marquer l'étape comme synchronisée
        const etape = await db.get("etapes", item.etapeId);
        if (etape) {
          etape.synced = true;
          await db.put("etapes", etape);
        }
        // Retirer de l'outbox
        await db.delete("outbox", item.id);
        console.log("[SW] Outbox item synchronisé :", item.id);
      }
    } catch (err) {
      console.error("[SW] Échec sync outbox item :", item.id, err);
      throw err; // Le navigateur ré-essaiera plus tard
    }
  }

  // Notifier la page que la sync est terminée
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: "SYNC_COMPLETE" });
  });
}

// ============================================================
// MESSAGE : écouter le message SKIP_WAITING de la page
// ============================================================
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    console.log("[SW] SKIP_WAITING reçu → activation immédiate");
    self.skipWaiting();
  }
});
