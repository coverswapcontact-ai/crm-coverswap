import { analyseDe, imageEchantillon, referenceObligatoire, type Reference } from "@/lib/simulateur/catalogue";
import { construirePrompt, etiquettesPour, filmsDistincts, type VarianteMoteur } from "@/lib/simulateur/moteur";
import { formatDeLaPhoto } from "@/lib/simulateur/moteur/analyse-photo";
import { controlerRendu, defautsEnPhrases } from "@/lib/simulateur/moteur/controle-rendu";
import { construirePlanche } from "@/lib/simulateur/moteur/planche";
import type { AnalysePhoto, DefautRendu, ReferenceMoteur, ZoneMoteur } from "@/lib/simulateur/moteur/types";
import { construirePromptV1 } from "@/lib/simulateur/moteur/v1";
import { DELAI_VISION_MS } from "@/lib/simulateur/moteur/vision";
import { empreintePhoto, obtenirAnalyse } from "@/lib/simulateur/analyses";
import { qualitePourOrigine, type Moteur, type ReglagesSimulateur } from "@/lib/simulateur/reglages";
import { resumerTeinte } from "@/lib/simulateur/teintes";
import { ZONES_SIMULATEUR, piece as lirePiece, type IdPiece, type IdZone } from "@/lib/simulateur/zones";
import { corrigerSortiePipeline } from "./correction-pipeline";
import type { FideliteSurface } from "./fidelite";
import { DELAI_OPENAI_MS, generateurEnVigueur, type Generateur, type ResultatGeneration } from "./generation";
import type { Qualite } from "./prix";
import type { EtapeTravail } from "./travaux-lecture";

/**
 * Le pipeline de génération (mission 15, partie 2) — commun au site (tâche
 * SIMULATION_SITE), à l'espace client et au CRM (tâche SIMULATION_API) :
 *  - V1 : l'ancien prompt (celui que le site envoie, ou `moteur/v1.ts`),
 *    échantillons bruts, pas d'analyse, pas de contrôle ;
 *  - V2 : analyse de la photo (réutilisée par empreinte, attendue si elle est
 *    en cours), prompt du moteur avec la planche étiquetée (ou les échantillons
 *    bruts), génération, contrôle automatique ; sous le seuil, une seconde
 *    tentative avec les défauts rappelés, la meilleure des deux gardée — si le
 *    temps de la tâche le permet encore (`echeance`) : une génération coupée
 *    par l'exécuteur serait payée pour rien.
 * Les étapes sont annoncées (`surEtape`) pour l'écran d'attente.
 */

export type { Generateur };

/** Ce qu'il faut encore avoir devant soi pour lancer une seconde tentative : un rendu, son contrôle, une marge. */
export const BUDGET_SECONDE_TENTATIVE_MS = DELAI_OPENAI_MS + DELAI_VISION_MS + 15_000;

export type EntreePipeline = {
  photo: Buffer;
  piece: IdPiece;
  zones: { zone: IdZone; ref: string }[];
  origine: "SITE" | "CRM" | "ESPACE";
  reglages: ReglagesSimulateur;
  qualite?: Qualite;
  /** V1 du site : le prompt signé envoyé par le site et ses échantillons à télécharger. */
  promptV1?: string | null;
  swatchUrlsV1?: string[];
  parcoursId?: string | null;
  dossierId?: string | null;
  preparationId?: string | null;
  /** Fin du délai de la tâche (horodatage) : la seconde tentative n'est lancée que si elle tient dedans. */
  echeance?: number | null;
  surEtape?: (etape: EtapeTravail) => Promise<void> | void;
  signal?: AbortSignal;
  generateur?: Generateur;
  /**
   * Mission 23 (L4a) — la phase de ce rendu : `ambiance`, `ambiance-edition` et `serie-*` (images de catalogue, sans
   * original gardé) ne sont jamais corrigées ni mesurées (`phaseSansCorrection`). Défaut : un rendu de simulation.
   */
  phase?: string;
  /** Mission 23 (L4a) — la fidélité est mesurée même réglage désactivé : le banc et la campagne de calibrage seulement. */
  mesurerFidelite?: boolean;
  /**
   * Mission 23 (L4a) — campagne de calibrage seulement : la phase notée dans `GenerationImage` pour TOUS les appels de ce
   * rendu (génération, analyse, contrôle : `calibrage-23`, celle que le plafond relit) ; défaut : les phases habituelles.
   */
  phaseNotee?: string;
  /** Mission 23 (L4a) — campagne de calibrage seulement : la variante du prompt (V2) ; défaut `actuel`, le prompt studio. */
  variante?: VarianteMoteur;
};

/** Mission 23 (L4a) : les phases des images de catalogue (ambiances, séries), exclues de la correction des teintes. */
export function phaseSansCorrection(phase: string | null | undefined): boolean {
  return phase === "ambiance" || phase === "ambiance-edition" || (typeof phase === "string" && phase.startsWith("serie-"));
}

