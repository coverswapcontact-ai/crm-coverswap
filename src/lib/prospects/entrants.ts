import type { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { completerCoordonnees, rattacherLead } from "@/lib/clients/identification";
import { formaterTelephone, normaliserEmail, normaliserTelephone } from "@/lib/clients/normalisation";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import {
  GROUPES_ENTRANTS,
  JOURS_A_TRAITER,
  LIBELLES_STATUT_LEAD,
  SOURCES_LEAD,
  STATUTS_LEAD_APRES_DEVIS,
  STATUTS_LEAD_MANUELS,
  TYPES_ECHANGE,
  TYPES_PROJET,
  groupeDuLead,
  intentionDuLead,
  type GroupeEntrants,
} from "./constantes";
import type { EntrantDetail, EntrantResume, ListeEntrants } from "./types";

// Contacts entrants (modèle Lead) : ce que le site, Meta, Zapier et la saisie
// à la main font arriver. Ils vivent ici jusqu'au dossier ; ensuite leur
// statut suit le dossier (src/lib/dossiers/transitions.ts).

const JOUR_MS = 86_400_000;
const VILLES_INCONNUES = new Set(["", "non renseignée", "non renseigne", "inconnue"]);

const inclusionResume = {
  simulations: { where: { archiveLe: null }, select: { source: true, prixDevis: true }, orderBy: { createdAt: "desc" } },
  interactions: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { type: true, contenu: true, createdAt: true } },
  dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true, etape: true } },
  client: { select: { id: true, nom: true } },
} satisfies Prisma.LeadInclude;

type LeadResume = Prisma.LeadGetPayload<{ include: typeof inclusionResume }>;

function nomDuLead(lead: { prenom: string; nom: string }): string {
  const prenom = lead.prenom.trim();
  const nom = lead.nom.trim();
  if (!prenom || prenom.toLowerCase() === nom.toLowerCase()) return nom || prenom || "Contact sans nom";
  return nom ? `${prenom} ${nom}` : prenom;
}

function telephoneLisible(saisie: string): string | null {
  if (!saisie.trim()) return null;
  const normalise = normaliserTelephone(saisie);
  return normalise ? formaterTelephone(normalise) : saisie.trim();
}

function versResume(lead: LeadResume, maintenant: Date): EntrantResume {
  const dernier = lead.interactions[0] ?? null;
  const depuis = dernier?.createdAt ?? lead.createdAt;
  const ville = VILLES_INCONNUES.has(lead.ville.trim().toLowerCase()) ? null : lead.ville.trim();
  return {
    id: lead.id,
    nom: nomDuLead(lead),
    telephone: telephoneLisible(lead.telephone),
    email: lead.email,
    ville,
    source: lead.source,
    statut: lead.statut,
    typeProjet: lead.typeProjet,
    intention: intentionDuLead(lead),
    prixSimule: lead.simulations.find((simulation) => simulation.prixDevis)?.prixDevis ?? lead.prixDevis ?? null,
    recuLe: lead.createdAt.toISOString(),
    dernierEchange: dernier ? { type: dernier.type, contenu: dernier.contenu.slice(0, 200), le: dernier.createdAt.toISOString() } : null,
    joursSansNouvelle: Math.max(0, Math.floor((maintenant.getTime() - depuis.getTime()) / JOUR_MS)),
    groupe: groupeDuLead({ statut: lead.statut, createdAt: lead.createdAt, archiveLe: lead.archiveLe, nbDossiers: lead.dossiers.length }, maintenant),
    dossier: lead.dossiers[0] ?? null,
    client: lead.client,
    archiveLe: lead.archiveLe?.toISOString() ?? null,
  };
}

/** Filtre d'un groupe, traduit pour la base (même partition que groupeDuLead). */
function whereGroupe(groupe: GroupeEntrants, maintenant: Date): Prisma.LeadWhereInput {
  const limite = new Date(maintenant.getTime() - JOURS_A_TRAITER * JOUR_MS);
  const actifsSansDossier: Prisma.LeadWhereInput = { archiveLe: null, dossiers: { none: { archiveLe: null } }, statut: { notIn: [...STATUTS_LEAD_APRES_DEVIS] } };
  switch (groupe) {
    case "ARCHIVES":
      return { archiveLe: { not: null } };
    case "AVEC_DOSSIER":
      return { archiveLe: null, OR: [{ dossiers: { some: { archiveLe: null } } }, { statut: { in: [...STATUTS_LEAD_APRES_DEVIS] } }] };
    case "SANS_SUITE":
      return { ...actifsSansDossier, AND: [{ statut: "PERDU" }] };
    case "A_TRAITER":
      return { ...actifsSansDossier, AND: [{ statut: { in: ["NOUVEAU", "DEVIS_DEMANDE"] } }], createdAt: { gte: limite } };
    case "ANCIENS":
      return { ...actifsSansDossier, AND: [{ statut: { in: ["NOUVEAU", "DEVIS_DEMANDE"] } }], createdAt: { lt: limite } };
    case "CONTACTES":
      return { ...actifsSansDossier, AND: [{ statut: { notIn: ["NOUVEAU", "DEVIS_DEMANDE", "PERDU"] } }] };
  }
}

