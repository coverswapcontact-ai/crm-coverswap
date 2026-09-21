import { promises as fs } from "node:fs";
import path from "node:path";
import type { EspaceClient, SimulationEspace } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { alerter } from "@/lib/alertes/canaux";
import { mettreEnFile } from "@/lib/taches/file";
import { EMETTEUR, FORMATS_PHOTO, PHOTO_OCTETS_MAX, type EtapeDossier } from "@/lib/dossiers/constants";
import { ajouterPhoto } from "@/lib/dossiers/dossiers";
import { montantsDocument } from "@/lib/dossiers/montants";
import { idPhoto, lireLignes, lirePhotos, estPhotoApres } from "@/lib/dossiers/stockage";
import { changerEtape } from "@/lib/dossiers/transitions";
import { conditionsDuDevis } from "@/lib/pdf/conditions";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { resolveUploadsDir } from "@/lib/uploads";
import { libelleZoneClient, lireZones, PIECES_ESPACE, TYPES_SURFACE_ESPACE, typeEspacePourProjet, ZONES, type ZoneTeinte } from "@/lib/simulateur/types-surface";
import { creditDisponible } from "@/lib/simulateur/consommation";
import { lireParametre } from "@/lib/parametres/service";
import { deposerSimulationDossier, lireImage, synchroniserSimulationsSite } from "@/lib/simulations/dossier";
import { etapeEspace, progression, type EtapeEspace, type FaitsEspace } from "./etapes";
import { lireProjet, projetComplet, projetPrecise, resumerProjet, schemaProjet, ZONES_DEPUIS_SITE, type ProjetClient } from "./projet";
import { composerFaits, dateSignature, lireDevisEtPaiements, restantes, SIMULATIONS_OFFERTES_PAR_DEFAUT, type AccordEffectif, type DevisLu, type PaiementEspace } from "./faits";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";

/**
 * L'espace client : ce que le client voit de SON projet, et ce qu'il peut y faire.
 *
 * Tout ce qui sort d'ici est filtré pour lui : jamais une note interne, jamais
 * un autre dossier, jamais une photo qui ne soit pas la sienne, jamais un
 * brouillon de simulation. Chaque geste écrit un événement dans son dossier
 * (acteur « EXTERNE:espace-client » au journal) et prévient Lucas quand il
 * compte : première ouverture, photos, projet précisé, simulation choisie ou
 * nouvelle proposition demandée, devis consulté, accord.
 */
// Le client n'a pas de session : ses écritures sont celles d'un appel externe, nommé (le journal sait que c'est lui).
const ACTEUR = { acteur: "EXTERNE:espace-client", origine: "espace-client" } as const;
const PHOTOS_MAX_PAR_DOSSIER = 40;
export const TACHE_ALERTE_PHOTOS = "ESPACE_PHOTOS_ALERTE";
/** Le projet s'enregistre à la frappe : Lucas est prévenu une fois, quelques minutes après, avec la version posée. */
export const TACHE_ALERTE_PROJET = "ESPACE_PROJET_ALERTE";
/** Délai annoncé au client pour ses premières simulations. */
export const DELAI_SIMULATION = "sous 24 h";

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
const lienDossier = (dossierId: string) => `${appUrl()}/dossiers?dossier=${dossierId}`;
const CANAUX_POUSSES = ["telegram", "ntfy", "pushweb"] as const;

async function prevenir(dossierId: string, alerte: { titre: string; texte: string; urgence: 1 | 2 | 3 | 4 | 5; telephone?: string | null; etiquette?: string }, origine = "espace-client"): Promise<void> {
  try {
    await alerter(
      { titre: alerte.titre, texte: alerte.texte, lien: lienDossier(dossierId), libelleLien: "Ouvrir le dossier", telephone: alerte.telephone || undefined, urgence: alerte.urgence, etiquette: alerte.etiquette ?? `espace-${dossierId}` },
      { origine, canaux: [...CANAUX_POUSSES] }
    );
  } catch (erreur) {
    console.error(`[espace] alerte « ${alerte.titre} » non envoyée :`, erreur);
  }
}

/* ── Ce que voit le client ─────────────────────────────────────────── */

export type SimulationClient = {
  id: string;
  titre: string | null;
  description: string | null;
  /** SITE : son essai sur coverswap.fr ; CLIENT : créée par lui dans son espace ; CRM : préparée et publiée par CoverSwap. */
  source: "SITE" | "CRM" | "CLIENT";
  zones: ZoneTeinte[];
  avant: boolean;
  le: string;
  nouvelle: boolean;
  choisie: boolean;
  commentaire: string | null;
};

export type DevisClient = {
  id: string;
  numero: string;
  objet: string;
  lignes: ({ type: "SECTION"; libelle: string } | { type: "PRESTATION"; designation: string; detail: string | null; quantite: number; unite: string; prixUnitaire: number; total: number })[];
  total: number;
  acompte: number;
  acomptePct: number | null;
  solde: number;
  conditions: string[];
  mentionTva: string;
  emisLe: string;
  valableJusquau: string;
  accepte: { le: string; nom: string; source: "ESPACE" | "CRM"; retirable: boolean } | null;
  /** Devis émis avant le CRM : pas de détail ligne à ligne, le PDF fait foi. */
  repris: boolean;
  pdf: string | null;
};

export type ChoixClient =
  | { mode: "UNE"; simulationId: string; commentaire: string | null; le: string }
  | { mode: "COMPOSITE"; zones: (ZoneTeinte & { simulationId: string })[]; commentaire: string | null; le: string };

export type EtatEspace = {
  version: 2;
  apercu: boolean;
  prenom: string;
  nom: string;
  ville: string;
  typeProjet: string;
  projet: string;
  etape: EtapeEspace;
  etapes: ReturnType<typeof progression>;
  /** Ancien nom de l'étape (espace du 20/09), gardé le temps que le site soit redéployé. */
  avancement: "PHOTOS" | "SIMULATION" | "DEVIS" | "ACCORD" | "CHANTIER";
  photos: { id: string; le: string | null }[];
  monProjet: ProjetClient | null;
  /** Le projet est validé (pastille verte) ; `manque` dit ce qu'il faut encore pour pouvoir le valider. */
  projetValide: { le: string; par: "CLIENT" | "LUCAS" } | null;
  projetManque: string | null;
  /** Ce qu'on sait déjà : jamais redemandé, proposé en préremplissage. */
  connu: { tailleCuisine: string | null; delai: string | null; delaiTexte: string | null; proprietaire: boolean | null; zones: string[]; refsSite: string[] };
  /** Ancien format des souhaits (espace du 20/09). */
  souhaits: { teintes: string[]; style: string | null; propositions: boolean; precisions: string } | null;
  simulations: SimulationClient[];
  simulationsEnPreparation: { delai: string } | null;
  propositionDemandeeLe: string | null;
  propositionMessage: string | null;
  choix: ChoixClient | null;
  coordonnees: { nom: string; adresse: string; codePostal: string; ville: string; email: string | null; completes: boolean };
  devis: DevisClient | null;
  acompte: { montant: number; recu: number; complet: boolean } | null;
  /** Onglet Paiement : ce qui est dû, ce qui est payé (date et moyen), à partir des encaissements du dossier. */
  paiement: (PaiementEspace & { devisNumero: string; signeLe: string | null }) | null;
  virement: { titulaire: string; iban: string; bic: string; reference: string } | null;
  /** Paiement de l'acompte par carte : proposé seulement quand il est activé côté CRM. */
  paiementCarte: boolean;
  chantier: { date: string | null } | null;
  apres: { photos: { id: string }[]; avis: { note: number; texte: string; le: string } | null } | null;
  contact: { nom: string; prenom: string; role: string; telephone: string; telephoneLien: string; portrait: boolean };
  /** Espace v3 : l'espace parle au nom de CoverSwap (le numéro reste celui de Lucas). */
  marque: { nom: string; telephone: string; telephoneLien: string };
  /** Les simulations que le client crée lui-même : combien il en reste, celles en cours, le crédit. */
  creation: {
    gratuites: number;
    accordees: number;
    /** Faites dans l'espace + faites sur le site : les deux comptent. */
    faites: number;
    faitesSite: number;
    restantes: number;
    enCours: { id: string; le: string }[];
    demandeesLe: string | null;
    disponible: boolean;
    /** Zones de son projet (dans l'ordre du simulateur) et celles qu'il a cochées dans son Projet. */
    zones: { zone: string; libelle: string }[];
    zonesProjet: string[];
    /** Toutes les pièces du simulateur du site, avec leurs zones ; `piece` : celle de son projet (proposée d'abord). */
    piece: string;
    pieces: { piece: string; libelle: string; aide: string; zones: { zone: string; libelle: string }[] }[];
  };
  favoris: string[];
  /** Il peut encore changer de simulation validée : aucun devis n'est émis. */
  choixModifiable: boolean;
  expireLe: string;
};

