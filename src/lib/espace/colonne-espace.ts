import { pluriel, quand } from "@/lib/commun/format";
import type { EspaceResume, Signal } from "./suivi-types";

/**
 * Mission 18 (A1) — les textes de la colonne « Espace » de Dossiers (l'ancien onglet Espaces clients) : le lien et la
 * visite, ce que le client a fait, le signal le plus pressant. Fonctions pures, partagées par la liste, la ligne du
 * téléphone, la carte du kanban et l'assistant (« lister » DOSSIERS) : un seul texte partout.
 */

/** Le lien et la dernière visite du projet : « vu hier (4 visites) », « lien envoyé il y a 3 jours, jamais ouvert »… */
export function visiteEspace(espace: Pick<EspaceResume, "revoque" | "dernierAccesLe" | "nbAcces" | "lienEnvoyeLe">, maintenant: Date | number): string {
  if (espace.revoque) return "lien désactivé";
  if (espace.dernierAccesLe) return `vu ${quand(espace.dernierAccesLe, maintenant)}${espace.nbAcces > 1 ? ` (${pluriel(espace.nbAcces, "visite")})` : ""}`;
  if (espace.lienEnvoyeLe) return `lien envoyé ${quand(espace.lienEnvoyeLe, maintenant)}, jamais ouvert`;
  return "lien pas encore envoyé";
}

/** Ce que le client a fait dans son espace : photos, simulations, devis relu (ou son accord). */
export function faitsEspace(espace: Pick<EspaceResume, "photos" | "simulations" | "devis" | "accord">): string[] {
  const devis = espace.accord ? "accord donné" : espace.devis ? (espace.devis.consultations > 0 ? `devis lu ${espace.devis.consultations} fois` : "devis pas encore ouvert") : null;
  return [espace.photos > 0 ? pluriel(espace.photos, "photo") : null, espace.simulations > 0 ? pluriel(espace.simulations, "simulation") : null, devis].filter((texte): texte is string => Boolean(texte));
}

/** Le signal qui demande un geste, le plus pressant d'abord (rouge, puis ambre) ; le gris n'en est pas un. */
export function signalPrincipal(espace: Pick<EspaceResume, "signaux">): Signal | null {
  return espace.signaux.find((s) => s.ton === "rouge") ?? espace.signaux.find((s) => s.ton === "ambre") ?? null;
}

const QUI: Record<EspaceResume["attente"]["qui"], string> = { MOI: "à moi", CLIENT: "chez le client", PERSONNE: "rien en attente" };

/** Tout l'état, en une phrase : l'infobulle de la colonne, et la ligne de l'assistant. */
export function descriptionEspace(espace: EspaceResume, maintenant: Date | number): string {
  const signaux = espace.signaux.filter((s) => s.ton !== "gris").map((s) => s.libelle);
  return [espace.etapeLibelle, visiteEspace(espace, maintenant), ...faitsEspace(espace), `${QUI[espace.attente.qui]} : ${espace.attente.libelle}`, ...(signaux.length ? [`signaux : ${signaux.join(", ")}`] : [])].join(" · ");
}
