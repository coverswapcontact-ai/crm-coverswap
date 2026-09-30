import prisma from "@/lib/prisma";
import { consommationDuMois } from "@/lib/ia/modele";
import { lireParametre } from "@/lib/parametres/service";
import { COUT_ESTIME_VISION_DOLLARS, MODELE_VISION, coutEnDollars } from "@/lib/simulations/prix";

/**
 * L'appel vision commun (mission 15, partie 2) : `POST /v1/chat/completions`
 * chez OpenAI, modèle `gpt-4.1-mini`, une ou deux images en data URL, sortie
 * JSON stricte (`response_format: json_schema`). Sert à l'analyse de la photo
 * et au contrôle du rendu.
 *
 * Coût compté deux fois, à dessein : une ligne `GenerationImage` (phase
 * `analyse` ou `controle`, jetons, dollars) pour le compteur du simulateur, et
 * une ligne `AppelIa` (euros) pour que la dépense entre dans le budget mensuel
 * de l'IA (`IA_BUDGET_MENSUEL`, `etatIa().depenseMois`). Au-delà du budget,
 * l'appel est SAUTÉ avec une raison — jamais la génération bloquée.
 *
 * Remplaçable pour les essais (`definirVisionEssai`) : aucun appel réseau, aucun
 * coût d'un test.
 */

/** Approximation notée : le budget de l'IA est en euros, OpenAI facture en dollars. */
export const EUROS_PAR_DOLLAR = 0.92;
export const DELAI_VISION_MS = 40_000;

export type DemandeVision = {
  modele: string;
  systeme: string;
  texte: string;
  /** Images en data URL (`data:image/jpeg;base64,…`), dans l'ordre. */
  images: string[];
  schema: { nom: string; json: Record<string, unknown> };
  jetonsSortieMax: number;
  signal?: AbortSignal;
};

export type ReponseVision = { texte: string; jetonsEntree: number; jetonsSortie: number };
export type FournisseurVision = (demande: DemandeVision) => Promise<ReponseVision>;

const CLE_ESSAI = "__coverswapVisionEssai";
const globalEssai = globalThis as unknown as Record<string, FournisseurVision | undefined>;

/** Essais seulement : remplace l'appel OpenAI (null : revient au vrai). */
export function definirVisionEssai(fournisseur: FournisseurVision | null): void {
  globalEssai[CLE_ESSAI] = fournisseur ?? undefined;
}

const baseOpenAI = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