const CLIENT_INCONNU = /^(inconnu|client)$/i;

/** Photos de chantier qui sont des rendus du site (copies) : ce ne sont pas des photos du client. */
async function rendusDansLesPhotos(dossierId: string): Promise<Set<string>> {
  const simulations = await prisma.simulation.findMany({ where: { dossierId, photosDossier: { not: null } }, select: { photosDossier: true } });
  const ids = new Set<string>();
  for (const s of simulations) {
    try {
      const { rendu } = JSON.parse(s.photosDossier!) as { rendu?: string | null };
      if (rendu) ids.add(rendu);
    } catch {
      // ignoré
    }
  }
  return ids;
}

/** Photos « avant » du client dans son dossier (ni rendu du site, ni photo après chantier). */
export async function photosDuClient(dossierId: string, photosJson: string): Promise<{ chemin: string; id: string }[]> {
  const rendus = await rendusDansLesPhotos(dossierId);
  return lirePhotos(photosJson)
    .filter((chemin) => !estPhotoApres(chemin))
    .map((chemin) => ({ chemin, id: idPhoto(chemin) }))
    .filter((p) => !rendus.has(p.id));
}

function lireChoix(json: string | null): ChoixClient | null {
  if (!json) return null;
  try {
    const choix = JSON.parse(json) as ChoixClient;
    return choix && (choix.mode === "UNE" || choix.mode === "COMPOSITE") ? choix : null;
  } catch {
    return null;
  }
}

function devisPourLeClient(devis: DevisLu, accord: AccordEffectif | null, retirable: boolean): DevisClient {
  const lignes = lireLignes(devis.lignes);
  const montants = montantsDocument({ lignes, totalHt: devis.totalHt, acomptePct: devis.acomptePct });
  const emisLe = devis.dateEmission ?? devis.createdAt;
  return {
    id: devis.id,
    numero: devis.numero!,
    objet: devis.objet,
    lignes: lignes.map((l) =>
      l.type === "SECTION"
        ? { type: "SECTION" as const, libelle: l.libelle }
        : { type: "PRESTATION" as const, designation: l.designation, detail: l.sousDesignation ?? null, quantite: l.quantite, unite: l.unite, prixUnitaire: l.prixUnitaire, total: Math.round(l.quantite * l.prixUnitaire * 100) / 100 }
    ),
    total: montants.totalTtcCentimes / 100,
    acompte: montants.acompteCentimes / 100,
    acomptePct: devis.acomptePct,
    solde: montants.soldeCentimes / 100,
    conditions: conditionsDuDevis(lignes, devis.acomptePct, montants),
    // Le PDF l'écrit en capitales ; à l'écran, en phrase lisible.
    mentionTva: /293 B/i.test(EMETTEUR.mentionTva) ? "TVA non applicable, article 293 B du CGI" : EMETTEUR.mentionTva,
    emisLe: emisLe.toISOString(),
    valableJusquau: new Date(emisLe.getTime() + 30 * 86_400_000).toISOString(),
    accepte: accord ? { le: accord.le.toISOString(), nom: accord.nom, source: accord.source, retirable: accord.source === "ESPACE" && retirable } : null,
    repris: devis.origine === "REPRISE",
    pdf: devis.pdfPath ? `devis/${devis.id}` : null,
  };
}

async function portraitExiste(): Promise<boolean> {
  return fs
    .stat(path.join(resolveUploadsDir(), "espace", "portrait.jpg"))
    .then((s) => s.size > 0)
    .catch(() => false);
}

