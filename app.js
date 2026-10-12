// ============================================================
// Journal de Voyage — app.js
// Logique frontend : IndexedDB (idb), Background Sync,
// Géolocalisation, mise à jour du Service Worker
// ============================================================

// --- Constantes ---
const API_ENDPOINT = "https://httpbin.org/post"; // Faux endpoint pour la synchronisation

// --- Ouverture / Création de la base IndexedDB ---
const dbPromise = idb.openDB("journal-voyage-db", 1, {
  upgrade(db) {
    // Store pour les étapes du journal de l'utilisateur
    if (!db.objectStoreNames.contains("etapes")) {
      db.createObjectStore("etapes", { keyPath: "id", autoIncrement: true });
    }
    // Store outbox pour la synchronisation hors ligne
    if (!db.objectStoreNames.contains("outbox")) {
      db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    }
  },
});

// ============================================================
// 1. ENREGISTREMENT DU SERVICE WORKER + MISE À JOUR
// ============================================================
async function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    console.log("✅ SW enregistré, scope :", registration.scope);

    // --- Bannière « Nouvelle version disponible » ---
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        // Si un nouveau SW est installé ET qu'un ancien contrôle déjà la page
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // Afficher la bannière de mise à jour
          const banner = document.getElementById("update-banner");
          banner.hidden = false;

          // Bouton « Mettre à jour » → envoie SKIP_WAITING au nouveau SW
          document.getElementById("btn-update").addEventListener("click", () => {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          });

          // Bouton fermer la bannière
          document.getElementById("btn-dismiss-update").addEventListener("click", () => {
            banner.hidden = true;
          });
        }
      });
    });

    // Quand le nouveau SW prend le contrôle → recharger la page
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      location.reload();
    });
  } catch (err) {
    console.error("❌ Erreur d'enregistrement du SW :", err);
  }
}

// ============================================================
// 2. BOUTON D'INSTALLATION CUSTOM (beforeinstallprompt)
// ============================================================
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById("btn-install").hidden = false;
});

document.getElementById("btn-install").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(outcome === "accepted" ? "✅ App installée" : "❌ Installation refusée");
  deferredPrompt = null;
  document.getElementById("btn-install").hidden = true;
});

window.addEventListener("appinstalled", () => {
  document.getElementById("btn-install").hidden = true;
  showToast("✅ L'application a été installée !");
});

// ============================================================
// 3. HYDRATATION DES DESTINATIONS PUBLIQUES (SEO → IndexedDB)
// ============================================================
async function hydrateDestinations() {
  const list = document.getElementById("destinations-list");
  const seeds = [...list.querySelectorAll("[data-seed]")].map((li) => {
    const strong = li.querySelector("strong");
    const p = li.querySelector("p");
    return {
      nom: strong ? strong.textContent.trim() : "",
      description: p ? p.textContent.trim() : "",
    };
  });

  const db = await dbPromise;

  // Premier lancement uniquement : importer les exemples du HTML dans IndexedDB
  if ((await db.count("etapes")) === 0) {
    for (const seed of seeds) {
      await db.add("etapes", {
        titre: seed.nom,
        description: seed.description,
        lat: null,
        lng: null,
        date: Date.now(),
        synced: true, // Contenu statique, pas besoin de sync
      });
    }
  }

  // Recharger la liste du journal depuis IndexedDB
  await renderJournal();
}

