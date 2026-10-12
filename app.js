// ============================================================
// Journal de Voyage — app.js
// Logique frontend : Multi-voyages, Photos d'étapes,
// IndexedDB (idb v2), Background Sync, Géolocalisation,
// Service Worker & Modal PWA (Zéro emojis)
// ============================================================

// --- Constantes & Endpoints ---
const API_ENDPOINT = "https://httpbin.org/post";

// --- SVG Icons Helper (Zéro emojis dans toute l'application) ---
const ICONS = {
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  clock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  pin: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
  edit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  book: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
};

// --- Helpers de stockage sécurisés (évite les SecurityError sous sandbox / Googlebot) ---
function getStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setStorage(key, val) {
  try { localStorage.setItem(key, String(val)); } catch {}
}
function getSession(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function setSession(key, val) {
  try { sessionStorage.setItem(key, String(val)); } catch {}
}

// ============================================================
// OUVERTURE / MIGRATION DE LA BASE IndexedDB (Version 2)
// ============================================================
const dbPromise = (typeof idb !== "undefined" && typeof indexedDB !== "undefined")
  ? idb.openDB("journal-voyage-db", 2, {
      upgrade(db, oldVersion) {
        // 1. Store des étapes
        if (!db.objectStoreNames.contains("etapes")) {
          const etapesStore = db.createObjectStore("etapes", { keyPath: "id", autoIncrement: true });
          etapesStore.createIndex("by-voyage", "voyageId");
        }
        // 2. Store outbox pour la synchronisation hors ligne
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        }
        // 3. Store des voyages (nouveau en v2)
        if (!db.objectStoreNames.contains("voyages")) {
          db.createObjectStore("voyages", { keyPath: "id", autoIncrement: true });
        }
      },
    }).catch((err) => {
      console.warn("[IndexedDB] Accès restreint ou indisponible :", err);
      return null;
    })
  : Promise.resolve(null);

// État global du voyage actif
let currentVoyageId = null;

// État des photos temporaires pour le formulaire de nouvelle étape
let currentStepPhotos = [];

// ============================================================
// 1. ENREGISTREMENT DU SERVICE WORKER + BANNIÈRE DE MISE À JOUR
// ============================================================
async function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    console.log("[SW] Enregistré, scope :", registration.scope);

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          const banner = document.getElementById("update-banner");
          if (banner) banner.hidden = false;

          const btnUpdate = document.getElementById("btn-update");
          if (btnUpdate) {
            btnUpdate.addEventListener("click", () => {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            });
          }

          const btnDismiss = document.getElementById("btn-dismiss-update");
          if (btnDismiss) {
            btnDismiss.addEventListener("click", () => {
              banner.hidden = true;
            });
          }
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      location.reload();
    });
  } catch (err) {
    console.error("[SW] Erreur enregistrement :", err);
  }
}

// ============================================================
// 2. MODALE D'INSTALLATION PWA (beforeinstallprompt)
// ============================================================
let deferredPrompt = null;
const installModal = document.getElementById("install-modal");
const btnInstallConfirm = document.getElementById("btn-install-confirm");
const btnInstallDismiss = document.getElementById("btn-install-dismiss");
const btnInstallClose = document.getElementById("btn-install-close");
const installBackdrop = document.getElementById("install-modal-backdrop");

function openInstallModal() {
  if (!installModal) return;
  if (getSession("pwa-install-dismissed")) return;
  installModal.hidden = false;
  requestAnimationFrame(() => installModal.classList.add("is-visible"));
}

function closeInstallModal(rememberDismiss = false) {
  if (!installModal) return;
  installModal.classList.remove("is-visible");
  setTimeout(() => { installModal.hidden = true; }, 300);
  if (rememberDismiss) {
    setSession("pwa-install-dismissed", "true");
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  setTimeout(() => openInstallModal(), 1200);
});

if (btnInstallConfirm) {
  btnInstallConfirm.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    closeInstallModal(false);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(outcome === "accepted" ? "App installée" : "Installation refusée");
    deferredPrompt = null;
  });
}

if (btnInstallDismiss) btnInstallDismiss.addEventListener("click", () => closeInstallModal(true));
if (btnInstallClose) btnInstallClose.addEventListener("click", () => closeInstallModal(true));
if (installBackdrop) installBackdrop.addEventListener("click", () => closeInstallModal(true));

window.addEventListener("appinstalled", () => {
  closeInstallModal(true);
  showToast("Application installée avec succès !");
});

// ============================================================
// 3. GESTION DES VOYAGES (Multi-carnets)
// ============================================================

