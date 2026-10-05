import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EspaceClient, EspacePermanent, SimulationEspace } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { mettreEnFile } from "@/lib/taches/file";
import { EMETTEUR, FORMATS_PHOTO, PHOTO_OCTETS_MAX } from "@/lib/dossiers/constants";
import { ajouterPhoto } from "@/lib/dossiers/dossiers";
import { montantsDocument } from "@/lib/dossiers/montants";
import { idPhoto, lireLignes, lirePhotos, estPhotoApres } from "@/lib/dossiers/stockage";
import { changerEtapeDansTransaction } from "@/lib/dossiers/transitions";
import { estSigneeParDevisAccepte, libelleNonRetenus, retenirDevis, type DevisNonRetenu } from "@/lib/dossiers/devis-signe";
import { suiteNonRetenus } from "@/lib/dossiers/devis-retenu";
import { appliquerEvenementDossier, suitesEvenementDossier, type Suites } from "@/lib/dossiers/synchro";
import { conditionsDuDevis } from "@/lib/pdf/conditions";
import { resolveUploadsDir } from "@/lib/uploads";
import { libelleZoneClient, lireZones, type ZoneTeinte } from "@/lib/simulateur/types-surface";
import { enregistrerPrestations, famillesSuggerees } from "@/lib/prestations/dossier";
import { famillesDe, lireSelection, motsDuProjet, phraseFamilles, type IdFamille } from "@/lib/prestations/prestations";
import { creationPourLeClient, type CreationClient } from "./creation";
import { changerStatutSimulation, deposerSimulationDossier, lireImage, synchroniserSimulationsSite } from "@/lib/simulations/dossier";
import { etapeEspace, progression, type EtapeEspace, type FaitsEspace } from "./etapes";
import { lireProjet, projetComplet, projetDepuisEntree, projetPrecise, resumerProjet, schemaProjet, ZONES_DEPUIS_SITE, type EntreeProjet, type ProjetClient } from "./projet";
import { ACTEUR, prevenir } from "./alertes";
import { enregistrerMessageClient } from "./messages";
import { enregistrerCoordonnees, lireCoordonnees, type CoordonneesEspace, type EntreeCoordonnees } from "./coordonnees";
import { figeDuProjet, MESSAGE_FIGE, type Fige } from "./projets";
import { accordEffectif, composerFaits, dateSignature, estAvenant, lectureDesDevis, lireDevisEtPaiements, type AccordEffectif, type DevisLu, type PaiementEspace } from "./faits";
import { stripeActif } from "@/lib/paiement/stripe";
import { prochainPas, type ProchainPas } from "./prochain-pas";
import { reporterTeintesDuChoix } from "./teintes-choix";

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
const PHOTOS_MAX_PAR_DOSSIER = 40;
export const TACHE_ALERTE_PHOTOS = "ESPACE_PHOTOS_ALERTE";
/** Le projet s'enregistre à la frappe : Lucas est prévenu une fois, quelques minutes après, avec la version posée. */
export const TACHE_ALERTE_PROJET = "ESPACE_PROJET_ALERTE";
/** Délai annoncé au client pour ses premières simulations. */
export const DELAI_SIMULATION = "sous 24 h";

/* ── Ce que voit le client ─────────────────────────────────────────── */

export type SimulationClient = {
  id: string;
  titre: string | null;
  description: string | null;
  /** SITE : son essai sur coverswap.fr ; CLIENT : créée par le client dans son espace ; CRM : préparée et publiée par CoverSwap. */
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
  /** Mission 11 : le libellé de la variante (« façades seules »), quand il y en a un. */
  libelle: string | null;
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
  /** Mission 5 : ce projet dans l'espace permanent du client (son code choisit le projet : `?projet=`). */
  code: string;
  nomProjet: string;
  /** Terminé et encaissé, ou non réalisé : il se consulte, il ne se modifie plus. */
  fige: Fige | null;
  /** Les familles cochées (le dossier) ; sans elles, celles que laisse deviner sa demande (proposées, jamais écrites). */
  familles: IdFamille[];
  famillesSuggerees: IdFamille[];
  /** Les mots de l'écran : « votre salle de bain » quand la famille est connue, « votre projet » sinon. */
  mots: { nom: string; votre: string; de: string };
  /** Le projet (familles, taille, mot) se modifie-t-il encore ? Sinon, pourquoi, dit au client. */
  projetModifiable: { ok: boolean; raison: string | null };
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
  /** Carte « Vérifiez vos coordonnées » : prénom, nom, e-mail, téléphone (le client), adresse (le projet). */
  coordonnees: CoordonneesEspace;
  devis: DevisClient | null;
  /** Mission 11 : les devis proposés visibles, du plus ancien au plus récent ; plusieurs → le client en choisit un ; l'accepté y est toujours. */
  devisProposes: DevisClient[];
  /**
   * Mission 18 (B7) : ceux qu'il peut signer maintenant, du plus ancien au plus récent (visibles, « Généré » ou
   * « Envoyé », sans accord). Avant la signature : les devis proposés ; après : les avenants et nouveaux devis émis
   * depuis — le devis signé reste `devis` (l'acompte porte sur lui), chacun garde son accord dans `devisProposes`.
   */
  devisASigner: DevisClient[];
  /** Mission 18 (B7) : la prochaine étape de l'accueil du projet et le point rouge des onglets (prochain-pas.ts). */
  prochainPas: ProchainPas;
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
  /** Les simulations que le client crée lui-même : combien il en reste, celles en cours, le crédit, les pièces (creation.ts). */
  creation: CreationClient;
  favoris: string[];
  /** Il peut encore changer de simulation validée : aucun devis n'est émis. */
  choixModifiable: boolean;
  expireLe: string;
};

const CLIENT_INCONNU = /^(inconnu|client)$/i;

