import type { EspaceClient, EspacePermanent } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { lireLignes } from "@/lib/dossiers/stockage";
import { montantsDocument } from "@/lib/dossiers/montants";
import { lirePdfDocument } from "@/lib/dossiers/documents";
import { famille, famillesDe, lireSelection, prestationsPubliques, type IdFamille, type PrestationsPubliques } from "@/lib/prestations/prestations";
import { ACTEUR, prevenir } from "./alertes";
import { confirmationRequise } from "./liens";
import { etapeEspace } from "./etapes";
import { figeDuProjet, LIBELLES_PASTILLE, pastilleDuProjet, peutOuvrirUnProjet, projetsVisibles, type Fige, type PastilleProjet } from "./projets";
import { chargerProjet, nomDuProjetClient } from "./service";

/**
 * L'espace PERMANENT du client, au-dessus de ses projets (mission 5) : l'accueil
 * « Mes projets » (une carte par projet : son nom, ses familles, une pastille,
 * la prochaine action), ses documents de tous les projets, ses favoris, le
 * contact. Rien d'un autre client : tout part de l'espace permanent du jeton.
 */

export type ProjetCarte = {
  code: string;
  nom: string;
  familles: { id: IdFamille; libelle: string }[];
  pastille: PastilleProjet;
  libellePastille: string;
  prochaine: string | null;
  fige: Fige | null;
  /** Ouvert le (date réelle d'ouverture du dossier). */
  depuis: string;
};

export type DocumentClient = {
  id: string;
  type: "DEVIS" | "FACTURE" | "AVOIR";
  numero: string;
  le: string;
  montant: number;
  /** « Signé », « À signer », « Remplacé », « Réglée », « À régler »… */
  statut: string;
  projet: string;
  /** Adresse du PDF dans l'espace (null : établi avant l'espace, sans PDF conservé). */
  pdf: string | null;
};

export type CompteEspace = {
  version: 3;
  prenom: string;
  /** Plus de 90 jours sans visite : rien d'autre ne sort avant les quatre derniers chiffres de son téléphone. */
  confirmation: { requise: boolean } | null;
  projets: ProjetCarte[];
  /** Le projet affiché (son code), s'il y en a un. */
  projetCourant: string | null;
  nouveauProjet: { possible: boolean; enCours: number; limite: number; demandeLe: string | null };
  documents: DocumentClient[];
  favoris: string[];
  prestations: PrestationsPubliques;
  marque: { nom: string; telephone: string; telephoneLien: string; email: string | null };
};

const CLIENT_INCONNU = /^(inconnu|client)$/i;
const marque = () => ({ nom: "CoverSwap", telephone: EMETTEUR.telephone, telephoneLien: `+33${EMETTEUR.telephone.replace(/\D/g, "").slice(1)}`, email: EMETTEUR.email as string | null });

function lireFavoris(json: string | null | undefined): string[] {
  try {
    const valeur: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(valeur) ? valeur.filter((r): r is string => typeof r === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(r)).slice(0, 60) : [];
  } catch {
    return [];
  }
}