/** Initialise ou récupère les voyages existants */
async function initVoyages() {
  const db = await dbPromise;
  if (!db) return;
  let voyages = await db.getAll("voyages");

  // Si aucun voyage n'existe, créer le voyage par défaut
  if (voyages.length === 0) {
    const defaultVoyage = {
      titre: "Échappée en Corse",
      description: "Aventures et randonnées au cœur des paysages corses, entre mer et montagnes.",
      photoVitrine: "/images/bavella.jpg",
      dateCreation: Date.now(),
    };
    const id = await db.add("voyages", defaultVoyage);
    defaultVoyage.id = id;
    voyages = [defaultVoyage];

    // Rattacher les éventuelles étapes orphelines existantes à ce voyage
    const etapes = await db.getAll("etapes");
    for (const etape of etapes) {
      if (!etape.voyageId) {
        etape.voyageId = id;
        await db.put("etapes", etape);
      }
    }
  }

  // Déterminer le voyage actif (sauvegardé dans localStorage ou premier disponible)
  const savedVoyageId = parseInt(getStorage("pwa-active-voyage-id"), 10);
  const found = voyages.find((v) => v.id === savedVoyageId);
  currentVoyageId = found ? found.id : voyages[0].id;
  setStorage("pwa-active-voyage-id", currentVoyageId);

  await updateActiveVoyageUI();
  await renderVoyages();
}

/** Met à jour les éléments d'interface liés au voyage actif */
async function updateActiveVoyageUI() {
  const db = await dbPromise;
  if (!db) return;
  const voyage = await db.get("voyages", currentVoyageId);
  if (!voyage) return;

  const titleEl = document.getElementById("active-voyage-title");
  if (titleEl) {
    titleEl.textContent = voyage.titre;
  }
}

/** Change le voyage actif */
async function setActiveVoyage(voyageId) {
  currentVoyageId = voyageId;
  setStorage("pwa-active-voyage-id", currentVoyageId);
  await updateActiveVoyageUI();
  await renderJournal();
  await renderVoyages();
  showToast(`Carnet actif : ${document.getElementById("active-voyage-title")?.textContent || ""}`);
}