/**
 * Photos de chantier qui sont des rendus du site (copies) : ce ne sont pas des photos du client. Relecture de la
 * partie A : lues d'une seule requête pour toute une liste de dossiers (le suivi des espaces en lisait une par dossier).
 */
export async function rendusDesDossiers(dossierIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const parDossier = new Map<string, Set<string>>(dossierIds.map((id) => [id, new Set<string>()]));
  if (dossierIds.length === 0) return parDossier;
  const simulations = await prisma.simulation.findMany({ where: { dossierId: { in: [...dossierIds] }, photosDossier: { not: null } }, select: { dossierId: true, photosDossier: true } });
  for (const s of simulations) {
    try {
      const { rendu } = JSON.parse(s.photosDossier!) as { rendu?: string | null };
      if (rendu && s.dossierId) parDossier.get(s.dossierId)?.add(rendu);
    } catch {
      // ignoré
    }
  }
  return parDossier;
}

/**
 * Photos « avant » du client dans son dossier (ni rendu du site, ni photo après chantier). `rendus` : déjà lus pour
 * toute une liste (`rendusDesDossiers`), sinon lus ici.
 */
export async function photosDuClient(dossierId: string, photosJson: string, rendusLus?: ReadonlySet<string>): Promise<{ chemin: string; id: string }[]> {
  const rendus = rendusLus ?? (await rendusDesDossiers([dossierId])).get(dossierId) ?? new Set<string>();
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
    libelle: devis.libelleVariante ?? null,
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

/** Les objets de dossier écrits d'office d'après un type de projet par défaut : ils ne nomment rien pour le client. */
const OBJET_GENERIQUE = /^(recouvrement( de (cuisine|salle de bains?|mobilier|local professionnel))?|projet à préciser|votre projet( de rénovation)?)?$/i;

/** Le nom d'un projet pour le client : le sien, sinon ses familles, sinon l'objet du dossier s'il dit quelque chose. */
export function nomDuProjetClient(nomProjet: string | null | undefined, objet: string, familles: IdFamille[]): string {
  if (nomProjet?.trim()) return nomProjet.trim();
  if (familles.length) return phraseFamilles(familles);
  const o = objet.trim();
  return o && !OBJET_GENERIQUE.test(o) && o.length <= 60 ? o : "Votre projet";
}

/**
 * Tout ce qu'il faut pour savoir où en est un projet — son dossier, ses
 * simulations publiées, ses photos, la lecture unique des devis et paiements
 * (faits.ts), ses familles —, sans rien écrire. Sert à l'état complet du projet
 * et aux cartes de l'accueil « Mes projets ».
 */
export async function chargerProjet(espace: EspaceClient) {
  const dossier = await prisma.dossier.findUnique({
    where: { id: espace.dossierId },
    select: {
      id: true,
      clientNom: true,
      clientAdresse: true,
      clientCp: true,
      clientVille: true,
      clientEmail: true,
      clientTelephone: true,
      objet: true,
      etape: true,
      photos: true,
      dateChantier: true,
      prestations: true,
      client: { select: { prenom: true, nomFamille: true, categorie: true } },
      lead: { select: { prenom: true, nom: true, typeProjet: true, source: true, tailleCuisine: true, delaiProjet: true, delaiProjetTexte: true, occupation: true } },
      // Mission 14 (R4) : les mêmes colonnes que les autres lecteurs de l'espace (faits.ts).
      documents: lectureDesDevis(),
      accords: { orderBy: { createdAt: "desc" } },
      encaissements: { select: { montant: true, moyen: true, recuLe: true, statut: true } },
      evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, createdAt: true, survenuLe: true } },
    },
  });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  const [simulations, photosClient] = await Promise.all([
    prisma.simulationEspace.findMany({ where: { espaceId: espace.id, statut: "PUBLIEE" }, orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] }),
    photosDuClient(dossier.id, dossier.photos),
  ]);
  // Devis en vigueur (repris compris), accord (en ligne ou constaté dans le CRM), paiements : lecture unique (faits.ts).
  const lecture = lireDevisEtPaiements({ devis: dossier.documents, accords: dossier.accords, encaissements: dossier.encaissements, clientNom: dossier.clientNom, signeLe: dateSignature(dossier.evenements) });
  const selection = lireSelection(dossier.prestations);
  const monProjet = lireProjet(espace.souhaits, selection, dossier.lead?.typeProjet);
  const choix = lireChoix(espace.choix);
  const faits: FaitsEspace = composerFaits({
    photos: photosClient.length,
    projetPrecise: projetPrecise(monProjet),
    projetValide: Boolean(espace.projetValideLe),
    simulationsCrm: simulations.filter((s) => s.source !== "SITE" && s.source !== "CLIENT").length,
    simulationsSite: simulations.filter((s) => s.source === "SITE").length,
    simulationsClient: simulations.filter((s) => s.source === "CLIENT").length,
    choix: Boolean(espace.choixLe && choix),
    lecture,
    etapeDossier: dossier.etape,
  });
  // Ce qu'il a déjà dit dans ses simulations du site : proposé en préremplissage, et la famille qu'elles laissent deviner.
  const zonesSite = new Set<string>();
  const refsSite: string[] = [];
  for (const s of simulations.filter((x) => x.source === "SITE")) {
    for (const z of lireZones(s.zones)) {
      for (const zone of ZONES_DEPUIS_SITE[z.zone] ?? []) zonesSite.add(zone);
      if (!refsSite.includes(z.ref)) refsSite.push(z.ref);
    }
  }
  const familles = famillesDe(selection);
  const suggerees = familles.length ? [] : famillesSuggerees({ zonesSite: [...zonesSite], typeProjet: dossier.lead?.typeProjet, sourceLead: dossier.lead?.source });
  return { dossier, simulations, photosClient, lecture, selection, monProjet, choix, faits, familles, suggerees, zonesSite: [...zonesSite], refsSite, fige: figeDuProjet(dossier.etape) };
}

