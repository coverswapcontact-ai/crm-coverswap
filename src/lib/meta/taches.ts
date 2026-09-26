import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { ErreurDefinitive, enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { mettreEnFile } from "@/lib/taches/file";
import { alerter } from "@/lib/alertes/canaux";
import { lireEtatJeton } from "./graph";
import { TACHE_LEAD, TACHE_RELANCE, TENTATIVES_LEAD, relancerSiNonTraite, traiterLeadMeta } from "./leads";
import { envoyerConversion, type DemandeConversion } from "./conversions";
import { etatConfiguration } from "./config";

/**
 * Ce que l'intégration Meta fait en arrière-plan.
 *
 * Le webhook ne fait qu'accuser réception : tout le travail passe par la file
 * de tâches, qui apporte déjà l'idempotence (clé unique), les réessais avec
 * temporisation croissante, la trace durable et l'écran « Tâches ».
 *
 *  - META_LEAD : récupérer les réponses du formulaire et créer le contact.
 *    14 tentatives ≈ 30 heures d'essais : le temps qu'une permission Meta soit
 *    accordée ou qu'une panne passe. Un refus de droits n'est pas définitif —
 *    c'est justement le cas qui se règle tout seul quand l'App Review aboutit.
 *  - META_RELANCE : rappeler un lead dont la fiche n'a pas été ouverte.
 *  - META_CONVERSION : renvoyer une étape franchie vers Meta.
 */
const JOUR_MS = 24 * 60 * 60_000;

export const TACHE_CONVERSION = "META_CONVERSION";

export function enregistrerTachesMeta(): void {
  enregistrerTraitement(TACHE_LEAD, {
    libelle: "Lead Meta : récupération et création du contact",
    acteur: "SYSTEME:meta",
    tentativesMax: TENTATIVES_LEAD,
    delaiMaxMs: 60_000,
    executer: async (charge) => {
      const { leadgenId } = charge as { leadgenId: string };
      const resultat = await traiterLeadMeta(leadgenId);
      return {
        leadId: resultat.leadId,
        rattacheAUnContactExistant: resultat.rattache,
        notifications: resultat.notifications.map((n) => `${n.canal} : ${n.ok ? "envoyée" : (n.detail ?? "échec")}`),
      };
    },
  });

  enregistrerTraitement(TACHE_RELANCE, {
    libelle: "Lead Meta : relance si la fiche n'a pas été ouverte",
    acteur: "SYSTEME:meta",
    tentativesMax: 3,
    executer: async (charge) => {
      const { leadgenId, leadId } = charge as { leadgenId: string; leadId: string };
      const relance = await relancerSiNonTraite(leadgenId, leadId);
      return { relance, raison: relance ? "fiche non ouverte après 30 minutes" : "fiche déjà ouverte ou contact déjà pris" };
    },
  });

  enregistrerTraitement(TACHE_CONVERSION, {
    libelle: "Meta : renvoi d'une conversion",
    acteur: "SYSTEME:meta",
    tentativesMax: 8,
    executer: async (charge) => {
      const demande = charge as DemandeConversion & { survenuLe?: string };
      const resultat = await envoyerConversion({
        ...demande,
        survenuLe: demande.survenuLe ? new Date(demande.survenuLe) : undefined,
      });
      // Rien n'est configuré : inutile de réessayer huit fois, la tâche se relance à la main.
      if (resultat.inactif) throw new ErreurDefinitive(resultat.detail ?? "Renvoi des conversions non configuré.");
      if (!resultat.ok) {
        // Mission 13 (B4) : un jeton refusé est définitif dès la première tentative ; Lucas est prévenu une fois par jour, pas à chaque tâche.
        if (resultat.jetonRefuse) await alerterJetonARenouveler(resultat.detail ?? "Jeton Meta refusé par Meta.", 5);
        throw new ErreurDefinitive(resultat.detail ?? "Conversion refusée par Meta.");
      }
      return resultat;
    },
  });

  enregistrerTravailPeriodique({
    nom: "meta-jeton",
    libelle: "Meta : échéance du jeton de page",
    acteur: "SYSTEME:meta",
    intervalleMs: 12 * 60 * 60_000,
    estActif: () => etatConfiguration().lecture && Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    executer: async () => {
      await verifierJeton();
    },
  });
}

/** Le rappel part 7 jours avant l'échéance, puis une fois par jour. */
export const AVERTIR_AVANT_MS = 7 * JOUR_MS;
const CLE_DERNIERE_ALERTE = "__coverswapMetaJetonAlerte";
const globalAlerte = globalThis as unknown as Record<string, number | undefined>;

export type VerdictJeton = { etat: "absent" | "non_verifie" | "sain" | "proche" | "expire" | "invalide"; message: string; echeance: string | null };

/**
 * Mission 13 (B4/B5) : ce que la base sait du jeton sans appeler Meta — les
 * conversions refusées pour jeton (code 190…) et les leads illisibles des sept
 * derniers jours. C'est ce qui permet de dire « jeton refusé » même quand
 * META_APP_ID et META_APP_SECRET manquent (debug_token impossible).
 */
export type FaitsJeton = { jetonPresent: boolean; refusLe: Date | null; refusDetail: string | null; conversionsRefusees: number; leadsIllisibles: number };

const REFUS_CONVERSION = [{ derniereErreur: { contains: "Jeton Meta refusé" } }, { derniereErreur: { contains: '"code":190' } }];
const REFUS_LECTURE = [{ erreur: { contains: "Jeton Meta refusé" } }, { erreur: { contains: "access token" } }, { erreur: { contains: "(#10)" } }, { erreur: { contains: "(#200)" } }];

/** Le message de Meta, court, extrait d'une erreur brute (JSON) ou déjà lisible. */
export function resumerRefus(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const json = /"message":"([^"]{3,160})"/.exec(texte);
  if (json) return json[1];
  const lisible = /\((code [^)]{1,160})\)/.exec(texte);
  if (lisible) return lisible[1];
  return texte.replace(/^ErreurDefinitive:\s*/, "").slice(0, 120);
}