/** Rendu de la section « Mes carnets de voyage » */
async function renderVoyages() {
  const db = await dbPromise;
  if (!db) return;
  const voyages = await db.getAll("voyages");
  const list = document.getElementById("voyages-list");
  if (!list) return;

  // Récupérer toutes les étapes pour calculer le nombre par voyage
  const allEtapes = await db.getAll("etapes");

  list.innerHTML = "";

  voyages.forEach((voyage) => {
    const etapesCount = allEtapes.filter((e) => e.voyageId === voyage.id).length;
    const isActive = voyage.id === currentVoyageId;

    const li = document.createElement("li");
    li.className = `destination-card voyage-card ${isActive ? "voyage-card--active" : ""}`;

    const media = document.createElement("div");
    media.className = "destination-card__media";

    if (isActive) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "voyage-card__active-badge";
      activeBadge.innerHTML = `${ICONS.check} Carnet actif`;
      media.appendChild(activeBadge);
    }

    if (voyage.photoVitrine) {
      const img = document.createElement("img");
      img.src = voyage.photoVitrine;
      img.alt = `Photo de couverture pour ${voyage.titre}`;
      img.className = "destination-card__img";
      img.loading = "lazy";
      media.appendChild(img);
    } else {
      media.className = "destination-card__media destination-card__media--placeholder";
      const placeholder = document.createElement("div");
      placeholder.className = "destination-card__placeholder-icon";
      placeholder.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
        </svg>
        <span>Carnet de voyage</span>
      `;
      media.appendChild(placeholder);
    }
    li.appendChild(media);

    const body = document.createElement("div");
    body.className = "destination-card__body";

    const title = document.createElement("p");
    title.className = "destination-card__name";
    title.textContent = voyage.titre;
    body.appendChild(title);

    const steps = document.createElement("p");
    steps.className = "voyage-card__steps";
    steps.innerHTML = `${ICONS.book} ${etapesCount} étape${etapesCount > 1 ? "s" : ""}`;
    body.appendChild(steps);

    li.appendChild(body);

    const desc = document.createElement("p");
    desc.className = "destination-card__description";
    desc.textContent = voyage.description;
    li.appendChild(desc);

    const footer = document.createElement("div");
    footer.className = "voyage-card__footer";

    const actions = document.createElement("div");
    actions.className = "voyage-card__actions";

    const btnOpen = document.createElement("button");
    btnOpen.type = "button";
    btnOpen.className = `btn ${isActive ? "btn--secondary" : "btn--primary"} btn--sm voyage-card__btn-open`;
    btnOpen.textContent = isActive ? "Carnet ouvert" : "Ouvrir ce carnet";
    btnOpen.disabled = isActive;
    btnOpen.addEventListener("click", () => setActiveVoyage(voyage.id));
    actions.appendChild(btnOpen);

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn btn--outline btn--sm voyage-card__btn-edit";
    btnEdit.innerHTML = `${ICONS.edit} <span>Modifier</span>`;
    btnEdit.title = "Modifier ce carnet";
    btnEdit.addEventListener("click", () => openEditVoyageModal(voyage.id));
    actions.appendChild(btnEdit);

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "voyage-card__btn-delete";
    btnDelete.innerHTML = ICONS.trash;
    btnDelete.title = "Supprimer ce carnet";
    btnDelete.setAttribute("aria-label", "Supprimer ce carnet");
    btnDelete.addEventListener("click", () => promptDeleteVoyage(voyage.id, voyage.titre));
    actions.appendChild(btnDelete);

    footer.appendChild(actions);
    li.appendChild(footer);
    list.appendChild(li);
  });
}

// ============================================================
// 4. MODALES : CRÉATION, ÉDITION & SÉLECTION DE VOYAGE
// ============================================================
const modalCreateVoyage = document.getElementById("modal-create-voyage");
const modalEditVoyage = document.getElementById("modal-edit-voyage");
const modalSwitchVoyage = document.getElementById("modal-switch-voyage");

function showModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add("is-visible"));
}

function hideModal(modal) {
  if (!modal) return;
  modal.classList.remove("is-visible");
  setTimeout(() => { modal.hidden = true; }, 300);
}

// Boutons d'ouverture de création
document.getElementById("btn-nouveau-voyage")?.addEventListener("click", () => showModal(modalCreateVoyage));
document.getElementById("btn-add-voyage-bar")?.addEventListener("click", () => showModal(modalCreateVoyage));
document.getElementById("btn-switch-create-new")?.addEventListener("click", () => {
  hideModal(modalSwitchVoyage);
  showModal(modalCreateVoyage);
});

// Fermeture de création
document.getElementById("btn-close-create-voyage")?.addEventListener("click", () => hideModal(modalCreateVoyage));
document.getElementById("btn-cancel-create-voyage")?.addEventListener("click", () => hideModal(modalCreateVoyage));
document.getElementById("modal-create-voyage-backdrop")?.addEventListener("click", () => hideModal(modalCreateVoyage));

// Bouton de modification du carnet ouvert
document.getElementById("btn-edit-active-voyage")?.addEventListener("click", () => openEditVoyageModal(currentVoyageId));

// Fermeture d'édition
document.getElementById("btn-close-edit-voyage")?.addEventListener("click", () => hideModal(modalEditVoyage));
document.getElementById("btn-cancel-edit-voyage")?.addEventListener("click", () => hideModal(modalEditVoyage));
document.getElementById("modal-edit-voyage-backdrop")?.addEventListener("click", () => hideModal(modalEditVoyage));

// Bouton de changement de voyage
document.getElementById("btn-change-voyage")?.addEventListener("click", async () => {
  await renderSwitchVoyageList();
  showModal(modalSwitchVoyage);
});

// Fermeture de sélection
document.getElementById("btn-close-switch-voyage")?.addEventListener("click", () => hideModal(modalSwitchVoyage));
document.getElementById("modal-switch-voyage-backdrop")?.addEventListener("click", () => hideModal(modalSwitchVoyage));

/** Rendu de la liste de sélection rapide de voyage dans la modale */
async function renderSwitchVoyageList() {
  const db = await dbPromise;
  const voyages = await db.getAll("voyages");
  const allEtapes = await db.getAll("etapes");
  const container = document.getElementById("switch-voyage-list");
  if (!container) return;

  container.innerHTML = "";

  voyages.forEach((v) => {
    const isCurrent = v.id === currentVoyageId;
    const count = allEtapes.filter((e) => e.voyageId === v.id).length;

    const item = document.createElement("div");
    item.className = `switch-voyage-item ${isCurrent ? "is-selected" : ""}`;

    if (v.photoVitrine) {
      const img = document.createElement("img");
      img.src = v.photoVitrine;
      img.alt = v.titre;
      img.className = "switch-voyage-item__img";
      item.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "switch-voyage-item__img switch-voyage-item__placeholder";
      placeholder.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
        </svg>
      `;
      item.appendChild(placeholder);
    }

    const info = document.createElement("div");
    info.className = "switch-voyage-item__info";

    const title = document.createElement("div");
    title.className = "switch-voyage-item__title";
    title.textContent = v.titre;
    info.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "switch-voyage-item__meta";
    meta.textContent = `${count} étape(s) ${isCurrent ? "· Actif" : ""}`;
    info.appendChild(meta);

    item.appendChild(info);

    item.addEventListener("click", async () => {
      await setActiveVoyage(v.id);
      hideModal(modalSwitchVoyage);
    });

    container.appendChild(item);
  });
}

