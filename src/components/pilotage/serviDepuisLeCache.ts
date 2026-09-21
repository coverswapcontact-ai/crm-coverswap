/**
 * Le service worker prévient l'écran quand il a répondu avec une lecture gardée
 * en mémoire à la place du serveur (coupure, réseau trop lent, redémarrage) :
 * l'écran affiche alors « hors ligne » au lieu de laisser croire que tout est à jour.
 */
const SIGNAL = "servi-depuis-le-cache";
let dernierSignal = 0;

/** Vrai si une lecture vient d'être servie depuis la mémoire (deux secondes de marge : le signal et la réponse se croisent). */
export function vientDuCache(): boolean {
  return Date.now() - dernierSignal < 2000;
}

export function ecouterLeCache(surCache: () => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  const recevoir = (evenement: MessageEvent) => {
    if ((evenement.data as { type?: string } | null)?.type !== SIGNAL) return;
    dernierSignal = Date.now();
    surCache();
  };
  navigator.serviceWorker.addEventListener("message", recevoir);
  return () => navigator.serviceWorker.removeEventListener("message", recevoir);
}