export async function etatEspace(espace: EspaceClient, options: { apercu?: boolean; permanent?: Pick<EspacePermanent, "favoris"> | null } = {}): Promise<EtatEspace> {
  await synchroniserSimulationsSite(espace.dossierId).catch((erreur) => console.error("[espace] synchronisation des simulations du site :", erreur));
  const { dossier, simulations, photosClient, lecture, selection, monProjet, choix, faits, familles, suggerees, zonesSite, refsSite, fige } = await chargerProjet(espace);
  const [portrait, enPreparationCrm] = await Promise.all([
    portraitExiste(),
    // CoverSwap prépare vraiment quelque chose : un brouillon déposé, ou une préparation du CRM en cours.
    Promise.all([
      prisma.simulationEspace.count({ where: { espaceId: espace.id, statut: "BROUILLON" } }),
      prisma.preparationSimulation.count({ where: { dossierId: espace.dossierId, origine: "CRM", statut: { in: ["PREPAREE", "EN_COURS"] }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    ]).then(([brouillons, preparations]) => brouillons + preparations > 0),
  ]);
  const accord = lecture.accord;
  // Il peut revenir sur son accord tant que rien n'est encaissé et que le chantier n'est pas planifié.
  const accordRetirable = dossier.etape === "SIGNE" && (lecture.paiement?.recu ?? 0) === 0;
  const devis = lecture.devis ? devisPourLeClient(lecture.devis, accord, accordRetirable) : null;
  // Mission 18 (B7) : un avenant signé garde SON accord (le client le relit signé) ; il se retire tant que le chantier
  // n'a pas commencé — le retirer ne fait pas reculer le dossier.
  const avenantRetirable = ["SIGNE", "PLANIFIE"].includes(dossier.etape);
  const pourLeClient = (d: DevisLu): DevisClient =>
    d.id === lecture.devis?.id ? devis! : devisPourLeClient(d, accordEffectif(d, dossier.accords, { nom: dossier.clientNom, signeLe: d.dateEmission ?? d.createdAt }), estAvenant(d, dossier.documents) && avenantRetirable);
  const recu = lecture.paiement?.recu ?? 0;
  const etape = etapeEspace(faits);
  // Le prénom de la fiche client d'abord : un prénom corrigé par le client (carte « coordonnées ») l'emporte sur le formulaire.
  const coordonnees = lireCoordonnees({ dossier, client: dossier.client, lead: dossier.lead });
  const prenomBrut = (coordonnees.prenom || dossier.lead?.prenom || dossier.clientNom.split(/\s+/)[0] || "").trim();
  const prenom = CLIENT_INCONNU.test(prenomBrut) ? "" : prenomBrut.split(/\s+/)[0];
  // Les mots de l'écran viennent de SA famille (cochée, sinon devinée de sa demande) ; aucune : « votre projet ».
  const famillesDuTexte = familles.length ? familles : suggerees;
  const typeProjet = famillesDuTexte[0] ?? "AUTRE";
  const vuesLe = espace.simulationsVuesLe?.getTime() ?? 0;
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
  // Ce qui est signé ne se modifie plus ; ce sur quoi le devis est établi non plus (un appel suffit).
  const projetModifiable = fige
    ? { ok: false, raison: MESSAGE_FIGE[fige] }
    : faits.accord
      ? { ok: false, raison: "Votre projet est signé : pour y changer quelque chose, appelez CoverSwap." }
      : devis
        ? { ok: false, raison: "Votre devis est établi sur ce projet : pour le changer, appelez CoverSwap, nous l'ajustons avec vous." }
        : { ok: true, raison: null };

  const sansPas: Omit<EtatEspace, "prochainPas"> = {
    version: 2,
    apercu: Boolean(options.apercu),
    code: espace.code,
    nomProjet: nomDuProjetClient(espace.nomProjet, dossier.objet, familles),
    fige,
    familles,
    famillesSuggerees: suggerees,
    mots: motsDuProjet(famillesDuTexte),
    projetModifiable,
    prenom,
    nom: dossier.clientNom,
    ville: dossier.clientVille,
    typeProjet,
    projet: nomDuProjetClient(espace.nomProjet, dossier.objet, familles),
    etape,
    etapes: progression(faits),
    avancement: faits.accord ? "ACCORD" : ["PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(dossier.etape) ? "CHANTIER" : devis ? "DEVIS" : simulations.length > 0 ? "SIMULATION" : "PHOTOS",
    photos: photosClient.map((p) => ({ id: p.id, le: null })),
    monProjet,
    projetValide: espace.projetValideLe ? { le: espace.projetValideLe.toISOString(), par: espace.projetValidePar === "LUCAS" ? "LUCAS" : "CLIENT" } : null,
    projetManque: projetComplet(monProjet),
    connu: {
      tailleCuisine: dossier.lead?.tailleCuisine ?? null,
      delai: delaiConnu,
      delaiTexte: dossier.lead?.delaiProjetTexte ?? null,
      proprietaire: dossier.lead?.occupation === "PROPRIETAIRE" ? true : dossier.lead?.occupation === "LOCATAIRE" ? false : null,
      zones: zonesSite,
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
      // « Nouveau » : une simulation de CoverSwap publiée depuis sa dernière visite ; une simulation qu'il a faite lui-même
      // ne l'est jamais — sauf si elle a attendu la relecture de Lucas (mission 15, partie 5) : il la reçoit à la publication.
      nouvelle: s.source === "SITE" ? false : s.source === "CLIENT" ? s.vueLe === null : (s.publieeLe ?? s.createdAt).getTime() > vuesLe,
      choisie: Boolean(s.choisieLe),
      commentaire: s.commentaireClient,
    })),
    // v3 : il crée lui-même ses simulations ; « CoverSwap prépare » ne s'affiche que si c'est vrai.
    simulationsEnPreparation: enPreparationCrm && !faits.devis ? { delai: DELAI_SIMULATION } : null,
    propositionDemandeeLe: espace.propositionDemandeeLe?.toISOString() ?? null,
    propositionMessage: espace.propositionDemandeeLe ? (espace.propositionMessage ?? null) : null,
    choix,
    coordonnees,
    devis,
    devisProposes: lecture.proposes.filter((d) => d.visibleEspace !== false || d.statut === "ACCEPTE").map(pourLeClient),
    devisASigner: lecture.aSigner.map(pourLeClient),
    acompte: devis && devis.acompte > 0 ? { montant: devis.acompte, recu, complet: recu >= devis.acompte - 0.5 } : null,
    paiement: devis && accord && lecture.paiement ? { ...lecture.paiement, devisNumero: devis.numero, signeLe: accord.le.toISOString() } : null,
    virement: (() => {
      const ribLu = /RIB : ([A-Z0-9 ]+?) –.*?: ([A-Z0-9]+)$/.exec(EMETTEUR.ligneRib);
      return ribLu && devis ? { titulaire: EMETTEUR.raisonSociale, iban: ribLu[1].trim(), bic: ribLu[2], reference: `Devis ${devis.numero}` } : null;
    })(),
    // Mission 18 (B10) : le bouton « Payer par carte » n'apparaît que si Stripe est configuré en entier (clé ET webhook).
    paiementCarte: stripeActif(),
    chantier: faits.accord || ["PLANIFIE", "CHANTIER"].includes(dossier.etape) ? { date: dossier.dateChantier?.toISOString() ?? null } : null,
    apres: apresChantier
      ? { photos: lirePhotos(dossier.photos).filter(estPhotoApres).map((chemin) => ({ id: idPhoto(chemin) })), avis: avis && typeof avis.note === "number" ? avis : null }
      : null,
    contact: { nom: "Lucas Villemin", prenom: "Lucas", role: "Artisan poseur · CoverSwap, Pérols", telephone: EMETTEUR.telephone, telephoneLien: `+33${EMETTEUR.telephone.replace(/\D/g, "").slice(1)}`, portrait },
    marque: { nom: "CoverSwap", telephone: EMETTEUR.telephone, telephoneLien: `+33${EMETTEUR.telephone.replace(/\D/g, "").slice(1)}` },
    creation: await creationPourLeClient(espace, famillesDuTexte, selection, Boolean(options.apercu)),
    favoris: lireFavoris(options.permanent?.favoris ?? espace.favoris),
    choixModifiable: !devis && !fige,
    expireLe: espace.expireLe.toISOString(),
  };
  return { ...sansPas, prochainPas: prochainPas(sansPas) };
}

/* ── Simulations créées par le client (espace v3) ─────────────────── */

// Mission 15 (partie 5) : le bloc vit dans creation.ts (quota, lancement, suivi, accords) ; réexporté pour la route et les tests.
export { accorderSimulations, creerSimulationClient, demanderSimulations, quotaSimulations, schemaCreationSimulation, simulationsGratuites, suivreCreation, type CreationClient, type SuiviCreation } from "./creation";

function lireFavoris(json: string | null): string[] {
  try {
    const valeur: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(valeur) ? valeur.filter((r): r is string => typeof r === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(r)).slice(0, 60) : [];
  } catch {
    return [];
  }
}

export const schemaFavoris = z.object({ refs: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,24}$/)).max(60) });