// Prévisualisation photo vitrine du nouveau voyage
let newVoyageCoverDataUrl = null;
const voyagePhotoInput = document.getElementById("voyage-input-photo");
const voyagePhotoPreview = document.getElementById("voyage-photo-preview");

if (voyagePhotoInput) {
  voyagePhotoInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    newVoyageCoverDataUrl = await readFileAsOptimizedDataUrl(file, 1200);
    if (voyagePhotoPreview) {
      voyagePhotoPreview.hidden = false;
      voyagePhotoPreview.innerHTML = `<img src="${newVoyageCoverDataUrl}" alt="Aperçu photo vitrine">`;
    }
  });
}

// Soumission du formulaire de création de voyage (SANS image par défaut forcée)
document.getElementById("form-create-voyage")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const titre = document.getElementById("voyage-input-titre").value.trim();
  const description = document.getElementById("voyage-input-desc").value.trim();
  if (!titre) return;

  const db = await dbPromise;
  const newVoyage = {
    titre,
    description: description || "Carnet d'aventures",
    photoVitrine: newVoyageCoverDataUrl || null,
    dateCreation: Date.now(),
  };

  const id = await db.add("voyages", newVoyage);
  newVoyage.id = id;

  // Réinitialiser le formulaire
  document.getElementById("form-create-voyage").reset();
  newVoyageCoverDataUrl = null;
  if (voyagePhotoPreview) {
    voyagePhotoPreview.hidden = true;
    voyagePhotoPreview.innerHTML = "";
  }

  hideModal(modalCreateVoyage);
  await setActiveVoyage(id);
  showToast(`Nouveau carnet « ${titre} » créé !`);
});

// Logique d'édition d'un carnet
let editingVoyageId = null;
let editVoyageCoverDataUrl = null;
const editVoyagePhotoInput = document.getElementById("edit-voyage-photo");
const editVoyagePhotoPreview = document.getElementById("edit-voyage-photo-preview");
const editVoyagePhotoActions = document.getElementById("edit-voyage-photo-actions");
const btnRemoveEditCover = document.getElementById("btn-remove-edit-cover");

async function openEditVoyageModal(voyageId) {
  const db = await dbPromise;
  const voyage = await db.get("voyages", voyageId || currentVoyageId);
  if (!voyage) return;

  editingVoyageId = voyage.id;
  document.getElementById("edit-voyage-titre").value = voyage.titre;
  document.getElementById("edit-voyage-desc").value = voyage.description;
  editVoyageCoverDataUrl = voyage.photoVitrine || null;

  if (editVoyageCoverDataUrl && editVoyagePhotoPreview) {
    editVoyagePhotoPreview.hidden = false;
    editVoyagePhotoPreview.innerHTML = `<img src="${editVoyageCoverDataUrl}" alt="Photo de couverture">`;
    if (editVoyagePhotoActions) editVoyagePhotoActions.hidden = false;
  } else {
    if (editVoyagePhotoPreview) {
      editVoyagePhotoPreview.hidden = true;
      editVoyagePhotoPreview.innerHTML = "";
    }
    if (editVoyagePhotoActions) editVoyagePhotoActions.hidden = true;
  }

  showModal(modalEditVoyage);
}

if (editVoyagePhotoInput) {
  editVoyagePhotoInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    editVoyageCoverDataUrl = await readFileAsOptimizedDataUrl(file, 1200);
    if (editVoyagePhotoPreview) {
      editVoyagePhotoPreview.hidden = false;
      editVoyagePhotoPreview.innerHTML = `<img src="${editVoyageCoverDataUrl}" alt="Aperçu photo vitrine">`;
    }
    if (editVoyagePhotoActions) editVoyagePhotoActions.hidden = false;
  });
}

if (btnRemoveEditCover) {
  btnRemoveEditCover.addEventListener("click", () => {
    editVoyageCoverDataUrl = null;
    if (editVoyagePhotoPreview) {
      editVoyagePhotoPreview.hidden = true;
      editVoyagePhotoPreview.innerHTML = "";
    }
    if (editVoyagePhotoActions) editVoyagePhotoActions.hidden = true;
    if (editVoyagePhotoInput) editVoyagePhotoInput.value = "";
  });
}

