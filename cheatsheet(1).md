# 🧾 Cheatsheet PWA — référence du TP

> Tous les snippets du cours, prêts à adapter. À garder ouvert pendant le TP.
> Convention : IndexedDB via la librairie **idb** (`<script src="https://cdn.jsdelivr.net/npm/idb@7/build/umd.js"></script>`).

---

## 1. Manifest minimal installable

```json
{
  "name": "Ma Super PWA",
  "short_name": "MaPWA",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6366f1",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

```html
<link rel="manifest" href="/manifest.json" />
<!-- iOS -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

Critères Chrome : `name`, `short_name`, `start_url`, `display: standalone`, icônes **192 + 512**, **HTTPS**, SW avec handler `fetch`.

---

## 2. Enregistrer le Service Worker

```javascript
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => console.log("✅ SW enregistré", reg.scope))
    .catch((err) => console.error("❌ SW erreur", err));
}
```

---

## 3. SW : install / activate / fetch (versionné, sans Service Worker périmé)

```javascript
// sw.js
const CACHE_NAME = "pwa-v1"; // incrémenter à chaque déploiement
const STATIC_ASSETS = ["/", "/index.html", "/app.js", "/styles.css", "/offline.html"];
// sw.js ne va jamais dans cette liste

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  // Deux stratégies de mise à jour, à choisir et à justifier dans le document technique :
  // (a) self.skipWaiting() ici → la nouvelle version s'applique d'office au prochain chargement ;
  // (b) ne rien faire ici, et laisser la page la proposer à l'utilisateur (§ 7).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});
```

---

## 4. Les stratégies de cache

### Cache First (CSS, JS, images, fonts)

```javascript
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
```

### Network First (données API — avec fallback cache)

```javascript
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone(); // Response = stream lisible 1 seule fois !
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
```

### Stale While Revalidate (HTML shell, avatars)

```javascript
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request).then((response) => {
        cache.put(event.request, response.clone());
        return response;
      });
      return cached || fetchPromise;
    }),
  );
});
```

### Router les stratégies par type de requête

```javascript
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    /* Network First */
  } else if (url.pathname.match(/\.(css|js|png|jpg|woff2)$/)) {
    /* Cache First */
  } else {
    /* SWR */
  }
});
```

| Ressource | Stratégie | Stockage |
|-----------|-----------|----------|
| HTML (shell) | SWR | Cache API |
| CSS, JS, images UI, fonts | Cache First | Cache API |
| Données API | Network First | IndexedDB |
| Auth, paiement | Network Only | — |

---

## 5. Page offline de fallback

```javascript
// sw.js — si une NAVIGATION échoue → offline.html (pré-cachée au §3)
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
  }
});
```

---

## 6. Bouton d'installation custom (`beforeinstallprompt`)

```javascript
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById("btn-install").style.display = "block";
});

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(outcome === "accepted" ? "Installé !" : "Refusé");
  deferredPrompt = null;
}

window.addEventListener("appinstalled", () => {
  document.getElementById("btn-install").style.display = "none";
});

// Détecter le mode standalone
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true; // iOS
```

---

## 7. Mise à jour proposée à l'utilisateur : bannière « Nouvelle version disponible »

```javascript
// app.js
const registration = await navigator.serviceWorker.register("/sw.js");

registration.addEventListener("updatefound", () => {
  const newWorker = registration.installing;
  newWorker.addEventListener("statechange", () => {
    if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
      // MAJ prête → afficher la bannière
      document.getElementById("update-banner").style.display = "block";
      document.getElementById("btn-update").onclick = () =>
        newWorker.postMessage({ type: "SKIP_WAITING" });
    }
  });
});

// Quand le nouveau SW prend le contrôle → recharger
navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
```

```javascript
// sw.js
self.addEventListener("message", (event) => {
  if (event.data.type === "SKIP_WAITING") self.skipWaiting();
});
```

---

## 8. IndexedDB avec idb (outbox offline)

```javascript
// Ouvrir/créer la base (une seule fois, réutiliser la promesse)
const dbPromise = idb.openDB("my-pwa-db", 1, {
  upgrade(db) {
    db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    db.createObjectStore("data", { keyPath: "id" });
  },
});

// CRUD
const db = await dbPromise;
await db.add("outbox", { type: "save", payload, timestamp: Date.now() });
const items = await db.getAll("outbox");
await db.put("data", { id: 1, titre: "màj" });
await db.delete("outbox", item.id);
```

