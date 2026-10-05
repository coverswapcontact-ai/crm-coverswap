import type { EspaceClient } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { pluriel } from "@/lib/commun/format";
import { recalculerMain } from "@/lib/dossiers/main";
import { idPhoto } from "@/lib/dossiers/stockage";
import { avecActeur } from "@/lib/journal/contexte";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireParametre } from "@/lib/parametres/service";
import { famillesDe, lireSelection, type IdFamille, type SelectionPrestations } from "@/lib/prestations/prestations";
import { messageZonesNonVisibles } from "@/lib/simulateur/analyses";
import { creditDisponible } from "@/lib/simulateur/consommation";
import { lireZones, TYPES_SURFACE_ESPACE, type ZoneTeinte } from "@/lib/simulateur/types-surface";
import { ZONES_MAX } from "@/lib/simulateur/zones";
import { ACTEUR, prevenir } from "./alertes";
import { restantes, SIMULATIONS_OFFERTES_PAR_DEFAUT } from "./faits";
import { attenteEstimeeEspaceS, CODES_PIECES_ESPACE, MESSAGE_RELECTURE, piecesPourLeClient, zonesNonVisiblesPourPhotoDuDossier, type PieceClient } from "./simulateur";

/**
 * Les simulations que le client crée lui-même dans son espace (espace v3,
 * mission 15 partie 5) — extrait de `service.ts` : son compte (offertes,
 * accordées, faites ici et sur le site, en cours), ce que « Créer une
 * simulation » lit (`creation` de l'état), le lancement (quota → crédit → photo
 * → zones visibles → préparation en mode API, origine CLIENT), le suivi pour
 * l'écran d'attente, « Demandez-en d'autres » et l'accord de Lucas.
 */

/** Ce que « Créer une simulation » lit dans l'état de l'espace (`EtatEspace.creation`). */
export type CreationClient = {
  gratuites: number;
  accordees: number;
  /** Faites dans l'espace + faites sur le site : les deux comptent. */
  faites: number;
  faitesSite: number;
  restantes: number;
  /** En cours de génération : la photo et les teintes, pour l'écran d'attente (même sur un autre appareil). */
  enCours: { id: string; le: string; photoId: string | null; zones: ZoneTeinte[] }[];
  /** Mission 15 (partie 5) : gardées en brouillon (contrôle sous le seuil), le client attend la relecture de CoverSwap. */
  enRelecture: { id: string; le: string }[];
  demandeesLe: string | null;
  disponible: boolean;
  /** Zones de son projet (dans l'ordre du simulateur) et celles qu'il a cochées dans son Projet. */
  zones: { zone: string; libelle: string }[];
  zonesProjet: string[];
  /** Toutes les pièces du simulateur (source unique du CRM, murs compris), avec leurs zones ; `piece` : celle de son projet (proposée d'abord). */
  piece: string;
  pieces: PieceClient[];
  /** Limite de zones par simulation (la même que le site). */
  zonesMax: number;
};

/** Simulations offertes par espace (paramètre du CRM, 5 si rien n'est saisi). */
export async function simulationsGratuites(): Promise<number> {
  const brut = await lireParametre("SIMULATEUR_ESPACE_GRATUITES").catch(() => null);
  // Rien de saisi : 5 (et non 0 — Number(null) vaut 0).
  if (brut === null || brut === undefined || String(brut).trim() === "") return SIMULATIONS_OFFERTES_PAR_DEFAUT;
  const valeur = Number(brut);
  return Number.isFinite(valeur) && valeur >= 0 ? Math.floor(valeur) : SIMULATIONS_OFFERTES_PAR_DEFAUT;
}

/**
 * Le compte du client : offertes, accordées en plus, faites (dans l'espace ET sur le site : deux simulations
 * faites sur coverswap.fr avant de recevoir son lien en laissent trois), en cours ; ce qu'il lui reste.
 * Une simulation masquée ou archivée par Lucas reste comptée : elle a coûté.
 */