document.getElementById("form-edit-voyage")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingVoyageId) return;

  const titre = document.getElementById("edit-voyage-titre").value.trim();
  const description = document.getElementById("edit-voyage-desc").value.trim();
  if (!titre) return;

  const db = await dbPromise;
  const voyage = await db.get("voyages", editingVoyageId);
  if (!voyage) return;

  voyage.titre = titre;
  voyage.description = description;
  voyage.photoVitrine = editVoyageCoverDataUrl;

  await db.put("voyages", voyage);

  hideModal(modalEditVoyage);

  if (editingVoyageId === currentVoyageId) {
    await updateActiveVoyageUI();
    await renderJournal();
  }
  await renderVoyages();

  showToast(`Carnet « ${titre} » mis à jour !`);
});

// ============================================================
// SUPPRESSION D'UN CARNET DE VOYAGE
// ============================================================
let pendingDeleteVoyageId = null;
const modalDeleteVoyage = document.getElementById("modal-delete-voyage");
const modalDeleteVoyageDesc = document.getElementById("modal-delete-voyage-desc");

async function promptDeleteVoyage(voyageId, voyageTitre) {
  const db = await dbPromise;
  const voyages = await db.getAll("voyages");
  if (voyages.length <= 1) {
    showToast("Impossible de supprimer le seul carnet existant.");
    return;
  }

  pendingDeleteVoyageId = voyageId;
  if (modalDeleteVoyageDesc) {
    modalDeleteVoyageDesc.innerHTML = `Êtes-vous sûr de vouloir supprimer le carnet <strong>« ${voyageTitre} »</strong> ? Toutes les étapes et photos associées seront définitivement supprimées.`;
  }
  showModal(modalDeleteVoyage);
}

document.getElementById("btn-close-delete-voyage")?.addEventListener("click", () => hideModal(modalDeleteVoyage));
document.getElementById("btn-cancel-delete-voyage")?.addEventListener("click", () => hideModal(modalDeleteVoyage));
document.getElementById("modal-delete-voyage-backdrop")?.addEventListener("click", () => hideModal(modalDeleteVoyage));

// Bouton supprimer depuis la modale d'édition
document.getElementById("btn-delete-from-edit")?.addEventListener("click", () => {
  if (!editingVoyageId) return;
  const titre = document.getElementById("edit-voyage-titre").value.trim() || "ce carnet";
  const idToDelete = editingVoyageId;
  hideModal(modalEditVoyage);
  promptDeleteVoyage(idToDelete, titre);
});

// Confirmation définitive de la suppression
document.getElementById("btn-confirm-delete-voyage")?.addEventListener("click", async () => {
  if (!pendingDeleteVoyageId) return;
  const id = pendingDeleteVoyageId;
  hideModal(modalDeleteVoyage);
  await deleteVoyage(id);
  pendingDeleteVoyageId = null;
});

async function deleteVoyage(voyageId) {
  const db = await dbPromise;
  const voyages = await db.getAll("voyages");

  if (voyages.length <= 1) {
    showToast("Impossible de supprimer le seul carnet existant.");
    return;
  }

  const targetVoyage = voyages.find((v) => v.id === voyageId);
  const titre = targetVoyage ? targetVoyage.titre : "Carnet";

  // 1. Supprimer toutes les étapes rattachées à ce voyage
  const allEtapes = await db.getAll("etapes");
  const etapesToDelete = allEtapes.filter((e) => e.voyageId === voyageId);
  for (const etape of etapesToDelete) {
    await db.delete("etapes", etape.id);
  }

  // 2. Supprimer les éléments d'outbox rattachés
  const outboxItems = await db.getAll("outbox");
  for (const item of outboxItems) {
    if (item.data && item.data.voyageId === voyageId) {
      await db.delete("outbox", item.id);
    }
  }

  // 3. Supprimer le carnet lui-même
  await db.delete("voyages", voyageId);

  // 4. Si c'était le carnet actif, basculer sur un carnet restant
  if (currentVoyageId === voyageId) {
    const remaining = (await db.getAll("voyages")).filter((v) => v.id !== voyageId);
    if (remaining.length > 0) {
      await setActiveVoyage(remaining[0].id);
    }
  } else {
    await renderVoyages();
  }

  showToast(`Carnet « ${titre} » supprimé.`);
}

// ============================================================
// 5. GESTION DES PHOTOS DE L'ÉTAPE
// ============================================================

/** Lit et redimensionne une image via canvas pour économiser l'espace IndexedDB */
function readFileAsOptimizedDataUrl(file, maxDimension = 1280) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const etapePhotosCamera = document.getElementById("etape-photos-camera");
const etapePhotosGallery = document.getElementById("etape-photos-gallery");
const etapePhotosPreview = document.getElementById("etape-photos-preview");

