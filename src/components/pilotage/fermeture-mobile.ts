"use client";

import { useEffect, useRef, useState, type CSSProperties, type TouchEvent } from "react";

/**
 * Fermer un panneau au pouce, sur téléphone.
 *
 * 1. Le geste « retour » (bord gauche sur iPhone, bouton retour sur Android,
 *    bouton précédent de l'ordinateur) ferme le panneau du dessus, et
 *    seulement lui : chaque panneau ouvert ajoute une entrée à l'historique.
 *    Fermé par un bouton, il retire son entrée — sauf si l'on a quitté l'écran
 *    entre-temps (un lien suivi depuis le panneau n'est jamais annulé).
 * 2. Glisser pour fermer : depuis le bord gauche vers la droite (panneaux
 *    latéraux, écrans plein écran), ou vers le bas (fenêtres, depuis leur
 *    barre de titre).
 */

const pile: { id: number; fermer: () => void }[] = [];
/** Panneaux dont l'entrée d'historique existe encore, dans l'ordre. */
const dansHistorique: number[] = [];
let compteur = 0;
let ecoute = false;
let synchronisationPrevue = false;

const panneauCourant = () => Number((window.history.state as { panneau?: number } | null)?.panneau) || 0;

function surRetour(evenement: PopStateEvent) {
  const niveau = Number((evenement.state as { panneau?: number } | null)?.panneau) || 0;
  while (dansHistorique.length > 0 && dansHistorique[dansHistorique.length - 1] > niveau) dansHistorique.pop();
  while (pile.length > 0 && pile[pile.length - 1].id > niveau) pile.pop()!.fermer();
}

function synchroniser() {
  synchronisationPrevue = false;
  const haut = pile.length > 0 ? pile[pile.length - 1].id : 0;
  // On a navigué ailleurs depuis (lien suivi dans le panneau) : ne rien défaire, oublier nos entrées.
  const surNosEntrees = dansHistorique.length > 0 && panneauCourant() === dansHistorique[dansHistorique.length - 1];
  let entrees = 0;
  while (dansHistorique.length > 0 && dansHistorique[dansHistorique.length - 1] > haut) {
    dansHistorique.pop();
    entrees++;
  }
  if (entrees > 0 && surNosEntrees) window.history.go(-entrees);
}

/** Le panneau ouvert répond au geste retour ; fermé autrement, son entrée d'historique s'efface. */
export function useRetourFerme(ouvert: boolean, fermer: () => void): void {
  const rappel = useRef(fermer);
  useEffect(() => {
    rappel.current = fermer;
  });
  useEffect(() => {
    if (!ouvert) return;
    const entree = { id: ++compteur, fermer: () => rappel.current() };
    pile.push(entree);
    dansHistorique.push(entree.id);
    // L'état de Next est gardé (sinon son routeur recharge la page au retour).
    window.history.pushState({ ...(window.history.state ?? {}), panneau: entree.id }, "");
    if (!ecoute) {
      window.addEventListener("popstate", surRetour);
      ecoute = true;
    }
    return () => {
      const rang = pile.indexOf(entree);
      if (rang < 0) return; // déjà fermé par le geste retour
      pile.splice(rang, 1);
      if (!synchronisationPrevue) {
        synchronisationPrevue = true;
        window.setTimeout(synchroniser, 0);
      }
    };
  }, [ouvert]);
}

/**
 * Glisser pour fermer. `droite` : le geste part du bord gauche (28 px), comme
 * le retour d'iOS ; `bas` : il part de l'élément qui porte les gestionnaires
 * (une barre de titre). Au-delà de 90 px, le panneau se ferme ; en deçà, il
 * revient en place.
 */
export function useGlisserPourFermer(fermer: () => void, sens: "droite" | "bas" = "droite") {
  const depart = useRef<{ x: number; y: number; actif: boolean } | null>(null);
  const [decalage, setDecalage] = useState(0);
  const gestionnaires = {
    onTouchStart: (evenement: TouchEvent<HTMLElement>) => {
      const t = evenement.touches[0];
      if (sens === "droite") {
        const cadre = evenement.currentTarget.getBoundingClientRect();
        if (t.clientX - cadre.left > 28) return;
      }
      depart.current = { x: t.clientX, y: t.clientY, actif: true };
    },
    onTouchMove: (evenement: TouchEvent<HTMLElement>) => {
      const d = depart.current;
      if (!d?.actif) return;
      const t = evenement.touches[0];
      const avance = sens === "droite" ? t.clientX - d.x : t.clientY - d.y;
      const travers = Math.abs(sens === "droite" ? t.clientY - d.y : t.clientX - d.x);
      if (avance > 8 && avance > travers * 1.2) setDecalage(avance);
      else if (avance < -4 || (travers > 24 && avance < travers)) {
        d.actif = false;
        setDecalage(0);
      }
    },
    onTouchEnd: () => {
      if (decalage > 90) fermer();
      setDecalage(0);
      depart.current = null;
    },
    onTouchCancel: () => {
      setDecalage(0);
      depart.current = null;
    },
  };
  const style: CSSProperties | undefined = decalage ? { transform: sens === "droite" ? `translateX(${decalage}px)` : `translateY(${decalage}px)`, transition: "none" } : undefined;
  return { gestionnaires, style };
}