/** Ses teintes favorites : gardées pour lui, et proposées en premier à Lucas dans le simulateur. */
export async function enregistrerFavoris(espace: EspaceClient | null, refs: string[], permanent?: Pick<EspacePermanent, "id"> | null): Promise<void> {
  const json = JSON.stringify([...new Set(refs)]);
  if (permanent) await avecActeur(ACTEUR, () => prisma.espacePermanent.update({ where: { id: permanent.id }, data: { favoris: json } }));
  else if (espace) await avecActeur(ACTEUR, () => prisma.espaceClient.update({ where: { id: espace.id }, data: { favoris: json } }));
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
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { photos: true, etape: true } });
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
      const suites = await prisma.$transaction(async (tx) => {
        // Le téléphone envoie les photos une à une : un dépôt en plusieurs envois reste UN événement.
        const recent = await tx.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_PHOTOS", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } }, orderBy: { createdAt: "desc" } });
        const deja = recent ? Number((JSON.parse(recent.metadata || "{}") as { nombre?: number }).nombre) || 0 : 0;
        const total = deja + deposees;
        const contenu = `${total} photo${total > 1 ? "s" : ""} déposée${total > 1 ? "s" : ""} par le client dans son espace`;
        if (recent) await tx.dossierEvenement.update({ where: { id: recent.id }, data: { contenu, metadata: JSON.stringify({ nombre: total }) } });
        else await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PHOTOS", direction: "ENTRANT", contenu, metadata: JSON.stringify({ nombre: total }) } });
        // La balle passe dans le camp de Lucas (mission 18 : une action posée à la main reste, une tâche le dit).
        return appliquerEvenementDossier(tx, espace.dossierId, { type: "PHOTOS_RECUES" });
      });
      await suitesEvenementDossier(suites);
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
    rubrique: "photos",
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

async function enregistrerJsonProjet(espace: EspaceClient, json: string, resume: string, precise: boolean): Promise<void> {
  const premier = !espace.souhaitsLe;
  await avecActeur(ACTEUR, async () => {
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { souhaits: json, souhaitsLe: new Date() } });
    // Enregistré à la frappe : un événement à la première saisie, puis au plus un par heure (mis à jour entre-temps).
    const recent = await prisma.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_SOUHAITS", createdAt: { gte: new Date(Date.now() - 3_600_000) } }, orderBy: { createdAt: "desc" } });
    const contenu = resume ? `Projet précisé par le client : ${resume}` : "Projet effacé par le client";
    if (premier || !recent) await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SOUHAITS", direction: "ENTRANT", contenu, metadata: "{}" } });
    else await prisma.dossierEvenement.update({ where: { id: recent.id }, data: { contenu } });
    // Une seule alerte par espace, trois minutes après le premier projet exploitable : la version posée, pas la première case cochée.
    if (precise) await mettreEnFile({ type: TACHE_ALERTE_PROJET, cle: `espace-projet:${espace.id}`, charge: { espaceId: espace.id }, apres: new Date(Date.now() + 180_000), priorite: 6 });
  });
}

