import type { TacheAFaire } from "@prisma/client";
import prisma from "@/lib/prisma";
import { jourMois, PREFIXE_COCHE } from "../achevement";
import { lireObjet, texteOuNull } from "../json";
import type { Achevement, Detecteur } from "./types";

/**
 * Mission 17 (partie A, lot 2) : détecteur MANUELLE — les tâches ajoutées par Lucas ou Claude (`reponses.ts ›
 * ajouterTache`) ou par la migration de mise en route. `detecter` ne rend rien (une tâche à moi n'est jamais cochée par
 * absence) ; `acheves` rend les tâches MANUELLE À faire ou Plus tard dont la condition (`donnees.condition`) est
 * remplie, avec la preuve lue en base : « coché par le CRM : moteur du simulateur passé en V2 ».
 *
 * `donnees.condition` : un code de `CONDITIONS_MANUELLES`, tel quel (`"SIMULATEUR_V2"`) ou dans un objet
 * (`{ code: "SIMULATEUR_V2" }`, la forme qu'accepte `ajouterTache`). Un code inconnu est ignoré (réponse à la main).
 * Lecture seule, jamais de réseau : chaque condition se lit en base, en mémoire ou dans l'environnement (présence seule).
 */

export const CONDITIONS_MANUELLES = ["SIMULATEUR_V2", "BANC_LANCE", "CALENDAR_ACTIVE", "AVIS_GOOGLE", "TARIFS_COMPLETS", "SOLDE_OPENAI_NOTE", "REALISATION_PUBLIEE", "JETON_META"] as const;
export type ConditionManuelle = (typeof CONDITIONS_MANUELLES)[number];

/** Ce que chaque condition attend, en une phrase (pour la migration de mise en route et les outils). */
export const LIBELLES_CONDITION: Record<ConditionManuelle, string> = {
  SIMULATEUR_V2: "le paramètre SIMULATEUR_MOTEUR vaut V2",
  BANC_LANCE: "une campagne du banc de comparaison a produit des rendus",
  CALENDAR_ACTIVE: "Google est connecté avec l'agenda et plus aucune tâche d'agenda n'attend l'activation de l'API (accessNotConfigured)",
  AVIS_GOOGLE: "GOOGLE_PLACES_API_KEY et GOOGLE_PLACE_ID sont posées",
  TARIFS_COMPLETS: "chaque sous-partie au métrage a un prix public",
  SOLDE_OPENAI_NOTE: "un solde OpenAI (SIMULATEUR_CREDIT_OPENAI) a été noté après la tâche",
  REALISATION_PUBLIEE: "une réalisation est publiée sur le site",
  JETON_META: "le jeton Meta n'est plus refusé",
};

/** Le code d'une condition (texte, ou objet `{ code }`), s'il est connu. */
export function codeDeCondition(condition: unknown): ConditionManuelle | null {
  const code = texteOuNull(condition) ?? (condition && typeof condition === "object" ? texteOuNull((condition as Record<string, unknown>).code) : null);
  return code && (CONDITIONS_MANUELLES as readonly string[]).includes(code) ? (code as ConditionManuelle) : null;
}

type Verification = (tache: Pick<TacheAFaire, "createdAt" | "depuis">, maintenant: Date) => Promise<string | null>;