async function handleEtapePhotosSelection(files) {
  for (const file of files) {
    try {
      const dataUrl = await readFileAsOptimizedDataUrl(file);
      currentStepPhotos.push(dataUrl);
    } catch (err) {
      console.warn("Échec lecture photo :", err);
    }
  }
  renderStepPhotosPreview();
}

if (etapePhotosCamera) {
  etapePhotosCamera.addEventListener("change", (e) => {
    handleEtapePhotosSelection(Array.from(e.target.files));
    etapePhotosCamera.value = "";
  });
}

if (etapePhotosGallery) {
  etapePhotosGallery.addEventListener("change", (e) => {
    handleEtapePhotosSelection(Array.from(e.target.files));
    etapePhotosGallery.value = "";
  });
}

function renderStepPhotosPreview() {
  if (!etapePhotosPreview) return;
  if (currentStepPhotos.length === 0) {
    etapePhotosPreview.hidden = true;
    etapePhotosPreview.innerHTML = "";
    return;
  }

  etapePhotosPreview.hidden = false;
  etapePhotosPreview.innerHTML = "";

  currentStepPhotos.forEach((dataUrl, idx) => {
    const item = document.createElement("div");
    item.className = "photo-preview-item";

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = `Photo étape ${idx + 1}`;
    item.appendChild(img);

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "photo-preview-remove";
    btnRemove.innerHTML = ICONS.close;
    btnRemove.setAttribute("aria-label", "Supprimer cette photo");
    btnRemove.addEventListener("click", () => {
      currentStepPhotos.splice(idx, 1);
      renderStepPhotosPreview();
    });
    item.appendChild(btnRemove);

    etapePhotosPreview.appendChild(item);
  });
}

// ============================================================
// 6. HYDRATATION DES DESTINATIONS PUBLIQUES (SEO → IndexedDB)
// ============================================================
async function hydrateDestinations() {
  const list = document.getElementById("destinations-list");
  if (!list) return;

  const seeds = [...list.querySelectorAll("[data-seed]")].map((li) => {
    const name = li.querySelector(".destination-card__name");
    const desc = li.querySelector(".destination-card__description");
    const img = li.querySelector(".destination-card__img");
    return {
      nom: name ? name.textContent.trim() : "",
      description: desc ? desc.textContent.trim() : "",
      imgSrc: img ? img.getAttribute("src") : null,
    };
  });

  const db = await dbPromise;
  if (!db) return;

  // Premier lancement uniquement : importer les exemples dans le voyage actif
  if ((await db.count("etapes")) === 0) {
    for (const seed of seeds) {
      await db.add("etapes", {
        voyageId: currentVoyageId || 1,
        titre: seed.nom,
        description: seed.description,
        lat: null,
        lng: null,
        photos: seed.imgSrc ? [seed.imgSrc] : [],
        date: Date.now(),
        synced: true,
      });
    }
  }

  await renderJournal();
}