---

## 9. Détection réseau + UX offline

```javascript
window.addEventListener("online", () => {
  document.body.classList.remove("offline");
  showToast("🌐 Connexion rétablie !");
  syncPendingData(); // fallback universel (cf. §10)
});

window.addEventListener("offline", () => {
  document.body.classList.add("offline");
  showToast("📴 Mode hors ligne — vos actions seront synchronisées");
});
```

⚠️ `navigator.onLine` peut être `true` avec un WiFi sans internet → toujours gérer aussi l'échec du `fetch`.

---

## 10. Background Sync + fallback obligatoire

```javascript
// app.js — sauvegarder puis demander une sync
async function saveData(data) {
  try {
    await fetch("/api/save", { method: "POST", body: JSON.stringify(data) });
  } catch {
    const db = await dbPromise;
    await db.add("outbox", { data, timestamp: Date.now() });
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) await reg.sync.register("sync-pending"); // Chromium only
    showToast("📴 Sauvegardé — envoi au retour du réseau");
  }
}
```

```javascript
// sw.js
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-pending") event.waitUntil(syncPendingData());
});

async function syncPendingData() {
  const db = await dbPromise;
  for (const item of await db.getAll("outbox")) {
    await fetch("/api/save", { method: "POST", body: JSON.stringify(item.data) });
    await db.delete("outbox", item.id);
  }
}
```

| Navigateur | Background Sync |
|------------|-----------------|
| Chrome / Edge | ✅ |
| Firefox / Safari | ❌ → fallback `window "online"` (§9) |

---

## 11. Réconcilier deux écritures : version et `If-Match` *(bonus, chapitre local-first du Jour 3)*

**Le problème.** Deux appareils modifient la même note hors ligne ; au retour du réseau, le dernier à envoyer écrase l'autre, sans que personne ne le sache.

**Le principe.** Chaque note porte un numéro de `version`. Quand l'app envoie une modification, elle joint la version qu'elle connaît (en-tête `If-Match`). Si le serveur détient déjà une version plus récente, il **refuse** (`412 Precondition Failed`) au lieu d'écraser, et renvoie sa version : l'app affiche un choix.

```text
 appareil A (v1 → "courses")        serveur (v1)        appareil B (v1 → "courses + pain")
        │ PUT, If-Match: "1"            │                        │
        ├──────────────────────────────▶│ ok → v2 "courses"      │
        │                               │◀───────────────────────┤ PUT, If-Match: "1"
        │                               │ 412 : je suis en v2    │
        │                               ├───────────────────────▶│ bannière : garder la mienne / prendre la leur
```

```javascript
// app.js — envoyer avec la version connue
const res = await fetch(`${API}/notes/${note.id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
  body: JSON.stringify({ text: note.text, version }),
});
if (res.status === 412) conflicts.set(note.id, await res.json()); // rien n'est écrasé
```

```javascript
// server.mjs — la précondition
if (match && old && match !== `"${old.version}"`) return send(res, 412, old);
```

« Garder la mienne » = renvoyer avec la version du serveur ; « Prendre la leur » = remplacer en local. Corrigé complet : `demos/demo-local-first/`. Le serveur doit autoriser `If-Match` dans `Access-Control-Allow-Headers` (CORS).

---

## 12. Notifications (rappel express)

```javascript
// Permission (toujours après une action utilisateur + explication !)
const permission = await Notification.requestPermission();

// Locale, depuis la page
new Notification("Titre", { body: "Contenu", icon: "/icon-192.png", tag: "unique" });

