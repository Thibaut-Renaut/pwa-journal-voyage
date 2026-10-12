# 🗺️ Journal de Voyage — Progressive Web App (PWA)

Application web progressive (PWA) de carnet de voyage installable, utilisable 100 % hors ligne avec synchronisation automatique, géolocalisation et capture photo.

> **Projet de Master 2 Informatique — Università di Corsica (2026)**  
> **Dépôt officiel :** [https://github.com/Thibaut-Renaut/pwa-journal-voyage](https://github.com/Thibaut-Renaut/pwa-journal-voyage)  
> **Documentation technique :** [DOC-TECHNIQUE.md](file:///c:/Master/M2/Progressive%20web%20apps/TPNOTE/DOC-TECHNIQUE.md)  

---

## ✨ Fonctionnalités Principales

- **Gestion Multi-Carnets** : Créez, éditez et supprimez plusieurs carnets de voyages indépendants. Ajoutez une photo vitrine personnalisée ou profitez de l'icône de boussole par défaut.
- **Ajout d'Étapes Détaillées** : Récits de voyage avec date, lieu, coordonnées GPS et sélection/prise de photos multiples.
- **Fonctionnement Hors Ligne (Offline-First)** :
  - Pré-mise en cache de l'App Shell via Service Worker (`sw.js`).
  - Stockage local robuste avec **IndexedDB** (`idb`).
  - Page de secours personnalisée (`offline.html`) servie lors des navigations hors cache.
- **Synchronisation Différée (Background Sync)** :
  - Les étapes créées hors ligne sont stockées dans l'`outbox`.
  - Envoi automatique au serveur dès le retour de la connexion via Background Sync API (ou repli universel sur l'événement `online`).
- **Capacités Matérielles (Device APIs)** :
  - **API Géolocalisation** : Récupération précise des coordonnées GPS avec accord explicite de l'utilisateur.
  - **API Caméra / Canvas** : Importation de photos avec compression et redimensionnement automatique côté client pour économiser le stockage.
- **Installation PWA** :
  - Manifest conforme avec icônes 192x192 et 512x512.
  - Modale et bouton d'installation personnalisés (`beforeinstallprompt`).
  - Mode d'affichage `standalone` sans barre de navigation.
- **Visibilité & Indexation (SEO & Agents IA)** :
  - Contenu public statique disponible directement dans le DOM pour les moteurs de recherche et les crawlers.
  - Métadonnées complètes, Open Graph, JSON-LD `WebApplication`.
  - Fichiers `robots.txt`, `sitemap.xml`, `llms.txt` et jumelle Markdown `voyage.md`.

---

## 🚀 Lancer le Projet en Local

Comme l'application utilise un **Service Worker**, elle doit être servie via un serveur HTTP local (pas via le protocole `file://`).

### Option 1 : Avec Node.js (`npx serve`)
```bash
# Cloner le dépôt
git clone https://github.com/Thibaut-Renaut/pwa-journal-voyage.git
cd pwa-journal-voyage

# Lancer le serveur local
npx serve .
```
Ouvrez ensuite votre navigateur sur `http://localhost:3000`.

### Option 2 : Avec Python 3
```bash
python -m http.server 8080
```
Ouvrez ensuite votre navigateur sur `http://localhost:8080`.

---

## 🧪 Tester les Fonctionnalités Clés

1. **Test Hors Ligne** :
   - Ouvrez l'application, puis ouvrez les Outils de Développement (`F12`).
   - Allez dans l'onglet **Network** (Réseau) et sélectionnez **Offline**.
   - Rechargez la page : l'application et vos carnets s'affichent instantanément.
2. **Test de Synchronisation** :
   - En mode **Offline**, créez une nouvelle étape : elle apparaît avec le statut *"En attente de sync"*.
   - Repassez en mode **Online** : la synchronisation se déclenche automatiquement et le badge passe à *"Synchronisé"*.
3. **Test d'Installation** :
   - Cliquez sur le bouton *"Installer l'application"* dans l'en-tête ou le modal dédié pour ajouter l'application sur votre écran d'accueil.

---

## 📚 Documentation Technique

Pour une analyse détaillée des choix architecturaux, du cycle de vie du Service Worker, des stratégies de cache et de la conformité au barème de notation, consultez le fichier :
👉 **[Consulter DOC-TECHNIQUE.md](./DOC-TECHNIQUE.md)**