async function prenomDuClient(permanent: EspacePermanent): Promise<string> {
  const client = await prisma.client.findUnique({ where: { id: permanent.clientId }, select: { prenom: true, nom: true, leads: { select: { prenom: true }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const brut = (client?.leads[0]?.prenom ?? client?.prenom ?? client?.nom.split(/\s+/)[0] ?? "").trim().split(/\s+/)[0] ?? "";
  return CLIENT_INCONNU.test(brut) ? "" : brut;
}

/**
 * Le projet à montrer : celui demandé (`?projet=<code>`), sinon celui du lien
 * (un lien de projet d'avant le 22/09), sinon — s'il n'a qu'un projet en cours —
 * celui-là ; sinon aucun : l'accueil « Mes projets ». Jamais celui d'un autre client.
 */
export type ProjetVisible = Awaited<ReturnType<typeof projetsVisibles>>[number];

export async function projetDemande(permanent: EspacePermanent, code: string | null, projetDuLien: EspaceClient | null): Promise<ProjetVisible | null> {
  const projets = await projetsVisibles(prisma, permanent.id);
  if (code) {
    const trouve = projets.find((p) => p.code === code);
    if (!trouve) throw new ErreurMetier("Ce projet n'est pas dans votre espace.", 404);
    return trouve;
  }
  if (projetDuLien) {
    const trouve = projets.find((p) => p.id === projetDuLien.id);
    if (trouve) return trouve;
  }
  const enCours = projets.filter((p) => !figeDuProjet(p.dossier.etape));
  if (enCours.length === 1) return enCours[0];
  if (projets.length === 1) return projets[0];
  return null;
}

/** La carte d'un projet sur l'accueil : de quoi dire en un coup d'œil où il en est. */
async function carteDuProjet(projet: EspaceClient): Promise<ProjetCarte> {
  const charge = await chargerProjet(projet);
  const etape = etapeEspace(charge.faits);
  const enCoursCreation = (await prisma.preparationSimulation.count({ where: { dossierId: projet.dossierId, origine: "CLIENT", statut: "EN_COURS", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } } })) > 0;
  const { pastille, prochaine } = pastilleDuProjet({ etape, etapeDossier: charge.dossier.etape, dateChantier: charge.dossier.dateChantier, soldeDu: Boolean(charge.lecture.paiement && !charge.lecture.paiement.regle), enCoursCreation });
  const familles = charge.familles.length ? charge.familles : charge.suggerees;
  const dossier = await prisma.dossier.findUnique({ where: { id: projet.dossierId }, select: { ouvertLe: true, createdAt: true } });
  return {
    code: projet.code,
    nom: nomDuProjetClient(projet.nomProjet, charge.dossier.objet, charge.familles),
    familles: familles.map((id) => ({ id, libelle: famille(id).libelle })),
    pastille,
    libellePastille: LIBELLES_PASTILLE[pastille],
    prochaine,
    fige: charge.fige,
    depuis: (dossier?.ouvertLe ?? dossier?.createdAt ?? projet.createdAt).toISOString(),
  };
}

const STATUTS_DEVIS: Record<string, string> = { GENERE: "À signer", ENVOYE: "À signer", ACCEPTE: "Signé", REFUSE: "Refusé", REMPLACE: "Remplacé", ANNULEE: "Annulé" };

/** Tous ses devis et factures, tous projets confondus, du plus récent au plus ancien. */
export async function documentsDuClient(permanent: Pick<EspacePermanent, "id">): Promise<DocumentClient[]> {
  const projets = await projetsVisibles(prisma, permanent.id);
  const noms = new Map(projets.map((p) => [p.dossierId, nomDuProjetClient(p.nomProjet, p.dossier.objet, famillesDe(lireSelection(p.dossier.prestations)))]));
  const documents = await prisma.document.findMany({
    where: { dossierId: { in: projets.map((p) => p.dossierId) }, archiveLe: null, numero: { not: null }, type: { in: ["DEVIS", "FACTURE", "AVOIR"] }, statut: { not: "BROUILLON" } },
    orderBy: [{ dateEmission: "desc" }, { createdAt: "desc" }],
  });
  const etapes = new Map(projets.map((p) => [p.dossierId, p.dossier.etape]));
  return documents.map((d) => {
    const montants = montantsDocument({ lignes: lireLignes(d.lignes), totalHt: d.totalHt, acomptePct: d.acomptePct });
    const statut =
      d.type === "DEVIS"
        ? (STATUTS_DEVIS[d.statut] ?? d.statut)
        : d.type === "AVOIR"
          ? "Avoir"
          : etapes.get(d.dossierId) === "ENCAISSE"
            ? "Réglée"
            : d.statut === "ANNULEE"
              ? "Annulée"
              : "À régler";
    return {
      id: d.id,
      type: d.type as DocumentClient["type"],
      numero: d.numero!,
      le: (d.dateEmission ?? d.createdAt).toISOString(),
      montant: montants.totalTtcCentimes / 100,
      statut,
      projet: noms.get(d.dossierId) ?? "Votre projet",
      pdf: d.pdfPath ? `documents/${d.id}` : null,
    };
  });
}

/** Le PDF d'un de SES documents (n'importe lequel de ses projets) ; jamais celui d'un autre client. */
export async function pdfPourLeClient(permanent: Pick<EspacePermanent, "id">, documentId: string): Promise<{ contenu: Buffer; nomFichier: string; dossierId: string }> {
  const projets = await projetsVisibles(prisma, permanent.id);
  const document = await prisma.document.findFirst({ where: { id: documentId, dossierId: { in: projets.map((p) => p.dossierId) }, archiveLe: null, numero: { not: null } }, select: { dossierId: true } });
  if (!document) throw new ErreurMetier("Document introuvable.", 404);
  return { ...(await lirePdfDocument(document.dossierId, documentId)), dossierId: document.dossierId };
}

/** L'espace du client en entier, pour l'accueil. Confirmation demandée : son prénom, et rien d'autre. */
export async function compteEspace(permanent: EspacePermanent, options: { apercu?: boolean; projetCourant?: EspaceClient | null } = {}): Promise<CompteEspace> {
  const prenom = await prenomDuClient(permanent);
  const requise = !options.apercu && confirmationRequise(permanent);
  const base = { version: 3 as const, prenom, prestations: prestationsPubliques(), marque: marque() };
  if (requise) return { ...base, confirmation: { requise: true }, projets: [], projetCourant: null, nouveauProjet: { possible: false, enCours: 0, limite: 0, demandeLe: null }, documents: [], favoris: [] };
  const projets = await projetsVisibles(prisma, permanent.id);
  const cartes = await Promise.all(projets.map((p) => carteDuProjet(p)));
  // En cours d'abord (ce qui l'attend en tête), puis les projets passés, du plus récent au plus ancien.
  const rang = (c: ProjetCarte) => (c.pastille === "A_VOUS" ? 0 : c.pastille === "COVERSWAP" || c.pastille === "EN_COURS" ? 1 : 2);
  cartes.sort((a, b) => rang(a) - rang(b) || b.depuis.localeCompare(a.depuis));
  const place = await peutOuvrirUnProjet(permanent);
  return {
    ...base,
    confirmation: null,
    projets: cartes,
    projetCourant: options.projetCourant?.code ?? null,
    nouveauProjet: { ...place, demandeLe: permanent.projetDemandeLe?.toISOString() ?? null },
    documents: await documentsDuClient(permanent),
    favoris: lireFavoris(permanent.favoris),
  };
}

/** Une visite de l'espace : comptée (dix minutes font une visite), datée — c'est elle qui fait courir les 90 jours. */
export async function noterVisitePermanent(permanent: EspacePermanent): Promise<void> {
  const maintenant = new Date();
  await avecActeur(ACTEUR, async () => {
    const { count } = await prisma.espacePermanent.updateMany({
      where: { id: permanent.id, OR: [{ dernierAccesLe: null }, { dernierAccesLe: { lt: new Date(maintenant.getTime() - 10 * 60_000) } }] },
      data: { dernierAccesLe: maintenant, nbAcces: { increment: 1 } },
    });
    if (count > 0) await prisma.espacePermanent.updateMany({ where: { id: permanent.id, premierAccesLe: null }, data: { premierAccesLe: maintenant } });
  });
}

/** Cinq essais manqués : bloqué 24 heures, et Lucas le sait (quelqu'un essaie peut-être un lien qui n'est pas le sien). */
export async function alerterConfirmationBloquee(permanent: EspacePermanent): Promise<void> {
  const projets = await projetsVisibles(prisma, permanent.id);
  const dossierId = projets.at(-1)?.dossierId;
  if (!dossierId) return;
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true } });
  await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_CONFIRMATION_BLOQUEE", direction: "ENTRANT", contenu: "Cinq essais manqués sur les 4 derniers chiffres du téléphone : l'espace est bloqué 24 heures.", metadata: JSON.stringify({ permanentId: permanent.id }) } });
  await prevenir(dossierId, { titre: `Espace bloqué — ${dossier?.clientNom ?? "client"}`, texte: "Cinq essais manqués sur les 4 derniers chiffres du téléphone. Si ce n'est pas lui, régénérez son lien (fiche client).", urgence: 4, telephone: dossier?.clientTelephone, etiquette: `confirmation-${permanent.id}` });
}

export const schemaMessage = z.object({ texte: z.string("Écrivez votre message.").trim().min(2, "Écrivez votre message.").max(2000, "Message trop long (2 000 caractères au plus).") });

/** « Écrire à CoverSwap » : le message va dans le dossier du projet (ou le plus récent), et sonne chez Lucas. */
export async function envoyerMessage(permanent: EspacePermanent, projet: EspaceClient | null, texte: string): Promise<void> {
  const projets = await projetsVisibles(prisma, permanent.id);
  const dossierId = projet?.dossierId ?? projets.at(-1)?.dossierId;
  if (!dossierId) throw new ErreurMetier("Votre espace n'a pas encore de projet : appelez CoverSwap.", 409);
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true } });
  await avecActeur(ACTEUR, () => prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: `Message du client depuis son espace : « ${texte} »`.slice(0, 2100), metadata: JSON.stringify({ permanentId: permanent.id }) } }));
  await prevenir(dossierId, { titre: `Message — ${dossier?.clientNom ?? "client"}`, texte: `« ${texte.slice(0, 600)} »\nÀ vous : lui répondre (appel ou SMS).`, urgence: 4, telephone: dossier?.clientTelephone, etiquette: `message-${dossierId}` });
}