type Reussite = Extract<ResultatGeneration, { ok: true }>;
type Echec = Extract<ResultatGeneration, { ok: false }>;

export type SortiePipeline =
  | (Reussite & { moteur: Moteur; prompt: string; directionArtistique: string | null; analyse: AnalysePhoto | null; empreinte: string; scoreControle: number | null; defautsControle: DefautRendu[] | null; tentatives: number; coutTotalDollars: number; /** Mission 23 (L3) : fidélité des teintes mesurée, et le rendu d'origine quand la correction l'a remplacé. */ fidelite?: FideliteSurface[] | null; imageOriginale?: Buffer | null })
  | (Echec & { moteur: Moteur; empreinte: string; tentatives: number });

/** Une référence du catalogue telle que le moteur la lit, couleur mesurée comprise (cache du CRM, sinon `hex` du site). */
export async function referenceMoteur(ref: string): Promise<ReferenceMoteur> {
  const r: Reference = await referenceObligatoire(ref);
  const couleur = await analyseDe(ref);
  return { ref: r.id, nom: r.nom, famille: r.famille, categorie: r.categorie, finition: r.finition, tags: r.tags, hex: r.hex ?? null, couleur };
}

async function zonesMoteur(zones: { zone: IdZone; ref: string }[]): Promise<ZoneMoteur[]> {
  const distinctes = [...new Set(zones.map((z) => z.ref))];
  const references = new Map(await Promise.all(distinctes.map(async (ref) => [ref, await referenceMoteur(ref)] as const)));
  return etiquettesPour(zones.map((z) => ({ zone: z.zone, reference: references.get(z.ref)! })));
}

/** Les échantillons bruts des films distincts, lus dans le cache du CRM en parallèle. */
async function echantillonsBruts(zones: ZoneMoteur[]): Promise<Buffer[]> {
  return Promise.all(filmsDistincts(zones).map((f) => imageEchantillon(f.reference.ref)));
}

/** La planche des zones (une tuile par zone, lettre + zone, référence et nom). */
export async function plancheDesZones(zones: ZoneMoteur[], sousTitre: string, options: { neutre?: boolean } = {}): Promise<Buffer> {
  const tuiles = await Promise.all(
    zones.map(async (z) => ({ etiquette: `${z.etiquette} · ${ZONES_SIMULATEUR[z.zone].libelle}`, ref: z.reference.ref, nom: z.reference.nom, resume: resumerTeinte({ ...z.reference, id: z.reference.ref }, z.reference.couleur ?? null), image: await imageEchantillon(z.reference.ref) }))
  );
  return construirePlanche(tuiles, sousTitre, options);
}