export async function etatEspace(espace: EspaceClient, options: { apercu?: boolean } = {}): Promise<EtatEspace> {
  await synchroniserSimulationsSite(espace.dossierId).catch((erreur) => console.error("[espace] synchronisation des simulations du site :", erreur));
  const dossier = await prisma.dossier.findUnique({
    where: { id: espace.dossierId },
    select: {
      id: true,
      clientNom: true,
      clientAdresse: true,
      clientCp: true,
      clientVille: true,
      clientEmail: true,
      objet: true,
      etape: true,
      photos: true,
      dateChantier: true,
      lead: { select: { prenom: true, typeProjet: true, tailleCuisine: true, delaiProjet: true, delaiProjetTexte: true, occupation: true } },
      documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" } },
      accords: { orderBy: { createdAt: "desc" } },
      encaissements: { select: { montant: true, moyen: true, recuLe: true, statut: true } },
      evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, createdAt: true, survenuLe: true } },
    },
  });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const [simulations, photosClient, portrait, enPreparationCrm] = await Promise.all([
    prisma.simulationEspace.findMany({ where: { espaceId: espace.id, statut: "PUBLIEE" }, orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] }),
    photosDuClient(dossier.id, dossier.photos),
    portraitExiste(),
    // CoverSwap prépare vraiment quelque chose : un brouillon déposé, ou une préparation du CRM en cours.
    Promise.all([
      prisma.simulationEspace.count({ where: { espaceId: espace.id, statut: "BROUILLON" } }),
      prisma.preparationSimulation.count({ where: { dossierId: espace.dossierId, origine: "CRM", statut: { in: ["PREPAREE", "EN_COURS"] }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    ]).then(([brouillons, preparations]) => brouillons + preparations > 0),
  ]);
  // Devis en vigueur (repris compris), accord (en ligne ou constaté dans le CRM), paiements : lecture unique (faits.ts).
  const lecture = lireDevisEtPaiements({ devis: dossier.documents, accords: dossier.accords, encaissements: dossier.encaissements, clientNom: dossier.clientNom, signeLe: dateSignature(dossier.evenements) });
  const accord = lecture.accord;
  // Il peut revenir sur son accord tant que rien n'est encaissé et que le chantier n'est pas planifié.
  const accordRetirable = dossier.etape === "SIGNE" && (lecture.paiement?.recu ?? 0) === 0;
  const devis = lecture.devis ? devisPourLeClient(lecture.devis, accord, accordRetirable) : null;
  const recu = lecture.paiement?.recu ?? 0;
  const monProjet = lireProjet(espace.souhaits);
  const choix = lireChoix(espace.choix);
  const simulationsCrm = simulations.filter((s) => s.source !== "SITE" && s.source !== "CLIENT").length;
  const simulationsClient = simulations.filter((s) => s.source === "CLIENT").length;
  const faits: FaitsEspace = composerFaits({
    photos: photosClient.length,
    projetPrecise: projetPrecise(monProjet),
    projetValide: Boolean(espace.projetValideLe),
    simulationsCrm,
    simulationsSite: simulations.filter((s) => s.source === "SITE").length,
    simulationsClient,
    choix: Boolean(espace.choixLe && choix),
    lecture,
    etapeDossier: dossier.etape,
  });
  const etape = etapeEspace(faits);
  const prenomBrut = (dossier.lead?.prenom ?? dossier.clientNom.split(/\s+/)[0] ?? "").trim();
  const prenom = CLIENT_INCONNU.test(prenomBrut) ? "" : prenomBrut.split(/\s+/)[0];
  const typeProjet = dossier.lead?.typeProjet ?? "CUISINE";
  const vuesLe = espace.simulationsVuesLe?.getTime() ?? 0;

  // Ce qu'il a déjà dit : sur le formulaire (Meta, site) et dans ses simulations du site.
  const zonesSite = new Set<string>();
  const refsSite: string[] = [];
  for (const s of simulations.filter((x) => x.source === "SITE")) {
    for (const z of lireZones(s.zones)) {
      for (const zone of ZONES_DEPUIS_SITE[z.zone] ?? []) zonesSite.add(zone);
      if (!refsSite.includes(z.ref)) refsSite.push(z.ref);
    }
  }
  const delaiConnu = dossier.lead?.delaiProjet === "COURT" ? "vite" : dossier.lead?.delaiProjet === "MOYEN" ? "1-3-mois" : dossier.lead?.delaiProjet === "LOINTAIN" ? "plus-tard" : null;
  const ancien = (() => {
    try {
      const brut = espace.souhaits ? (JSON.parse(espace.souhaits) as Record<string, unknown>) : null;
      return brut && Array.isArray(brut.teintes) ? { teintes: brut.teintes as string[], style: (brut.style as string | null) ?? null, propositions: Boolean(brut.propositions), precisions: String(brut.precisions ?? "") } : null;
    } catch {
      return null;
    }
  })();
  const apresChantier = ["CHANTIER", "FACTURE", "ENCAISSE"].includes(dossier.etape);
  const avis = (() => {
    try {
      return espace.avis ? (JSON.parse(espace.avis) as { note: number; texte: string; le: string }) : null;
    } catch {
      return null;
    }
  })();

  return {
    version: 2,
    apercu: Boolean(options.apercu),
    prenom,
    nom: dossier.clientNom,
    ville: dossier.clientVille,
    typeProjet,
    projet: dossier.objet || "Votre projet de rénovation",
    etape,
    etapes: progression(faits),
    avancement: faits.accord ? "ACCORD" : ["PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(dossier.etape) ? "CHANTIER" : devis ? "DEVIS" : simulations.length > 0 ? "SIMULATION" : "PHOTOS",
    photos: photosClient.map((p) => ({ id: p.id, le: null })),
    monProjet,
    projetValide: espace.projetValideLe ? { le: espace.projetValideLe.toISOString(), par: espace.projetValidePar === "LUCAS" ? "LUCAS" : "CLIENT" } : null,
    projetManque: projetComplet(monProjet, typeProjet),
    connu: {
      tailleCuisine: dossier.lead?.tailleCuisine ?? null,
      delai: delaiConnu,
      delaiTexte: dossier.lead?.delaiProjetTexte ?? null,
      proprietaire: dossier.lead?.occupation === "PROPRIETAIRE" ? true : dossier.lead?.occupation === "LOCATAIRE" ? false : null,
      zones: [...zonesSite],
      refsSite,
    },
    souhaits: ancien,
    simulations: simulations.map((s) => ({
      id: s.id,
      titre: s.titre,
      description: s.description,
      source: s.source === "SITE" ? ("SITE" as const) : s.source === "CLIENT" ? ("CLIENT" as const) : ("CRM" as const),
      zones: lireZones(s.zones).map((z) => ({ ...z, libelle: libelleZoneClient(z.zone, typeProjet) ?? z.libelle })),
      avant: Boolean(s.photoAvant),
      le: (s.publieeLe ?? s.createdAt).toISOString(),
      nouvelle: s.source !== "SITE" && s.source !== "CLIENT" && (s.publieeLe ?? s.createdAt).getTime() > vuesLe,
      choisie: Boolean(s.choisieLe),
      commentaire: s.commentaireClient,
    })),
    // v3 : il crée lui-même ses simulations ; « CoverSwap prépare » ne s'affiche que si c'est vrai.
    simulationsEnPreparation: enPreparationCrm && !faits.devis ? { delai: DELAI_SIMULATION } : null,
    propositionDemandeeLe: espace.propositionDemandeeLe?.toISOString() ?? null,
    propositionMessage: espace.propositionDemandeeLe ? (espace.propositionMessage ?? null) : null,
    choix,
    coordonnees: {
      nom: dossier.clientNom,
      adresse: dossier.clientAdresse,
      codePostal: dossier.clientCp,
      ville: dossier.clientVille,
      email: dossier.clientEmail,
      completes: Boolean(dossier.clientAdresse.trim() && dossier.clientCp.trim() && dossier.clientVille.trim() && dossier.clientEmail?.trim()),
    },
    devis,
    acompte: devis && devis.acompte > 0 ? { montant: devis.acompte, recu, complet: recu >= devis.acompte - 0.5 } : null,
    paiement: devis && accord && lecture.paiement ? { ...lecture.paiement, devisNumero: devis.numero, signeLe: accord.le.toISOString() } : null,
    virement: (() => {
      const ribLu = /RIB : ([A-Z0-9 ]+?) –.*?: ([A-Z0-9]+)$/.exec(EMETTEUR.ligneRib);
      return ribLu && devis ? { titulaire: EMETTEUR.raisonSociale, iban: ribLu[1].trim(), bic: ribLu[2], reference: `Devis ${devis.numero}` } : null;
    })(),
    paiementCarte: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    chantier: faits.accord || ["PLANIFIE", "CHANTIER"].includes(dossier.etape) ? { date: dossier.dateChantier?.toISOString() ?? null } : null,
    apres: apresChantier
      ? { photos: lirePhotos(dossier.photos).filter(estPhotoApres).map((chemin) => ({ id: idPhoto(chemin) })), avis: avis && typeof avis.note === "number" ? avis : null }
      : null,
    contact: { nom: "Lucas Villemin", prenom: "Lucas", role: "Artisan poseur · CoverSwap, Pérols", telephone: EMETTEUR.telephone, telephoneLien: `+33${EMETTEUR.telephone.replace(/\D/g, "").slice(1)}`, portrait },
    marque: { nom: "CoverSwap", telephone: EMETTEUR.telephone, telephoneLien: `+33${EMETTEUR.telephone.replace(/\D/g, "").slice(1)}` },
    creation: await creationPourLeClient(espace, typeProjet, monProjet, Boolean(options.apercu)),
    favoris: lireFavoris(espace.favoris),
    choixModifiable: !devis,
    expireLe: espace.expireLe.toISOString(),
  };
}

/* ── Simulations créées par le client (espace v3) ─────────────────── */

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
export async function quotaSimulations(espace: Pick<EspaceClient, "id" | "dossierId" | "simulationsAccordees">): Promise<{ gratuites: number; accordees: number; faites: number; faitesSite: number; enCours: { id: string; le: string }[]; restantes: number }> {
  const [gratuites, faitesEspace, faitesSite, enCours] = await Promise.all([
    simulationsGratuites(),
    prisma.simulationEspace.count({ where: { ...AVEC_ARCHIVES, espaceId: espace.id, source: "CLIENT" } }),
    prisma.simulationEspace.count({ where: { ...AVEC_ARCHIVES, espaceId: espace.id, source: "SITE" } }),
    // Une génération tient une minute ; au-delà d'une demi-heure, elle est tenue pour perdue (elle ne bloque plus rien).
    prisma.preparationSimulation.findMany({ where: { dossierId: espace.dossierId, origine: "CLIENT", statut: "EN_COURS", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true } }),
  ]);
  const accordees = espace.simulationsAccordees ?? 0;
  return { gratuites, accordees, faites: faitesEspace + faitesSite, faitesSite, enCours: enCours.map((p) => ({ id: p.id, le: p.createdAt.toISOString() })), restantes: restantes({ gratuites, accordees, faitesEspace, faitesSite, enCours: enCours.length }) };
}

async function creationPourLeClient(espace: EspaceClient, typeProjet: string, projet: ProjetClient | null, apercu = false): Promise<EtatEspace["creation"]> {
  const [quota, disponible] = await Promise.all([quotaSimulations(espace), creditDisponible().catch(() => true)]);
  // Un client tombe sur « momentanément indisponible » : Lucas le sait (au plus une alerte toutes les trois heures).
  if (!disponible && !apercu) void alerterCreditEpuise(espace.dossierId).catch(() => undefined);
  const type = typeEspacePourProjet(typeProjet);
  return {
    gratuites: quota.gratuites,
    accordees: quota.accordees,
    faites: quota.faites,
    faitesSite: quota.faitesSite,
    restantes: quota.restantes,
    enCours: quota.enCours,
    demandeesLe: espace.simulationsDemandeesLe?.toISOString() ?? null,
    disponible,
    zones: type.zones.map((zone) => ({ zone, libelle: libelleZoneClient(zone, typeProjet) ?? ZONES[zone].libelle })),
    zonesProjet: (projet?.zones ?? []).filter((zone) => (type.zones as string[]).includes(zone)),
    piece: typeProjet in TYPES_SURFACE_ESPACE ? typeProjet : "CUISINE",
    pieces: PIECES_ESPACE.map((p) => ({ piece: p.piece, libelle: p.libelle, aide: p.aide, zones: p.zones.map((zone) => ({ zone, libelle: libelleZoneClient(zone, p.piece) ?? ZONES[zone].libelle })) })),
  };
}

function lireFavoris(json: string | null): string[] {
  try {
    const valeur: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(valeur) ? valeur.filter((r): r is string => typeof r === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(r)).slice(0, 60) : [];
  } catch {
    return [];
  }
}

export const schemaCreationSimulation = z.object({
  /** La pièce simulée (toutes celles du site) ; sans elle : celle de son projet. */
  piece: z.enum(["CUISINE", "SDB", "MEUBLES", "PRO", "MURS"]).optional(),
  photoId: z.string().min(1, "Choisissez une photo.").max(80),
  zones: z.array(z.object({ zone: z.string().min(1).max(40), ref: z.string().min(1).max(24) })).min(1, "Choisissez au moins une teinte.").max(4, "Quatre zones au plus par simulation."),
});

/**
 * Le client lance une simulation depuis son espace : SA photo, les zones de son
 * projet, une teinte par zone. Même chemin que le mode API du CRM (consigne du
 * site, moteur commun) ; le résultat arrive dans sa galerie. Refusé sans rien
 * lancer si ses simulations offertes sont épuisées ou si le crédit est épuisé :
 * ses choix restent dans son téléphone.
 */
export async function creerSimulationClient(espace: EspaceClient, entree: z.output<typeof schemaCreationSimulation>): Promise<{ preparationId: string; restantes: number }> {
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
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { photos: true, lead: { select: { typeProjet: true } } } });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const photos = await photosDuClient(espace.dossierId, dossier.photos);
  if (!photos.some((p) => p.id === entree.photoId)) throw new ErreurMetier("Cette photo n'est plus dans votre espace : choisissez-en une autre.", 404);
  const type = entree.piece ? TYPES_SURFACE_ESPACE[entree.piece] : typeEspacePourProjet(dossier.lead?.typeProjet);
  const { preparerSimulation } = await import("@/lib/simulateur/preparation");
  const preparation = await avecActeur(ACTEUR, () => preparerSimulation({ dossierId: espace.dossierId, photoId: entree.photoId, typeSurface: type.id, zones: entree.zones, mode: "API" }, { origine: "CLIENT" }));
  return { preparationId: preparation.id, restantes: Math.max(0, quota.restantes - 1) };
}

