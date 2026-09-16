import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { lireParametres } from "@/lib/parametres/service";
import type { CleParametre } from "@/lib/parametres/definitions";

/**
 * Seul point d'appel à un modèle d'IA dans le CRM.
 *
 * - Désactivé tant que tout n'est pas explicitement réglé : clé
 *   ANTHROPIC_API_KEY sur le serveur, et dans Paramètres le modèle, ses prix,
 *   le budget mensuel et l'interrupteur « Active » (aucune valeur par défaut :
 *   rien ne se dépense sans décision).
 * - Plafond : un appel dont le coût estimé dépasserait le budget du mois civil
 *   (heure de Paris) n'est pas fait.
 * - Chaque appel, réussi ou non, est enregistré (`AppelIa`) avec ses jetons et
 *   son coût aux prix datés en vigueur.
 * - Le modèle ne rend qu'une sortie structurée (un « outil » imposé), validée
 *   par l'appelant ; il n'a aucun moyen d'agir.
 */

export const CLES_PARAMETRES_IA = ["IA_AGENT_MAIL", "IA_MODELE", "IA_PRIX_ENTREE", "IA_PRIX_SORTIE", "IA_BUDGET_MENSUEL"] as const satisfies readonly CleParametre[];

export type DemandeModele = {
  modele: string;
  systeme: string;
  message: string;
  outil: { nom: string; description: string; schema: Record<string, unknown> };
  jetonsSortieMax: number;
  signal?: AbortSignal;
};

/** `donnees` absentes : le modèle a répondu (et coûté) sans rendre la sortie structurée. */
export type ReponseModele = { donnees: unknown; jetonsEntree: number; jetonsSortie: number };

export type FournisseurModele = (demande: DemandeModele) => Promise<ReponseModele>;

const CLE_ESSAI = "__coverswapFournisseurIaEssai";
const globalEssai = globalThis as unknown as Record<string, FournisseurModele | undefined>;

/** Essais seulement : remplace le modèle réel (aucun appel payant pendant les tests). */
export function definirFournisseurIaEssai(fournisseur: FournisseurModele | null): void {
  globalEssai[CLE_ESSAI] = fournisseur ?? undefined;
}

async function fournisseurAnthropic(demande: DemandeModele): Promise<ReponseModele> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  const reponse = await client.messages.create(
    {
      model: demande.modele,
      max_tokens: demande.jetonsSortieMax,
      system: demande.systeme,
      messages: [{ role: "user", content: demande.message }],
      tools: [{ name: demande.outil.nom, description: demande.outil.description, input_schema: demande.outil.schema as { type: "object" } }],
      tool_choice: { type: "tool", name: demande.outil.nom },
    },
    { signal: demande.signal }
  );
  const bloc = reponse.content.find((element) => element.type === "tool_use");
  return {
    donnees: bloc?.type === "tool_use" ? bloc.input : undefined,
    jetonsEntree: reponse.usage.input_tokens + (reponse.usage.cache_read_input_tokens ?? 0) + (reponse.usage.cache_creation_input_tokens ?? 0),
    jetonsSortie: reponse.usage.output_tokens,
  };
}

export type EtatIa = {
  active: boolean;
  /** Pourquoi l'IA ne lit pas les mails (null si active). */
  raison: string | null;
  cleApi: boolean;
  manquants: CleParametre[];
  pause: boolean;
  modele: string | null;
  budget: number | null;
  depenseMois: number;
  appelsMois: number;
};

const arrondi = (montant: number) => Math.round(montant * 10_000) / 10_000;

async function consommationDuMois(maintenant: Date): Promise<{ depense: number; appels: number }> {
  const mois = jourParis(maintenant).slice(0, 7);
  const lignes = await prisma.appelIa.findMany({
    where: { createdAt: { gte: new Date(maintenant.getTime() - 33 * 86_400_000), lte: maintenant } },
    select: { createdAt: true, coutEuros: true },
  });
  const duMois = lignes.filter((ligne) => jourParis(ligne.createdAt).startsWith(mois));
  return { depense: arrondi(duMois.reduce((total, ligne) => total + (ligne.coutEuros ?? 0), 0)), appels: duMois.length };
}

type Reglages = { modele: string; prixEntree: number; prixSortie: number; budget: number };

