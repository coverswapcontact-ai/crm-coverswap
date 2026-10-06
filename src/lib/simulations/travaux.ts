import { promises as fs } from "fs";
import path from "path";
import prisma from "@/lib/prisma";
import { rendreSimulation } from "@/lib/acces/limite-site";
import { ouvrirDossierAutomatique } from "@/lib/dossiers/depuis-lead";
import { MESSAGES_ECHEC } from "@/lib/site/erreurs-generation";
import { DOSSIER_SITE, enregistrerSimulationSite, rattacherSimulationsSite, type ReferenceSimulee, type TraceMoteur } from "@/lib/site/simulations";
import { empreintePhoto } from "@/lib/simulateur/analyses";
import { reglagesSimulateur } from "@/lib/simulateur/reglages";
import { estIdPiece, estIdZone, type IdPiece, type IdZone } from "@/lib/simulateur/zones";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement } from "@/lib/taches/registre";
import { resolveUploadsDir } from "@/lib/uploads";
import { effacerImage, enregistrerImageBase64, imageBase64Acceptable } from "./images";
import { definirGenerateurEssai, extensionDe, generateurEnVigueur, typeImage } from "./generation";
import { genererAvecMoteur, type SortiePipeline } from "./pipeline";
import { notifierTravailPret } from "./prevenir";
import { attenteEstimeeS, lireSwatchUrls, MESSAGE_INTERROMPUE, MESSAGE_STOCKAGE, type EtapeTravail } from "./travaux-lecture";

/**
 * Mission 15 (partie 1) — la génération du simulateur du site, ASYNCHRONE,
 * visible et reprenable. `POST /api/simulate` crée un travail (EN_ATTENTE,
 * photo sur le volume) et met en file la tâche SIMULATION_SITE (voie longue :
 * deux générations en parallèle, sans bloquer les mails ni Drive). La tâche
 * passe le travail EN_COURS, déroule le pipeline commun (`pipeline.ts` : V1 =
 * le prompt signé du site et ses échantillons ; V2 = analyse de la photo,
 * planche, prompt du moteur, contrôle, seconde tentative), garde le rendu comme
 * avant (`enregistrerSimulationSite`, rattachement au lead du parcours), puis
 * pose PRETE — ou ECHEC avec la raison classée. Une seconde réclamation de la
 * tâche (redéploiement pendant la génération) ne rappelle JAMAIS OpenAI :
 * ECHEC « interrompue ». Les étapes (`analyse`, `matieres`, `rendu`) sont
 * écrites sur le travail pour l'écran d'attente.
 *
 * Le générateur est remplaçable pour les essais (`definirGenerateurEssai`) :
 * aucun appel OpenAI ne part d'un test.
 */

export const TACHE_SIMULATION_SITE = "SIMULATION_SITE";
/** Mission 15 (partie 2) : analyse (jusqu'à 45 s d'attente) + rendu + contrôle + seconde tentative tiennent dans 8 min (< 10 min : seuil « travail perdu »). */
export const DELAI_TACHE_SITE_MS = 480_000;

/** Le générateur (mission 15, partie 2 : registre commun dans generation.ts, valable pour le site, l'espace, le CRM et le banc). */
export { definirGenerateurEssai };
export const generateurSite = generateurEnVigueur;
const generateur = generateurSite;

export type EntreeTravail = {
  parcoursId: string;
  projet: string;
  references: ReferenceSimulee[];
  /** Mission 15 (partie 4) : le site n'envoie plus de prompt — null, et le moteur construit la consigne (V1 revu ou V2). */
  prompt?: string | null;
  swatchUrls?: string[];
  photoBase64: string;
  page?: string | null;
  source?: string | null;
  campagne?: string | null;
  ipOrigine?: string | null;
  /** Site 3.0 : la pièce d'exemple du site (nom de l'avant) ; absente, la photo est celle du visiteur. */
  exemple?: string | null;
};