export async function quotaSimulations(espace: Pick<EspaceClient, "id" | "dossierId" | "simulationsAccordees">): Promise<{ gratuites: number; accordees: number; faites: number; faitesSite: number; enCours: CreationClient["enCours"]; restantes: number }> {
  const [gratuites, faitesEspace, faitesSite, enCours] = await Promise.all([
    simulationsGratuites(),
    prisma.simulationEspace.count({ where: { ...AVEC_ARCHIVES, espaceId: espace.id, source: "CLIENT" } }),
    prisma.simulationEspace.count({ where: { ...AVEC_ARCHIVES, espaceId: espace.id, source: "SITE" } }),
    // Une génération tient une minute ; au-delà d'une demi-heure, elle est tenue pour perdue (elle ne bloque plus rien).
    prisma.preparationSimulation.findMany({ where: { dossierId: espace.dossierId, origine: "CLIENT", statut: "EN_COURS", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, photoSource: true, zones: true } }),
  ]);
  const accordees = espace.simulationsAccordees ?? 0;
  return {
    gratuites,
    accordees,
    faites: faitesEspace + faitesSite,
    faitesSite,
    enCours: enCours.map((p) => ({ id: p.id, le: p.createdAt.toISOString(), photoId: idPhoto(p.photoSource) || null, zones: lireZones(p.zones) })),
    restantes: restantes({ gratuites, accordees, faitesEspace, faitesSite, enCours: enCours.length }),
  };
}

export async function creationPourLeClient(espace: EspaceClient, familles: IdFamille[], selection: SelectionPrestations, apercu = false): Promise<CreationClient> {
  const [quota, disponible, enRelecture] = await Promise.all([
    quotaSimulations(espace),
    creditDisponible().catch(() => true),
    prisma.simulationEspace.findMany({ where: { espaceId: espace.id, source: "CLIENT", statut: "BROUILLON" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true } }),
  ]);
  // Un client tombe sur « momentanément indisponible » : Lucas le sait (au plus une alerte toutes les trois heures).
  if (!disponible && !apercu) void alerterCreditEpuise(espace.dossierId).catch(() => undefined);
  // Les pièces : celles de SON projet d'abord (ses familles, sinon celles que laisse deviner sa demande), puis les autres
  // (murs compris — source unique du simulateur) ; les zones : celles de ses sous-parties cochées d'abord.
  const pieces = piecesPourLeClient(familles, selection);
  return {
    gratuites: quota.gratuites,
    accordees: quota.accordees,
    faites: quota.faites,
    faitesSite: quota.faitesSite,
    restantes: quota.restantes,
    enCours: quota.enCours,
    enRelecture: enRelecture.map((s) => ({ id: s.id, le: s.createdAt.toISOString() })),
    demandeesLe: espace.simulationsDemandeesLe?.toISOString() ?? null,
    disponible,
    zones: pieces[0].zones.map((z) => ({ zone: z.zone, libelle: z.libelle })),
    zonesProjet: pieces[0].cochees,
    piece: pieces[0].piece,
    pieces,
    zonesMax: ZONES_MAX,
  };
}

export const schemaCreationSimulation = z.object({
  /** La pièce simulée (toutes celles du simulateur, murs compris) ; sans elle : celle de son projet. */
  piece: z.enum(CODES_PIECES_ESPACE as [string, ...string[]]).optional(),
  photoId: z.string().min(1, "Choisissez une photo.").max(80),
  zones: z.array(z.object({ zone: z.string().min(1).max(40), ref: z.string().min(1).max(24) })).min(1, "Choisissez au moins une teinte.").max(ZONES_MAX, `${ZONES_MAX} zones au plus par simulation.`),
});

/**
 * Le client lance une simulation depuis son espace : SA photo, les zones de son
 * projet, une teinte par zone. Même chemin que le mode API du CRM (consigne du
 * site, moteur commun) ; le résultat arrive dans sa galerie. Refusé sans rien
 * lancer si ses simulations offertes sont épuisées, si le crédit est épuisé, ou
 * si une zone choisie n'est pas sur la photo d'après son analyse (409
 * « zone-non-visible », comme sur le site) : ses choix restent dans son téléphone.
 */