/** Où en est une simulation lancée par le client : en cours, prête (dans sa galerie), ou pas aboutie (dit simplement). */
export async function suivreCreation(espace: EspaceClient, preparationId: string): Promise<{ statut: "EN_COURS" | "PRETE" | "ECHEC"; simulationId: string | null; message: string | null; raison: "credit" | "echec" | null }> {
  const p = await prisma.preparationSimulation.findFirst({ where: { id: preparationId, dossierId: espace.dossierId, origine: "CLIENT" }, select: { statut: true, resultatId: true, erreur: true, createdAt: true } });
  if (!p) throw new ErreurMetier("Simulation introuvable.", 404);
  if (p.statut === "TERMINEE") return { statut: "PRETE", simulationId: p.resultatId, message: null, raison: null };
  if (p.statut === "ECHEC" || (p.statut === "EN_COURS" && Date.now() - p.createdAt.getTime() > 30 * 60_000)) {
    const credit = /crédit|clé refusée/i.test(p.erreur ?? "");
    return {
      statut: "ECHEC",
      simulationId: null,
      raison: credit ? "credit" : "echec",
      message: credit ? "La création de simulations est momentanément indisponible. Vos choix sont gardés ; CoverSwap est prévenu." : "Cette simulation n'a pas abouti. Elle ne compte pas : vous pouvez la relancer.",
    };
  }
  return { statut: "EN_COURS", simulationId: null, message: null, raison: null };
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
  await prevenir(espace.dossierId, { titre: `${dossier?.clientNom ?? "Un client"} demande d'autres simulations`, texte: `${quota.faites} simulation(s) faite(s) (site et espace). Accordez-en d'autres en un clic depuis Espaces clients.`, urgence: 3, telephone: dossier?.clientTelephone });
}

/** Lucas accorde des simulations de plus (Espaces clients, dossier) : la demande est close. */
export async function accorderSimulations(espaceId: string, nombre: number): Promise<{ accordees: number }> {
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 20) throw new ErreurMetier("Nombre de simulations invalide (1 à 20).", 400);
  const espace = await prisma.espaceClient.findUnique({ where: { id: espaceId }, select: { id: true, dossierId: true } });
  if (!espace) throw new ErreurMetier("Espace introuvable.", 404);
  const mis = await prisma.espaceClient.update({ where: { id: espace.id }, data: { simulationsAccordees: { increment: nombre }, simulationsDemandeesLe: null } });
  await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATIONS_ACCORDEES", direction: "SORTANT", contenu: `${nombre} simulation${nombre > 1 ? "s" : ""} de plus accordée${nombre > 1 ? "s" : ""} au client dans son espace.`, metadata: JSON.stringify({ nombre }) } });
  return { accordees: mis.simulationsAccordees };
}

export const schemaFavoris = z.object({ refs: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,24}$/)).max(60) });

/** Ses teintes favorites : gardées pour lui, et proposées en premier à Lucas dans le simulateur. */
export async function enregistrerFavoris(espace: EspaceClient, refs: string[]): Promise<void> {
  await avecActeur(ACTEUR, () => prisma.espaceClient.update({ where: { id: espace.id }, data: { favoris: JSON.stringify([...new Set(refs)]) } }));
}

/** Une visite : comptée, datée ; la première est notée dans le dossier et sonne (Lucas sait que le lien a été ouvert). */
export async function noterVisite(espace: EspaceClient): Promise<void> {
  const maintenant = new Date();
  const ilYADixMinutes = new Date(maintenant.getTime() - 10 * 60_000);
  // Une rafale de requêtes de la même page ne compte que pour une visite — y compris deux requêtes
  // simultanées : la condition est vérifiée par la base, pas sur une lecture déjà périmée.
  let premiere = false;
  await avecActeur(ACTEUR, async () => {
    const { count } = await prisma.espaceClient.updateMany({
      where: { id: espace.id, OR: [{ dernierAccesLe: null }, { dernierAccesLe: { lt: ilYADixMinutes } }] },
      data: { dernierAccesLe: maintenant, nbAcces: { increment: 1 } },
    });
    if (count === 0) return;
    premiere = (await prisma.espaceClient.updateMany({ where: { id: espace.id, premierAccesLe: null }, data: { premierAccesLe: maintenant } })).count === 1;
    if (premiere) {
      await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_VISITE", direction: "ENTRANT", contenu: "Le client a ouvert son espace pour la première fois", metadata: JSON.stringify({ espaceId: espace.id }) } });
    }
  });
  if (premiere) {
    const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
    await prevenir(espace.dossierId, { titre: `Espace ouvert — ${dossier?.clientNom ?? "client"}`, texte: "Le client vient d'ouvrir son espace pour la première fois.", urgence: 3, telephone: dossier?.clientTelephone });
  }
}

/* ── Photos ────────────────────────────────────────────────────────── */

export async function deposerPhotos(espace: EspaceClient, fichiers: File[]): Promise<{ deposees: number; refusees: string[] }> {
  if (fichiers.length === 0) throw new ErreurMetier("Aucune photo reçue.", 400);
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { photos: true, etape: true, prochaineAction: true } });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const dejaLa = lirePhotos(dossier.photos).length;
  if (dejaLa + fichiers.length > PHOTOS_MAX_PAR_DOSSIER) throw new ErreurMetier(`Vous avez déjà déposé beaucoup de photos (${dejaLa}). Quelques-unes suffisent : appelez-nous si besoin.`, 413);

  const refusees: string[] = [];
  let deposees = 0;
  await avecActeur(ACTEUR, async () => {
    for (const fichier of fichiers) {
      try {
        if (!FORMATS_PHOTO[fichier.type]) throw new ErreurMetier("format non pris en charge (JPEG, PNG, WebP ou HEIC)");
        if (fichier.size > PHOTO_OCTETS_MAX) throw new ErreurMetier("photo trop lourde (9 Mo au plus)");
        await ajouterPhoto(espace.dossierId, fichier);
        deposees++;
      } catch (erreur) {
        refusees.push(`${fichier.name || "photo"} : ${erreur instanceof Error ? erreur.message : "erreur"}`);
      }
    }
    if (deposees > 0) {
      // Le téléphone envoie les photos une à une : un dépôt en plusieurs envois reste UN événement.
      const recent = await prisma.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_PHOTOS", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } }, orderBy: { createdAt: "desc" } });
      const deja = recent ? Number((JSON.parse(recent.metadata || "{}") as { nombre?: number }).nombre) || 0 : 0;
      const total = deja + deposees;
      const contenu = `${total} photo${total > 1 ? "s" : ""} déposée${total > 1 ? "s" : ""} par le client dans son espace`;
      if (recent) await prisma.dossierEvenement.update({ where: { id: recent.id }, data: { contenu, metadata: JSON.stringify({ nombre: total }) } });
      else await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PHOTOS", direction: "ENTRANT", contenu, metadata: JSON.stringify({ nombre: total }) } });
      // La balle passe dans le camp de Lucas.
      if (!dossier.prochaineAction || /attendre les photos/i.test(dossier.prochaineAction)) {
        await prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Préparer la simulation (photos reçues)", prochaineActionDate: new Date() } });
      }
      // Une seule alerte pour un dépôt en plusieurs envois : elle part deux minutes après le premier.
      await mettreEnFile({ type: TACHE_ALERTE_PHOTOS, cle: `espace-photos:${espace.id}:${Math.floor(Date.now() / 300_000)}`, charge: { espaceId: espace.id, dossierId: espace.dossierId }, apres: new Date(Date.now() + 120_000), priorite: 6 });
    }
  });
  if (deposees === 0) throw new ErreurMetier(`Aucune photo n'a pu être enregistrée. ${refusees[0] ?? ""}`.trim(), 400);
  return { deposees, refusees };
}