/** La pièce d'un travail (le projet du site), cuisine à défaut. */
export function pieceDuProjet(projet: string): IdPiece {
  return estIdPiece(projet) ? projet : "cuisine";
}

/** Les zones d'un travail (références du site), dédoublonnées, zones connues seulement. */
export function zonesDuTravail(references: ReferenceSimulee[]): { zone: IdZone; ref: string }[] {
  const vues = new Set<string>();
  const zones: { zone: IdZone; ref: string }[] = [];
  for (const r of references) {
    if (!estIdZone(r.zone) || vues.has(r.zone) || !r.ref) continue;
    vues.add(r.zone);
    zones.push({ zone: r.zone, ref: r.ref });
  }
  return zones;
}

/**
 * Moteur V2 seulement (en V1 le prompt et les adresses signés suffisent) : les
 * références envoyées par le site ne sont pas signées, les adresses des
 * échantillons le sont, et le moteur V2 construit le prompt depuis les
 * références — chaque référence relue au catalogue doit donc correspondre à un
 * échantillon signé. Une adresse qui diffère vient d'abord d'un cache périmé
 * (le site répare ses adresses d'images chaque semaine, le CRM garde le
 * catalogue six heures) : le catalogue est relu UNE fois avant de refuser ; site
 * injoignable ou référence inconnue : on laisse passer (la vérification ne
 * protège aucun coût, `referenceObligatoire` refusera une référence absente).
 */
export async function referencesCoherentes(references: ReferenceSimulee[], swatchUrls: string[]): Promise<boolean> {
  if (references.length === 0 || swatchUrls.length === 0) return true;
  const { reference, rafraichirCatalogue } = await import("@/lib/simulateur/catalogue");
  const signees = new Set(swatchUrls);
  const incoherentes = async (): Promise<string[]> => {
    const ecarts: string[] = [];
    for (const r of references) {
      const connue = await reference(r.ref).catch(() => null);
      if (connue !== null && !signees.has(connue.image)) ecarts.push(r.ref);
    }
    return ecarts;
  };
  const ecarts = await incoherentes();
  if (ecarts.length === 0) return true;
  if (!(await rafraichirCatalogue())) {
    console.warn(`[simulate] références ${ecarts.join(", ")} hors des échantillons signés, catalogue du site injoignable : demande acceptée`);
    return true;
  }
  const restants = await incoherentes();
  if (restants.length > 0) console.warn(`[simulate] références ${restants.join(", ")} hors des échantillons signés après relecture du catalogue : demande refusée`);
  return restants.length === 0;
}

/**
 * Crée le travail (photo écrite sur le volume) et met sa tâche en file ; rend
 * l'identifiant et l'attente annoncée. Une photo vide ou trop grosse est
 * refusée (« photo-refusee », c'est la photo) ; une écriture impossible
 * (volume plein, droits) est une panne de NOTRE côté : « stockage », message
 * honnête, et le quota du visiteur lui est rendu.
 */