/** L'alerte « projet précisé », avec le projet tel qu'il est au moment où elle part. */
export async function alerterProjetPrecise(espaceId: string): Promise<{ envoyee: boolean }> {
  const espace = await prisma.espaceClient.findUnique({ where: { id: espaceId }, select: { dossierId: true, souhaits: true, dossier: { select: { clientNom: true, clientTelephone: true, prestations: true, lead: { select: { typeProjet: true } } } } } });
  if (!espace) return { envoyee: false };
  const projet = lireProjet(espace.souhaits, lireSelection(espace.dossier.prestations), espace.dossier.lead?.typeProjet);
  if (!projetPrecise(projet)) return { envoyee: false };
  await prevenir(espace.dossierId, { titre: `Projet précisé — ${espace.dossier.clientNom}`, texte: resumerProjet(projet), urgence: 3, telephone: espace.dossier.clientTelephone });
  return { envoyee: true };
}

/**
 * Le client précise son projet : les familles et sous-parties vont au dossier
 * (Lucas les voit sur sa carte), la taille et le mot à l'espace. Modifier un
 * projet validé le dévalide (la pastille verte tombe, le CRM le sait) : il le
 * revalidera.
 */
export async function enregistrerProjet(espace: EspaceClient, entree: EntreeProjet): Promise<void> {
  const dossier = await prisma.dossier.findUnique({ where: { id: espace.dossierId }, select: { prestations: true, lead: { select: { typeProjet: true } } } });
  const typeProjet = dossier?.lead?.typeProjet ?? null;
  const avant = lireProjet(espace.souhaits, lireSelection(dossier?.prestations), typeProjet);
  const { selection, souhaits } = projetDepuisEntree(entree, avant, typeProjet);
  const apres = lireProjet(JSON.stringify(souhaits), selection, typeProjet);
  const empreinte = (p: ProjetClient | null) => JSON.stringify(p ? { f: p.familles, t: p.tailles, m: p.precisions } : null);
  if (espace.projetValideLe && empreinte(avant) !== empreinte(apres)) {
    const { devaliderProjet } = await import("./validations");
    await devaliderProjet(espace, "CLIENT", "il le modifie");
  }
  await avecActeur(ACTEUR, () => enregistrerPrestations(espace.dossierId, selection, "CLIENT"));
  await enregistrerJsonProjet(espace, JSON.stringify(souhaits), resumerProjet(apres), projetPrecise(apres));
}

export async function enregistrerSouhaits(espace: EspaceClient, souhaits: Souhaits): Promise<void> {
  const resume = [souhaits.propositions ? "veut des propositions" : null, souhaits.teintes.length ? `teintes : ${souhaits.teintes.join(", ")}` : null, souhaits.style ? `style : ${souhaits.style}` : null, souhaits.precisions ? `« ${souhaits.precisions} »` : null].filter(Boolean).join(" · ");
  await enregistrerJsonProjet(espace, JSON.stringify(souhaits), resume, Boolean(resume));
}

/** PUT /souhaits : le nouveau format (zones, styles…) ou l'ancien (teintes, style). */
export async function enregistrerProjetOuSouhaits(espace: EspaceClient, corps: unknown): Promise<void> {
  const brut = (corps && typeof corps === "object" ? corps : {}) as Record<string, unknown>;
  if ("familles" in brut || "tailles" in brut || "zones" in brut || "styles" in brut || "metres" in brut || "repere" in brut || "delai" in brut) {
    const lu = schemaProjet.safeParse(brut);
    if (!lu.success) throw new ErreurMetier(lu.error.issues[0]?.message ?? "Projet invalide.", 400);
    return enregistrerProjet(espace, lu.data);
  }
  const lu = schemaSouhaits.safeParse(brut);
  if (!lu.success) throw new ErreurMetier("Souhaits invalides.", 400);
  return enregistrerSouhaits(espace, lu.data);
}

/* ── Coordonnées ───────────────────────────────────────────────────── */

export { schemaCoordonnees } from "./coordonnees";