// ============================================================
// 4. AFFICHAGE DU JOURNAL DEPUIS IndexedDB
// ============================================================
async function renderJournal() {
  const db = await dbPromise;
  const etapes = await db.getAll("etapes");
  const list = document.getElementById("journal-list");
  const emptyMsg = document.getElementById("journal-empty");

  if (etapes.length === 0) {
    emptyMsg.hidden = false;
    list.replaceChildren();
    return;
  }

  emptyMsg.hidden = true;

  // Trier par date décroissante
  etapes.sort((a, b) => b.date - a.date);

  const items = etapes.map((etape) => {
    const li = document.createElement("li");
    li.className = "journal-entry";

    const dateStr = new Date(etape.date).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    let geoHtml = "";
    if (etape.lat && etape.lng) {
      geoHtml = `<span class="journal-entry__geo">📍 ${etape.lat.toFixed(4)}, ${etape.lng.toFixed(4)}</span>`;
    }

    let pendingHtml = "";
    if (etape.synced === false) {
      pendingHtml = `<span class="journal-entry__pending">⏳ En attente de sync</span>`;
    }

    // On utilise textContent pour les données utilisateur (sécurité XSS)
    // Mais ici on construit le squelette HTML, puis on injecte les textes en textContent
    const header = document.createElement("div");
    header.className = "journal-entry__header";

    const title = document.createElement("span");
    title.className = "journal-entry__title";
    title.textContent = etape.titre;

    const date = document.createElement("span");
    date.className = "journal-entry__date";
    date.textContent = dateStr;

    header.appendChild(title);
    header.appendChild(date);

    const desc = document.createElement("p");
    desc.className = "journal-entry__description";
    desc.textContent = etape.description;

    li.appendChild(header);
    li.appendChild(desc);

    // Geo et pending badges (safe HTML)
    if (geoHtml || pendingHtml) {
      const badges = document.createElement("div");
      badges.innerHTML = geoHtml + pendingHtml;
      li.appendChild(badges);
    }

    // Bouton supprimer
    const actions = document.createElement("div");
    actions.className = "journal-entry__actions";
    const btnDelete = document.createElement("button");
    btnDelete.className = "btn btn--delete";
    btnDelete.textContent = "🗑️ Supprimer";
    btnDelete.addEventListener("click", () => deleteEtape(etape.id));
    actions.appendChild(btnDelete);
    li.appendChild(actions);

    return li;
  });

  list.replaceChildren(...items);
}

// ============================================================
// 5. AJOUT D'UNE ÉTAPE + BACKGROUND SYNC
// ============================================================
document.getElementById("form-etape").addEventListener("submit", async (e) => {
  e.preventDefault();

  const titre = document.getElementById("etape-titre").value.trim();
  const description = document.getElementById("etape-description").value.trim();
  const lat = parseFloat(document.getElementById("etape-lat").value) || null;
  const lng = parseFloat(document.getElementById("etape-lng").value) || null;

  if (!titre || !description) return;

  const etape = {
    titre,
    description,
    lat,
    lng,
    date: Date.now(),
    synced: false, // Pas encore envoyée au serveur
  };

  const db = await dbPromise;

  // Sauvegarder localement dans IndexedDB
  const id = await db.add("etapes", etape);
  etape.id = id;

  // Tenter la synchronisation avec le serveur
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(etape),
    });

    if (response.ok) {
      // Succès : marquer comme synchronisée
      etape.synced = true;
      await db.put("etapes", etape);
      showToast("✅ Étape enregistrée et synchronisée !");
    } else {
      throw new Error("Réponse serveur non-OK");
    }
  } catch (err) {
    // Échec (hors ligne ou erreur réseau) → sauvegarder dans l'outbox
    console.warn("⚠️ Sync échouée, sauvegarde dans l'outbox :", err.message);
    await db.add("outbox", { etapeId: id, data: etape, timestamp: Date.now() });

    // Enregistrer un tag de Background Sync (Chromium uniquement)
    try {
      const reg = await navigator.serviceWorker.ready;
      if ("sync" in reg) {
        await reg.sync.register("sync-etapes");
        console.log("🔄 Background Sync enregistré : sync-etapes");
      }
    } catch (syncErr) {
      console.warn("Background Sync non disponible :", syncErr);
    }

    showToast("📴 Étape sauvegardée hors ligne — elle sera synchronisée au retour du réseau");
  }

  // Réinitialiser le formulaire
  document.getElementById("form-etape").reset();
  document.getElementById("etape-lat").value = "";
  document.getElementById("etape-lng").value = "";
  document.getElementById("geo-status").textContent = "";
  document.getElementById("geo-status").className = "form__help";

  // Mettre à jour l'affichage
  await renderJournal();
});

// ============================================================
// 6. SUPPRESSION D'UNE ÉTAPE
// ============================================================
async function deleteEtape(id) {
  const db = await dbPromise;
  await db.delete("etapes", id);
  await renderJournal();
  showToast("🗑️ Étape supprimée");
}