export async function alerterPhotosDeposees(dossierId: string): Promise<{ photos: number }> {
  const depuis = new Date(Date.now() - 8 * 60_000);
  const [dossier, evenements] = await Promise.all([
    prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true, photos: true } }),
    prisma.dossierEvenement.findMany({ where: { dossierId, type: "ESPACE_PHOTOS", createdAt: { gte: depuis } }, select: { metadata: true } }),
  ]);
  if (!dossier) return { photos: 0 };
  const nombre = evenements.reduce((n, e) => n + (Number((JSON.parse(e.metadata) as { nombre?: number }).nombre) || 0), 0);
  // (un dépôt en plusieurs envois n'écrit qu'un événement, mis à jour : sa somme est le nombre de photos du dépôt)
  if (nombre === 0) return { photos: 0 };
  await prevenir(dossierId, {
    titre: `Photos reçues — ${dossier.clientNom}`,
    texte: `${nombre} photo${nombre > 1 ? "s" : ""} déposée${nombre > 1 ? "s" : ""} dans son espace (${lirePhotos(dossier.photos).length} au total).\nÀ vous : préparer la simulation (annoncée ${DELAI_SIMULATION}).`,
    urgence: 4,
    telephone: dossier.clientTelephone,
  });
  return { photos: nombre };
}

/** Une photo du dossier, servie au client par son lien (jamais celle d'un autre dossier). */
export async function photoDeLEspace(espace: EspaceClient, photoId: string): Promise<{ contenu: Buffer; type: string }> {
  const { lirePhoto } = await import("@/lib/dossiers/dossiers");
  return lirePhoto(espace.dossierId, photoId);
}

/* ── Le projet ─────────────────────────────────────────────────────── */

/** Ancien format (espace du 20/09) : accepté tant que l'ancienne page circule. */
export const schemaSouhaits = z.object({
  teintes: z.array(z.string().max(40)).max(9).default([]),
  style: z.string().max(40).nullable().default(null),
  propositions: z.boolean().default(false),
  precisions: z.string().trim().max(1000, "Précisions trop longues (1 000 caractères au plus).").default(""),
});
export type Souhaits = z.output<typeof schemaSouhaits>;

async function enregistrerJsonProjet(espace: EspaceClient, json: string, resume: string, typeProjet: string, precise: boolean): Promise<void> {
  const premier = !espace.souhaitsLe;
  await avecActeur(ACTEUR, async () => {
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { souhaits: json, souhaitsLe: new Date() } });
    // Enregistré à la frappe : un événement à la première saisie, puis au plus un par heure (mis à jour entre-temps).
    const recent = await prisma.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_SOUHAITS", createdAt: { gte: new Date(Date.now() - 3_600_000) } }, orderBy: { createdAt: "desc" } });
    const contenu = resume ? `Projet précisé par le client : ${resume}` : "Projet effacé par le client";
    if (premier || !recent) await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SOUHAITS", direction: "ENTRANT", contenu, metadata: JSON.stringify({ typeProjet }) } });
    else await prisma.dossierEvenement.update({ where: { id: recent.id }, data: { contenu } });
    // Une seule alerte par espace, trois minutes après le premier projet exploitable : la version posée, pas la première case cochée.
    if (precise) await mettreEnFile({ type: TACHE_ALERTE_PROJET, cle: `espace-projet:${espace.id}`, charge: { espaceId: espace.id }, apres: new Date(Date.now() + 180_000), priorite: 6 });
  });
}

/** L'alerte « projet précisé », avec le projet tel qu'il est au moment où elle part. */
export async function alerterProjetPrecise(espaceId: string): Promise<{ envoyee: boolean }> {
  const espace = await prisma.espaceClient.findUnique({ where: { id: espaceId }, select: { dossierId: true, souhaits: true, dossier: { select: { clientNom: true, clientTelephone: true, lead: { select: { typeProjet: true } } } } } });
  if (!espace) return { envoyee: false };
  const projet = lireProjet(espace.souhaits);
  if (!projetPrecise(projet)) return { envoyee: false };
  await prevenir(espace.dossierId, { titre: `Projet précisé — ${espace.dossier.clientNom}`, texte: resumerProjet(projet, espace.dossier.lead?.typeProjet ?? "CUISINE"), urgence: 3, telephone: espace.dossier.clientTelephone });
  return { envoyee: true };
}

export async function enregistrerProjet(espace: EspaceClient, projet: ProjetClient): Promise<void> {
  // Modifier un projet validé le dévalide (la pastille verte tombe, le CRM le sait) : il le revalidera.
  if (espace.projetValideLe && JSON.stringify(lireProjet(espace.souhaits)) !== JSON.stringify(projet)) {
    const { devaliderProjet } = await import("./validations");
    await devaliderProjet(espace, "CLIENT", "il le modifie");
  }
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { lead: { select: { typeProjet: true } } } });
  const typeProjet = dossier?.lead?.typeProjet ?? "CUISINE";
  await enregistrerJsonProjet(espace, JSON.stringify(projet), resumerProjet(projet, typeProjet), typeProjet, projetPrecise(projet));
}

export async function enregistrerSouhaits(espace: EspaceClient, souhaits: Souhaits): Promise<void> {
  const resume = [souhaits.propositions ? "veut des propositions" : null, souhaits.teintes.length ? `teintes : ${souhaits.teintes.join(", ")}` : null, souhaits.style ? `style : ${souhaits.style}` : null, souhaits.precisions ? `« ${souhaits.precisions} »` : null].filter(Boolean).join(" · ");
  await enregistrerJsonProjet(espace, JSON.stringify(souhaits), resume, "CUISINE", Boolean(resume));
}

/** PUT /souhaits : le nouveau format (zones, styles…) ou l'ancien (teintes, style). */
export async function enregistrerProjetOuSouhaits(espace: EspaceClient, corps: unknown): Promise<void> {
  const brut = (corps && typeof corps === "object" ? corps : {}) as Record<string, unknown>;
  if ("zones" in brut || "styles" in brut || "metres" in brut || "repere" in brut || "delai" in brut) {
    const lu = schemaProjet.safeParse(brut);
    if (!lu.success) throw new ErreurMetier(lu.error.issues[0]?.message ?? "Projet invalide.", 400);
    return enregistrerProjet(espace, lu.data);
  }
  const lu = schemaSouhaits.safeParse(brut);
  if (!lu.success) throw new ErreurMetier("Souhaits invalides.", 400);
  return enregistrerSouhaits(espace, lu.data);
}

/* ── Coordonnées ───────────────────────────────────────────────────── */

export const schemaCoordonnees = z.object({
  nom: z.string().trim().min(2, "Indiquez votre nom.").max(120),
  adresse: z.string().trim().min(3, "Indiquez l'adresse du chantier.").max(200),
  codePostal: z.string().trim().regex(/^\d{5}$/, "Code postal : cinq chiffres."),
  ville: z.string().trim().min(1, "Indiquez la ville.").max(80),
  email: z.string().trim().max(160).refine((v) => v === "" || normaliserEmail(v) !== null, "Adresse e-mail invalide.").default(""),
});

export async function completerCoordonnees(espace: EspaceClient, entree: z.output<typeof schemaCoordonnees>): Promise<void> {
  await avecActeur(ACTEUR, async () => {
    await prisma.dossier.update({
      where: { id: espace.dossierId },
      data: { clientNom: entree.nom, clientAdresse: entree.adresse, clientCp: entree.codePostal, clientVille: entree.ville, ...(entree.email ? { clientEmail: normaliserEmail(entree.email) } : {}) },
    });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_COORDONNEES", direction: "ENTRANT", contenu: `Le client a complété ses coordonnées : adresse du chantier${entree.email ? " et e-mail" : ""}`, metadata: "{}" } });
  });
}