export async function creerSimulationClient(espace: EspaceClient, entree: z.output<typeof schemaCreationSimulation>): Promise<{ preparationId: string; restantes: number; attenteEstimeeS: number }> {
  const quota = await quotaSimulations(espace);
  const total = quota.gratuites + quota.accordees;
  if (quota.restantes <= 0) {
    if (quota.enCours.length > 0) throw new ErreurMetier("Votre simulation est en cours de création : patientez un instant.", 409, { raison: "en-cours" });
    throw new ErreurMetier(`${total > 1 ? `Vous avez utilisé vos ${total} simulations.` : "Vous avez utilisé votre simulation."} Demandez-en d'autres à CoverSwap.`, 409, { raison: "quota" });
  }
  if (!(await creditDisponible().catch(() => true))) {
    await alerterCreditEpuise(espace.dossierId);
    throw new ErreurMetier("La création de simulations est momentanément indisponible. Vos choix sont gardés : réessayez plus tard, CoverSwap est prévenu.", 503, { raison: "credit" });
  }
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { photos: true, prestations: true, lead: { select: { typeProjet: true } } } });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const { photosDuClient } = await import("./service");
  const photos = await photosDuClient(espace.dossierId, dossier.photos);
  if (!photos.some((p) => p.id === entree.photoId)) throw new ErreurMetier("Cette photo n'est plus dans votre espace : choisissez-en une autre.", 404);
  // Une zone choisie que l'analyse connue de la photo ne voit pas : dit avant de dépenser (jamais à l'aveugle).
  const nonVisibles = await zonesNonVisiblesPourPhotoDuDossier(espace.dossierId, entree.photoId, entree.zones.map((z) => z.zone)).catch(() => []);
  if (nonVisibles.length > 0) throw new ErreurMetier(messageZonesNonVisibles(nonVisibles), 409, { raison: "zone-non-visible", zones: nonVisibles });
  // La pièce choisie, sinon la première famille de son projet (cuisine s'il n'en a pas encore).
  const piece = entree.piece ?? famillesDe(lireSelection(dossier.prestations))[0] ?? "CUISINE";
  const type = TYPES_SURFACE_ESPACE[piece] ?? TYPES_SURFACE_ESPACE.CUISINE;
  const { preparerSimulation } = await import("@/lib/simulateur/preparation");
  const preparation = await avecActeur(ACTEUR, () => preparerSimulation({ dossierId: espace.dossierId, photoId: entree.photoId, typeSurface: type.id, zones: entree.zones, mode: "API" }, { origine: "CLIENT" }));
  return { preparationId: preparation.id, restantes: Math.max(0, quota.restantes - 1), attenteEstimeeS: await attenteEstimeeEspaceS() };
}

export type SuiviCreation = {
  /** RELECTURE (mission 15, partie 5) : générée mais gardée en brouillon pour CoverSwap (contrôle sous le seuil) ; le client l'attend. */
  statut: "EN_COURS" | "PRETE" | "ECHEC" | "RELECTURE";
  /** L'étape en cours (analyse | matieres | rendu) ; null tant que la génération n'a pas été prise (file d'attente). */
  etape: string | null;
  attenteEstimeeS: number;
  simulationId: string | null;
  message: string | null;
  raison: "credit" | "echec" | "interrompue" | null;
};

/**
 * Où en est une simulation lancée par le client : en cours (avec l'étape, pour
 * l'écran d'attente), prête (dans sa galerie), en relecture, ou pas aboutie
 * (dit simplement). Même rythme que le site : le navigateur sonde toutes les 3 s.
 */