async function lireReglages(maintenant: Date): Promise<{ etat: EtatIa; reglages: Reglages | null }> {
  const valeurs = await lireParametres(CLES_PARAMETRES_IA, maintenant);
  const manquants = CLES_PARAMETRES_IA.filter((cle) => valeurs[cle] === undefined);
  const cleApi = Boolean(process.env.ANTHROPIC_API_KEY);
  const pause = valeurs.IA_AGENT_MAIL !== undefined && valeurs.IA_AGENT_MAIL !== "ACTIVE";
  const { depense, appels } = await consommationDuMois(maintenant);
  const budget = typeof valeurs.IA_BUDGET_MENSUEL === "number" ? valeurs.IA_BUDGET_MENSUEL : null;

  let raison: string | null = null;
  if (!cleApi) raison = "Clé ANTHROPIC_API_KEY absente des variables d'environnement du serveur.";
  else if (manquants.length > 0) raison = "Réglages à renseigner dans Paramètres (modèle, prix, budget, interrupteur).";
  else if (pause) raison = "En pause (Paramètres → Agent mail et IA).";
  else if (budget !== null && depense >= budget) raison = `Budget du mois atteint (${depense.toFixed(2).replace(".", ",")} € sur ${budget.toFixed(2).replace(".", ",")} €).`;

  const etat: EtatIa = {
    active: raison === null,
    raison,
    cleApi,
    manquants,
    pause,
    modele: typeof valeurs.IA_MODELE === "string" ? valeurs.IA_MODELE : null,
    budget,
    depenseMois: depense,
    appelsMois: appels,
  };
  const reglages =
    raison === null
      ? { modele: String(valeurs.IA_MODELE), prixEntree: Number(valeurs.IA_PRIX_ENTREE), prixSortie: Number(valeurs.IA_PRIX_SORTIE), budget: budget! }
      : null;
  return { etat, reglages };
}

export async function etatIa(maintenant: Date = new Date()): Promise<EtatIa> {
  return (await lireReglages(maintenant)).etat;
}

export class IaIndisponible extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IaIndisponible";
  }
}

export type AppelModele = Omit<DemandeModele, "modele"> & { usage: string };

/** Estimation prudente des jetons d'un texte français (≈ 3 caractères par jeton). */
export function estimerJetons(texte: string): number {
  return Math.ceil(texte.length / 3);
}

/**
 * Appelle le modèle réglé. Lève `IaIndisponible` sans rien dépenser si l'IA
 * est inactive ou si l'appel pourrait dépasser le budget du mois.
 */
export async function appelerModele(appel: AppelModele, maintenant: Date = new Date()): Promise<{ donnees: unknown; appelId: string; coutEuros: number }> {
  const { etat, reglages } = await lireReglages(maintenant);
  if (!reglages) throw new IaIndisponible(etat.raison ?? "IA inactive.");

  const estimation =
    ((estimerJetons(appel.systeme + appel.message + JSON.stringify(appel.outil.schema)) * reglages.prixEntree) + appel.jetonsSortieMax * reglages.prixSortie) / 1_000_000;
  if (etat.depenseMois + estimation > reglages.budget) {
    throw new IaIndisponible(`Budget du mois presque atteint : l'analyse (jusqu'à ${estimation.toFixed(3).replace(".", ",")} €) le dépasserait.`);
  }

  const fournisseur = globalEssai[CLE_ESSAI] ?? fournisseurAnthropic;
  const debut = Date.now();
  let reponse: ReponseModele;
  try {
    reponse = await fournisseur({ ...appel, modele: reglages.modele });
  } catch (erreur) {
    const message = (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 1000);
    await prisma.appelIa.create({
      data: { usage: appel.usage, modele: reglages.modele, coutEuros: 0, dureeMs: Date.now() - debut, statut: "ECHEC", erreur: message },
    });
    throw erreur;
  }
  const cout = arrondi((reponse.jetonsEntree * reglages.prixEntree + reponse.jetonsSortie * reglages.prixSortie) / 1_000_000);
  const structuree = reponse.donnees !== undefined && reponse.donnees !== null;
  const ligne = await prisma.appelIa.create({
    data: {
      usage: appel.usage,
      modele: reglages.modele,
      jetonsEntree: reponse.jetonsEntree,
      jetonsSortie: reponse.jetonsSortie,
      coutEuros: cout,
      dureeMs: Date.now() - debut,
      statut: structuree ? "REUSSI" : "ECHEC",
      erreur: structuree ? null : "Réponse sans sortie structurée.",
    },
  });
  if (!structuree) throw new Error("Le modèle n'a pas rendu de réponse structurée.");
  return { donnees: reponse.donnees, appelId: ligne.id, coutEuros: cout };
}