function whereRecherche(recherche: string | undefined): Prisma.LeadWhereInput {
  const brut = (recherche ?? "").trim();
  // « 06 11 00 00 03 » : un numéro, pas cinq mots. Les leads gardent le numéro tel que reçu ; leur fiche client l'a normalisé.
  const chiffres = brut.replace(/\D/g, "");
  if (chiffres.length >= 6 && /^[\d\s.+()-]+$/.test(brut)) {
    const fin = chiffres.replace(/^(33|0)/, "").slice(-9);
    return { OR: [{ telephone: { contains: chiffres } }, { telephone: { contains: fin } }, { client: { telephones: { some: { numero: { contains: fin } } } } }] };
  }
  const termes = brut.split(/\s+/).filter(Boolean).slice(0, 5);
  return {
    AND: termes.map((terme) => {
      const chiffres = terme.replace(/\D/g, "");
      return {
        OR: [
          { nom: { contains: terme } },
          { prenom: { contains: terme } },
          { email: { contains: terme.toLowerCase() } },
          { ville: { contains: terme } },
          ...(chiffres.length >= 4 ? [{ telephone: { contains: chiffres.slice(-8) } }] : []),
        ],
      };
    }),
  };
}

export type FiltresEntrants = { groupe?: GroupeEntrants; source?: string; recherche?: string; limite?: number };

export async function listerEntrants(filtres: FiltresEntrants = {}, maintenant: Date = new Date()): Promise<ListeEntrants> {
  const groupe = filtres.groupe ?? "A_TRAITER";
  // Filtres combinés par AND : la recherche et le groupe ont chacun leurs AND/OR, qui ne doivent pas s'écraser.
  const communs: Prisma.LeadWhereInput[] = [...(filtres.source ? [{ source: filtres.source }] : []), whereRecherche(filtres.recherche)];
  const [leads, ...comptes] = await Promise.all([
    prisma.lead.findMany({
      where: { ...AVEC_ARCHIVES, AND: [...communs, whereGroupe(groupe, maintenant)] },
      include: inclusionResume,
      orderBy: groupe === "A_TRAITER" || groupe === "ANCIENS" ? { createdAt: "desc" } : { updatedAt: "desc" },
      take: Math.min(filtres.limite ?? 200, 500),
    }),
    ...GROUPES_ENTRANTS.map((cle) => prisma.lead.count({ where: { ...AVEC_ARCHIVES, AND: [...communs, whereGroupe(cle, maintenant)] } })),
  ]);
  const compteurs = Object.fromEntries(GROUPES_ENTRANTS.map((cle, index) => [cle, comptes[index]])) as Record<GroupeEntrants, number>;
  return { lignes: leads.map((lead) => versResume(lead, maintenant)), compteurs };
}

/** Contacts à traiter (reçus depuis moins de 60 jours, sans dossier) : le compteur de la navigation. */
export function compterEntrantsATraiter(maintenant: Date = new Date()): Promise<number> {
  return prisma.lead.count({ where: whereGroupe("A_TRAITER", maintenant) });
}

