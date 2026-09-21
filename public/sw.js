/*
 * Service worker du CRM CoverSwap (applications installées « CoverSwap » et « Messages »).
 *
 * Trois rôles, et rien d'autre :
 *  1. NOTIFICATIONS : afficher un push reçu, poser le badge de l'icône, et ouvrir
 *     directement l'écran concerné quand on tape dessus (la conversation, la
 *     fiche, la file de validation).
 *  2. RÉSEAU MÉDIOCRE : l'interface s'affiche tout de suite (fichiers de
 *     l'application gardés en cache), les données arrivent ensuite.
 *  3. COUPURE : la dernière version connue d'un écran s'affiche, sinon une page
 *     « hors ligne ». Les envois, eux, sont mis en file par l'écran lui-même.
 *
 * Jamais mis en cache : la connexion, les webhooks, le flux temps réel, tout ce
 * qui n'est pas une lecture (GET). Une réponse qui redirige vers la page de
 * connexion n'est jamais gardée.
 */
const VERSION = "v4";
const CACHE_APPLICATION = `application-${VERSION}`;
const CACHE_ECRANS = `ecrans-${VERSION}`;
const CACHE_DONNEES = `donnees-${VERSION}`;
const HORS_LIGNE = "/hors-ligne.html";
const EN_LOCAL = ["localhost", "127.0.0.1"].includes(self.location.hostname);

// Lectures utiles hors ligne : la liste des conversations, un fil, le pilotage commercial, les compteurs.
const DONNEES_GARDEES = [/^\/api\/sms\/conversations/, /^\/api\/commercial\/pilotage$/, /^\/api\/pilotage\/compteurs$/];
const JAMAIS = [/^\/api\/auth\//, /^\/auth\//, /^\/api\/sms\/flux/, /^\/api\/webhook/, /^\/api\/espace\//, /^\/api\/cron\//, /^\/_next\/webpack-hmr/, /^\/api\/push\//];

self.addEventListener("install", (evenement) => {
  self.skipWaiting();
  evenement.waitUntil(caches.open(CACHE_ECRANS).then((cache) => cache.add(new Request(HORS_LIGNE, { cache: "reload" }))).catch(() => undefined));
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    (async () => {
      const gardes = [CACHE_APPLICATION, CACHE_ECRANS, CACHE_DONNEES];
      for (const nom of await caches.keys()) if (!gardes.includes(nom)) await caches.delete(nom);
      await self.clients.claim();
    })()
  );
});

const avecDelai = (promesse, ms) => Promise.race([promesse, new Promise((_, rejeter) => setTimeout(() => rejeter(new Error("délai")), ms))]);

/** Réponse gardable : réussie, et pas une redirection vers la page de connexion. */
const gardable = (reponse) => reponse && reponse.ok && !reponse.redirected && reponse.type === "basic";

/**
 * Le réseau d'abord, la dernière version connue ensuite.
 * Quand une version connue existe, on n'attend le réseau que `delaiSiConnueMs` :
 * sur une connexion qui traîne, l'écran s'affiche tout de suite et la réponse,
 * quand elle finit par arriver, met le cache à jour pour la fois suivante.
 * `souple` : à défaut de la même adresse, la même lecture avec d'autres paramètres
 * (un écran ouvert avec ?c=…, un fil lu avec ?lu=0).
 */
async function prevenirLEcran(evenement) {
  const ecran = evenement.clientId ? await self.clients.get(evenement.clientId) : null;
  if (ecran) ecran.postMessage({ type: "servi-depuis-le-cache" });
}

