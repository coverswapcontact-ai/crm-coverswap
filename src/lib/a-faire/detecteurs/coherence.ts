import type { Incoherence, RapportCoherence } from "@/lib/coherence/controle";
import { PREFIXE_COCHE } from "../achevement";
import type { Detection, Raccourci } from "../types";
import { court, depuisDe, tachesOuvertesDe } from "./ouvertes";
import type { Achevement, ContexteDetection, Detecteur } from "./types";

/**
 * Mission 17 (partie A, lot 2) : détecteur COHERENCE — les incohérences du contrôle (coherence/controle.ts), une tâche
 * « Corriger · Nom » par incohérence (niveau 5, 1 min), clé `COHERENCE:<clé de l'incohérence>` (stable d'un contrôle à
 * l'autre : `MAIN_DECALEE:<dossierId>`…). Sujet : le dossier, sinon le lead. Raccourci COHERENCE (`cleCoherence`,
 * « corriger en un geste ») quand l'incohérence a une correction, sinon la fiche du dossier ou du lead.
 *
 * - MAIL_SANS_REPONSE n'est pas rendu : les tâches « Répondre » (sources MAIL, ESPACE_MESSAGES) le couvrent déjà.
 * - Les dossiers dont la prochaine action manuelle est en vigueur sont écartés par le moteur (moteur.ts).
 * - `controlerCoherence()` est coûteux (plusieurs requêtes par dossier) : son rapport est gardé en mémoire
 *   (globalThis) au plus une heure ; `corrigerIncoherence` l'invalide (`invaliderCoherence`) après une correction.
 * - Achèvement : la clé disparaît du rapport ; `acheves` dit alors « incohérence corrigée ».
 */

/** Un rapport au plus une heure (temps réel : c'est le coût du contrôle qu'on épargne, pas une règle métier). */
export const DUREE_CACHE_COHERENCE_MS = 60 * 60_000;
const CLE_CACHE = "__coverswapTachesCoherence";
type Cache = { lu: number; rapport: Promise<RapportCoherence> };
const memoire = globalThis as unknown as Record<string, Cache | undefined>;

/** Oublie le rapport gardé : le prochain passage rejoue le contrôle (après une correction, ou dans les essais). */
export function invaliderCoherence(): void {
  memoire[CLE_CACHE] = undefined;
}

/** Le rapport de cohérence, rejoué au plus une fois par heure. Un contrôle en échec n'est pas gardé. */
export async function rapportCoherence(): Promise<RapportCoherence> {
  const cache = memoire[CLE_CACHE];
  if (cache && Date.now() - cache.lu < DUREE_CACHE_COHERENCE_MS) return cache.rapport;
  const { controlerCoherence } = await import("@/lib/coherence/controle");
  const rapport = controlerCoherence();
  const entree: Cache = { lu: Date.now(), rapport };
  memoire[CLE_CACHE] = entree;
  rapport.catch(() => {
    if (memoire[CLE_CACHE] === entree) invaliderCoherence();
  });
  return rapport;
}

/**
 * Recoupe les tâches « Répondre » : pas de seconde tâche pour le même mail. Mission 18 (B13) : un PDF parti de Gmail à
 * enregistrer a déjà sa tâche « Enregistrer comme devis envoyé » (détecteur des dossiers, un geste) : pas de seconde.
 */
export const CODES_ECARTES: readonly string[] = ["MAIL_SANS_REPONSE", "DEVIS_GMAIL_NON_ENREGISTRE"];

/** « Le devis 2026-043 vaut 0 € » : le constat jusqu'à sa première explication (« : … », « . … »), 140 caractères au plus. */
export function constatCourt(constat: string): string {
  const coupe = /\s:\s|\.\s/.exec(constat);
  const debut = coupe && coupe.index >= 20 ? constat.slice(0, coupe.index) : constat.replace(/\.$/, "");
  return court(debut);
}

const cleDe = (i: Pick<Incoherence, "cle">) => `COHERENCE:${i.cle}`;

function detectionDe(i: Incoherence, depuis: Date): Detection {
  // Un dossier clos (perdu ou archivé, espace resté ouvert) n'est pas le sujet : la tâche serait écartée comme « sujet disparu ».
  const dossierVivant = i.code === "ESPACE_ACTIF_DOSSIER_CLOS" && i.leadId ? null : i.dossierId;
  const sujet = dossierVivant ? ({ type: "DOSSIER", id: dossierVivant } as const) : i.leadId ? ({ type: "LEAD", id: i.leadId } as const) : ({ type: "DOSSIER", id: i.dossierId } as const);
  const fiche: Raccourci = i.dossierId
    ? { genre: "DOSSIER", libelle: "Ouvrir le dossier", dossierId: i.dossierId, href: `/dossiers?dossier=${i.dossierId}` }
    : { genre: "LEAD", libelle: "Ouvrir la fiche", leadId: i.leadId, href: i.leadId ? `/leads?lead=${i.leadId}` : null };
  const raccourci: Raccourci = i.correction ? { genre: "COHERENCE", libelle: court(i.correction, 80), cleCoherence: i.cle, dossierId: i.dossierId, href: fiche.href } : fiche;
  return {
    cle: cleDe(i),
    type: "COHERENCE",
    source: "COHERENCE",
    sujet,
    dossierId: dossierVivant,
    leadId: i.leadId,
    titre: `Corriger · ${i.client || "sans nom"}`,
    raison: constatCourt(i.constat),
    niveau: 5,
    depuis,
    raccourci,
    donnees: { code: i.code, gravite: i.gravite, constat: i.constat },
  };
}

type Analyse = { detections: Detection[]; acheves: Achevement[] };
const analyses = new WeakMap<ContexteDetection, Promise<Analyse>>();

async function analyser(contexte: ContexteDetection): Promise<Analyse> {
  const [rapport, ouvertes] = await Promise.all([rapportCoherence(), tachesOuvertesDe("COHERENCE")]);
  const retenues = rapport.incoherences.filter((i) => !CODES_ECARTES.includes(i.code) && (i.dossierId || i.leadId));
  const detections = retenues.map((i) => detectionDe(i, depuisDe(ouvertes, cleDe(i), contexte.maintenant)));
  const presentes = new Set(rapport.incoherences.map(cleDe));
  const acheves = [...ouvertes.keys()].filter((c) => !presentes.has(c)).map((c) => ({ cle: c, texte: `${PREFIXE_COCHE}incohérence corrigée` }));
  return { detections, acheves };
}

function analyse(contexte: ContexteDetection): Promise<Analyse> {
  let enCours = analyses.get(contexte);
  if (!enCours) {
    enCours = analyser(contexte);
    analyses.set(contexte, enCours);
  }
  return enCours;
}

export const detecteurCoherence: Detecteur = {
  source: "COHERENCE",
  async detecter(contexte) {
    return (await analyse(contexte)).detections;
  },
  async acheves(contexte) {
    return (await analyse(contexte)).acheves;
  },
};