// ============================================================
// 7. GÉOLOCALISATION (permission au clic uniquement)
// ============================================================
document.getElementById("btn-geo").addEventListener("click", () => {
  const geoStatus = document.getElementById("geo-status");

  // Vérifier que l'API est disponible
  if (!("geolocation" in navigator)) {
    geoStatus.textContent = "❌ La géolocalisation n'est pas disponible sur cet appareil.";
    geoStatus.className = "form__help error";
    return;
  }

  geoStatus.textContent = "⏳ Recherche de votre position…";
  geoStatus.className = "form__help";

  // La permission est demandée ICI, au clic utilisateur (jamais au chargement)
  navigator.geolocation.getCurrentPosition(
    (position) => {
      // Succès
      const { latitude, longitude } = position.coords;
      document.getElementById("etape-lat").value = latitude.toFixed(6);
      document.getElementById("etape-lng").value = longitude.toFixed(6);
      geoStatus.textContent = `✅ Position trouvée : ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      geoStatus.className = "form__help success";
    },
    (error) => {
      // Gestion fine des erreurs de géolocalisation
      let message = "";
      switch (error.code) {
        case error.PERMISSION_DENIED:
          message = "📍 Localisation refusée. Vous pouvez l'activer dans les paramètres de votre navigateur.";
          break;
        case error.POSITION_UNAVAILABLE:
          message = "📍 Position indisponible. Vérifiez que le GPS est activé sur votre appareil.";
          break;
        case error.TIMEOUT:
          message = "📍 Délai dépassé. Réessayez dans un endroit avec une meilleure réception.";
          break;
        default:
          message = "📍 Localisation refusée ou indisponible.";
      }
      geoStatus.textContent = message;
      geoStatus.className = "form__help error";
      console.warn("Géolocalisation :", error.message);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    }
  );
});

// ============================================================
// 8. DÉTECTION RÉSEAU + FALLBACK UNIVERSEL (online/offline)
// ============================================================

// Fallback pour les navigateurs sans Background Sync (Firefox, Safari)
async function syncOutbox() {
  try {
    const db = await dbPromise;
    const pending = await db.getAll("outbox");

    if (pending.length === 0) return;

    console.log(`🔄 Synchronisation de ${pending.length} élément(s) en attente…`);

    for (const item of pending) {
      try {
        const response = await fetch(API_ENDPOINT, {
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
          // Supprimer de l'outbox
          await db.delete("outbox", item.id);
          console.log(`✅ Élément ${item.id} synchronisé`);
        }
      } catch (fetchErr) {
        console.warn(`⚠️ Échec sync élément ${item.id} :`, fetchErr);
        break; // On arrête si le réseau est encore instable
      }
    }

    await renderJournal();
    showToast("🔄 Données synchronisées !");
  } catch (err) {
    console.error("Erreur syncOutbox :", err);
  }
}

window.addEventListener("online", () => {
  showNetworkStatus("online", "🌐 Connexion rétablie !");
  // Fallback universel : tenter la synchronisation
  syncOutbox();
});

window.addEventListener("offline", () => {
  showNetworkStatus("offline", "📴 Mode hors ligne — vos actions seront synchronisées");
});

// ============================================================
// 9. UTILITAIRES UI
// ============================================================

/** Affiche un toast temporaire */
function showToast(message, duration = 3500) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

/** Affiche l'indicateur réseau */
function showNetworkStatus(type, text) {
  const el = document.getElementById("network-status");
  const textEl = document.getElementById("network-status-text");
  el.className = `network-status ${type}`;
  textEl.textContent = text;
  el.hidden = false;

  clearTimeout(showNetworkStatus._timer);
  showNetworkStatus._timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

// ============================================================
// 10. INITIALISATION
// ============================================================
(async function init() {
  // Enregistrer le Service Worker
  await initServiceWorker();

  // Hydrater les destinations du HTML dans IndexedDB (premier lancement)
  await hydrateDestinations();

  // Afficher le statut réseau initial si hors ligne
  if (!navigator.onLine) {
    showNetworkStatus("offline", "📴 Vous êtes hors ligne");
  }
})();