// ============================================================
// 7. AFFICHAGE DU JOURNAL DEPUIS IndexedDB (Timeline)
// ============================================================
async function renderJournal() {
  const db = await dbPromise;
  if (!db) return;
  const allEtapes = await db.getAll("etapes");
  const list = document.getElementById("journal-list");
  const emptyMsg = document.getElementById("journal-empty");
  if (!list || !emptyMsg) return;

  // Filtrer uniquement les étapes du voyage actif
  const etapes = allEtapes.filter((e) => (e.voyageId || 1) === currentVoyageId);

  if (etapes.length === 0) {
    emptyMsg.hidden = false;
    list.replaceChildren();
    return;
  }

  emptyMsg.hidden = true;

  // Trier par date décroissante
  etapes.sort((a, b) => b.date - a.date);

  const items = etapes.map((etape, index) => {
    const li = document.createElement("li");
    li.className = "journal-entry";

    // Pastille numérotée
    const dot = document.createElement("div");
    dot.className = "journal-entry__dot";
    dot.textContent = index + 1;

    // Carte de contenu
    const card = document.createElement("div");
    card.className = "journal-entry__card";

    // En-tête : titre + date
    const header = document.createElement("div");
    header.className = "journal-entry__header";

    const title = document.createElement("h3");
    title.className = "journal-entry__title";
    title.textContent = etape.titre;

    const dateStr = new Date(etape.date).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const time = document.createElement("time");
    time.className = "journal-entry__time";
    time.textContent = dateStr;

    header.appendChild(title);
    header.appendChild(time);
    card.appendChild(header);

    // Description
    const desc = document.createElement("p");
    desc.className = "journal-entry__desc";
    desc.textContent = etape.description;
    card.appendChild(desc);

    // Galerie de photos attachées à l'étape
    if (etape.photos && etape.photos.length > 0) {
      const photosContainer = document.createElement("div");
      photosContainer.className = "journal-entry__photos";
      etape.photos.forEach((photoUrl, pIdx) => {
        const thumb = document.createElement("div");
        thumb.className = "journal-entry__photo-thumb";
        const img = document.createElement("img");
        img.src = photoUrl;
        img.alt = `Photo ${pIdx + 1} de ${etape.titre}`;
        img.loading = "lazy";
        thumb.appendChild(img);
        photosContainer.appendChild(thumb);
      });
      card.appendChild(photosContainer);
    }

    // Pied de carte : GPS + Statut + Supprimer
    const footer = document.createElement("div");
    footer.className = "journal-entry__footer";

    // Info GPS
    if (etape.lat && etape.lng) {
      const geo = document.createElement("span");
      geo.className = "journal-entry__geo";
      geo.innerHTML = `${ICONS.pin} ${etape.lat.toFixed(4)}, ${etape.lng.toFixed(4)}`;
      footer.appendChild(geo);
    }

    // Statut de synchronisation
    const status = document.createElement("span");
    if (etape.synced === false) {
      status.className = "journal-entry__status journal-entry__status--pending";
      status.innerHTML = `${ICONS.clock} En attente de sync`;
    } else {
      status.className = "journal-entry__status journal-entry__status--synced";
      status.innerHTML = `${ICONS.check} Synchronisé`;
    }
    footer.appendChild(status);

    // Bouton de suppression
    const btnDelete = document.createElement("button");
    btnDelete.className = "btn btn--delete";
    btnDelete.innerHTML = `${ICONS.trash} Supprimer`;
    btnDelete.addEventListener("click", () => deleteEtape(etape.id));
    footer.appendChild(btnDelete);

    card.appendChild(footer);

    li.appendChild(dot);
    li.appendChild(card);
    return li;
  });

  list.replaceChildren(...items);
}

// ============================================================
// 8. AJOUT D'UNE ÉTAPE + BACKGROUND SYNC
// ============================================================
document.getElementById("form-etape")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const titre = document.getElementById("etape-titre").value.trim();
  const description = document.getElementById("etape-description").value.trim();
  const lat = parseFloat(document.getElementById("etape-lat").value) || null;
  const lng = parseFloat(document.getElementById("etape-lng").value) || null;

  if (!titre || !description) return;

  const etape = {
    voyageId: currentVoyageId || 1,
    titre,
    description,
    lat,
    lng,
    photos: [...currentStepPhotos],
    date: Date.now(),
    synced: false,
  };

  const db = await dbPromise;
  const id = await db.add("etapes", etape);
  etape.id = id;

  // 1. Mise à jour IMMÉDIATE de l'interface (Optimistic UI)
  document.getElementById("form-etape").reset();
  document.getElementById("etape-lat").value = "";
  document.getElementById("etape-lng").value = "";
  const geoStatus = document.getElementById("geo-status");
  if (geoStatus) {
    geoStatus.textContent = "";
    geoStatus.className = "form__help";
  }

  currentStepPhotos = [];
  renderStepPhotosPreview();

  // Affichage immédiat de la nouvelle étape dans l'itinéraire
  await renderJournal();
  await renderVoyages();

  // 2. Préparation du payload de synchronisation léger (SANS les lourds blobs Base64)
  const syncPayload = {
    id: etape.id,
    voyageId: etape.voyageId,
    titre: etape.titre,
    description: etape.description,
    lat: etape.lat,
    lng: etape.lng,
    date: etape.date,
    photosCount: etape.photos.length,
  };

  // 3. Synchronisation réseau en tâche de fond
  if (!navigator.onLine) {
    await db.add("outbox", { etapeId: id, data: syncPayload, timestamp: Date.now() });
    registerBackgroundSync();
    showToast("Étape enregistrée hors ligne — synchronisation différée");
    return;
  }

  // En ligne : envoi direct avec timeout court (3.5s)
  try {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(syncPayload),
      signal: controller.signal,
    });
    clearTimeout(timeoutTimer);

    if (response.ok) {
      etape.synced = true;
      await db.put("etapes", etape);
      await renderJournal(); // Passe immédiatement le badge à "Synchronisé"
      showToast("Étape enregistrée et synchronisée !");
    } else {
      throw new Error(`Erreur serveur (${response.status})`);
    }
  } catch (err) {
    console.warn("Synchronisation réseau différée :", err.message);
    await db.add("outbox", { etapeId: id, data: syncPayload, timestamp: Date.now() });
    registerBackgroundSync();
    showToast("Étape enregistrée (en attente de synchronisation)");
  }
});

