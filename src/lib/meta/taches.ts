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
      if (!resultat.ok) throw new ErreurDefinitive(resultat.detail ?? "Conversion refusée par Meta.");
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

export type VerdictJeton = { etat: "absent" | "sain" | "proche" | "expire" | "invalide"; message: string; echeance: string | null };

/** Compare l'échéance d'un jeton à maintenant. Fonction pure, testée. */
export function verdictJeton(
  jeton: { valide: boolean; expireLe: string | null; accesExpireLe: string | null; erreur?: string } | null,
  maintenant: Date = new Date()
): VerdictJeton {
  if (!jeton) return { etat: "absent", message: "Jeton Meta non configuré ou non vérifiable (META_APP_ID et META_APP_SECRET requis).", echeance: null };
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

/** Vérifie le jeton et prévient si l'échéance approche (au plus une alerte par jour). */
export async function verifierJeton(): Promise<VerdictJeton> {
  const verdict = verdictJeton(await lireEtatJeton());
  if (verdict.etat === "proche" || verdict.etat === "expire" || verdict.etat === "invalide") {
    const derniere = globalAlerte[CLE_DERNIERE_ALERTE] ?? 0;
    if (Date.now() - derniere > JOUR_MS) {
      globalAlerte[CLE_DERNIERE_ALERTE] = Date.now();
      await alerter({
        titre: "Meta : jeton à renouveler",
        texte: `${verdict.message}\n\nÀ faire : régénérer le jeton de page dans l'outil d'exploration de l'API Graph, puis remplacer META_PAGE_ACCESS_TOKEN sur Railway.`,
        urgence: verdict.etat === "proche" ? 4 : 5,
      });
    }
  }
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
