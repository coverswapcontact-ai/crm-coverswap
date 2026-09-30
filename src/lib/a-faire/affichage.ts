import { accord } from "@/lib/commun/format";
import { LIBELLES_RAISON_PAS_A_FAIRE, LIBELLES_RAISON_PLUS_TARD, type RaisonPasAFaire, type RaisonPlusTard, type TacheVue } from "./types";

/**
 * Mission 17 (partie A) — les textes de l'écran Tâches (pur : importable par l'écran comme par les essais). Pas de
 * code, pas d'identifiant, pas de jargon ; les pluriels se calculent ; heure de Paris.
 */

const PARIS = "Europe/Paris";

/** « 10 min », « 1 h », « 1 h 05 ». */
export function dureeLisible(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const heures = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${heures} h ${String(reste).padStart(2, "0")}` : `${heures} h`;
}

/** « J'ai 5 min », « J'ai 1 h ». */
export const libelleChoixMinutes = (minutes: number) => (minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`);

/** Le sous-titre de l'écran : « 7 aujourd'hui · environ 45 min », « Rien pour aujourd'hui ». */
export function sousTitreTaches(compteurs: { aujourdhui: number; minutesAujourdhui: number }): string {
  if (compteurs.aujourdhui === 0) return "Rien pour aujourd'hui";
  return `${compteurs.aujourdhui} aujourd'hui · environ ${dureeLisible(compteurs.minutesAujourdhui)}`;
}

/** Le nom dans « Appeler · Nom » (tout le titre s'il n'y a pas de « · »). */
export function nomDuTitre(titre: string): string {
  const parties = titre.split(" · ");
  return parties.length > 1 ? parties.slice(1).join(" · ").trim() : titre.trim();
}

function partiesParis(date: Date) {
  const lire = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, ...options }).format(date);
  const jour = new Intl.DateTimeFormat("sv-SE", { timeZone: PARIS, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const heure = Number(new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, hour: "2-digit", hour12: false }).format(date)) % 24;
  const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, minute: "2-digit" }).format(date));
  return { jour, heure, minute, lire };
}

const ecartJours = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** « 9 h », « 18 h 30 ». */
function heureLisible(heure: number, minute: number): string {
  return minute ? `${heure} h ${String(minute).padStart(2, "0")}` : `${heure} h`;
}

/**
 * Le moment d'un retour, heure de Paris : « ce soir 18 h », « aujourd'hui 14 h », « demain 9 h », « lundi 9 h » (dans la
 * semaine), « le 12 oct. 9 h » au-delà.
 */
export function momentLisible(iso: string, maintenant: Date): string {
  const date = new Date(iso);
  const cible = partiesParis(date);
  const ici = partiesParis(maintenant);
  const ecart = ecartJours(ici.jour, cible.jour);
  const h = heureLisible(cible.heure, cible.minute);
  if (ecart === 0) return cible.heure >= 18 ? `ce soir ${h}` : `aujourd'hui ${h}`;
  if (ecart === 1) return `demain ${h}`;
  if (ecart > 1 && ecart < 7) return `${cible.lire({ weekday: "long" })} ${h}`;
  return `le ${cible.lire({ day: "numeric", month: "short" })} ${h}`;
}

/** « à 10:12 » : l'heure d'une réponse du jour. */
export function heureDe(iso: string): string {
  const p = partiesParis(new Date(iso));
  return `${String(p.heure).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** La ligne grise d'une tâche à faire : sa raison ; pour une reportée, quand elle revient (et pourquoi elle attend). */
export function ligneGrise(tache: Pick<TacheVue, "raison" | "statut" | "plusTardJusqua" | "reponseRaison" | "raccourci">, maintenant: Date): string {
  if (tache.statut === "PLUS_TARD" && tache.plusTardJusqua && Date.parse(tache.plusTardJusqua) > maintenant.getTime()) {
    const attente = tache.reponseRaison && tache.reponseRaison in LIBELLES_RAISON_PLUS_TARD ? ` · ${LIBELLES_RAISON_PLUS_TARD[tache.reponseRaison as RaisonPlusTard].toLowerCase()}` : "";
    return `revient ${momentLisible(tache.plusTardJusqua, maintenant)}${attente}`;
  }
  // Une page du CRM ou externe (réglage, jeton) : la marche à suivre, en une ligne.
  if (tache.raccourci.genre === "PAGE" && tache.raccourci.marche) return tache.raccourci.marche;
  return tache.raison;
}

/**
 * Ce qui a été fait aujourd'hui, en une ligne : la raison d'une coche du CRM (« coché par le CRM : devis 2026-043
 * déposé »), sinon qui a répondu, à quelle heure, et pourquoi pour « Pas à faire ».
 */
export function ligneFaite(tache: Pick<TacheVue, "statut" | "reponse" | "reponseRaison" | "reponseTexte" | "reponduLe" | "reponduParLisible">): string {
  const qui = tache.reponduParLisible ?? "Lucas";
  const quand = tache.reponduLe ? ` à ${heureDe(tache.reponduLe)}` : "";
  if (qui === "le CRM") return tache.reponseTexte?.trim() || `coché par le CRM${quand}`;
  if (tache.statut === "PAS_A_FAIRE") {
    const raison = tache.reponseRaison && tache.reponseRaison in LIBELLES_RAISON_PAS_A_FAIRE ? LIBELLES_RAISON_PAS_A_FAIRE[tache.reponseRaison as RaisonPasAFaire] : null;
    const precision = tache.reponseTexte?.trim();
    return `pas à faire${raison ? ` : ${raison.toLowerCase()}` : ""}${precision && precision !== raison ? ` (${precision})` : ""} · ${qui}${quand}`;
  }
  return `fait par ${qui}${quand}`;
}

/** « Demain : 3 tâches reviennent », « Demain : 1 tâche revient », « Rien de prévu demain ». */
export function texteDemain(nombre: number): string {
  if (nombre <= 0) return "Rien de prévu pour demain";
  return `Demain : ${nombre} ${accord(nombre, "tâche")} ${nombre > 1 ? "reviennent" : "revient"}`;
}

/** « Commencer · 7 tâches · 45 min » (tient sur un téléphone ; le sous-titre dit déjà « environ »). */
export function libelleCommencer(nombre: number, minutes: number): string {
  return `Commencer · ${nombre} ${accord(nombre, "tâche")} · ${dureeLisible(minutes)}`;
}
