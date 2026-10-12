# TP — Une Progressive Web App complète

Partie I — PWA · Cours M2 Informatique · Università di Corsica · lundi 12 octobre 2026

## Objectif

Concevoir, développer, déployer et documenter **une PWA** sur un sujet choisi, qui s'installe sur un téléphone, fonctionne hors ligne, se synchronise au retour du réseau, est lisible par les moteurs de recherche et les agents IA, et utilise au moins une capacité de l'appareil.

Une ou deux PWA, technologie libre : HTML/CSS/JavaScript avec `idb`, ou un framework (React, Vue, Svelte, Angular, Next, Nuxt…). Workbox et les assistants IA sont autorisés ; le document technique doit montrer que chaque choix est compris.

## Le Class Hub

Le Class Hub est la plateforme de la promotion (adresse communiquée en séance). On s'y inscrit, on y dépose sa PWA (nom, URL, dépôt, description, capacités utilisées), on y découvre celles des autres pour les installer, les tester et leur laisser une appréciation. Le Hub est lui-même une PWA installable.

## Sujet

Au choix dans la liste du Hub (todo list, carnet, inventaire, recettes, suivi sportif…) ou libre, à condition que l'application manipule des **données créées par l'utilisateur** et ait un **contenu public** à rendre visible.

## Fonctionnalités attendues

| Brique | Attendu | Validation |
|---|---|---|
| **Déploiement** | En ligne, HTTPS, testée sur téléphone (ou DevTools, mode mobile) | L'URL s'ouvre sur un téléphone |
| **Installable** | Manifest : nom, icônes 192 et 512, `display: standalone`, couleurs | DevTools → Application → Manifest sans erreur ; l'icône arrive sur l'écran d'accueil |
| **Hors ligne** | App Shell en cache, données locales affichées, page de secours, actions indisponibles signalées | Mode avion : l'app s'ouvre, ses données aussi |
| **Mise à jour** | Une stratégie choisie — nouvelle version appliquée d'office, ou proposée à l'utilisateur (bannière) — et justifiée dans le document | Redéployer : la nouvelle version arrive sans vider le cache à la main |
| **Synchronisation** | Outbox IndexedDB, envoi au retour du réseau (Background Sync + repli `online`) | Action faite hors ligne → arrivée au serveur au retour du réseau |
| **Visible** | Contenu public dans le HTML initial ; `<title>`, description, Open Graph ; `robots.txt`, `sitemap.xml`, `llms.txt` | `curl` sur l'URL montre le contenu ; les trois fichiers répondent |
| **Une capacité de l'appareil** | Géolocalisation, caméra, partage, badge, wake lock, presse-papiers… — permission demandée **après une action de l'utilisateur**, refus géré | Le bouton fonctionne sur téléphone ; le refus affiche un message, pas une erreur |
| **Document technique** | Voir `doc-technique-modele.md` | Lié depuis le dépôt |

Bonus : notifications push (Firebase ou `web-push`) ; une deuxième capacité ; la réconciliation de conflits (`If-Match`, cheatsheet § 11).

## Livrables

1. **Le code** : un dépôt public (GitHub, GitLab ou autre), avec un `README` qui dit comment lancer en local.
2. **L'URL de la PWA déployée** (Netlify, Vercel, GitHub Pages, Firebase Hosting…).
3. **Le document technique** : `DOC-TECHNIQUE.md` à la racine du dépôt (ou un PDF lié depuis le `README`), 1 à 3 pages, selon le modèle fourni.

Les trois sont déclarés sur la fiche du Hub.

## Barème (sur 10)

| Critère | Points |
|---|---|
| Déployée, dépôt et URL rendus, testée sur téléphone | 1 |
| Installable | 1 |
| Hors ligne | 2 |
| Mise à jour | 1 |
| Synchronisation après retour en ligne | 1 |
| Visibilité SEO / GEO | 1 |
| Une capacité de l'appareil, fonctionnelle, permission au bon moment | 1 |
| Document technique : choix expliqués, cohérents avec le code | 2 |
| Bonus : notifications push +1 · deuxième capacité ou conflits +1 | jusqu'à +2, plafond 10 |

## Ressources

`TP/cheatsheet.md` (tous les snippets du cours) · `TP/doc-technique-modele.md` · `TD/td8-pwa-notes/` (point de départ des TD, réutilisable) · corrigés dans `demos/` · [web.dev/learn/pwa](https://web.dev/learn/pwa/) · [whatpwacando.today](https://whatpwacando.today/)