// ============================================================
// 9. SUPPRESSION D'UNE ÉTAPE
// ============================================================
async function deleteEtape(id) {
  const db = await dbPromise;
  await db.delete("etapes", id);
  await renderJournal();
  await renderVoyages();
  showToast("Étape supprimée");
}

// ============================================================
// 10. GÉOLOCALISATION
// ============================================================
document.getElementById("btn-geo")?.addEventListener("click", () => {
  const geoStatus = document.getElementById("geo-status");
  if (!geoStatus) return;

  if (!("geolocation" in navigator)) {
    geoStatus.textContent = "La géolocalisation n'est pas disponible sur cet appareil.";
    geoStatus.className = "form__help error";
    return;
  }

  geoStatus.textContent = "Recherche de votre position GPS...";
  geoStatus.className = "form__help";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      document.getElementById("etape-lat").value = latitude.toFixed(6);
      document.getElementById("etape-lng").value = longitude.toFixed(6);
      geoStatus.textContent = `Position trouvée : ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      geoStatus.className = "form__help success";
    },
    (error) => {
      let message = "";
      switch (error.code) {
        case error.PERMISSION_DENIED:
          message = "Localisation refusée. Autorisez le GPS dans les paramètres de votre navigateur.";
          break;
        case error.POSITION_UNAVAILABLE:
          message = "Position indisponible. Vérifiez que le GPS est activé.";
          break;
        case error.TIMEOUT:
          message = "Délai dépassé. Réessayez avec une meilleure réception.";
          break;
        default:
          message = "Impossible de récupérer la position.";
      }
      geoStatus.textContent = message;
      geoStatus.className = "form__help error";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
});

// Enregistrement Background Sync helper
async function registerBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) {
      await reg.sync.register("sync-etapes");
    }
  } catch (syncErr) {
    console.warn("Background Sync non supporté :", syncErr);
  }
}

// ============================================================
// 11. DÉTECTION RÉSEAU + SYNCHRONISATION UNIVERSELLE
// ============================================================
async function syncOutbox() {
  try {
    const db = await dbPromise;
    const pending = await db.getAll("outbox");
    if (pending.length === 0) return;

    let syncedAny = false;

    for (const item of pending) {
      try {
        const controller = new AbortController();
        const timeoutTimer = setTimeout(() => controller.abort(), 3500);

        const response = await fetch(API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.data),
          signal: controller.signal,
        });
        clearTimeout(timeoutTimer);

        if (response.ok) {
          const etape = await db.get("etapes", item.etapeId);
          if (etape) {
            etape.synced = true;
            await db.put("etapes", etape);
          }
          await db.delete("outbox", item.id);
          syncedAny = true;
        }
      } catch (fetchErr) {
        console.warn("Échec synchronisation outbox item :", fetchErr);
        break;
      }
    }

    if (syncedAny) {
      await renderJournal();
      showToast("Données synchronisées avec succès !");
    }
  } catch (err) {
    console.error("Erreur syncOutbox :", err);
  }
}

// Écouter les messages du Service Worker (Background Sync terminé)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SYNC_COMPLETE") {
      renderJournal();
    }
  });
}

window.addEventListener("online", () => {
  showNetworkStatus("is-online", "Connexion rétablie");
  syncOutbox();
});

window.addEventListener("offline", () => {
  showNetworkStatus("is-offline", "Mode hors ligne — actions synchronisées au retour");
});

// ============================================================
// 12. UTILITAIRES D'INTERFACE (Toasts & Statut Réseau)
// ============================================================
function showToast(message, duration = 3500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function showNetworkStatus(typeClass, text) {
  const el = document.getElementById("network-status");
  const textEl = document.getElementById("network-status-text");
  if (!el || !textEl) return;

  el.className = `network-status ${typeClass}`;
  textEl.textContent = text;
  el.hidden = false;

  clearTimeout(showNetworkStatus._timer);
  showNetworkStatus._timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

// ============================================================
// 13. INITIALISATION AU DÉMARRAGE
// ============================================================
(async function init() {
  try {
    await initServiceWorker();
  } catch (err) {
    console.warn("[SW] Erreur initialisation :", err);
  }

  try {
    await initVoyages();
  } catch (err) {
    console.warn("[Voyages] Erreur initialisation :", err);
  }

  try {
    await hydrateDestinations();
  } catch (err) {
    console.warn("[Hydratation] Erreur initialisation :", err);
  }

  if (!navigator.onLine) {
    showNetworkStatus("is-offline", "Vous êtes hors ligne");
  }
})();