/** Saisie assistée de l'adresse : la Base adresse nationale, interrogée par le CRM (le client ne parle qu'au CRM). */
type AdresseProposee = { libelle: string; adresse: string; codePostal: string; ville: string };

/**
 * Adresses proposées pendant la saisie (Base Adresse Nationale). Les adresses
 * du code postal déjà connu du dossier passent en premier : « 5 rue des
 * Cigales » tapé par une cliente de Lattes doit donner Lattes, pas un homonyme
 * à l'autre bout de la région.
 */
export async function proposerAdresses(recherche: string, dossierId?: string): Promise<AdresseProposee[]> {
  const q = recherche.trim().slice(0, 120);
  if (q.length < 4) return [];
  const chercher = async (filtre: string): Promise<AdresseProposee[]> => {
    try {
      const reponse = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5&autocomplete=1${filtre}`, { signal: AbortSignal.timeout(4000) });
      if (!reponse.ok) return [];
      const donnees = (await reponse.json()) as { features?: { properties?: { label?: string; name?: string; postcode?: string; city?: string; type?: string } }[] };
      return (donnees.features ?? [])
        .map((f) => f.properties ?? {})
        .filter((p) => p.label && p.postcode && p.city)
        .map((p) => ({ libelle: p.label!, adresse: p.type === "municipality" ? "" : (p.name ?? ""), codePostal: p.postcode!, ville: p.city! }));
    } catch {
      return [];
    }
  };
  const dossier = dossierId ? await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientCp: true } }) : null;
  const cp = dossier?.clientCp && /^\d{5}$/.test(dossier.clientCp) && !/\b\d{5}\b/.test(q) ? dossier.clientCp : null;
  const [proches, partout] = await Promise.all([cp ? chercher(`&postcode=${cp}`) : Promise.resolve([]), chercher("")]);
  const vues = new Set<string>();
  // Trois du code postal au plus : si la rue n'y existe pas, la bonne adresse ailleurs reste proposée.
  return [...proches.slice(0, 3), ...partout].filter((a) => !vues.has(a.libelle) && Boolean(vues.add(a.libelle))).slice(0, 5);
}

/* ── Simulations ───────────────────────────────────────────────────── */

async function simulationPubliee(espace: EspaceClient, simulationId: string): Promise<SimulationEspace> {
  const simulation = await prisma.simulationEspace.findFirst({ where: { id: simulationId, espaceId: espace.id, statut: "PUBLIEE" } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  return simulation;
}

/** Image d'une simulation, pour le client : seulement les siennes, seulement celles publiées. */
export async function imagePourLeClient(espace: EspaceClient, simulationId: string, quoi: "image" | "avant"): Promise<{ contenu: Buffer; type: string }> {
  const simulation = await simulationPubliee(espace, simulationId);
  return lireImage(quoi === "image" ? simulation.chemin : simulation.photoAvant);
}

/** Ancien nom (écran du dossier) : image d'une simulation d'un espace ou d'un dossier, sans filtre de statut. */
export async function imageDeSimulation(filtre: { espaceId?: string; dossierId?: string }, simulationId: string): Promise<{ contenu: Buffer; type: string }> {
  const simulation = await prisma.simulationEspace.findFirst({ where: { id: simulationId, ...filtre, ...(filtre.espaceId ? { statut: "PUBLIEE" } : {}) } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  return lireImage(simulation.chemin);
}

/** Ancien dépôt (écran du dossier) : devenu un brouillon, que Lucas publie. */
export async function deposerSimulation(dossierId: string, fichier: File, details: { titre?: string | null; description?: string | null }): Promise<{ id: string; espaceId: string }> {
  const vue = await deposerSimulationDossier(dossierId, fichier, { ...details, source: "MANUEL", preparationId: null });
  const ligne = await prisma.simulationEspace.findUniqueOrThrow({ where: { id: vue.id }, select: { espaceId: true } });
  return { id: vue.id, espaceId: ligne.espaceId };
}

export async function retirerSimulation(simulationId: string, motif = "Retirée de l'espace client"): Promise<void> {
  await prisma.simulationEspace.update({ where: { id: simulationId }, data: { archiveLe: new Date(), archiveMotif: motif } });
}

/** Le client a regardé ses simulations : elles ne sont plus « nouvelles », et Lucas sait lesquelles ont été vues. */
export async function noterSimulationsVues(espace: EspaceClient): Promise<void> {
  const maintenant = new Date();
  await avecActeur(ACTEUR, async () => {
    await prisma.simulationEspace.updateMany({ where: { espaceId: espace.id, statut: "PUBLIEE", vueLe: null }, data: { vueLe: maintenant } });
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { simulationsVuesLe: maintenant } });
  });
}

export const schemaChoix = z.object({ commentaire: z.string().trim().max(1000, "Commentaire trop long.").default("") });

export const schemaChoixComplet = z
  .object({
    simulationId: z.string().min(1).max(40).optional(),
    zones: z.array(z.object({ zone: z.string().min(1).max(60), simulationId: z.string().min(1).max(40) })).max(8).optional(),
    commentaire: z.string().trim().max(1000, "Commentaire trop long.").default(""),
  })
  .refine((v) => v.simulationId || (v.zones && v.zones.length > 0), "Choisissez une simulation, ou une teinte pour chaque zone.");

/**
 * Le choix du client : une simulation entière, ou une teinte par zone piochée
 * dans plusieurs (les meubles hauts de l'une, le plan de travail d'une autre).
 * Le choix précédent est remplacé ; Lucas est prévenu dans les deux cas.
 */
export async function choisir(espace: EspaceClient, entree: z.output<typeof schemaChoixComplet>, auteur: "CLIENT" | "LUCAS" = "CLIENT"): Promise<ChoixClient> {
  // Le devis est établi sur sa simulation validée : la changer ensuite passe par CoverSwap (un appel). Lucas, lui, le peut.
  const devisEmis = auteur === "LUCAS" ? 0 : await prisma.document.count({ where: { dossierId: espace.dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } } });
  if (devisEmis > 0) throw new ErreurMetier("Votre devis est déjà établi sur la simulation validée. Pour en changer, appelez CoverSwap : nous l'ajustons avec vous.", 409, { raison: "devis-emis" });
  const maintenant = new Date();
  let choix: ChoixClient;
  let impliquees: string[];
  let resume: string;
  if (entree.zones && entree.zones.length > 0) {
    const zones: (ZoneTeinte & { simulationId: string })[] = [];
    for (const { zone, simulationId } of entree.zones) {
      const simulation = await simulationPubliee(espace, simulationId);
      const teinte = lireZones(simulation.zones).find((z) => (z.zone || z.libelle) === zone);
      if (!teinte) throw new ErreurMetier("Cette teinte n'existe pas sur la simulation choisie.", 400);
      if (zones.some((z) => (z.zone || z.libelle) === zone)) continue;
      zones.push({ ...teinte, simulationId });
    }
    choix = { mode: "COMPOSITE", zones, commentaire: entree.commentaire || null, le: maintenant.toISOString() };
    impliquees = [...new Set(zones.map((z) => z.simulationId))];
    resume = `${auteur === "LUCAS" ? "Lucas a validé, à la place du client, le mélange" : "Le client a validé son mélange"} : ${zones.map((z) => `${z.libelle || z.zone} — ${z.nom || z.ref}${z.ref ? ` (${z.ref})` : ""}`).join(" · ")}`;
  } else {
    const simulation = await simulationPubliee(espace, entree.simulationId!);
    choix = { mode: "UNE", simulationId: simulation.id, commentaire: entree.commentaire || null, le: maintenant.toISOString() };
    impliquees = [simulation.id];
    resume = `${auteur === "LUCAS" ? "Lucas a validé, à la place du client, la simulation" : "Le client a validé la simulation"}${simulation.titre ? ` « ${simulation.titre} »` : ""}`;
  }
  const texte = `${resume}${entree.commentaire ? ` : « ${entree.commentaire} »` : ""}`;
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
  const zonesValidees = choix.mode === "COMPOSITE" ? choix.zones : lireZones((await prisma.simulationEspace.findUnique({ where: { id: impliquees[0] }, select: { zones: true } }))?.zones ?? null);
  const ecrire = <T,>(travail: () => Promise<T>) => (auteur === "LUCAS" ? travail() : avecActeur(ACTEUR, travail));
  await ecrire(async () => {
    await prisma.$transaction([
      prisma.simulationEspace.updateMany({ where: { espaceId: espace.id, id: { notIn: impliquees }, choisieLe: { not: null } }, data: { choisieLe: null } }),
      ...impliquees.map((id) => prisma.simulationEspace.update({ where: { id }, data: { choisieLe: maintenant, ...(entree.commentaire && choix.mode === "UNE" ? { commentaireClient: entree.commentaire, commenteeLe: maintenant } : {}) } })),
      prisma.espaceClient.update({ where: { id: espace.id }, data: { choix: JSON.stringify(choix), choixLe: maintenant } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATION_CHOISIE", direction: auteur === "LUCAS" ? "INTERNE" : "ENTRANT", contenu: `${texte}${choix.mode === "UNE" && zonesValidees.length ? ` — ${zonesValidees.map((z) => `${z.libelle || z.zone} : ${z.nom || z.ref}${z.ref ? ` (${z.ref})` : ""}`).join(" · ")}` : ""}`.slice(0, 1500), metadata: JSON.stringify({ simulations: impliquees, mode: choix.mode, auteur, zones: zonesValidees }) } }),
      prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)", prochaineActionDate: maintenant } }),
    ]);
  });
  if (auteur === "CLIENT") await prevenir(espace.dossierId, { titre: `Simulation validée — ${dossier?.clientNom ?? "client"}`, texte: `${texte}\nÀ vous : préparer le devis.`, urgence: 5, telephone: dossier?.clientTelephone });
  return choix;
}

/** Ancien geste (page du 20/09) : choisir une simulation entière. */
export async function choisirSimulation(espace: EspaceClient, simulationId: string, commentaire: string): Promise<void> {
  await choisir(espace, { simulationId, commentaire });
}

export async function commenterSimulation(espace: EspaceClient, simulationId: string, commentaire: string): Promise<void> {
  if (!commentaire) throw new ErreurMetier("Le commentaire est vide.", 400);
  const simulation = await simulationPubliee(espace, simulationId);
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
  await avecActeur(ACTEUR, async () => {
    await prisma.$transaction([
      prisma.simulationEspace.update({ where: { id: simulationId }, data: { commentaireClient: commentaire, commenteeLe: new Date() } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_COMMENTAIRE", direction: "ENTRANT", contenu: `Commentaire du client${simulation.titre ? ` sur « ${simulation.titre} »` : ""} : « ${commentaire} »`, metadata: JSON.stringify({ simulationId }) } }),
    ]);
  });
  await prevenir(espace.dossierId, { titre: `Commentaire — ${dossier?.clientNom ?? "client"}`, texte: `« ${commentaire} »`, urgence: 4, telephone: dossier?.clientTelephone });
}

export const schemaProposition = z.object({
  commentaire: z.string().trim().max(1000, "Message trop long (1 000 caractères au plus).").default(""),
  simulationId: z.string().max(40).optional(),
});

/** « Proposez-moi autre chose » : la main repasse à Lucas, avec le mot du client. */
export async function demanderProposition(espace: EspaceClient, entree: z.output<typeof schemaProposition>): Promise<void> {
  const simulation = entree.simulationId ? await prisma.simulationEspace.findFirst({ where: { id: entree.simulationId, espaceId: espace.id, statut: "PUBLIEE" }, select: { id: true, titre: true } }) : null;
  const maintenant = new Date();
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
  const texte = `Le client demande une autre proposition${simulation?.titre ? ` (après « ${simulation.titre} »)` : ""}${entree.commentaire ? ` : « ${entree.commentaire} »` : ""}`;
  await avecActeur(ACTEUR, async () => {
    await prisma.$transaction([
      // Son mot est gardé entier sur l'espace : il s'affiche dans le dossier et dans Espaces clients, pas seulement dans l'historique.
      prisma.espaceClient.update({ where: { id: espace.id }, data: { propositionDemandeeLe: maintenant, propositionMessage: entree.commentaire || null, propositionSimulationId: simulation?.id ?? null } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_NOUVELLE_PROPOSITION", direction: "ENTRANT", contenu: texte.slice(0, 1500), metadata: JSON.stringify({ simulationId: simulation?.id ?? null }) } }),
      prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: `Préparer une autre proposition${entree.commentaire ? ` — « ${entree.commentaire.slice(0, 120)} »` : " (demande du client)"}`, prochaineActionDate: maintenant } }),
      ...(simulation && entree.commentaire ? [prisma.simulationEspace.update({ where: { id: simulation.id }, data: { commentaireClient: entree.commentaire, commenteeLe: maintenant } })] : []),
    ]);
  });
  await prevenir(espace.dossierId, { titre: `Autre proposition demandée — ${dossier?.clientNom ?? "client"}`, texte: `${texte}\nÀ vous : préparer une nouvelle simulation.`, urgence: 4, telephone: dossier?.clientTelephone });
}

/* ── Devis : consultation, bon pour accord ─────────────────────────── */

/**
 * Le client ouvre son devis : compté une fois par visite (trente minutes). La
 * première consultation et la troisième sonnent — un client qui revient trois
 * fois sur son devis sans signer hésite : c'est le moment d'appeler.
 */
export async function noterConsultationDevis(espace: EspaceClient, documentId: string): Promise<{ consultations: number }> {
  const devis = await prisma.document.findFirst({ where: { id: documentId, dossierId: espace.dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } }, select: { id: true, numero: true } });
  if (!devis) throw new ErreurMetier("Devis introuvable.", 404);
  const maintenant = new Date();
  const seuil = new Date(maintenant.getTime() - 30 * 60_000);
  // Mise à jour conditionnelle, atomique : deux requêtes simultanées (double appui, page + PDF)
  // ne comptent qu'une consultation et ne préviennent qu'une fois.
  let pris = { count: 0 };
  await avecActeur(ACTEUR, async () => {
    pris = await prisma.espaceClient.updateMany({
      where: { id: espace.id, devisConsulteId: devis.id, OR: [{ devisConsulteLe: null }, { devisConsulteLe: { lt: seuil } }] },
      data: { devisConsultations: { increment: 1 }, devisConsulteLe: maintenant },
    });
    if (pris.count === 0) {
      pris = await prisma.espaceClient.updateMany({
        where: { id: espace.id, OR: [{ devisConsulteId: null }, { devisConsulteId: { not: devis.id } }] },
        data: { devisConsultations: 1, devisConsulteId: devis.id, devisConsulteLe: maintenant },
      });
    }
  });
  const apres = await prisma.espaceClient.findUnique({ where: { id: espace.id }, select: { devisConsultations: true } });
  const consultations = apres?.devisConsultations ?? 1;
  if (pris.count === 0) return { consultations };
  const accord = await prisma.accordDevis.findFirst({ where: { documentId: devis.id, retireLe: null }, select: { id: true } });
  const contenu = `Le client a consulté son devis ${devis.numero} ${consultations === 1 ? "pour la première fois" : `— ${consultations} fois (dernière le ${maintenant.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" })} à ${maintenant.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })})`}`;
  await avecActeur(ACTEUR, async () => {
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_DEVIS_CONSULTE", metadata: { contains: devis.id } }, orderBy: { createdAt: "desc" } });
    if (evenement) await prisma.dossierEvenement.update({ where: { id: evenement.id }, data: { contenu, metadata: JSON.stringify({ documentId: devis.id, consultations }) } });
    else await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_DEVIS_CONSULTE", direction: "ENTRANT", contenu, metadata: JSON.stringify({ documentId: devis.id, consultations }) } });
  });
  if (!accord && (consultations === 1 || consultations === 3)) {
    const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true } });
    await prevenir(
      espace.dossierId,
      consultations === 1
        ? { titre: `Devis ouvert — ${dossier?.clientNom ?? "client"}`, texte: `Le client lit son devis ${devis.numero}.`, urgence: 3, telephone: dossier?.clientTelephone }
        : { titre: `Il hésite — ${dossier?.clientNom ?? "client"}`, texte: `Troisième visite sur son devis ${devis.numero}, sans accord. Un appel peut lever le doute.`, urgence: 4, telephone: dossier?.clientTelephone }
    );
  }
  return { consultations };
}

export const schemaAccord = z.object({
  documentId: z.string().min(1).max(40),
  nom: z.string("Indiquez votre nom.").trim().min(2, "Indiquez votre nom.").max(120),
  /** La case « j'ai lu et j'accepte le devis » : sans elle, pas d'accord. */
  accepte: z.literal(true, "Cochez la case pour donner votre accord."),
  /** Signature tracée au doigt (PNG en data URL), facultative. */
  signature: z.string().max(400_000, "Signature trop lourde.").optional(),
});

async function enregistrerSignature(dossierId: string, dataUrl: string | undefined): Promise<string | null> {
  const m = dataUrl ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m) return null;
  const octets = Buffer.from(m[1], "base64");
  if (octets.length < 200 || octets[0] !== 0x89 || octets[1] !== 0x50) return null;
  const relatif = path.posix.join("dossiers", dossierId, "accords", `signature-${Date.now().toString(36)}.png`);
  const absolu = path.join(resolveUploadsDir(), relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, octets);
  return relatif;
}

/**
 * Bon pour accord : UN geste du client. L'accord est écrit une fois pour toutes
 * (ligne jamais modifiée, avec la date, le montant figé, l'adresse IP, le
 * navigateur, et la signature au doigt s'il l'a tracée), le devis passe
 * « accepté », le dossier passe « Signé » et Lucas est prévenu sur son
 * téléphone. Vaut signature même sans paiement immédiat.
 */
export async function accepterDevis(espace: EspaceClient, entree: z.output<typeof schemaAccord>, origine: { ip: string | null; navigateur: string | null }): Promise<{ dejaAccepte: boolean }> {
  const devis = await prisma.document.findFirst({ where: { id: entree.documentId, dossierId: espace.dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } } });
  if (!devis) throw new ErreurMetier("Devis introuvable.", 404);
  if (["REMPLACE", "ANNULEE", "REFUSE"].includes(devis.statut)) throw new ErreurMetier("Ce devis n'est plus en vigueur : un nouveau devis vous sera proposé.", 409);
  // Un accord retiré ne vaut plus : le client peut en redonner un (nouvelle ligne, nouvelle preuve).
  const existant = await prisma.accordDevis.findFirst({ where: { documentId: devis.id, retireLe: null } });
  if (existant) return { dejaAccepte: true };

  const montants = montantsDocument({ lignes: lireLignes(devis.lignes), totalHt: devis.totalHt, acomptePct: devis.acomptePct });
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientTelephone: true, etape: true } });
  const signature = await enregistrerSignature(espace.dossierId, entree.signature).catch(() => null);
  await avecActeur(ACTEUR, async () => {
    await prisma.$transaction([
      prisma.accordDevis.create({
        data: { dossierId: espace.dossierId, documentId: devis.id, numeroDevis: devis.numero, totalHt: montants.totalHtCentimes / 100, acomptePct: devis.acomptePct, nomSignataire: entree.nom, mention: "Bon pour accord", ip: origine.ip, navigateur: origine.navigateur?.slice(0, 300) ?? null, signature },
      }),
      prisma.dossierEvenement.create({
        data: { dossierId: espace.dossierId, type: "ESPACE_DEVIS_ACCEPTE", direction: "ENTRANT", contenu: `Bon pour accord donné par ${entree.nom} sur le devis ${devis.numero} (${(montants.totalTtcCentimes / 100).toLocaleString("fr-FR")} €)${signature ? ", signé au doigt" : ""}`, metadata: JSON.stringify({ documentId: devis.id, signature: Boolean(signature) }) },
      }),
    ]);
    // Le dossier passe « Signé » : c'est le client qui signe, pas un agent. L'acompte reste à enregistrer par Lucas.
    const etapesAvantSignature: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "EN_PAUSE", "PERDU"];
    if (dossier && etapesAvantSignature.includes(dossier.etape as EtapeDossier)) {
      await changerEtape(espace.dossierId, { vers: "SIGNE", devisAccepteId: devis.id, confirmations: { BON_POUR_ACCORD: true } });
    } else if (devis.statut !== "ACCEPTE") {
      await prisma.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
    }
    await prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Appeler le client : fixer la date du chantier, suivre l'acompte", prochaineActionDate: new Date() } });
  });

  await prevenir(
    espace.dossierId,
    {
      titre: `DEVIS SIGNÉ — ${dossier?.clientNom ?? entree.nom}`,
      texte: `Bon pour accord sur le devis ${devis.numero} : ${(montants.totalTtcCentimes / 100).toLocaleString("fr-FR")} €${montants.acompteCentimes ? ` (acompte ${(montants.acompteCentimes / 100).toLocaleString("fr-FR")} €)` : ""}.\nÀ vous : appeler pour fixer la date du chantier.`,
      urgence: 5,
      telephone: dossier?.clientTelephone,
      etiquette: `accord-${espace.dossierId}`,
    },
    "espace-accord"
  );
  return { dejaAccepte: false };
}

/* ── Après le chantier : l'avis ─────────────────────────────────────── */

export const schemaAvis = z.object({
  note: z.number().int().min(1, "Choisissez une note.").max(5),
  texte: z.string().trim().max(2000, "Avis trop long (2 000 caractères au plus).").default(""),
  /** « J'accepte que mon avis soit publié sur coverswap.fr avec mon prénom. » */
  publication: z.boolean().default(false),
});

export async function donnerAvis(espace: EspaceClient, entree: z.output<typeof schemaAvis>): Promise<void> {
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { clientNom: true, clientVille: true, clientTelephone: true, clientId: true, lead: { select: { prenom: true, typeProjet: true } } } });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const maintenant = new Date();
  const prenom = (dossier.lead?.prenom ?? dossier.clientNom.split(/\s+/)[0] ?? "").trim();
  const initiale = dossier.clientNom.trim().split(/\s+/).slice(1).join(" ").charAt(0);
  await avecActeur(ACTEUR, async () => {
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { avis: JSON.stringify({ note: entree.note, texte: entree.texte, publication: entree.publication, le: maintenant.toISOString() }), avisLe: maintenant } });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_AVIS", direction: "ENTRANT", contenu: `Avis du client : ${entree.note}/5${entree.texte ? ` — « ${entree.texte} »` : ""}${entree.publication ? " (accepte la publication)" : ""}`.slice(0, 1500), metadata: "{}" } });
    // Accord écrit du client : l'avis attend dans Site → Publications, Lucas le publie.
    if (entree.publication && entree.texte) {
      await prisma.publicationSite.create({
        data: { type: "AVIS", titre: `Avis de ${prenom || "client"}`, texte: entree.texte, note: entree.note, auteur: `${prenom}${initiale ? ` ${initiale}.` : ""}`.trim() || null, ville: dossier.clientVille || null, typeProjet: dossier.lead?.typeProjet ?? null, dossierId: espace.dossierId, clientId: dossier.clientId, accordClientLe: maintenant },
      });
    }
  });
  await prevenir(espace.dossierId, { titre: `Avis ${entree.note}/5 — ${dossier.clientNom}`, texte: entree.texte ? `« ${entree.texte} »` : "Note sans commentaire.", urgence: 3, telephone: dossier.clientTelephone });
}

/* ── Lucas, en photo ─────────────────────────────────────────────────── */

export async function lirePortrait(): Promise<{ contenu: Buffer; type: string }> {
  const contenu = await fs.readFile(path.join(resolveUploadsDir(), "espace", "portrait.jpg")).catch(() => null);
  if (!contenu) throw new ErreurMetier("Pas de photo.", 404);
  return { contenu, type: "image/jpeg" };
}

/** Paramètres → Espace client : la photo de Lucas, réduite et recadrée en carré. */
export async function enregistrerPortrait(fichier: File): Promise<void> {
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(fichier.type)) throw new ErreurMetier("Photo : JPEG, PNG ou WebP.", 415);
  if (fichier.size > PHOTO_OCTETS_MAX) throw new ErreurMetier("Photo trop lourde (9 Mo au plus).", 413);
  const sharp = (await import("sharp")).default;
  const octets = await sharp(Buffer.from(await fichier.arrayBuffer())).rotate().resize(480, 480, { fit: "cover", position: "attention" }).jpeg({ quality: 86 }).toBuffer();
  const chemin = path.join(resolveUploadsDir(), "espace", "portrait.jpg");
  await fs.mkdir(path.dirname(chemin), { recursive: true });
  const ancienne = await fs.readFile(chemin).catch(() => null);
  // Rien ne se supprime : l'ancienne photo part dans les archives.
  if (ancienne) {
    const archive = path.join(resolveUploadsDir(), "archives", `${new Date().toISOString().replace(/[:.]/g, "-")}-portrait`, "portrait.jpg");
    await fs.mkdir(path.dirname(archive), { recursive: true });
    await fs.writeFile(archive, ancienne);
  }
  await fs.writeFile(chemin, octets);
}