export async function faitsJeton(maintenant: Date = new Date()): Promise<FaitsJeton> {
  const depuis = new Date(maintenant.getTime() - 7 * JOUR_MS);
  const [conversionsRefusees, derniereConversion, leadsIllisibles, dernierLead] = await Promise.all([
    prisma.tache.count({ where: { type: TACHE_CONVERSION, statut: "ECHEC_DEFINITIF", updatedAt: { gte: depuis }, OR: REFUS_CONVERSION } }),
    prisma.tache.findFirst({ where: { type: TACHE_CONVERSION, statut: "ECHEC_DEFINITIF", updatedAt: { gte: depuis }, OR: REFUS_CONVERSION }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, derniereErreur: true } }),
    prisma.metaLead.count({ where: { ...AVEC_ARCHIVES, statut: "ECHEC", updatedAt: { gte: depuis }, OR: REFUS_LECTURE } }),
    prisma.metaLead.findFirst({ where: { ...AVEC_ARCHIVES, statut: "ECHEC", updatedAt: { gte: depuis }, OR: REFUS_LECTURE }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, erreur: true } }),
  ]);
  const dernier = [derniereConversion ? { le: derniereConversion.updatedAt, detail: derniereConversion.derniereErreur } : null, dernierLead ? { le: dernierLead.updatedAt, detail: dernierLead.erreur } : null]
    .filter((x): x is { le: Date; detail: string | null } => x !== null)
    .sort((a, b) => b.le.getTime() - a.le.getTime())[0];
  return { jetonPresent: etatConfiguration().lecture, refusLe: dernier?.le ?? null, refusDetail: resumerRefus(dernier?.detail), conversionsRefusees, leadsIllisibles };
}

/** Le verdict sans appeler Meta : les faits de la base seulement (santé du système, Publicité sans « interroger »). */
export async function etatJetonMeta(maintenant: Date = new Date()): Promise<VerdictJeton> {
  return verdictJeton(null, maintenant, await faitsJeton(maintenant));
}

/**
 * Compare l'échéance d'un jeton à maintenant. Fonction pure, testée. Sans
 * réponse de Meta (`jeton` null), les faits tranchent : un refus récent =
 * jeton invalide ; sinon « présent, non vérifié » ou « absent ».
 */