/** Le client enregistre ses coordonnées (carte « Vérifiez vos coordonnées », ou au bon pour accord) : coordonnees.ts. */
export async function completerCoordonnees(espace: Pick<EspaceClient, "dossierId">, entree: EntreeCoordonnees): Promise<void> {
  await enregistrerCoordonnees(espace, entree);
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
  const numero = /^(\d{1,4}(?:\s?(?:bis|ter|quater|[a-d]))?)\s+\D/i.exec(q)?.[1] ?? null;
  const chercher = async (filtre: string): Promise<AdresseProposee[]> => {
    try {
      const reponse = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5&autocomplete=1${filtre}`, { signal: AbortSignal.timeout(4000) });
      if (!reponse.ok) return [];
      const donnees = (await reponse.json()) as { features?: { properties?: { label?: string; name?: string; postcode?: string; city?: string; type?: string } }[] };
      return (donnees.features ?? [])
        .map((f) => f.properties ?? {})
        .filter((p) => p.label && p.postcode && p.city)
        .map((p) => {
          // Une rue sans le numéro tapé (« 12 rue des Lil… » → « Rue des Lilas ») : le numéro du client est gardé.
          const rue = p.type === "street" && numero ? `${numero} ${p.name ?? ""}`.trim() : null;
          return { libelle: rue ? `${rue} ${p.postcode} ${p.city}` : p.label!, adresse: p.type === "municipality" ? "" : (rue ?? p.name ?? ""), codePostal: p.postcode!, ville: p.city! };
        });
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

/**
 * Ancien retrait (POST de l'écran du dossier) : le même geste que « retirer » du bloc Espace (mission 18, B9) — archivée,
 * et le choix du client dévalidé si elle en fait partie (simulations/dossier.ts › changerStatutSimulation).
 */
export async function retirerSimulation(simulationId: string, motif = "Retirée de l'espace client"): Promise<void> {
  const simulation = await prisma.simulationEspace.findUnique({ where: { id: simulationId }, select: { dossierId: true } });
  if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
  await changerStatutSimulation(simulation.dossierId, simulationId, "retirer", motif);
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
  const suites = await ecrire(() =>
    prisma.$transaction(async (tx) => {
      await tx.simulationEspace.updateMany({ where: { espaceId: espace.id, id: { notIn: impliquees }, choisieLe: { not: null } }, data: { choisieLe: null } });
      for (const id of impliquees) await tx.simulationEspace.update({ where: { id }, data: { choisieLe: maintenant, ...(entree.commentaire && choix.mode === "UNE" ? { commentaireClient: entree.commentaire, commenteeLe: maintenant } : {}) } });
      await tx.espaceClient.update({ where: { id: espace.id }, data: { choix: JSON.stringify(choix), choixLe: maintenant } });
      // Mission 18 (B11) : les teintes choisies deviennent celles du dossier (sous-parties de son projet), les autres restent.
      await reporterTeintesDuChoix(tx, espace.dossierId, zonesValidees.map((z) => ({ zone: z.zone, ref: z.ref || null, nom: z.nom || null })), { remplacer: true });
      await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATION_CHOISIE", direction: auteur === "LUCAS" ? "INTERNE" : "ENTRANT", contenu: `${texte}${choix.mode === "UNE" && zonesValidees.length ? ` — ${zonesValidees.map((z) => `${z.libelle || z.zone} : ${z.nom || z.ref}${z.ref ? ` (${z.ref})` : ""}`).join(" · ")}` : ""}`.slice(0, 1500), metadata: JSON.stringify({ simulations: impliquees, mode: choix.mode, auteur, zones: zonesValidees }) } });
      return appliquerEvenementDossier(tx, espace.dossierId, { type: "CHOIX_VALIDE" }, maintenant);
    })
  );
  // Mission 14 (partie 7) : la prochaine action remplacée (un rappel peut-être) → l'agenda suit (mission 18 : les suites).
  await suitesEvenementDossier(suites);
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
    const [, evenement] = await prisma.$transaction([
      prisma.simulationEspace.update({ where: { id: simulationId }, data: { commentaireClient: commentaire, commenteeLe: new Date() } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_COMMENTAIRE", direction: "ENTRANT", contenu: `Commentaire du client${simulation.titre ? ` sur « ${simulation.titre} »` : ""} : « ${commentaire} »`, metadata: JSON.stringify({ simulationId }) } }),
    ]);
    await enregistrerMessageClient({ dossierId: espace.dossierId, espaceId: espace.id, source: "COMMENTAIRE", texte: commentaire, simulationId, evenementId: evenement.id });
  });
  await prevenir(espace.dossierId, { titre: `Commentaire — ${dossier?.clientNom ?? "client"}`, texte: `« ${commentaire} »`, urgence: 4, telephone: dossier?.clientTelephone, rubrique: "messages" });
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
  const suites = await avecActeur(ACTEUR, async () => {
    const { evenement, suites } = await prisma.$transaction(async (tx) => {
      // Son mot est gardé entier sur l'espace : il s'affiche dans le dossier et dans Espaces clients, pas seulement dans l'historique.
      await tx.espaceClient.update({ where: { id: espace.id }, data: { propositionDemandeeLe: maintenant, propositionMessage: entree.commentaire || null, propositionSimulationId: simulation?.id ?? null } });
      const evenement = await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_NOUVELLE_PROPOSITION", direction: "ENTRANT", contenu: texte.slice(0, 1500), metadata: JSON.stringify({ simulationId: simulation?.id ?? null }) } });
      if (simulation && entree.commentaire) await tx.simulationEspace.update({ where: { id: simulation.id }, data: { commentaireClient: entree.commentaire, commenteeLe: maintenant } });
      return { evenement, suites: await appliquerEvenementDossier(tx, espace.dossierId, { type: "PROPOSITION_DEMANDEE", commentaire: entree.commentaire }, maintenant) };
    });
    await enregistrerMessageClient({ dossierId: espace.dossierId, espaceId: espace.id, source: "PROPOSITION", texte: entree.commentaire || texte, simulationId: simulation?.id ?? null, evenementId: evenement.id });
    return suites;
  });
  await suitesEvenementDossier(suites);
  await prevenir(espace.dossierId, { titre: `Autre proposition demandée — ${dossier?.clientNom ?? "client"}`, texte: `${texte}\nÀ vous : préparer une nouvelle simulation.`, urgence: 4, telephone: dossier?.clientTelephone, rubrique: "messages" });
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
  // Mission 13 (lot 5, B6) : le compteur vit sur le devis lui-même (plusieurs devis proposés : chacun a le sien).
  // Mise à jour conditionnelle, atomique : deux requêtes simultanées (double appui, page + PDF)
  // ne comptent qu'une consultation et ne préviennent qu'une fois.
  let pris = { count: 0 };
  await avecActeur(ACTEUR, async () => {
    pris = await prisma.document.updateMany({
      where: { id: devis.id, OR: [{ consulteLe: null }, { consulteLe: { lt: seuil } }] },
      data: { consultations: { increment: 1 }, consulteLe: maintenant },
    });
  });
  const apres = await prisma.document.findUnique({ where: { id: devis.id }, select: { consultations: true } });
  const consultations = apres?.consultations ?? 1;
  if (pris.count === 0) return { consultations };
  // Mission 18 (B11) : le devis est la seule source de ses lectures ; les champs de l'espace (devisConsulte*) ne sont
  // plus écrits (colonnes gardées, plus aucun lecteur).
  const accord = await prisma.accordDevis.findFirst({ where: { documentId: devis.id, retireLe: null }, select: { id: true } });
  const contenu = `Le client a consulté son devis ${devis.numero} ${consultations === 1 ? "pour la première fois" : `— ${consultations} fois (dernière le ${maintenant.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" })} à ${maintenant.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })})`}`;
  await avecActeur(ACTEUR, async () => {
    // Une première lecture (le compteur remis à zéro par « Réinitialiser » compris) ouvre une nouvelle ligne d'historique.
    const evenement = consultations === 1 ? null : await prisma.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_DEVIS_CONSULTE", metadata: { contains: devis.id } }, orderBy: { createdAt: "desc" } });
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

/**
 * La signature tracée au doigt, écrite AVANT la transaction de l'accord (mission 18, B8 : pas d'écriture de fichier dans
 * une transaction) sous un nom stable — le devis et l'empreinte du dessin : une nouvelle tentative (double appui,
 * réseau coupé) réécrit le même fichier au lieu d'en semer un second.
 */
async function enregistrerSignature(dossierId: string, documentId: string, dataUrl: string | undefined): Promise<string | null> {
  const m = dataUrl ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m) return null;
  const octets = Buffer.from(m[1], "base64");
  if (octets.length < 200 || octets[0] !== 0x89 || octets[1] !== 0x50) return null;
  const empreinte = createHash("sha256").update(octets).digest("hex").slice(0, 16);
  const relatif = path.posix.join("dossiers", dossierId, "accords", `signature-${documentId}-${empreinte}.png`);
  const absolu = path.join(resolveUploadsDir(), relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, octets);
  return relatif;
}

/** Les statuts d'un devis qui ne se signe plus (remplacé, annulé, refusé, non retenu). */
const DEVIS_HORS_VIGUEUR = ["REMPLACE", "ANNULEE", "REFUSE", "NON_RETENU"];
const MESSAGE_HORS_VIGUEUR = "Ce devis n'est plus en vigueur : un nouveau devis vous sera proposé.";

/** Ce qu'a écrit la transaction d'un bon pour accord (null : rien, l'accord était déjà là). */
type IssueAccord = { avenant: { numero: string | null } | null; suites: Suites; reprise: boolean };

/**
 * Bon pour accord : UN geste du client. L'accord est écrit une fois pour toutes
 * (ligne jamais modifiée, avec la date, le montant figé, l'adresse IP, le
 * navigateur, et la signature au doigt s'il l'a tracée), le devis passe
 * « accepté », le dossier passe « Signé » et Lucas est prévenu sur son
 * téléphone. Vaut signature même sans paiement immédiat.
 *
 * Mission 18 (B8, écart 8) : tout se joue dans UNE transaction — l'accord relu dedans (un double appui n'en écrit qu'un),
 * l'accord, les autres devis proposés « non retenus », l'événement `ESPACE_DEVIS_ACCEPTE`, le passage en « Signé »
 * (`changerEtapeDansTransaction` : devis accepté, main et statut du lead), puis le point d'entrée (`DEVIS_ACCEPTE` :
 * prochaine action, une action posée à la main reste avec une tâche à côté ; main). Un échec n'écrit rien : la nouvelle
 * tentative signe. Rejouée après une signature réussie : sans effet. Un accord écrit sans que le dossier soit passé en
 * « Signé » (ancienne signature en deux temps, interrompue) : la nouvelle tentative termine le passage. Après la
 * transaction : Meta, agenda, tâches (`suitesEvenementDossier`), puis l'alerte à Lucas.
 */
export async function accepterDevis(espace: EspaceClient, entree: z.output<typeof schemaAccord>, origine: { ip: string | null; navigateur: string | null }): Promise<{ dejaAccepte: boolean }> {
  const devis = await prisma.document.findFirst({ where: { id: entree.documentId, dossierId: espace.dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } } });
  if (!devis) throw new ErreurMetier("Devis introuvable.", 404);
  if (DEVIS_HORS_VIGUEUR.includes(devis.statut)) throw new ErreurMetier(MESSAGE_HORS_VIGUEUR, 409);
  if (devis.visibleEspace === false && devis.statut !== "ACCEPTE") throw new ErreurMetier("Ce devis n'est pas proposé dans votre espace.", 409);

  const dossierId = espace.dossierId;
  const montants = montantsDocument({ lignes: lireLignes(devis.lignes), totalHt: devis.totalHt, acomptePct: devis.acomptePct });
  const total = (montants.totalTtcCentimes / 100).toLocaleString("fr-FR");
  const libelle = devis.libelleVariante ? ` (${devis.libelleVariante})` : "";
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true } });
  const signature = await enregistrerSignature(dossierId, devis.id, entree.signature).catch(() => null);

  const issue = await avecActeur(ACTEUR, () =>
    prisma.$transaction(
      async (tx): Promise<IssueAccord | null> => {
        // Relu dans la transaction : un devis annulé, remplacé ou retiré entre-temps ne se signe plus.
        const relu = await tx.document.findUnique({ where: { id: devis.id }, select: { statut: true, archiveLe: true } });
        if (!relu || relu.archiveLe || DEVIS_HORS_VIGUEUR.includes(relu.statut)) throw new ErreurMetier(MESSAGE_HORS_VIGUEUR, 409);
        // Un projet figé (non réalisé : perdu ; terminé : encaissé) ne se signe plus — la même règle que la route (projetDe).
        const fige = figeDuProjet((await tx.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { etape: true } })).etape);
        if (fige) throw new ErreurMetier(MESSAGE_FIGE[fige], 409);
        // Un accord retiré ne vaut plus : le client peut en redonner un (nouvelle ligne, nouvelle preuve).
        const existant = await tx.accordDevis.findFirst({ where: { documentId: devis.id, retireLe: null }, select: { id: true } });
        const nouvelAccord = () =>
          tx.accordDevis.create({
            data: { dossierId, documentId: devis.id, numeroDevis: devis.numero, totalHt: montants.totalHtCentimes / 100, acomptePct: devis.acomptePct, nomSignataire: entree.nom, mention: "Bon pour accord", ip: origine.ip, navigateur: origine.navigateur?.slice(0, 300) ?? null, signature },
          });
        // Mission 11 : il n'en signe qu'un ; les autres devis proposés passent « non retenu » (gardés en historique).
        const evenementAccord = (nonRetenus: DevisNonRetenu[], avenantDe: { id: string; numero: string | null } | null) =>
          tx.dossierEvenement.create({
            data: {
              dossierId,
              type: "ESPACE_DEVIS_ACCEPTE",
              direction: "ENTRANT",
              contenu: `Bon pour accord donné par ${entree.nom} sur le devis ${devis.numero}${libelle} (${total} €)${avenantDe ? `, avenant au devis signé ${avenantDe.numero}` : ""}${signature ? ", signé au doigt" : ""}${nonRetenus.length ? ` ; non retenu${nonRetenus.length > 1 ? "s" : ""} : ${libelleNonRetenus(nonRetenus)}` : ""}`,
              metadata: JSON.stringify({
                documentId: devis.id,
                numero: devis.numero,
                libelle: devis.libelleVariante ?? null,
                signature: Boolean(signature),
                ...(avenantDe ? { avenant: true, devisSigneId: avenantDe.id } : {}),
                nonRetenus: nonRetenus.map((a) => ({ id: a.id, numero: a.numero, libelle: a.libelleVariante ?? null })),
              }),
            },
          });

        // Mission 18 (B7, écart 7) : un avenant (ou un nouveau devis émis après le devis signé) se signe À CÔTÉ du devis
        // d'origine : son accord n'y touche pas, l'étape ne bouge pas (l'acompte reste celui du devis d'origine), les autres
        // devis « Généré » ou « Envoyé » (d'autres avenants proposés) passent « non retenu ».
        const signeAvant = await tx.document.findFirst({ where: { dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, statut: "ACCEPTE", id: { not: devis.id }, createdAt: { lt: devis.createdAt } }, orderBy: { createdAt: "asc" }, select: { id: true, numero: true } });
        if (signeAvant) {
          if (existant) return null;
          await nouvelAccord();
          const nonRetenus = await retenirDevis(tx, dossierId, devis.id);
          await tx.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
          await evenementAccord(nonRetenus, signeAvant);
          const suites = await appliquerEvenementDossier(tx, dossierId, { type: "DEVIS_ACCEPTE", documentId: devis.id, avenant: { numero: devis.numero } });
          return { avenant: { numero: signeAvant.numero }, suites, reprise: false };
        }

        // Le devis d'origine. Q, S, Devis envoyé, Relance (ou en pause depuis l'une d'elles) → « Signé » ; perdu (figé,
        // refusé plus haut) ne figure plus parmi les étapes signables ; déjà signé ou plus loin : le devis seul passe « accepté ».
        const signer = await estSigneeParDevisAccepte(tx, dossierId);
        if (existant && !signer) return null;
        let nonRetenus: DevisNonRetenu[] = [];
        if (!existant) {
          await nouvelAccord();
          nonRetenus = await retenirDevis(tx, dossierId, devis.id);
          await evenementAccord(nonRetenus, null);
        }
        const changement = signer
          ? await changerEtapeDansTransaction(tx, dossierId, {
              vers: "SIGNE",
              devisAccepteId: devis.id,
              confirmations: { BON_POUR_ACCORD: true },
              raison: [`bon pour accord donné dans l'espace client sur le devis ${devis.numero}${existant ? " (passage terminé à la nouvelle tentative)" : ""}`, suiteNonRetenus(nonRetenus)].filter(Boolean).join(" ; "),
            })
          : null;
        if (!changement && relu.statut !== "ACCEPTE") await tx.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
        const suites = await appliquerEvenementDossier(tx, dossierId, { type: "DEVIS_ACCEPTE", documentId: devis.id });
        return { avenant: null, suites: changement ? { ...suites, changements: [changement, ...suites.changements] } : suites, reprise: Boolean(existant) };
      },
      { maxWait: 10_000, timeout: 30_000 }
    )
  );
  if (!issue) return { dejaAccepte: true };
  await suitesEvenementDossier(issue.suites);

  if (issue.avenant) {
    await prevenir(
      dossierId,
      {
        titre: `AVENANT SIGNÉ — ${dossier?.clientNom ?? entree.nom}`,
        texte: `Bon pour accord sur le devis ${devis.numero}${libelle} : ${total} €, en plus du devis signé ${issue.avenant.numero}.\nÀ vous : le prévoir au chantier et sur la facture.`,
        urgence: 4,
        telephone: dossier?.clientTelephone,
        etiquette: `accord-${dossierId}`,
      },
      "espace-accord"
    );
    return { dejaAccepte: false };
  }
  // Signature reprise (l'accord d'une tentative interrompue) : Lucas n'avait pas été prévenu, il l'est maintenant.
  await prevenir(
    dossierId,
    {
      titre: `DEVIS SIGNÉ — ${dossier?.clientNom ?? entree.nom}`,
      texte: `Bon pour accord sur le devis ${devis.numero} : ${total} €${montants.acompteCentimes ? ` (acompte ${(montants.acompteCentimes / 100).toLocaleString("fr-FR")} €)` : ""}.\nÀ vous : appeler pour fixer la date du chantier.`,
      urgence: 5,
      telephone: dossier?.clientTelephone,
      etiquette: `accord-${dossierId}`,
    },
    "espace-accord"
  );
  return { dejaAccepte: issue.reprise };
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