async function reseauPuisCache(evenement, nomCache, { delaiMs, delaiSiConnueMs = delaiMs, souple = false, prevenir = false }) {
  const requete = evenement.request;
  const cache = await caches.open(nomCache);
  const connue = (await cache.match(requete, { ignoreVary: true })) || (souple ? await cache.match(requete, { ignoreVary: true, ignoreSearch: true }) : undefined);
  const reseau = fetch(requete).then((reponse) => {
    if (gardable(reponse)) cache.put(requete, reponse.clone()).catch(() => undefined);
    return reponse;
  });
  // La réponse tardive doit pouvoir finir d'arriver même si l'écran est déjà servi depuis le cache.
  evenement.waitUntil(reseau.catch(() => undefined));
  try {
    const reponse = await avecDelai(reseau, connue ? delaiSiConnueMs : delaiMs);
    // Serveur en cours de redémarrage (502, 503, 504) : même traitement qu'une coupure.
    if (reponse.status >= 502 && reponse.status <= 504) throw new Error(`serveur indisponible (${reponse.status})`);
    return reponse;
  } catch (erreur) {
    if (!connue) throw erreur;
    if (prevenir) await prevenirLEcran(evenement).catch(() => undefined);
    return connue;
  }
}

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  if (JAMAIS.some((motif) => motif.test(url.pathname))) return;

  // Fichiers de l'application (noms uniques par version) et icônes : le cache d'abord.
  // Sur le poste de développement, le réseau d'abord : un fichier modifié ne doit jamais rester figé.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icones/")) {
    if (EN_LOCAL) {
      evenement.respondWith(reseauPuisCache(evenement, CACHE_APPLICATION, { delaiMs: 8000 }));
      return;
    }
    evenement.respondWith(
      caches.open(CACHE_APPLICATION).then(async (cache) => {
        const connue = await cache.match(requete);
        if (connue) return connue;
        const reponse = await fetch(requete);
        if (reponse.ok) cache.put(requete, reponse.clone()).catch(() => undefined);
        return reponse;
      })
    );
    return;
  }

  // Un écran : le réseau d'abord — 2,5 s s'il est déjà connu, 8 s sinon —, puis sa dernière version, sinon la page hors ligne.
  if (requete.mode === "navigate") {
    evenement.respondWith(
      reseauPuisCache(evenement, CACHE_ECRANS, { delaiMs: 8000, delaiSiConnueMs: 2500, souple: true }).catch(async () => {
        const cache = await caches.open(CACHE_ECRANS);
        return (await cache.match(HORS_LIGNE)) || Response.error();
      })
    );
    return;
  }

  if (DONNEES_GARDEES.some((motif) => motif.test(url.pathname))) {
    // Un fil se relit avec ou sans ?lu=0 : même lecture. Une liste filtrée, elle, ne vaut que pour son filtre.
    const unFil = /^\/api\/sms\/conversations\/[^/]+$/.test(url.pathname);
    evenement.respondWith(reseauPuisCache(evenement, CACHE_DONNEES, { delaiMs: 8000, souple: unFil, prevenir: true }));
  }
});

/* ── Notifications ─────────────────────────────────────────────────── */

self.addEventListener("push", (evenement) => {
  let charge = {};
  try {
    charge = evenement.data ? evenement.data.json() : {};
  } catch (erreur) {
    charge = { titre: "CoverSwap", texte: evenement.data ? evenement.data.text() : "" };
  }
  const titre = charge.titre || "CoverSwap";
  evenement.waitUntil(
    (async () => {
      await self.registration.showNotification(titre, {
        body: charge.texte || "",
        tag: charge.etiquette || undefined,
        renotify: Boolean(charge.etiquette),
        icon: "/icones/crm-192.png",
        badge: "/icones/pastille-96.png",
        data: { lien: charge.lien || "/" },
      });
      if (typeof charge.badge === "number" && "setAppBadge" in self.navigator) {
        await (charge.badge > 0 ? self.navigator.setAppBadge(charge.badge) : self.navigator.clearAppBadge()).catch(() => undefined);
      }
    })()
  );
});

// Un tap ouvre directement l'écran concerné : la conversation, la fiche, la relance à valider.
self.addEventListener("notificationclick", (evenement) => {
  evenement.notification.close();
  const lien = new URL((evenement.notification.data && evenement.notification.data.lien) || "/", self.location.origin);
  // Un lien vers la messagerie du CRM s'ouvre dans l'application « Messages » quand c'est elle qui est ouverte.
  evenement.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const fenetre of fenetres) {
        const dansMessages = new URL(fenetre.url).pathname.startsWith("/messagerie");
        const cible = dansMessages && lien.pathname === "/sms" ? `/messagerie${lien.search}` : lien.pathname + lien.search;
        try {
          await fenetre.focus();
          if ("navigate" in fenetre) await fenetre.navigate(cible);
          return;
        } catch (erreur) {
          // Fenêtre qui refuse la navigation : on en ouvre une autre.
        }
      }
      await self.clients.openWindow(lien.pathname + lien.search);
    })()
  );
});