export function verdictJeton(
  jeton: { valide: boolean; expireLe: string | null; accesExpireLe: string | null; erreur?: string } | null,
  maintenant: Date = new Date(),
  faits?: Pick<FaitsJeton, "jetonPresent" | "refusLe" | "refusDetail">
): VerdictJeton {
  if (!jeton) {
    if (faits?.refusLe) return { etat: "invalide", message: `Jeton Meta refusé par Meta le ${faits.refusLe.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}${faits.refusDetail ? ` (${faits.refusDetail})` : ""} : à renouveler (META_PAGE_ACCESS_TOKEN sur Railway).`, echeance: null };
    if (faits?.jetonPresent) return { etat: "non_verifie", message: "Jeton présent ; sa validité n'est pas vérifiable auprès de Meta (META_APP_ID et META_APP_SECRET absentes) ; aucun refus constaté sur 7 jours.", echeance: null };
    return { etat: "absent", message: "Jeton Meta non configuré ou non vérifiable (META_APP_ID et META_APP_SECRET requis).", echeance: null };
  }
  if (!jeton.valide) return { etat: "invalide", message: `Jeton Meta refusé par Meta${jeton.erreur ? ` : ${jeton.erreur}` : ""}. Les leads ne peuvent plus être lus.`, echeance: null };
  const echeances = [jeton.expireLe, jeton.accesExpireLe].filter((d): d is string => Boolean(d)).map((d) => new Date(d).getTime());
  if (echeances.length === 0) return { etat: "sain", message: "Jeton de page sans expiration.", echeance: null };
  const prochaine = Math.min(...echeances);
  const reste = prochaine - maintenant.getTime();
  const echeance = new Date(prochaine).toISOString();
  if (reste <= 0) return { etat: "expire", message: "Le jeton Meta a expiré : les leads ne peuvent plus être lus. À régénérer.", echeance };
  if (reste <= AVERTIR_AVANT_MS) {
    const jours = Math.max(1, Math.round(reste / JOUR_MS));
    return { etat: "proche", message: `Le jeton Meta expire dans ${jours} jour${jours > 1 ? "s" : ""} : à régénérer avant, sinon les leads ne seront plus lus.`, echeance };
  }
  return { etat: "sain", message: "Jeton valide.", echeance };
}

/** Une seule alerte « jeton à renouveler » par jour, quelle que soit l'origine (échéance, conversion refusée, lead illisible). Rend vrai si elle est partie. */
export async function alerterJetonARenouveler(message: string, urgence: 4 | 5): Promise<boolean> {
  const derniere = globalAlerte[CLE_DERNIERE_ALERTE] ?? 0;
  if (Date.now() - derniere <= JOUR_MS) return false;
  globalAlerte[CLE_DERNIERE_ALERTE] = Date.now();
  await alerter(
    {
      titre: "Meta : jeton à renouveler",
      texte: `${message}\n\nÀ faire : régénérer le jeton de page dans l'outil d'exploration de l'API Graph, puis remplacer META_PAGE_ACCESS_TOKEN (et META_CONVERSIONS_TOKEN s'il est distinct) sur Railway.`,
      urgence,
    },
    { origine: "jeton-meta" }
  );
  return true;
}

/** Vérifie le jeton (auprès de Meta, puis d'après les faits) et prévient si l'échéance approche ou s'il est refusé (au plus une alerte par jour). */
export async function verifierJeton(): Promise<VerdictJeton> {
  const maintenant = new Date();
  const verdict = verdictJeton(await lireEtatJeton(), maintenant, await faitsJeton(maintenant));
  if (verdict.etat === "proche" || verdict.etat === "expire" || verdict.etat === "invalide") await alerterJetonARenouveler(verdict.message, verdict.etat === "proche" ? 4 : 5);
  return verdict;
}

/** Met un renvoi de conversion en file. Idempotent : une étape franchie ne repart qu'une fois. */
export async function planifierConversion(demande: DemandeConversion): Promise<void> {
  if (!etatConfiguration().conversions) return;
  await mettreEnFile({
    type: TACHE_CONVERSION,
    cle: `meta-conversion:${demande.evenementId}`,
    charge: { ...demande, survenuLe: (demande.survenuLe ?? new Date()).toISOString() },
    priorite: 3,
  });
}