/** Chaque condition : la preuve (sans le préfixe « coché par le CRM : ») quand elle est remplie, sinon null. */
const VERIFICATIONS: Record<ConditionManuelle, Verification> = {
  async SIMULATEUR_V2(_t, maintenant) {
    const { lireParametre } = await import("@/lib/parametres/service");
    return (await lireParametre("SIMULATEUR_MOTEUR", maintenant)) === "V2" ? "moteur du simulateur passé en V2" : null;
  },
  async BANC_LANCE() {
    const premier = await prisma.renduBanc.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    return premier ? `banc de comparaison lancé le ${jourMois(premier.createdAt)}` : null;
  },
  async CALENDAR_ACTIVE() {
    const { etatConnexionGoogle } = await import("@/lib/google/connexion");
    const etat = await etatConnexionGoogle();
    return etat.agenda && etat.agendaApiActivee ? "API Google Calendar activée (plus aucune tâche d'agenda en attente)" : null;
  },
  async AVIS_GOOGLE() {
    return process.env.GOOGLE_PLACES_API_KEY?.trim() && process.env.GOOGLE_PLACE_ID?.trim() ? "clés des avis Google posées" : null;
  },
  async TARIFS_COMPLETS() {
    const { tarifsPublics } = await import("@/lib/site/tarifs-publics");
    const tarifs = await tarifsPublics();
    const sansPrix = tarifs.familles.flatMap((f) => f.sousParties).filter((sp) => sp.metrage && sp.prixUnitaire === null);
    return sansPrix.length === 0 ? "chaque sous-partie au métrage a son prix" : null;
  },
  async SOLDE_OPENAI_NOTE(tache) {
    const releve = await prisma.parametre.findFirst({ where: { cle: "SIMULATEUR_CREDIT_OPENAI", createdAt: { gt: tache.createdAt } }, orderBy: { createdAt: "desc" }, select: { valeur: true, createdAt: true } });
    if (!releve) return null;
    const valeur = Number(JSON.parse(releve.valeur));
    return `solde OpenAI noté le ${jourMois(releve.createdAt)}${Number.isFinite(valeur) ? ` (${valeur.toFixed(2).replace(".", ",")} $)` : ""}`;
  },
  async REALISATION_PUBLIEE() {
    const publication = await prisma.publicationSite.findFirst({ where: { type: "REALISATION", publieLe: { not: null }, retireLe: null }, orderBy: { publieLe: "asc" }, select: { publieLe: true } });
    return publication?.publieLe ? `réalisation publiée le ${jourMois(publication.publieLe)}` : null;
  },
  async JETON_META(_t, maintenant) {
    const { lireJetonMeta } = await import("./systeme");
    const jeton = await lireJetonMeta(maintenant);
    if (jeton.aRenouveler) return null;
    return jeton.succesLe ? `jeton Meta accepté le ${jourMois(jeton.succesLe)}` : "plus aucun refus du jeton Meta";
  },
};

export const detecteurManuelles: Detecteur = {
  source: "MANUELLE",
  async detecter() {
    return [];
  },
  async acheves(contexte) {
    const taches = await prisma.tacheAFaire.findMany({ where: { type: "MANUELLE", statut: { in: ["A_FAIRE", "PLUS_TARD"] } }, select: { cle: true, donnees: true, createdAt: true, depuis: true } });
    const aVerifier = taches.map((t) => ({ tache: t, code: codeDeCondition(lireObjet(t.donnees).condition) })).filter((x): x is { tache: (typeof taches)[number]; code: ConditionManuelle } => x.code !== null);
    const acheves: Achevement[] = [];
    // Une condition lue une fois par passage, sauf celle qui dépend de la tâche (solde noté APRÈS elle).
    // Une condition illisible (module en panne) ne coche rien et n'empêche pas les autres.
    const communes = new Map<ConditionManuelle, Promise<string | null>>();
    const verifier = (code: ConditionManuelle, tache: (typeof taches)[number]) =>
      VERIFICATIONS[code](tache, contexte.maintenant).catch((erreur) => {
        console.error(`[a-faire] condition ${code} illisible :`, erreur);
        return null;
      });
    for (const { tache, code } of aVerifier) {
      let preuve: Promise<string | null>;
      if (code === "SOLDE_OPENAI_NOTE") preuve = verifier(code, tache);
      else {
        preuve = communes.get(code) ?? verifier(code, tache);
        communes.set(code, preuve);
      }
      const texte = await preuve;
      if (texte) acheves.push({ cle: tache.cle, texte: `${PREFIXE_COCHE}${texte}` });
    }
    return acheves;
  },
};