export async function creerTravailSimulation(entree: EntreeTravail): Promise<{ travailId: string; attenteEstimeeS: number }> {
  const acceptable = imageBase64Acceptable(entree.photoBase64);
  const photoEmpreinte = acceptable ? empreintePhoto(Buffer.from(entree.photoBase64.replace(/^data:image\/\w+;base64,/, ""), "base64")) : null;
  const travail = await prisma.travailSimulation.create({
    data: {
      parcoursId: entree.parcoursId,
      projet: entree.projet.slice(0, 40),
      references: JSON.stringify(entree.references.slice(0, 5)),
      promptTexte: entree.prompt ?? null,
      swatchUrls: JSON.stringify(entree.swatchUrls ?? []),
      page: entree.page?.slice(0, 200) ?? null,
      source: entree.source?.slice(0, 120) ?? null,
      campagne: entree.campagne?.slice(0, 120) ?? null,
      ipOrigine: entree.ipOrigine ?? null,
      exemple: entree.exemple ?? null,
      photoEmpreinte,
      statut: "EN_ATTENTE",
    },
  });
  if (!acceptable) {
    await prisma.travailSimulation.update({ where: { id: travail.id }, data: { statut: "ECHEC", termineLe: new Date(), erreurRaison: "photo-refusee", erreurMessage: MESSAGES_ECHEC["photo-refusee"] } });
    return { travailId: travail.id, attenteEstimeeS: await attenteEstimeeS() };
  }
  const photoPath = await enregistrerImageBase64(entree.photoBase64, path.join(DOSSIER_SITE, entree.parcoursId, "travaux"), `${travail.id}.jpg`);
  if (!photoPath) {
    await prisma.travailSimulation.update({ where: { id: travail.id }, data: { statut: "ECHEC", termineLe: new Date(), erreurRaison: "stockage", erreurMessage: MESSAGE_STOCKAGE } });
    if (entree.ipOrigine) rendreSimulation(entree.ipOrigine);
    console.error(`[simulate] travail ${travail.id} : photo non écrite sur le volume (stockage) — quota rendu`);
    return { travailId: travail.id, attenteEstimeeS: await attenteEstimeeS() };
  }
  await prisma.travailSimulation.update({ where: { id: travail.id }, data: { photoPath } });
  await mettreEnFile({ type: TACHE_SIMULATION_SITE, cle: `simulation-site:${travail.id}`, charge: { travailId: travail.id }, priorite: 7, tentativesMax: 1 });
  return { travailId: travail.id, attenteEstimeeS: await attenteEstimeeS() };
}

class Abandon extends Error {
  constructor() {
    super("Génération abandonnée : délai de la tâche dépassé.");
    this.name = "Abandon";
  }
}

async function echouer(travailId: string, raison: string, message: string, ip: string | null, demarreLe: Date | null): Promise<{ statut: "ECHEC"; raison: string }> {
  const maintenant = new Date();
  await prisma.travailSimulation.updateMany({
    where: { id: travailId, statut: { in: ["EN_ATTENTE", "EN_COURS"] } },
    data: { statut: "ECHEC", termineLe: maintenant, dureeMs: demarreLe ? maintenant.getTime() - demarreLe.getTime() : null, erreurRaison: raison.slice(0, 60), erreurMessage: message.slice(0, 500) },
  });
  // Panne de notre côté ou coupure du service : le quota du visiteur lui est rendu.
  if (ip && ["service-indisponible", "config", "interrompue"].includes(raison)) rendreSimulation(ip);
  console.error(`[simulate] travail ${travailId} en échec (${raison}) : ${message.slice(0, 120)}`);
  return { statut: "ECHEC", raison };
}

type TravailLu = { id: string; parcoursId: string; projet: string; references: string; page: string | null; source: string | null; campagne: string | null; ipOrigine: string | null; leadId: string | null; photoPath: string | null; exemple?: string | null };
type Reussite = Extract<SortiePipeline, { ok: true }>;

