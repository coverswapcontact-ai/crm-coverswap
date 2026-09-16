import type { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { dateDepuisJour, estJourValide } from "@/lib/dossiers/dates";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import {
  CATEGORIES_CLIENT,
  LIBELLES_STATUT_CONSENTEMENT,
  MOYENS_CONSENTEMENT,
  SOURCES_CLIENT,
  STATUTS_CONSENTEMENT,
  familleDeSource,
  type CategorieClient,
  type SourceClient,
  type StatutConsentement,
} from "./constantes";
import { completerCoordonnees, creerClient, trouverClientParCoordonnees } from "./identification";
import { nomAffichage, normaliserEmail, normaliserTelephone, siretValide } from "./normalisation";
import type { ClientDetail, ClientResume, CoordonneeVue, LigneAcquisition } from "./types";

const ETAPES_CLOSES = new Set(["PERDU", "ENCAISSE"]);

/* ── Lecture ───────────────────────────────────────────────────────── */

const inclusionResume = {
  emails: { where: { archiveLe: null }, orderBy: [{ principale: "desc" }, { createdAt: "asc" }], take: 1 },
  telephones: { where: { archiveLe: null }, orderBy: [{ principal: "desc" }, { createdAt: "asc" }], take: 1 },
  recommandePar: { select: { id: true, nom: true } },
  _count: { select: { recommandations: true } },
  dossiers: {
    where: { archiveLe: null },
    select: {
      etape: true,
      updatedAt: true,
      documents: { where: { type: "DEVIS", statut: "ACCEPTE", archiveLe: null }, select: { totalHt: true } },
    },
  },
} satisfies Prisma.ClientInclude;

type ClientAvecResume = Prisma.ClientGetPayload<{ include: typeof inclusionResume }>;

function versResume(client: ClientAvecResume): ClientResume {
  const derniereActivite = client.dossiers.reduce(
    (plusRecente, dossier) => (dossier.updatedAt > plusRecente ? dossier.updatedAt : plusRecente),
    client.updatedAt
  );
  return {
    id: client.id,
    nom: client.nom,
    categorie: client.categorie as CategorieClient,
    ville: client.ville,
    source: client.source as SourceClient,
    sourceDetail: client.sourceDetail,
    premierContactLe: client.premierContactLe.toISOString(),
    derniereActiviteLe: derniereActivite.toISOString(),
    telephone: client.telephones[0]?.numero ?? null,
    email: client.emails[0]?.adresse ?? null,
    nbDossiers: client.dossiers.length,
    nbDossiersEnCours: client.dossiers.filter((dossier) => !ETAPES_CLOSES.has(dossier.etape)).length,
    montantSigne: client.dossiers.reduce(
      (somme, dossier) => somme + dossier.documents.reduce((total, document) => total + document.totalHt, 0),
      0
    ),
    recommandePar: client.recommandePar,
    nbRecommandations: client._count.recommandations,
    archiveLe: client.archiveLe?.toISOString() ?? null,
  };
}

export type FiltresClients = {
  recherche?: string;
  categorie?: CategorieClient;
  source?: SourceClient;
  archives?: boolean;
  limite?: number;
};

const FICHE_ANONYMISEE = "Fiche anonymisée (RGPD) : elle ne se modifie plus.";

export async function listerClients(filtres: FiltresClients = {}): Promise<ClientResume[]> {
  const termes = (filtres.recherche ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const where: Prisma.ClientWhereInput = {
    ...(filtres.archives ? { archiveLe: { not: null } } : {}),
    ...(filtres.categorie ? { categorie: filtres.categorie } : {}),
    ...(filtres.source ? { source: filtres.source } : {}),
    AND: termes.map((terme) => {
      const chiffres = terme.replace(/\D/g, "").replace(/^0/, "");
      return {
        OR: [
          { nom: { contains: terme } },
          { ville: { contains: terme } },
          { codePostal: { contains: terme } },
          { emails: { some: { adresse: { contains: terme.toLowerCase() } } } },
          ...(chiffres.length >= 4 ? [{ telephones: { some: { numero: { contains: chiffres } } } }] : []),
        ],
      };
    }),
  };
  const clients = await prisma.client.findMany({
    where,
    include: inclusionResume,
    orderBy: { updatedAt: "desc" },
    take: Math.min(filtres.limite ?? 200, 500),
  });
  return clients.map(versResume).sort((a, b) => b.derniereActiviteLe.localeCompare(a.derniereActiviteLe));
}

function versCoordonnee(ligne: {
  id: string;
  libelle: string | null;
  archiveLe: Date | null;
  archiveMotif: string | null;
  adresse?: string;
  numero?: string;
  saisi?: string;
  principale?: boolean;
  principal?: boolean;
}): CoordonneeVue {
  return {
    id: ligne.id,
    valeur: ligne.adresse ?? ligne.numero ?? "",
    saisi: ligne.saisi ?? null,
    libelle: ligne.libelle,
    principale: Boolean(ligne.principale ?? ligne.principal),
    archiveLe: ligne.archiveLe?.toISOString() ?? null,
    archiveMotif: ligne.archiveMotif,
  };
}

const LIBELLES_CHAMPS: Record<string, string> = {
  nom: "nom",
  prenom: "prénom",
  nomFamille: "nom de famille",
  raisonSociale: "raison sociale",
  siret: "SIRET",
  adresse: "adresse",
  codePostal: "code postal",
  ville: "ville",
  categorie: "catégorie",
  source: "source",
  sourceDetail: "précision de la source",
  campagne: "campagne",
  publicite: "publicité",
  formulaire: "formulaire",
  premierContactLe: "premier contact",
  recommandeParId: "recommandé par",
  recommandeParTexte: "recommandé par",
  notes: "passif",
  archiveLe: "archivage",
  archiveMotif: "motif d'archivage",
  anonymiseLe: "anonymisation (RGPD)",
  fusionneDansId: "fusion",
  principale: "principale",
  principal: "principal",
  clientId: "fiche",
};

function resumeLigneJournal(ligne: { modele: string; operation: string; avant: string | null; apres: string }): string {
  let apres: Record<string, unknown> = {};
  let avant: Record<string, unknown> = {};
  try {
    apres = JSON.parse(ligne.apres);
    avant = ligne.avant ? JSON.parse(ligne.avant) : {};
  } catch {
    return ligne.operation;
  }
  if (ligne.modele === "ClientEmail") return `${ligne.operation === "CREATION" ? "Adresse ajoutée" : "Adresse modifiée"} : ${apres.adresse}`;
  if (ligne.modele === "ClientTelephone") return `${ligne.operation === "CREATION" ? "Numéro ajouté" : "Numéro modifié"} : ${apres.saisi ?? apres.numero}`;
  if (ligne.modele === "ConsentementMail") {
    return `Mails commerciaux : ${(LIBELLES_STATUT_CONSENTEMENT[apres.statut as StatutConsentement] ?? String(apres.statut)).toLowerCase()}`;
  }
  if (ligne.operation === "CREATION" || ligne.operation === "ETAT_INITIAL") return "Fiche créée";
  const changes = Object.keys(apres).filter(
    (cle) => !["ecriture", "updatedAt"].includes(cle) && JSON.stringify(apres[cle]) !== JSON.stringify(avant[cle])
  );
  const libelles = [...new Set(changes.map((cle) => LIBELLES_CHAMPS[cle] ?? cle))];
  return libelles.length ? `Modifié : ${libelles.join(", ")}` : "Modification";
}

export async function chargerFiche(clientId: string): Promise<ClientDetail> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      ...inclusionResume,
      emails: { orderBy: [{ archiveLe: "asc" }, { principale: "desc" }, { createdAt: "asc" }] },
      telephones: { orderBy: [{ archiveLe: "asc" }, { principal: "desc" }, { createdAt: "asc" }] },
      consentements: { orderBy: [{ recueilliLe: "desc" }, { createdAt: "desc" }] },
      recommandations: {
        where: { archiveLe: null },
        select: {
          id: true,
          nom: true,
          dossiers: {
            where: { archiveLe: null },
            select: { documents: { where: { type: "DEVIS", statut: "ACCEPTE", archiveLe: null }, select: { totalHt: true } } },
          },
        },
      },
      leads: {
        orderBy: { createdAt: "desc" },
        select: { id: true, source: true, statut: true, createdAt: true, campagne: true, formulaire: true },
      },
    },
  });
  if (!client) throw new ErreurMetier("Client introuvable.", 404);

  const [dossiers, fusionneDans, propositions, journal] = await Promise.all([
    prisma.dossier.findMany({
      where: { ...AVEC_ARCHIVES, clientId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        objet: true,
        etape: true,
        clientVille: true,
        montantEstime: true,
        createdAt: true,
        archiveLe: true,
        documents: {
          where: { type: "DEVIS", statut: { not: "BROUILLON" }, archiveLe: null },
          orderBy: { createdAt: "desc" },
          select: { totalHt: true, statut: true },
        },
      },
    }),
    client.fusionneDansId
      ? prisma.client.findUnique({ where: { id: client.fusionneDansId }, select: { id: true, nom: true } })
      : null,
    prisma.proposition.findMany({
      where: { clientId, statut: "EN_ATTENTE" },
      select: { id: true, titre: true, type: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.$queryRawUnsafe<{ horodatage: bigint | number; operation: string; acteur: string; modele: string; avant: string | null; apres: string }[]>(
      `SELECT "horodatage", "operation", "acteur", "modele", "avant", "apres" FROM "JournalModification"
       WHERE ("modele" = 'Client' AND "enregistrementId" = ?)
          OR ("modele" IN ('ClientEmail', 'ClientTelephone', 'ConsentementMail') AND json_extract("apres", '$.clientId') = ?)
       ORDER BY "horodatage" DESC LIMIT 40`,
      clientId,
      clientId
    ),
  ]);

  return {
    ...versResume(client),
    prenom: client.prenom,
    nomFamille: client.nomFamille,
    raisonSociale: client.raisonSociale,
    siret: client.siret,
    adresse: client.adresse,
    codePostal: client.codePostal,
    campagne: client.campagne,
    publicite: client.publicite,
    formulaire: client.formulaire,
    recommandeParTexte: client.recommandeParTexte,
    notes: client.notes,
    archiveMotif: client.archiveMotif,
    fusionneDans,
    anonymiseLe: client.anonymiseLe?.toISOString() ?? null,
    emails: client.emails.map(versCoordonnee),
    telephones: client.telephones.map(versCoordonnee),
    consentements: client.consentements.map((consentement) => ({
      id: consentement.id,
      statut: consentement.statut as StatutConsentement,
      moyen: consentement.moyen,
      recueilliLe: consentement.recueilliLe.toISOString(),
      preuve: consentement.preuve,
      createdAt: consentement.createdAt.toISOString(),
    })),
    recommandations: client.recommandations.map((recommande) => ({
      id: recommande.id,
      nom: recommande.nom,
      nbDossiers: recommande.dossiers.length,
      montantSigne: recommande.dossiers.reduce(
        (somme, dossier) => somme + dossier.documents.reduce((total, document) => total + document.totalHt, 0),
        0
      ),
    })),
    dossiers: dossiers.map((dossier) => ({
      id: dossier.id,
      objet: dossier.objet,
      etape: dossier.etape,
      ville: dossier.clientVille,
      montant: dossier.documents.find((document) => document.statut === "ACCEPTE")?.totalHt ?? dossier.documents[0]?.totalHt ?? dossier.montantEstime,
      createdAt: dossier.createdAt.toISOString(),
      archiveLe: dossier.archiveLe?.toISOString() ?? null,
    })),
    leads: client.leads.map((lead) => ({ ...lead, createdAt: lead.createdAt.toISOString() })),
    propositionsEnAttente: propositions,
    historique: journal.map((ligne) => ({
      horodatage: new Date(Number(ligne.horodatage)).toISOString(),
      operation: ligne.operation,
      acteur: ligne.acteur,
      modele: ligne.modele,
      resume: resumeLigneJournal(ligne),
    })),
  };
}

/** D'où viennent les clients, et ce que chaque canal a signé. */
export async function statistiquesAcquisition(): Promise<LigneAcquisition[]> {
  const clients = await prisma.client.findMany({
    select: {
      source: true,
      dossiers: {
        where: { archiveLe: null },
        select: { documents: { where: { type: "DEVIS", statut: "ACCEPTE", archiveLe: null }, select: { totalHt: true } } },
      },
    },
  });
  const lignes = new Map<string, LigneAcquisition>();
  for (const client of clients) {
    const source = client.source as SourceClient;
    const ligne = lignes.get(source) ?? { famille: familleDeSource(source), source, clients: 0, clientsSignes: 0, montantSigne: 0 };
    const montant = client.dossiers.reduce(
      (somme, dossier) => somme + dossier.documents.reduce((total, document) => total + document.totalHt, 0),
      0
    );
    ligne.clients++;
    if (montant > 0) ligne.clientsSignes++;
    ligne.montantSigne += montant;
    lignes.set(source, ligne);
  }
  return [...lignes.values()].sort((a, b) => b.montantSigne - a.montantSigne || b.clients - a.clients);
}

/* ── Écriture ──────────────────────────────────────────────────────── */

const texteOuNull = (max: number, message: string) =>
  z
    .string(message)
    .trim()
    .max(max, message)
    .nullable()
    .transform((valeur) => valeur || null);

const jour = (message: string) => z.string(message).refine(estJourValide, message);

const champsClient = {
  categorie: z.enum(CATEGORIES_CLIENT, "Catégorie invalide."),
  prenom: texteOuNull(80, "Prénom trop long."),
  nomFamille: texteOuNull(120, "Nom trop long."),
  raisonSociale: texteOuNull(160, "Raison sociale trop longue."),
  siret: z
    .string("SIRET invalide : 14 chiffres attendus.")
    .transform((valeur) => valeur.replace(/\s/g, ""))
    .refine((valeur) => valeur === "" || /^\d{14}$/.test(valeur), "SIRET invalide : 14 chiffres attendus.")
    .nullable()
    .transform((valeur) => valeur || null),
  adresse: texteOuNull(200, "Adresse trop longue."),
  codePostal: z
    .string("Code postal invalide : 5 chiffres attendus.")
    .trim()
    .refine((valeur) => valeur === "" || /^\d{5}$/.test(valeur), "Code postal invalide : 5 chiffres attendus.")
    .nullable()
    .transform((valeur) => valeur || null),
  ville: texteOuNull(80, "Ville trop longue."),
  source: z.enum(SOURCES_CLIENT, "Source invalide."),
  sourceDetail: texteOuNull(160, "Précision trop longue."),
  campagne: texteOuNull(200, "Campagne trop longue."),
  publicite: texteOuNull(200, "Publicité trop longue."),
  formulaire: texteOuNull(200, "Formulaire trop long."),
  premierContactLe: jour("Date de premier contact invalide."),
  recommandeParId: z.string().max(40).nullable(),
  recommandeParTexte: texteOuNull(160, "Recommandation trop longue."),
  notes: texteOuNull(10_000, "Passif trop long : 10 000 caractères maximum."),
};

export const schemaModificationClient = z.object(champsClient).partial();
export type ModificationClient = z.output<typeof schemaModificationClient>;

async function verifierRecommandeur(clientId: string | null, recommandeParId: string | null | undefined) {
  if (!recommandeParId) return;
  if (recommandeParId === clientId) throw new ErreurMetier("Un client ne peut pas se recommander lui-même.", 400);
  const recommandeur = await prisma.client.findUnique({ where: { id: recommandeParId }, select: { archiveLe: true } });
  if (!recommandeur || recommandeur.archiveLe) throw new ErreurMetier("Client recommandeur introuvable ou archivé.", 404);
}

const SIRET_FAUX = "SIRET invalide : un chiffre est faux (clé de contrôle). Vérifie-le sur l'avis de situation ou dans l'annuaire.";
const RAISON_SOCIALE_MANQUANTE = "Indique la raison sociale : pour un client pro, c'est l'entreprise qui est le client.";

export async function modifierClient(clientId: string, modification: ModificationClient): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ErreurMetier("Client introuvable.", 404);
  if (client.anonymiseLe) throw new ErreurMetier(FICHE_ANONYMISEE, 409);
  if (client.archiveLe) throw new ErreurMetier("Fiche archivée : la restaurer avant de la modifier.", 409);
  await verifierRecommandeur(clientId, modification.recommandeParId);

  const apres = <C extends "categorie" | "prenom" | "nomFamille" | "raisonSociale">(champ: C) =>
    modification[champ] !== undefined ? modification[champ] : client[champ];
  // Un particulier qui devient pro, ou un pro qui a déjà sa raison sociale, ne s'en passe pas. Une fiche
  // pro venue d'un formulaire sans nom d'entreprise reste modifiable en attendant qu'on le connaisse.
  const raisonSocialeExigee = client.categorie === "PARTICULIER" || nomAffichage({ raisonSociale: client.raisonSociale }) !== null;
  if (apres("categorie") !== "PARTICULIER" && raisonSocialeExigee && !nomAffichage({ raisonSociale: apres("raisonSociale") })) {
    throw new ErreurMetier(RAISON_SOCIALE_MANQUANTE, 400);
  }
  // Un pro qui devient particulier doit avoir un nom de personne (une fiche ancienne peut n'en avoir aucun).
  if (modification.categorie === "PARTICULIER" && client.categorie !== "PARTICULIER" && !nomAffichage({ prenom: apres("prenom"), nomFamille: apres("nomFamille") })) {
    throw new ErreurMetier("Indique un prénom ou un nom : un particulier est une personne.", 400);
  }
  // Seul un SIRET nouvellement saisi est contrôlé : une fiche ancienne reste modifiable.
  if (modification.siret && modification.siret !== client.siret && !siretValide(modification.siret)) throw new ErreurMetier(SIRET_FAUX, 400);

  const { premierContactLe, ...champs } = modification;
  const data: Prisma.ClientUncheckedUpdateInput = { ...champs };
  if (premierContactLe) data.premierContactLe = dateDepuisJour(premierContactLe);
  const nom = nomAffichage({ prenom: apres("prenom"), nomFamille: apres("nomFamille"), raisonSociale: apres("raisonSociale") });
  if (nom) data.nom = nom;
  await prisma.client.update({ where: { id: clientId }, data });
}

export const schemaCreationClient = z.object({
  ...champsClient,
  premierContactLe: jour("Date de premier contact invalide.").nullable().optional(),
  email: z.string().trim().max(160).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  /** Créer même si un client a déjà cet e-mail ou ce numéro (la paire sera proposée à la fusion). */
  forcer: z.boolean().optional(),
});
export type CreationClient = z.output<typeof schemaCreationClient>;

/**
 * Fiche créée à la main. Un particulier est une personne (prénom, nom) ; un
 * professionnel ou un donneur d'ordre est une entité (raison sociale, SIRET),
 * sans prénom ni nom de personne.
 */
export async function creerClientManuel(saisie: CreationClient): Promise<string> {
  const estPro = saisie.categorie !== "PARTICULIER";
  const entree: CreationClient = estPro
    ? { ...saisie, prenom: null, nomFamille: null }
    : { ...saisie, raisonSociale: null, siret: null };
  if (estPro && !nomAffichage({ raisonSociale: entree.raisonSociale })) throw new ErreurMetier(RAISON_SOCIALE_MANQUANTE, 400);
  if (!estPro && !nomAffichage(entree)) throw new ErreurMetier("Indique un prénom ou un nom.", 400);
  if (entree.siret && !siretValide(entree.siret)) throw new ErreurMetier(SIRET_FAUX, 400);
  if (entree.email && !normaliserEmail(entree.email)) throw new ErreurMetier("Adresse e-mail invalide.", 400);
  if (entree.telephone && !normaliserTelephone(entree.telephone)) throw new ErreurMetier("Numéro de téléphone invalide.", 400);
  await verifierRecommandeur(null, entree.recommandeParId);

  if (!entree.forcer) {
    const memeSiret = entree.siret ? await prisma.client.findFirst({ where: { siret: entree.siret }, select: { id: true, nom: true } }) : null;
    if (memeSiret) {
      throw new ErreurMetier(`Un client a déjà ce SIRET : « ${memeSiret.nom} ».`, 409, { clientExistantId: memeSiret.id });
    }
    const existant = await trouverClientParCoordonnees({ emails: [entree.email], telephones: [entree.telephone] });
    if (existant) {
      throw new ErreurMetier(`Un client a déjà cet e-mail ou ce numéro : « ${existant.nom} ».`, 409, { clientExistantId: existant.id });
    }
  }
  return prisma.$transaction(async (tx) => {
    const cree = await creerClient(tx, {
      ...entree,
      premierContactLe: entree.premierContactLe ? dateDepuisJour(entree.premierContactLe) : new Date(),
      emails: [entree.email],
      telephones: [entree.telephone],
    });
    if (entree.recommandeParId || entree.recommandeParTexte || entree.siret || entree.notes) {
      await tx.client.update({
        where: { id: cree.id },
        data: {
          recommandeParId: entree.recommandeParId,
          recommandeParTexte: entree.recommandeParTexte,
          siret: entree.siret,
          notes: entree.notes,
        },
      });
    }
    return cree.id;
  });
}

export async function ajouterCoordonnee(
  clientId: string,
  nature: "email" | "telephone",
  valeur: string,
  libelle: string | null
): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { archiveLe: true } });
  if (!client) throw new ErreurMetier("Client introuvable.", 404);
  if (client.archiveLe) throw new ErreurMetier("Fiche archivée : la restaurer avant de la modifier.", 409);
  if (nature === "email") {
    const adresse = normaliserEmail(valeur);
    if (!adresse) throw new ErreurMetier("Adresse e-mail invalide.", 400);
    if (await prisma.clientEmail.findFirst({ where: { clientId, adresse } })) {
      throw new ErreurMetier("Cette adresse est déjà sur la fiche.", 409);
    }
  } else {
    const numero = normaliserTelephone(valeur);
    if (!numero) throw new ErreurMetier("Numéro de téléphone invalide.", 400);
    if (await prisma.clientTelephone.findFirst({ where: { clientId, numero } })) {
      throw new ErreurMetier("Ce numéro est déjà sur la fiche.", 409);
    }
  }
  await prisma.$transaction(async (tx) => {
    await completerCoordonnees(tx, clientId, nature === "email" ? { emails: [valeur] } : { telephones: [valeur] });
    if (libelle) {
      if (nature === "email") {
        await tx.clientEmail.updateMany({ where: { clientId, adresse: normaliserEmail(valeur)! }, data: { libelle } });
      } else {
        await tx.clientTelephone.updateMany({ where: { clientId, numero: normaliserTelephone(valeur)! }, data: { libelle } });
      }
    }
  });
}