export async function chargerEntrant(id: string, maintenant: Date = new Date()): Promise<EntrantDetail> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      ...inclusionResume,
      simulations: { where: { archiveLe: null }, orderBy: { createdAt: "desc" } },
      interactions: { where: { archiveLe: null }, orderBy: { createdAt: "desc" } },
      dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true, etape: true, objet: true, ouvertLe: true, createdAt: true } },
      devis: { orderBy: { createdAt: "desc" }, select: { id: true, numero: true, statut: true, prixVente: true, createdAt: true, facture: { select: { id: true, numero: true } } } },
      chantier: { include: { commandes: { where: { archiveLe: null }, select: { reference: true, statut: true } } } },
    },
  });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  const resume = versResume(
    { ...lead, simulations: lead.simulations, interactions: lead.interactions.slice(0, 1), dossiers: lead.dossiers.map((dossier) => ({ id: dossier.id, etape: dossier.etape })) },
    maintenant
  );
  return {
    ...resume,
    prenom: lead.prenom,
    nomFamille: lead.nom,
    codePostal: lead.codePostal,
    notes: lead.notes,
    campagne: lead.campagne,
    publicite: lead.publicite,
    formulaire: lead.formulaire,
    archiveMotif: lead.archiveMotif,
    simulations: lead.simulations.map((simulation) => ({
      id: simulation.id,
      le: simulation.createdAt.toISOString(),
      source: simulation.source,
      reference: simulation.referenceChoisie,
      metresLineaires: simulation.mlEstimes,
      prix: simulation.prixDevis,
      avant: simulation.imageBeforePath ? `/api/uploads/${simulation.imageBeforePath}` : null,
      apres: simulation.imageAfterPath ? `/api/uploads/${simulation.imageAfterPath}` : null,
      pdf: `/api/simulations/${simulation.id}/pdf`,
    })),
    echanges: lead.interactions.map((echange) => ({ id: echange.id, type: echange.type, contenu: echange.contenu, le: echange.createdAt.toISOString() })),
    dossiers: lead.dossiers.map((dossier) => ({ id: dossier.id, objet: dossier.objet, etape: dossier.etape, ouvertLe: (dossier.ouvertLe ?? dossier.createdAt).toISOString() })),
    anciensDevis: lead.devis.map((devis) => ({
      id: devis.id,
      numero: devis.numero,
      statut: devis.statut,
      montant: devis.prixVente,
      le: devis.createdAt.toISOString(),
      pdf: `/api/pdf/devis/${devis.id}`,
      facture: devis.facture ? { numero: devis.facture.numero, pdf: `/api/pdf/facture/${devis.facture.id}` } : null,
    })),
    ancienChantier: lead.chantier
      ? {
          dateIntervention: lead.chantier.dateIntervention.toISOString(),
          adresse: lead.chantier.adresse,
          statut: lead.chantier.statut,
          acompteRecu: lead.chantier.acompteRecu,
          soldeRecu: lead.chantier.soldeRecu,
          commandes: lead.chantier.commandes,
        }
      : null,
  };
}

/* ── Écriture ──────────────────────────────────────────────────────── */

const texte = (max: number, message: string) => z.string(message).trim().max(max, message);

export const schemaModificationEntrant = z
  .object({
    prenom: texte(80, "Prénom trop long."),
    nomFamille: texte(120, "Nom trop long."),
    telephone: texte(40, "Numéro trop long."),
    email: texte(160, "Adresse trop longue.").nullable(),
    ville: texte(80, "Ville trop longue."),
    codePostal: texte(10, "Code postal trop long.").nullable(),
    typeProjet: z.enum(TYPES_PROJET, "Type de projet invalide."),
    notes: texte(5000, "Notes trop longues.").nullable(),
    statut: z.enum(STATUTS_LEAD_MANUELS, "Statut invalide."),
    motif: texte(300, "Motif trop long.").nullable(),
  })
  .partial();

/** Tout se corrige ; rend ce qui mérite d'être signalé. */
export async function modifierEntrant(id: string, entree: z.output<typeof schemaModificationEntrant>): Promise<string[]> {
  const lead = await prisma.lead.findUnique({ where: { id }, include: { dossiers: { where: { archiveLe: null }, select: { id: true } } } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  const avertissements: string[] = [];
  const { nomFamille, motif, email, ...champs } = entree;
  if (entree.statut && entree.statut !== lead.statut && lead.dossiers.length > 0) {
    throw new ErreurMetier("Ce contact a un dossier : son statut suit le dossier, c'est le dossier qu'il faut faire avancer.", 409);
  }
  if (email && !normaliserEmail(email)) throw new ErreurMetier("Adresse e-mail invalide.", 400);
  if (entree.telephone && !normaliserTelephone(entree.telephone)) throw new ErreurMetier("Numéro de téléphone illisible : il faut au moins 9 chiffres.", 400);
  // Coordonnées corrigées : la fiche client les reçoit aussi (les anciennes y restent, archivables depuis la fiche).
  const nouvelEmail = email && normaliserEmail(email) !== normaliserEmail(lead.email) ? email : null;
  const nouveauTelephone = entree.telephone && normaliserTelephone(entree.telephone) !== normaliserTelephone(lead.telephone) ? entree.telephone : null;
  const prenomFinal = (entree.prenom ?? lead.prenom).trim();
  const nomFinal = (nomFamille ?? lead.nom).trim();
  if (!prenomFinal && !nomFinal) throw new ErreurMetier("Indique au moins un prénom ou un nom.", 400);

  const data: Prisma.LeadUpdateInput = { ...champs, ...(nomFamille !== undefined ? { nom: nomFamille } : {}), ...(email !== undefined ? { email: email ? normaliserEmail(email) : null } : {}) };
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data });
    if (nouvelEmail || nouveauTelephone) {
      if (lead.clientId) await completerCoordonnees(tx, lead.clientId, { emails: [nouvelEmail], telephones: [nouveauTelephone] });
      else await rattacherLead(tx, id, null);
    }
    if (entree.statut && entree.statut !== lead.statut) {
      await tx.interaction.create({
        data: {
          leadId: id,
          type: "NOTE",
          contenu: `Statut : ${LIBELLES_STATUT_LEAD[entree.statut]}${entree.statut === "PERDU" && motif ? ` (${motif})` : ""}`,
        },
      });
    }
  });
  if ((nouvelEmail || nouveauTelephone) && lead.clientId) {
    avertissements.push("Coordonnées ajoutées aussi à la fiche client ; les anciennes y restent, à archiver depuis la fiche si elles sont fausses.");
  }
  return avertissements;
}