// Depuis le SW (push)
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: "/icon-192.png" }),
  );
});
```

---

## 13. Visible : SEO et agents IA

Corrigé complet : `demos/demo-pwa-visible/`. Principe : le HTML initial porte le contenu public ; les robots (Googlebot, GPTBot, ClaudeBot) lisent le HTML sans exécuter `app.js` ni installer de Service Worker.

### `<head>` complète

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PWA Notes — carnet hors ligne</title>
  <meta name="description" content="Carnet de notes installable, utilisable hors ligne. Cours M2, Università di Corsica." />
  <link rel="canonical" href="https://<ma-pwa>/" />
  <link rel="alternate" type="text/markdown" href="/notes.md" />
  <link rel="manifest" href="manifest.json" />
  <meta property="og:title" content="PWA Notes — carnet hors ligne" />
  <meta property="og:description" content="Carnet de notes installable, utilisable hors ligne." />
  <meta property="og:image" content="https://<ma-pwa>/icons/icon-512.png" />
  <meta property="og:url" content="https://<ma-pwa>/" />
  <script type="application/ld+json">
  { "@context": "https://schema.org", "@type": "WebApplication",
    "name": "PWA Notes", "applicationCategory": "ProductivityApplication",
    "operatingSystem": "Any", "url": "https://<ma-pwa>/",
    "description": "Carnet de notes installable et utilisable hors ligne." }
  </script>
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/idb@8/build/umd.js"></script>
</head>
```

`og:image` : URL **absolue**. `canonical` : une seule URL publique (les vues `/?note=<id>` sont privées). Corps de page : `<main>` avec `<h1>`, une phrase de description, le `<form>`, le `<ul>` et trois `<li data-seed>` d'exemple.

### `robots.txt`

```
# robots.txt
User-agent: *
Allow: /
# Crawlers d'IA : une décision par robot, avec sa raison
User-agent: GPTBot
Allow: /            # une PWA de notes gagne à être citée
User-agent: Google-Extended
Disallow: /         # pas d'entraînement de Gemini ; la recherche reste ouverte
Sitemap: https://<ma-pwa>/sitemap.xml
# llms.txt : https://<ma-pwa>/llms.txt
```

### `sitemap.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://<ma-pwa>/</loc><lastmod>AAAA-MM-JJ</lastmod></url>
</urlset>
```

`lastmod` : la date du dernier déploiement, au format `AAAA-MM-JJ` (utilisé par les moteurs seulement s'il est constamment exact).

### `llms.txt`

```markdown
# PWA Notes
> Carnet de notes installable, utilisable hors ligne.
> Projet du cours M2 DFS, Università di Corsica.
## Contenu
- [Notes publiques en Markdown](https://<ma-pwa>/notes.md)
## Technique
- Vanilla : Service Worker, API Cache, IndexedDB, Web App Manifest
```

### `notes.md` (la jumelle Markdown de la page d'accueil)

```markdown
# PWA Notes

> Carnet de notes installable, utilisable hors ligne.

## Notes publiques

- Première note : ce carnet s'ouvre en mode avion
- Deuxième note : les notes restent sur cet appareil
- Troisième note : installable depuis le navigateur
```

### `_headers` (Netlify) — *optionnel*

```
/*.md
  X-Robots-Tag: noindex
```

**Récap :** `_headers` est le fichier par lequel Netlify envoie des en-têtes HTTP (chapitre 9 : CSP, HSTS…). Ici il pose `X-Robots-Tag: noindex` sur la jumelle `.md` : elle reste lisible par les agents sans être indexée par Google comme une page concurrente du HTML. Raffinement, pas une exigence du TP. En local, la même règle s'écrit dans `serve.json` :

```json
{
  "cleanUrls": false,
  "rewrites": [{ "source": "/", "destination": "/index.html" }],
  "headers": [{ "source": "**/*.md", "headers": [{ "key": "X-Robots-Tag", "value": "noindex" }] }]
}
```

`cleanUrls: false` est **nécessaire** : par défaut, `serve` redirige `/offline.html` vers `/offline` (301), et une réponse redirigée mise en cache par le Service Worker est refusée pour une navigation : `offline.html` ne s'affiche jamais. La réécriture `/` → `/index.html` remplace le listing de dossier que `cleanUrls: false` provoque sur `/`.

### Hydratation depuis le HTML — *optionnel*

Deux façons de rendre le contenu visible : **(a)** du contenu public *statique* dans le HTML (titre, description, mode d'emploi, exemples en texte) et les données de l'utilisateur dans IndexedDB — rien à hydrater, c'est le plus simple ; **(b)** des exemples dans le HTML (`<li data-seed>`) importés une fois dans IndexedDB au premier lancement — l'hydratation ci-dessous, utile quand la liste affichée *est* le contenu public.

```javascript
// app.js
const list = document.querySelector("#notes-list");
const seeds = [...list.querySelectorAll("[data-seed]")].map((li) => li.textContent.trim());