export async function suivreCreation(espace: EspaceClient, preparationId: string): Promise<SuiviCreation> {
  const p = await prisma.preparationSimulation.findFirst({ where: { id: preparationId, dossierId: espace.dossierId, origine: "CLIENT" }, select: { statut: true, etape: true, resultatId: true, erreur: true, createdAt: true } });
  if (!p) throw new ErreurMetier("Simulation introuvable.", 404);
  const attenteEstimeeS = await attenteEstimeeEspaceS();
  const commun = { etape: p.etape, attenteEstimeeS, simulationId: null, message: null, raison: null };
  if (p.statut === "TERMINEE") {
    const resultat = p.resultatId ? await prisma.simulationEspace.findFirst({ where: { ...AVEC_ARCHIVES, id: p.resultatId }, select: { statut: true } }) : null;
    if (resultat?.statut === "BROUILLON") return { ...commun, statut: "RELECTURE", simulationId: p.resultatId, message: MESSAGE_RELECTURE };
    return { ...commun, statut: "PRETE", simulationId: p.resultatId };
  }
  if (p.statut === "ECHEC" || (p.statut === "EN_COURS" && Date.now() - p.createdAt.getTime() > 30 * 60_000)) {
    const credit = /crédit|clé refusée/i.test(p.erreur ?? "");
    const interrompue = /interrompue par une mise à jour/i.test(p.erreur ?? "");
    return {
      ...commun,
      statut: "ECHEC",
      raison: credit ? "credit" : interrompue ? "interrompue" : "echec",
      message: credit
        ? "La création de simulations est momentanément indisponible. Vos choix sont gardés ; CoverSwap est prévenu."
        : interrompue
          ? "La génération a été interrompue par une mise à jour du service. Elle ne compte pas : relancez-la."
          : "Cette simulation n'a pas abouti. Elle ne compte pas : vous pouvez la relancer.",
    };
  }
  return { ...commun, statut: "EN_COURS" };
}

let derniereAlerteCredit = 0;
async function alerterCreditEpuise(dossierId: string): Promise<void> {
  if (Date.now() - derniereAlerteCredit < 3 * 3_600_000) return;
  derniereAlerteCredit = Date.now();
  await prevenir(dossierId, { titre: "Un client ne peut pas créer de simulation", texte: "Crédit OpenAI épuisé (ou clé refusée) : la création de simulations est bloquée dans les espaces clients. Rechargez le crédit, puis notez le nouveau solde dans Paramètres.", urgence: 4, etiquette: "credit-openai-espace" });
}

/** « Demandez-en d'autres à CoverSwap » : la demande est notée, Lucas prévenu ; il accorde d'un clic depuis le CRM. */
export async function demanderSimulations(espace: EspaceClient): Promise<void> {
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
  const quota = await quotaSimulations(espace);
  await avecActeur(ACTEUR, async () => {
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { simulationsDemandeesLe: new Date() } });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATIONS_DEMANDEES", direction: "ENTRANT", contenu: `Le client demande d'autres simulations (${quota.faites} faite${quota.faites > 1 ? "s" : ""} sur ${quota.gratuites + quota.accordees}).`, metadata: "{}" } });
  });
  await prevenir(espace.dossierId, { titre: `${dossier?.clientNom ?? "Un client"} demande d'autres simulations`, texte: `${pluriel(quota.faites, "simulation faite", "simulations faites")} (site et espace). Accordez-en d'autres en un clic depuis le bloc Espace du dossier.`, urgence: 3, telephone: dossier?.clientTelephone });
}

/** Lucas accorde des simulations de plus (bloc Espace du dossier, assistant) : la demande est close. */
export async function accorderSimulations(espaceId: string, nombre: number): Promise<{ accordees: number }> {
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 20) throw new ErreurMetier("Nombre de simulations invalide (1 à 20).", 400);
  const espace = await prisma.espaceClient.findUnique({ where: { id: espaceId }, select: { id: true, dossierId: true } });
  if (!espace) throw new ErreurMetier("Espace introuvable.", 404);
  const mis = await prisma.espaceClient.update({ where: { id: espace.id }, data: { simulationsAccordees: { increment: nombre }, simulationsDemandeesLe: null } });
  await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATIONS_ACCORDEES", direction: "SORTANT", contenu: `${nombre} simulation${nombre > 1 ? "s" : ""} de plus accordée${nombre > 1 ? "s" : ""} au client dans son espace.`, metadata: JSON.stringify({ nombre }) } });
  await recalculerMain(espace.dossierId);
  return { accordees: mis.simulationsAccordees };
}