export async function archiverCoordonnee(
  clientId: string,
  nature: "email" | "telephone",
  coordonneeId: string,
  motif: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (nature === "email") {
      const ligne = await tx.clientEmail.findFirst({ where: { id: coordonneeId, clientId } });
      if (!ligne) throw new ErreurMetier("Adresse introuvable.", 404);
      await tx.clientEmail.update({ where: { id: ligne.id }, data: { archiveLe: new Date(), archiveMotif: motif, principale: false } });
      if (ligne.principale) {
        const suivante = await tx.clientEmail.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" } });
        if (suivante) await tx.clientEmail.update({ where: { id: suivante.id }, data: { principale: true } });
      }
    } else {
      const ligne = await tx.clientTelephone.findFirst({ where: { id: coordonneeId, clientId } });
      if (!ligne) throw new ErreurMetier("Numéro introuvable.", 404);
      await tx.clientTelephone.update({ where: { id: ligne.id }, data: { archiveLe: new Date(), archiveMotif: motif, principal: false } });
      if (ligne.principal) {
        const suivant = await tx.clientTelephone.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" } });
        if (suivant) await tx.clientTelephone.update({ where: { id: suivant.id }, data: { principal: true } });
      }
    }
  });
}

export async function definirPrincipale(clientId: string, nature: "email" | "telephone", coordonneeId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (nature === "email") {
      const ligne = await tx.clientEmail.findFirst({ where: { id: coordonneeId, clientId, archiveLe: null } });
      if (!ligne) throw new ErreurMetier("Adresse introuvable.", 404);
      await tx.clientEmail.updateMany({ where: { clientId, principale: true, id: { not: ligne.id } }, data: { principale: false } });
      await tx.clientEmail.update({ where: { id: ligne.id }, data: { principale: true } });
    } else {
      const ligne = await tx.clientTelephone.findFirst({ where: { id: coordonneeId, clientId, archiveLe: null } });
      if (!ligne) throw new ErreurMetier("Numéro introuvable.", 404);
      await tx.clientTelephone.updateMany({ where: { clientId, principal: true, id: { not: ligne.id } }, data: { principal: false } });
      await tx.clientTelephone.update({ where: { id: ligne.id }, data: { principal: true } });
    }
  });
}

