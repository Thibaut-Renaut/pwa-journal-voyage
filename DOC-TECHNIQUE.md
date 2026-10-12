# Document Technique — PWA Journal de Voyage

**Projet :** Journal de Voyage — Application PWA complète et autonome  
**Cadre :** TP Noté PWA · Master 2 Informatique · Università di Corsica  
**Dépôt GitHub :** [https://github.com/Thibaut-Renaut/pwa-journal-voyage](https://github.com/Thibaut-Renaut/pwa-journal-voyage)  
**Date :** Octobre 2026  

---

## 1. Vision et Concept de l'Application

**Journal de Voyage** est une Progressive Web App (PWA) conçue selon le paradigme **Offline-First**. Elle s'adresse aux explorateurs, randonneurs et voyageurs souhaitant documenter leurs expéditions en pleine nature, même en l'absence totale de réseau cellulaire ou Internet (zones blanches, mode avion, bivouac en montagne).

### Points clés :
- **Multi-carnets de voyage** : création et gestion de carnets indépendants (titre, description, photo vitrine ou icône vectorielle par défaut).
- **Récits d'étapes enrichis** : texte, date, coordonnées GPS précises et galerie de photos multiples.
- **Fonctionnement 100 % hors-ligne** : consultation, modification et création de données sans connexion.
- **Synchronisation automatique** : file d'attente Outbox envoyée au retour du réseau via Background Sync et repli événementiel.
- **Installation native** : utilisable comme une application mobile autonome (iOS, Android, Windows, macOS).
- **Double visibilité** : indexable par les moteurs de recherche traditionnels (SEO) et lisible par les agents d'intelligence artificielle (GEO / LLMs).

---

## 2. Architecture Technique et Choix Technologiques

### 2.1. Zéro Framework (Vanilla HTML5 / CSS3 / JavaScript ES6+)
- **Choix délibéré** : Aucun framework lourd (React, Angular, Vue) n'a été utilisé.
- **Justification** : Dans une architecture PWA centrée sur le cycle de vie du Service Worker, le contrôle absolu du DOM natif, des flux de cache et des événements réseau (`online`, `sync`, `beforeinstallprompt`) garantit :
  - Un poids ultra-léger (App Shell inférieur à 60 Ko hors images).
  - Un temps de premier rendu (First Contentful Paint) instantané.
  - L'absence de dépendances fragiles ou d'outils de compilation complexes.
- **Base locale** : Bibliothèque UMD `idb` (v8) importée via CDN et pré-mise en cache pour manipuler IndexedDB avec des promesses asynchrones modernes (`async/await`).

### 2.2. Design et Typographie
- **Typographie expressive** : Polices Google Fonts *Fraunces* (titres chaleureux et typés voyage) et *Plus Jakarta Sans* (corps de texte moderne et hautement lisible).
- **Palette chromatique inspirée de la nature** : Nuances de vert pin, sauge, crème et granite corse définies via des variables CSS (`--green-600`, `--cream-50`).
- **Zéro emoji** : Respect strict d'une charte graphique soignée avec des icônes vectorielles SVG intégrées (boussole, crayon, poubelle, épingle de géolocalisation, livre).

---

## 3. Le Service Worker et les Stratégies de Cache

Le Service Worker (`sw.js`) agit comme un proxy programmable interceptant toutes les requêtes réseau pour assurer résilience et rapidité.

### 3.1. Pré-mise en cache de l'App Shell (`install`)
À l'installation, le Service Worker télécharge et stocke immédiatement les fichiers indispensables dans le cache nommé `pwa-voyage-v6` :
- `/` et `/index.html` (Structure principale)
- `/app.js` (Logique applicative)
- `/style.css` (Feuille de style complète)
- `/manifest.json` (Déclaration de l'application)
- `/offline.html` (Page de secours)
- `/voyage.md` (Jumelle Markdown pour les agents IA)
- Images vitrines des destinations corses (`/images/bavella.jpg`, etc.)

### 3.2. Routage et stratégies de cache (`fetch`)
Trois stratégies distinctes sont déployées selon la nature de la ressource :

1. **Navigation HTML : Stale While Revalidate (SWR) avec Fallback**
   - *Fonctionnement* : Le Service Worker sert instantanément le fichier HTML depuis le cache local (affichage immédiat), tout en lançant une requête réseau en tâche de fond pour actualiser le cache.
   - *Prise en charge de `ignoreSearch: true`* : Permet de répondre avec la page d'accueil en cache même si l'URL contient des paramètres de requête (ex. `/?v=6` ou jetons de navigation).
   - *Fallback d'urgence* : Si la requête réseau échoue et qu'aucune page correspondante n'est en cache, le Service Worker sert la page de secours stylisée `/offline.html`.

2. **Assets Statiques : Cache First**
   - *Cible* : CSS, JS, PNG, JPG, JPEG, SVG, WOFF2, ICO.
   - *Fonctionnement* : La ressource est servie directement depuis le cache. En cas d'absence, elle est récupérée sur le réseau et immédiatement mise en cache pour les consultations ultérieures.

3. **Requêtes vers des tiers & synchronisation** : Laissées au réseau direct (Network Only) pour éviter toute mise en cache incohérente des requêtes API POST.

### 3.3. Stratégie de mise à jour choisie et justifiée
- **Stratégie retenue** : **Mise à jour proposée à l'utilisateur via bannière non intrusive**.
- **Justification technique** : Dans une application où l'utilisateur saisit du texte ou prend des photos, forcer un rechargement brutal via `self.skipWaiting()` à l'installation risquerait d'interrompre une saisie en cours ou de vider un formulaire non sauvegardé.
- **Implémentation** :
  1. Lors du déploiement d'une nouvelle version, le nouveau Service Worker s'installe en arrière-plan et attend (`installed`).
  2. L'application écoute l'événement `updatefound` et affiche une bannière élégante en haut de l'écran : *"Nouvelle version disponible — Mettre à jour"*.
  3. Au clic, un message `SKIP_WAITING` est transmis via `postMessage`.
  4. Dès que le nouveau Service Worker prend le contrôle (`controllerchange`), la page se recharge proprement.
- **Nettoyage automatique (`activate`)** : Tous les caches dont le nom diffère de `CACHE_NAME` sont supprimés via `caches.delete()`, garantissant une gestion propre de l'espace disque.

---

## 4. Modèle de Données et Stockage Local (IndexedDB)

Les données sont conservées localement dans le navigateur du client via **IndexedDB** sous la base `journal-voyage-db` (version 2).

### 4.1. Schéma des Object Stores :
1. **Store `voyages`** (clé primaire `id`, autoIncrement) :
   - `id` (int) : Identifiant unique.
   - `titre` (string) : Nom du voyage (ex : *Échappée en Corse*).
   - `description` (string) : Résumé de l'aventure.
   - `photoVitrine` (string Base64 | null) : Photo de couverture personnalisée.
   - `dateCreation` (timestamp) : Date de création.

2. **Store `etapes`** (clé primaire `id`, autoIncrement, index `by-voyage` sur `voyageId`) :
   - `id` (int) : Identifiant unique de l'étape.
   - `voyageId` (int) : Rattachement au carnet correspondant.
   - `titre` (string) : Titre de l'étape.
   - `lieu` (string) : Nom du lieu ou de la commune.
   - `date` (string) : Date de l'étape.
   - `recit` (string) : Texte du journal.
   - `photos` (array of Base64 strings) : Liste des photographies capturées.
   - `lat` (float | null), `lng` (float | null) : Coordonnées GPS.
   - `synced` (boolean) : Indicateur d'état réseau.
   - `dateCreation` (timestamp) : Horodatage.

3. **Store `outbox`** (clé primaire `id`, autoIncrement) :
   - Tampon des actions créées hors ligne en attente d'expédition vers le serveur distant.

### 4.2. Confidentialité et isolation
Les données de l'application sont stockées **strictement en local** sur le terminal de chaque utilisateur. Chaque appareil et chaque navigateur possède son propre espace sandboxé, garantissant une confidentialité totale des carnets personnels.

---

## 5. Gestion du Réseau, Mode Hors-ligne et Synchronisation

### 5.1. UX et indicateur d'état réseau
- Les événements natifs `window.addEventListener("online")` et `"offline"` pilotent un badge visuel flottant `.network-status`.
- Lors d'une bascule hors ligne, un toast informe immédiatement l'utilisateur que l'application reste opérationnelle et que les futures actions seront différées.

### 5.2. Protocole de synchronisation (Background Sync + Repli)
Lorsqu'un utilisateur ajoute une nouvelle étape :
1. L'étape est enregistrée localement dans IndexedDB avec `synced: false`.
2. L'application tente un envoi immédiat vers le point de terminaison distant (`https://httpbin.org/post`).
3. **Cas hors ligne ou échec réseau** :
   - La charge utile est déposée dans le store `outbox` d'IndexedDB.
   - **Background Sync API (Chromium)** : L'application enregistre une tâche différée via `registration.sync.register("sync-pending")`. Le Service Worker exécutera l'envoi même si l'onglet est fermé au moment du retour du réseau.
   - **Repli universel obligatoire (Firefox / Safari)** : Ces navigateurs ne supportant pas l'API Background Sync, l'écouteur `window.addEventListener("online")` appelle directement la fonction `syncPendingData()` dès que la connexion est rétablie.
4. Au succès de l'envoi, l'élément est purgé de l'outbox, le drapeau `synced` passe à `true` dans IndexedDB et le badge de l'étape se transforme en "Synchronisé".

---

## 6. Capacités de l'Appareil Exploitees (Device APIs)

Conformément aux exigences et aux critères bonus du TP, l'application mobilise **deux capacités matérielles distinctes**, en respectant le principe d'une demande de permission consécutive à un geste explicite de l'utilisateur :

### 6.1. Capacité 1 : API Géolocalisation (`navigator.geolocation`)
- **Déclenchement** : Uniquement lors du clic volontaire sur le bouton *"Ma position actuelle"*.
- **Paramètres** : `enableHighAccuracy: true` et `timeout: 10000` pour une précision GPS optimale sur le terrain.
- **Gestion des erreurs et refus** : En cas de refus de permission (`PERMISSION_DENIED`) ou d'impossibilité de fixer les satellites (`POSITION_UNAVAILABLE`), l'application affiche un toast d'explication convivial sans aucun crash, et permet la saisie manuelle des coordonnées.

### 6.2. Capacité 2 (Bonus) : Caméra et Prise de Vue (`<input type="file" accept="image/*">` + Canvas)
- **Déclenchement** : Clic sur *"Ajouter une ou plusieurs photos"*.
- **Optimisation embarquée** : Les photos prises sur les smartphones modernes peuvent peser entre 5 et 15 Mo. Afin d'éviter la saturation de l'IndexedDB et des transferts réseau, une fonction `readFileAsOptimizedDataUrl()` utilise un `HTMLCanvasElement` pour redimensionner automatiquement les images à une dimension maximale de 1280px tout en compressant le flux JPEG (qualité 0.82).

---

## 7. Installation Native (Web App Manifest)

L'application est déclarée installable via le fichier `manifest.json` :
- `display: "standalone"` pour masquer les barres d'outils du navigateur et offrir une immersion native.
- Icônes haute résolution `192x192` et `512x512` générées au format PNG.
- Couleurs de marque : `theme_color: "#4a6741"` et `background_color: "#f4f7f2"`.
- Support d'iOS via les balises `apple-mobile-web-app-capable` et `apple-touch-icon`.
- **Expérience d'installation sur-mesure** : Interception de l'événement `beforeinstallprompt` pour proposer un bouton et une modale d'installation personnalisée intégrée au design du site.

---

## 8. Visibilité : SEO, GEO (Generative Engine Optimization) et Agents IA

Pour répondre aux exigences des moteurs de recherche et des agents conversationnels (LLMs) :

1. **Contenu public statique dans le DOM initial** :
   - Les 3 destinations d'inspiration corses (*Calanques de Piana*, *Aiguilles de Bavella*, *Plage de Palombaggia*) sont inscrites directement dans le code source de `index.html`. Les crawlers (Googlebot, GPTBot, ClaudeBot) qui n'exécutent pas de code JavaScript lisent l'intégralité du contenu dès la première requête HTTP.
2. **Métadonnées et balisage sémantique** :
   - Balises `<title>`, `<meta name="description">`, `canonical`.
   - Balises Open Graph complètes (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`).
   - Données structurées JSON-LD `WebApplication` (schéma Schema.org).
3. **Robots.txt & Sitemap.xml** :
   - `robots.txt` autorise expressément `GPTBot` (pour être cité par OpenAI) et bloque `Google-Extended` (pour éviter l'entraînement non consenti).
   - `sitemap.xml` conforme pointant vers l'URL canonique.
4. **Fichiers IA dédiés** :
   - `llms.txt` : Résumé structuré en Markdown destiné aux modèles de langage.
   - `voyage.md` : Jumelle Markdown de la page d'accueil, liée dans le `<head>` via `<link rel="alternate" type="text/markdown" href="/voyage.md">` et protégée par l'en-tête `X-Robots-Tag: noindex` (`_headers` / `serve.json`).

---

## 9. Synthèse de Conformité au Barème

| Critère du barème | Statut | Justification technique |
| :--- | :---: | :--- |
| **Déployée & Testée** (1 pt) |  Conforme | Code statique pur, testé en mode responsive mobile/tablette/PC. |
| **Installable** (1 pt) |  Conforme | Manifest complet, icônes 192/512, standalone, modale d'installation custom. |
| **Hors ligne** (2 pts) |  Conforme | App Shell en cache, données locales sous idb, page de secours `offline.html`. |
| **Mise à jour** (1 pt) |  Conforme | Stratégie avec bannière utilisateur, postMessage `SKIP_WAITING`, purge des anciens caches. |
| **Synchronisation** (1 pt) |  Conforme | Outbox IndexedDB, Background Sync API avec repli universel `online`. |
| **Visibilité SEO / GEO** (1 pt) |  Conforme | HTML initial garni, JSON-LD, Open Graph, `robots.txt`, `sitemap.xml`, `llms.txt`, `voyage.md`. |
| **Capacité de l'appareil** (1 pt) |  Conforme | Géolocalisation avec accord explicite et gestion gracieuse du refus. |
| **Bonus capacités** (+1 pt) |  Conforme | Deuxième capacité : Caméra / import photos avec optimisation Canvas. |
| **Document technique** (2 pts) |  Conforme | Présent document `DOC-TECHNIQUE.md` détaillé et explicatif. |

---

*Document rédigé par Thibaut Renaut — Master 2 Informatique, Università di Corsica, 2026.*