// Premier lancement seulement : importer les exemples du HTML
if ((await db.count("notes")) === 0)
  for (const text of seeds) await db.add("notes", { text, createdAt: Date.now() });

// Rendu depuis IndexedDB : textContent, jamais innerHTML
list.replaceChildren(...(await db.getAll("notes")).map((n) => { const li = document.createElement("li"); li.textContent = n.text; return li; }));
```

Sans le test `count === 0`, chaque rechargement réimporte les exemples : 3, 6, 9 notes.

### Les quatre commandes de vérification — à lancer sur sa propre PWA

```bash
# 1. Le contenu est dans le HTML : 3 notes d'exemple (0 si l'interface est créée par app.js)
curl -s -A "GPTBot" https://<ma-pwa>/ | grep -c "<li[ >]"

# 2. La jumelle Markdown répond
curl -s -A "ClaudeBot" https://<ma-pwa>/notes.md

# 3. Type et en-tête de la jumelle : text/markdown, noindex
curl -sI https://<ma-pwa>/notes.md | grep -iE "content-type|x-robots"

# 4. Pas de négociation de contenu côté serveur statique : text/html
curl -sD - -o /dev/null -H "Accept: text/markdown" https://<ma-pwa>/
```

`-A "GPTBot"` ne fait que changer le user-agent : le serveur répond le même HTML à tout le monde ; la commande montre ce que reçoit un robot, qui n'exécute pas `app.js`. Adapter le `grep` au contenu de sa PWA (`<li[ >]` compte les notes du corrigé ; `<li` seul compterait aussi `<link`). Compléter par `https://<ma-pwa>/robots.txt`, `/sitemap.xml` et `/llms.txt` (réponse `200`), puis DevTools → Lighthouse → SEO (100) et validator.schema.org (0 erreur pour le JSON-LD).

### Pièges

- **`curl` voit le nouveau HTML, le navigateur l'ancien** : le Service Worker sert `index.html` depuis le cache. Incrémenter `CACHE_NAME` (`pwa-notes-v2`), recharger, fermer tous les onglets de l'origine, rouvrir (Jour 1, TD 5).
- **`/?note=3` hors ligne** : `caches.match(request, { ignoreSearch: true })` dans le `fetch` du Service Worker.
- **App Shell** : `notes.md` oui ; `robots.txt` et `sitemap.xml` non (inutiles hors ligne).

---

## 14. Checklist finale avant de publier sur le Hub

- [ ] Déployée en HTTPS (Netlify / Vercel / GitHub Pages / Firebase : automatique) ; ouverte sur un téléphone
- [ ] Manifest valide (DevTools → Application → Manifest) ; installation testée sur mobile
- [ ] Service Worker actif, `fetch` handler, `CACHE_NAME` versionné, anciens caches supprimés à l'`activate`
- [ ] Hors ligne testé (Network → Offline → recharger) : interface, données, page de secours
- [ ] Mise à jour testée : redéployer avec `CACHE_NAME` incrémenté → la nouvelle version arrive selon la stratégie choisie (d'office ou bannière), sans vider le cache à la main
- [ ] Synchronisation : une action hors ligne arrive au serveur au retour du réseau
- [ ] Visible : le contenu public est dans le HTML (`curl`, § 13) ; `robots.txt`, `sitemap.xml`, `llms.txt` répondent ; Lighthouse SEO
- [ ] Une capacité de l'appareil fonctionne sur téléphone ; permission demandée après un geste ; refus géré
- [ ] Core Web Vitals corrects (Lighthouse / PageSpeed)
- [ ] Aucun secret dans le code livré au navigateur
- [ ] **Document technique** rédigé (`DOC-TECHNIQUE.md`, modèle `TP/doc-technique-modele.md`) et lié depuis le `README` du dépôt
- [ ] Fiche déposée sur le Hub : nom, URL, dépôt, description, capacités
- [ ] *(bonus)* Notifications push ; conflits : deux onglets hors ligne modifient la même note → `412` et bannière (§ 11)