export const schemaEchange = z.object({
  type: z.enum(TYPES_ECHANGE, "Type d'échange invalide."),
  contenu: z.string("Précise l'échange.").trim().min(2, "Précise l'échange.").max(5000, "Échange trop long."),
});

/** Un échange noté ; un appel, un SMS ou un e-mail fait passer un contact à traiter en « Contacté ». */
export async function ajouterEchange(id: string, entree: z.output<typeof schemaEchange>): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { statut: true, archiveLe: true, dossiers: { where: { archiveLe: null }, select: { id: true } } } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  if (lead.dossiers.length > 0) throw new ErreurMetier("Ce contact a un dossier : le suivi se note sur le dossier.", 409);
  await prisma.$transaction(async (tx) => {
    await tx.interaction.create({ data: { leadId: id, type: entree.type, contenu: entree.contenu } });
    if (entree.type !== "NOTE" && (lead.statut === "NOUVEAU" || lead.statut === "DEVIS_DEMANDE")) {
      await tx.lead.update({ where: { id }, data: { statut: "CONTACTE" } });
    }
  });
}

export const schemaMotif = z.object({
  motif: z.string("Motif obligatoire.").trim().min(3, "Motif obligatoire : 3 caractères au moins.").max(500, "Motif trop long."),
});

export async function archiverEntrant(id: string, motif: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { archiveLe: true } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  if (lead.archiveLe) throw new ErreurMetier("Contact déjà archivé.", 409);
  await prisma.lead.update({ where: { id }, data: { archiveLe: new Date(), archiveMotif: motif } });
}

export async function restaurerEntrant(id: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { archiveLe: true } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  if (!lead.archiveLe) return;
  await prisma.lead.update({ where: { id }, data: { archiveLe: null, archiveMotif: null } });
}

export const schemaCreationEntrant = z.object({
  prenom: texte(80, "Prénom trop long.").default(""),
  nomFamille: texte(120, "Nom trop long.").default(""),
  telephone: texte(40, "Numéro trop long.").default(""),
  email: texte(160, "Adresse trop longue.").nullable().default(null),
  ville: texte(80, "Ville trop longue.").default(""),
  codePostal: texte(10, "Code postal trop long.").nullable().default(null),
  source: z.enum(SOURCES_LEAD, "Source invalide.").default("AUTRE"),
  typeProjet: z.enum(TYPES_PROJET, "Type de projet invalide.").default("CUISINE"),
  notes: texte(5000, "Notes trop longues.").nullable().default(null),
});

/**
 * Contact saisi à la main (appel, salon, bouche-à-oreille). Seul un prénom ou
 * un nom est exigé ; un numéro ou une adresse illisibles sont refusés. Il
 * rejoint aussitôt la fiche client qui a ces coordonnées, ou en crée une.
 */
export async function creerEntrant(entree: z.output<typeof schemaCreationEntrant>): Promise<{ id: string; clientId: string }> {
  if (!entree.prenom && !entree.nomFamille) throw new ErreurMetier("Indique au moins un prénom ou un nom.", 400);
  if (entree.telephone && !normaliserTelephone(entree.telephone)) throw new ErreurMetier("Numéro de téléphone illisible : il faut au moins 9 chiffres.", 400);
  if (entree.email && !normaliserEmail(entree.email)) throw new ErreurMetier("Adresse e-mail invalide.", 400);
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        prenom: entree.prenom,
        nom: entree.nomFamille,
        telephone: entree.telephone,
        email: entree.email ? normaliserEmail(entree.email) : null,
        ville: entree.ville,
        codePostal: entree.codePostal,
        source: entree.source,
        typeProjet: entree.typeProjet,
        notes: entree.notes,
      },
    });
    await tx.interaction.create({ data: { leadId: lead.id, type: "NOTE", contenu: "Contact saisi à la main dans le pilotage" } });
    const clientId = await rattacherLead(tx, lead.id, null);
    return { id: lead.id, clientId };
  });
}