async function genererSansCorrection(entree: EntreePipeline): Promise<SortiePipeline> {
  const generateur = entree.generateur ?? generateurEnVigueur();
  const qualite = entree.qualite ?? qualitePourOrigine(entree.reglages, entree.origine);
  const empreinte = empreintePhoto(entree.photo);
  const commun = { photo: entree.photo, origine: entree.origine, qualite, dossierId: entree.dossierId, preparationId: entree.preparationId, signal: entree.signal, ...(entree.phaseNotee ? { phase: entree.phaseNotee } : {}) };
  const contexteVision = { dossierId: entree.dossierId, preparationId: entree.preparationId, origine: entree.origine, signal: entree.signal, ...(entree.phaseNotee ? { phase: entree.phaseNotee } : {}) };
  const variante = entree.variante ?? "actuel";

  if (entree.reglages.moteur === "V1") {
    await entree.surEtape?.("rendu");
    if (entree.promptV1) {
      const resultat = await generateur({ ...commun, prompt: entree.promptV1, swatchUrls: entree.swatchUrlsV1 ?? [] });
      return resultat.ok ? { ...resultat, moteur: "V1", prompt: entree.promptV1, directionArtistique: null, analyse: null, empreinte, scoreControle: null, defautsControle: null, tentatives: 1, coutTotalDollars: resultat.coutDollars } : { ...resultat, moteur: "V1", empreinte, tentatives: 1 };
    }
    const zones = await zonesMoteur(entree.zones);
    const prompt = construirePromptV1(entree.piece, zones);
    const resultat = await generateur({ ...commun, prompt, swatches: await echantillonsBruts(zones) });
    return resultat.ok ? { ...resultat, moteur: "V1", prompt, directionArtistique: null, analyse: null, empreinte, scoreControle: null, defautsControle: null, tentatives: 1, coutTotalDollars: resultat.coutDollars } : { ...resultat, moteur: "V1", empreinte, tentatives: 1 };
  }

  // V2 — 1) l'analyse de la photo (réutilisée, attendue si elle est en cours, sinon faite maintenant ; jamais bloquante).
  await entree.surEtape?.("analyse");
  const etatAnalyse = await obtenirAnalyse(entree.photo, entree.piece, { parcoursId: entree.parcoursId, ...contexteVision });
  const analyse = etatAnalyse.analyse;

  // 2) Les matières : références, couleurs, planche ou échantillons, format.
  await entree.surEtape?.("matieres");
  const zones = await zonesMoteur(entree.zones);
  const format = (await formatDeLaPhoto(entree.photo)) ?? analyse?.format ?? "paysage";
  const neutre = variante === "planche-neutre";
  const planche = entree.reglages.planche || neutre ? await plancheDesZones(zones, `CoverSwap · ${lirePiece(entree.piece).libelle}`, { neutre }) : null;
  const swatches = planche ? undefined : await echantillonsBruts(zones);
  const mode = planche ? "api-planche" : "api-swatches";
  const zonesControle = zones.map((z) => ({ zone: z.zone, ref: z.reference.ref, nom: z.reference.nom }));

  // 3) Rendu, contrôle, seconde tentative sous le seuil ; la meilleure est gardée.
  await entree.surEtape?.("rendu");
  let meilleure: (Reussite & { prompt: string; directionArtistique: string; score: number | null; defauts: DefautRendu[] | null }) | null = null;
  let defautsPrecedents: string[] = [];
  let coutTotal = 0;
  let tentatives = 0;
  for (let tentative = 1; tentative <= 2; tentative++) {
    tentatives = tentative;
    const construit = construirePrompt({ piece: entree.piece, zones, analyse, format, mode, defautsPrecedents, ...(variante !== "actuel" ? { variante } : {}) });
    const resultat = await generateur({ ...commun, prompt: construit.texte, planche, swatches });
    if (!resultat.ok) {
      if (meilleure) break; // la première a réussi : on la garde
      return { ...resultat, moteur: "V2", empreinte, tentatives };
    }
    coutTotal += resultat.coutDollars;
    const controle = await controlerRendu(resultat.avant ?? entree.photo, resultat.image, zonesControle, contexteVision);
    if (controle.ok) coutTotal += controle.coutDollars;
    const score = controle.ok ? controle.donnees.score : null;
    const defauts = controle.ok ? controle.donnees.defauts : null;
    const candidate = { ...resultat, prompt: construit.texte, directionArtistique: construit.directionArtistique, score, defauts };
    if (!meilleure || (score ?? -1) > (meilleure.score ?? -1)) meilleure = candidate;
    if (score === null || score >= entree.reglages.seuilControle) break;
    defautsPrecedents = defautsEnPhrases(controle.ok ? controle.donnees : null);
    if (defautsPrecedents.length === 0) break;
    // Plus assez de temps avant la fin de la tâche : la première est gardée plutôt qu'une seconde coupée en route (et payée).
    if (typeof entree.echeance === "number" && entree.echeance - Date.now() < BUDGET_SECONDE_TENTATIVE_MS) {
      console.log(`[simulate] contrôle ${score}/10 sous le seuil ${entree.reglages.seuilControle}, mais plus le temps d'une seconde tentative (${Math.max(0, Math.round((entree.echeance - Date.now()) / 1000))} s restantes) : première gardée`);
      break;
    }
    console.log(`[simulate] contrôle ${score}/10 sous le seuil ${entree.reglages.seuilControle} : seconde tentative (${defautsPrecedents.length} défaut(s) rappelé(s))`);
  }
  const { score, defauts, ...reussite } = meilleure!;
  return { ...reussite, moteur: "V2", analyse, empreinte, scoreControle: score, defautsControle: defauts, tentatives, coutTotalDollars: Math.round(coutTotal * 10_000) / 10_000 };
}

/**
 * Mission 23 (L3, L4a) — la fin du pipeline : la correction des teintes derrière le réglage `correctionTeintes`, voir
 * `correction-pipeline.ts`. Réglage désactivé (défaut) : ni mesure ni correction, le rendu sort tel quel (sauf
 * `mesurerFidelite`, le banc). Les images de catalogue (`phaseSansCorrection`) ne passent jamais par là. Une erreur
 * garde le rendu d'origine.
 */
export async function genererAvecMoteur(entree: EntreePipeline): Promise<SortiePipeline> {
  const sortie = await genererSansCorrection(entree);
  if (!sortie.ok) return sortie;
  const appliquer = entree.reglages.correctionTeintes === true;
  if (phaseSansCorrection(entree.phase) || (!appliquer && entree.mesurerFidelite !== true)) return { ...sortie, imageOriginale: null, fidelite: null };
  const c = await corrigerSortiePipeline({ avant: sortie.avant ?? entree.photo, image: sortie.image, zones: entree.zones, appliquer, origine: entree.origine });
  return { ...sortie, image: c.image, imageOriginale: c.imageOriginale, fidelite: c.fidelite };
}