export const schemaConsentement = z.object({
  statut: z.enum(STATUTS_CONSENTEMENT, "Choisis la réponse du client."),
  moyen: z.enum(MOYENS_CONSENTEMENT, "Choisis comment le client a répondu."),
  recueilliLe: jour("Date invalide."),
  preuve: texteOuNull(1000, "Précision trop longue.").optional(),
});

export async function enregistrerConsentement(clientId: string, entree: z.output<typeof schemaConsentement>): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, anonymiseLe: true } });
  if (!client) throw new ErreurMetier("Client introuvable.", 404);
  if (client.anonymiseLe) throw new ErreurMetier(FICHE_ANONYMISEE, 409);
  const recueilliLe = dateDepuisJour(entree.recueilliLe);
  if (recueilliLe.getTime() > Date.now() + 24 * 60 * 60_000) {
    throw new ErreurMetier("La date du consentement ne peut pas être dans le futur.", 400);
  }
  await prisma.consentementMail.create({
    data: { clientId, statut: entree.statut, moyen: entree.moyen, recueilliLe, preuve: entree.preuve ?? null },
  });
}

/** État courant du consentement : la déclaration la plus récente (par date de recueil). */
export function consentementCourant(consentements: { statut: StatutConsentement; recueilliLe: string }[]): StatutConsentement | null {
  return consentements[0]?.statut ?? null;
}

export async function archiverClient(clientId: string, motif: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { archiveLe: true, dossiers: { where: { archiveLe: null }, select: { etape: true } } },
  });
  if (!client) throw new ErreurMetier("Client introuvable.", 404);
  if (client.archiveLe) throw new ErreurMetier("Fiche déjà archivée.", 409);
  if (client.dossiers.some((dossier) => !ETAPES_CLOSES.has(dossier.etape))) {
    throw new ErreurMetier("Ce client a des dossiers en cours : clos-les ou archive-les d'abord.", 409);
  }
  await prisma.client.update({ where: { id: clientId }, data: { archiveLe: new Date(), archiveMotif: motif } });
}

export async function restaurerClient(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { archiveLe: true, fusionneDansId: true, anonymiseLe: true } });
  if (!client) throw new ErreurMetier("Client introuvable.", 404);
  if (client.anonymiseLe) throw new ErreurMetier(FICHE_ANONYMISEE, 409);
  if (client.fusionneDansId) throw new ErreurMetier("Fiche fusionnée dans une autre : c'est celle-ci qui vit.", 409);
  if (!client.archiveLe) return;
  await prisma.client.update({ where: { id: clientId }, data: { archiveLe: null, archiveMotif: null } });
}