async function fournisseurOpenAI(demande: DemandeVision): Promise<ReponseVision> {
  const cle = process.env.OPENAI_API_KEY;
  if (!cle) throw new Error("OPENAI_API_KEY absente.");
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_VISION_MS);
  demande.signal?.addEventListener("abort", () => controleur.abort(), { once: true });
  try {
    const reponse = await fetch(`${baseOpenAI()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      signal: controleur.signal,
      body: JSON.stringify({
        model: demande.modele,
        max_completion_tokens: demande.jetonsSortieMax,
        messages: [
          { role: "system", content: demande.systeme },
          { role: "user", content: [{ type: "text", text: demande.texte }, ...demande.images.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } }))] },
        ],
        response_format: { type: "json_schema", json_schema: { name: demande.schema.nom, strict: true, schema: demande.schema.json } },
      }),
    });
    if (!reponse.ok) throw new Error(`OpenAI HTTP ${reponse.status} : ${(await reponse.text().catch(() => "")).slice(0, 200)}`);
    const donnees = (await reponse.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { texte: donnees.choices?.[0]?.message?.content ?? "", jetonsEntree: donnees.usage?.prompt_tokens ?? 0, jetonsSortie: donnees.usage?.completion_tokens ?? 0 };
  } finally {
    clearTimeout(minuterie);
  }
}

export type Phase = "analyse" | "controle";
export type RaisonSaut = "cle" | "budget" | "delai" | "erreur" | "invalide";

export type ResultatVision<T> = { ok: true; donnees: T; coutDollars: number; dureeMs: number } | { ok: false; raison: RaisonSaut; message: string; dureeMs: number };

/** Le budget mensuel de l'IA laisse-t-il passer cet appel ? Sans budget saisi : oui. */
export async function budgetVisionDisponible(maintenant: Date = new Date()): Promise<{ ok: boolean; message?: string }> {
  const budget = await lireParametre("IA_BUDGET_MENSUEL", maintenant).catch(() => null);
  if (typeof budget !== "number") return { ok: true };
  const { depense } = await consommationDuMois(maintenant);
  const estimation = COUT_ESTIME_VISION_DOLLARS * EUROS_PAR_DOLLAR;
  if (depense + estimation > budget) return { ok: false, message: `Budget IA du mois atteint (${depense.toFixed(2).replace(".", ",")} € sur ${budget.toFixed(2).replace(".", ",")} €) : appel vision sauté.` };
  return { ok: true };
}

/** D'où vient l'appel (compteur du simulateur ventilé par origine) : le site, l'espace du client ou le CRM. */
export type ContexteVision = { origine?: "SITE" | "CRM" | "ESPACE"; dossierId?: string | null; preparationId?: string | null; signal?: AbortSignal };

async function noter(phase: Phase, usage: string, reponse: ReponseVision | null, dureeMs: number, erreur: string | null, contexte: ContexteVision): Promise<number> {
  const jetons = { texte: reponse?.jetonsEntree ?? 0, image: 0, sortie: reponse?.jetonsSortie ?? 0 };
  const coutDollars = reponse ? coutEnDollars(jetons, MODELE_VISION) : 0;
  try {
    await prisma.generationImage.create({
      data: { origine: contexte.origine ?? "CRM", phase, modele: MODELE_VISION, statut: erreur ? "ECHEC" : "REUSSI", erreur: erreur?.slice(0, 500) ?? null, dureeMs, echantillons: 0, jetonsTexte: jetons.texte, jetonsImage: 0, jetonsSortie: jetons.sortie, coutDollars: reponse ? coutDollars : null, dossierId: contexte.dossierId ?? null, preparationId: contexte.preparationId ?? null },
    });
    await prisma.appelIa.create({
      data: { usage, modele: MODELE_VISION, jetonsEntree: jetons.texte, jetonsSortie: jetons.sortie, coutEuros: Math.round(coutDollars * EUROS_PAR_DOLLAR * 10_000) / 10_000, dureeMs, statut: erreur ? "ECHEC" : "REUSSI", erreur: erreur?.slice(0, 1000) ?? null },
    });
  } catch (e) {
    console.error("[vision] consommation non enregistrée (non bloquant) :", e);
  }
  return coutDollars;
}

/**
 * Appelle le modèle vision et lit sa sortie JSON. Toute cause d'échec rend une
 * raison (clé absente, budget, délai, erreur, JSON invalide) : l'appelant
 * continue sans.
 */
export async function appelerVision<T>(phase: Phase, demande: Omit<DemandeVision, "modele">, lire: (brut: unknown) => T | null, contexte: ContexteVision = {}): Promise<ResultatVision<T>> {
  const debut = Date.now();
  const fournisseur = globalEssai[CLE_ESSAI] ?? fournisseurOpenAI;
  if (!globalEssai[CLE_ESSAI] && !process.env.OPENAI_API_KEY) return { ok: false, raison: "cle", message: "OPENAI_API_KEY absente : analyse sautée.", dureeMs: 0 };
  const budget = await budgetVisionDisponible();
  if (!budget.ok) return { ok: false, raison: "budget", message: budget.message ?? "Budget atteint.", dureeMs: 0 };
  const usage = phase === "analyse" ? "VISION_ANALYSE_PHOTO" : "VISION_CONTROLE_RENDU";
  let reponse: ReponseVision;
  try {
    reponse = await fournisseur({ ...demande, modele: MODELE_VISION });
  } catch (erreur) {
    const delai = erreur instanceof Error && (erreur.name === "AbortError" || /abort/i.test(erreur.message));
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    const dureeMs = Date.now() - debut;
    await noter(phase, usage, null, dureeMs, `${delai ? "delai" : "erreur"} : ${message}`, contexte);
    return { ok: false, raison: delai ? "delai" : "erreur", message, dureeMs };
  }
  const dureeMs = Date.now() - debut;
  let brut: unknown;
  try {
    brut = JSON.parse(reponse.texte);
  } catch {
    await noter(phase, usage, reponse, dureeMs, "invalide : sortie non JSON", contexte);
    return { ok: false, raison: "invalide", message: "Le modèle n'a pas rendu de JSON.", dureeMs };
  }
  const donnees = lire(brut);
  if (donnees === null) {
    await noter(phase, usage, reponse, dureeMs, "invalide : JSON hors schéma", contexte);
    return { ok: false, raison: "invalide", message: "Le modèle a rendu un JSON hors schéma.", dureeMs };
  }
  const coutDollars = await noter(phase, usage, reponse, dureeMs, null, contexte);
  return { ok: true, donnees, coutDollars, dureeMs };
}

/** Une image en data URL pour l'appel vision (réduite à 1024 px de côté : les détails suffisent, les jetons non). */
export async function imageEnDataUrl(octets: Buffer): Promise<string> {
  try {
    const sharp = (await import("sharp")).default;
    const reduite = await sharp(octets).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${reduite.toString("base64")}`;
  } catch {
    return `data:image/jpeg;base64,${octets.toString("base64")}`;
  }
}