/** Garde le rendu (SimulationSite + rattachement au lead du parcours) et pose PRETE. Une exception après OpenAI ne perd pas le rendu. */
async function terminerAvecRendu(travail: TravailLu, resultat: Reussite, demarreLe: Date): Promise<{ statut: "PRETE"; simulationSiteId: string }> {
  let simulationSiteId: string;
  const type = resultat.type ?? typeImage(resultat.image);
  const trace: TraceMoteur = {
    moteur: resultat.moteur,
    promptTexte: resultat.prompt,
    directionArtistique: resultat.directionArtistique,
    photoEmpreinte: resultat.empreinte,
    analyse: resultat.analyse ? JSON.stringify(resultat.analyse) : null,
    scoreControle: resultat.scoreControle,
    defautsControle: resultat.defautsControle ? JSON.stringify(resultat.defautsControle) : null,
    tentatives: resultat.tentatives,
  };
  try {
    // La photo avant gardée est celle au cadrage exact du rendu (superposable) ; sans cadrage, la photo du visiteur.
    const avant = resultat.avant ? `data:image/jpeg;base64,${resultat.avant.toString("base64")}` : `data:image/jpeg;base64,${(await fs.readFile(path.join(resolveUploadsDir(), travail.photoPath ?? ""))).toString("base64")}`;
    const gardee = await enregistrerSimulationSite({
      parcoursId: travail.parcoursId,
      projet: travail.projet,
      references: JSON.parse(travail.references || "[]") as ReferenceSimulee[],
      imageAvantBase64: avant,
      imageApresBase64: `data:${type};base64,${resultat.image.toString("base64")}`,
      page: travail.page,
      source: travail.source,
      campagne: travail.campagne,
      ipOrigine: travail.ipOrigine,
      exemple: travail.exemple ?? null,
      dureeMs: resultat.dureeMs,
      ...trace,
    });
    simulationSiteId = gardee.id;
    if (!gardee.imageAfterPath) throw new Error("rendu non écrit sur le volume");
  } catch (erreur) {
    console.error("[simulate] stockage du rendu impossible :", erreur);
    await echouer(travail.id, "stockage", MESSAGE_STOCKAGE, null, demarreLe);
    throw erreur;
  }
  // La photo du visiteur ne servait qu'à la tâche : la SimulationSite garde l'avant, le fichier du travail est effacé
  // (volume de 500 Mo ; « Réessayer » renvoie la photo depuis le navigateur).
  await effacerImage(travail.photoPath);
  const maintenant = new Date();
  await prisma.travailSimulation.update({ where: { id: travail.id }, data: { statut: "PRETE", etape: "rendu", termineLe: maintenant, dureeMs: maintenant.getTime() - demarreLe.getTime(), simulationSiteId, photoPath: null, moteur: resultat.moteur, promptTexte: resultat.prompt, photoEmpreinte: resultat.empreinte } });
  console.log(`[simulate] travail ${travail.id} prêt en ${maintenant.getTime() - demarreLe.getTime()} ms (simulation ${simulationSiteId}, moteur ${resultat.moteur}, ${extensionDe(type)}${resultat.scoreControle !== null ? `, contrôle ${resultat.scoreControle}/10` : ""})`);
  // La personne a déjà laissé ses coordonnées pendant ce parcours (ou « Me prévenir ») : la simulation rejoint sa fiche et son dossier,
  // qui s'ouvre au besoin (mission 18, A2) — jamais bloquant.
  try {
    // « Me prévenir » a pu poser le lead pendant la génération : relu maintenant, pas au départ.
    const leadId = (await prisma.travailSimulation.findUnique({ where: { id: travail.id }, select: { leadId: true } }))?.leadId ?? travail.leadId;
    const connu = leadId ? { id: leadId } : await prisma.lead.findFirst({ where: { parcoursId: travail.parcoursId, archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (connu) {
      await rattacherSimulationsSite(connu.id, travail.parcoursId, [simulationSiteId]);
      await ouvrirDossierAutomatique(connu.id);
    }
  } catch (erreur) {
    console.error("[simulate] rattachement au lead du parcours (non bloquant) :", erreur);
  }
  await notifierTravailPret(travail.id);
  return { statut: "PRETE", simulationSiteId };
}

/**
 * Le corps de la tâche SIMULATION_SITE. Idempotent : un travail déjà PRETE ou
 * ECHEC ne bouge pas ; un travail déjà démarré (la tâche a été réclamée une
 * seconde fois) devient ECHEC « interrompue » sans rappeler OpenAI.
 */
export async function executerTravailSimulation(travailId: string, signal?: AbortSignal): Promise<{ statut: "PRETE" | "ECHEC" | "INCHANGE"; simulationSiteId?: string; raison?: string }> {
  const travail = await prisma.travailSimulation.findUnique({ where: { id: travailId } });
  if (!travail) return { statut: "INCHANGE", raison: "introuvable" };
  if (travail.statut === "PRETE" || travail.statut === "ECHEC") return { statut: "INCHANGE", raison: travail.statut };
  if (travail.demarreLe) return echouer(travail.id, "interrompue", MESSAGE_INTERROMPUE, travail.ipOrigine, travail.demarreLe);

  const reglages = await reglagesSimulateur();
  const zones = zonesDuTravail(JSON.parse(travail.references || "[]") as ReferenceSimulee[]);
  // V2 sans zones connues (ancien site, références absentes) : le prompt signé du site sert (V1).
  const moteur = reglages.moteur === "V2" && zones.length > 0 ? "V2" : "V1";
  const demarreLe = new Date();
  const { count } = await prisma.travailSimulation.updateMany({ where: { id: travail.id, statut: "EN_ATTENTE", demarreLe: null }, data: { statut: "EN_COURS", demarreLe, etape: moteur === "V2" ? "analyse" : "rendu", moteur } });
  if (count !== 1) return echouer(travail.id, "interrompue", MESSAGE_INTERROMPUE, travail.ipOrigine, travail.demarreLe);

  const photo = travail.photoPath ? await fs.readFile(path.join(resolveUploadsDir(), travail.photoPath)).catch(() => null) : null;
  if (!photo) return echouer(travail.id, "photo-refusee", "Votre photo n'a pas pu être relue. Reprenez-la et relancez la simulation.", null, demarreLe);

  const surEtape = async (etape: EtapeTravail) => {
    await prisma.travailSimulation.updateMany({ where: { id: travail.id, statut: "EN_COURS" }, data: { etape } }).catch(() => undefined);
  };
  const generation = genererAvecMoteur({
    photo,
    piece: pieceDuProjet(travail.projet),
    zones,
    origine: "SITE",
    reglages: { ...reglages, moteur },
    promptV1: moteur === "V1" ? (travail.promptTexte ?? null) : null,
    swatchUrlsV1: lireSwatchUrls(travail.swatchUrls),
    parcoursId: travail.parcoursId,
    echeance: demarreLe.getTime() + DELAI_TACHE_SITE_MS,
    surEtape,
    signal,
    generateur: generateur(),
  });
  const abandon = new Promise<never>((_, rejeter) => {
    if (!signal) return;
    if (signal.aborted) rejeter(new Abandon());
    signal.addEventListener("abort", () => rejeter(new Abandon()), { once: true });
  });
  let resultat: SortiePipeline;
  try {
    resultat = await Promise.race([generation, abandon]);
  } catch (erreur) {
    if (erreur instanceof Abandon) {
      // Le rendu, s'il arrive plus tard, est quand même gardé (il est payé) : le lien du mail et la reprise le retrouvent.
      void generation.then((tardif) => (tardif.ok ? terminerAvecRendu(travail, tardif, demarreLe) : null)).catch(() => undefined);
      return echouer(travail.id, "delai", MESSAGES_ECHEC.delai, null, demarreLe);
    }
    console.error(`[simulate] travail ${travail.id} : pipeline en erreur`, erreur);
    return echouer(travail.id, "erreur", MESSAGES_ECHEC.erreur, null, demarreLe);
  }
  if (!resultat.ok) {
    const raison = resultat.raison === "config" ? "service-indisponible" : resultat.raison;
    return echouer(travail.id, raison, resultat.message, travail.ipOrigine, demarreLe);
  }
  try {
    return await terminerAvecRendu(travail, resultat, demarreLe);
  } catch {
    return { statut: "ECHEC", raison: "stockage" };
  }
}

/** Enregistrement de la tâche (traitements.ts) : voie longue, une seule tentative (une génération ratée est peut-être facturée). */
export function enregistrerTachesSimulationSite(): void {
  enregistrerTraitement(TACHE_SIMULATION_SITE, {
    libelle: "Simulateur du site : génération d'un rendu",
    acteur: "SYSTEME:simulateur-site",
    tentativesMax: 1,
    delaiMaxMs: DELAI_TACHE_SITE_MS,
    voie: "longue",
    executer: async (charge, { signal }) => executerTravailSimulation((charge as { travailId: string }).travailId, signal),
  });
}
