import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { aHeureParis, quandLisible } from "@/lib/commercial/quand";
import { issueDesMetadonnees, tentativesALaFin } from "@/lib/commercial/sans-reponse";
import { jetonEspace, lienPourLeProjet, ouvrirEspace, ouvrirEspaceDuContact } from "@/lib/espace/liens";
import { liensEnvoyes } from "@/lib/espace/suivi";
import { estIssuDuSimulateur } from "@/lib/prospects/qualification";
import { estRelancePhotos, type ActionSms, type CodeSms, type PropositionSms, type RelanceSms } from "./catalogue";
import { devisARelancer } from "./copie";
import { texteDuCatalogue } from "./modeles";
import { prenomDuContact } from "./texte";

/**
 * Mission 14 (29/09/2026), partie 5 — le SMS proposé à Lucas, prérempli selon
 * l'action (issue d'appel, lien de l'espace, relance) et la source du lead
 * (simulation du site, pub Meta, formulaire, espace). Le texte vient du
 * catalogue (`texteDuCatalogue`). RIEN n'est écrit ici : c'est la copie
 * (`noterSmsCopie`) qui trace. Seule exception, voulue : un SMS avec le lien
 * ouvre l'espace (et le dossier) s'il ne l'est pas, comme « lien_espace ».
 */

export type DemandeSms = {
  action: ActionSms;
  leadId?: string | null;
  dossierId?: string | null;
  /** Le rappel posé (PAS_DE_REPONSE : demain 18 h à défaut ; A_RAPPELER : « prochainement » sans date). */
  rappelLe?: Date | string | null;
  /** RELANCE_DEVIS : le devis et le rang de la relance ; RELANCE_PHOTOS : `{ type: "PHOTOS", rang }` (partie 6). */
  relance?: RelanceSms | null;
  /** PAS_DE_REPONSE : les appels sans réponse d'affilée, cet appel compris (sinon lus sur le lead ou le dossier). */
  tentatives?: number | null;
};

const SELECTION_LEAD = {
  id: true,
  prenom: true,
  nom: true,
  telephone: true,
  source: true,
  tentatives: true,
  _count: { select: { simulations: { where: { archiveLe: null } } } },
} satisfies Prisma.LeadSelect;
type LeadLu = Prisma.LeadGetPayload<{ select: typeof SELECTION_LEAD }>;

type Contact = { leadId: string | null; dossierId: string | null; lead: LeadLu | null; nom: string; prenom: string; telephone: string | null };

/** « Inconnu » et « Client » sont posés faute de mieux par les formulaires : ni prénom ni nom. */
const sansValeurParDefaut = (texte: string | null | undefined) => (texte ?? "").trim().replace(/^(inconnu|client)$/i, "");

/** « SMS à … » : prénom et nom du lead sans « Inconnu » (comme la liste des leads), sinon le nom du dossier. */
function nomAffiche(lead: { prenom: string; nom: string } | null, nomDuDossier: string | null): string {
  const prenom = sansValeurParDefaut(lead?.prenom);
  const nom = sansValeurParDefaut(lead?.nom);
  const complet = !prenom || prenom.toLowerCase() === nom.toLowerCase() ? nom || prenom : `${prenom} ${nom}`;
  return complet || sansValeurParDefaut(nomDuDossier) || "Contact sans nom";
}

/**
 * Qui reçoit le SMS : le lead (ou celui du dossier), son dossier vivant, son nom, son téléphone (le lead d'abord,
 * sinon le dossier ou la fiche client) et son prénom — `prenomDuContact`, la règle du mail et de « lien_espace » :
 * fiche client, puis lead, puis nom du dossier. Un lead qui a un dossier vivant est lu par son dossier.
 */
async function contactDe(entree: { leadId?: string | null; dossierId?: string | null }): Promise<Contact> {
  if (!entree.dossierId) {
    if (!entree.leadId) throw new ErreurMetier("Indique le contact ou le dossier.", 400);
    const lead = await prisma.lead.findUnique({ where: { id: entree.leadId }, select: { ...SELECTION_LEAD, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
    if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
    const dossierId = lead.dossiers[0]?.id;
    if (dossierId) return contactDe({ leadId: lead.id, dossierId });
    return { leadId: lead.id, dossierId: null, lead, nom: nomAffiche(lead, null), prenom: prenomDuContact(lead.prenom), telephone: lead.telephone.trim() || null };
  }
  const dossier = await prisma.dossier.findUnique({
    where: { id: entree.dossierId },
    select: {
      id: true,
      clientNom: true,
      clientTelephone: true,
      lead: { select: SELECTION_LEAD },
      client: { select: { prenom: true, telephones: { where: { archiveLe: null }, orderBy: [{ principal: "desc" }, { createdAt: "asc" }], take: 1, select: { numero: true } } } },
    },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const lead = dossier.lead ?? (entree.leadId ? await prisma.lead.findUnique({ where: { id: entree.leadId }, select: SELECTION_LEAD }) : null);
  return {
    leadId: lead?.id ?? null,
    dossierId: dossier.id,
    lead,
    nom: nomAffiche(lead, dossier.clientNom),
    prenom: prenomDuContact(dossier.client?.prenom, lead?.prenom, dossier.clientNom),
    telephone: lead?.telephone.trim() || dossier.clientTelephone.trim() || dossier.client?.telephones[0]?.numero || null,
  };
}

/**
 * Une simulation du site est DÉJÀ dans l'espace de ce projet : rangée dans le dossier, avec son rendu (c'est ce que
 * l'espace montre, `synchroniserSimulationsSite`). Seule condition de LIEN_ESPACE_SIMULATION (« votre simulation vous
 * attend dans votre espace »), pour l'écran SMS comme pour « lien_espace » — la même que le mail du lien.
 */
export async function simulationDansLEspace(dossierId: string | null): Promise<boolean> {
  return dossierId ? (await prisma.simulation.count({ where: { dossierId, archiveLe: null, imageAfterPath: { not: null } } })) > 0 : false;
}

/**
 * Lead venu d'une simulation du site, pour le SMS « pas de réponse » (« au sujet de votre simulation ») : la règle
 * d'`estIssuDuSimulateur` (source SITE_SIMULATEUR ou une simulation sur sa fiche), ou une simulation rangée dans son
 * dossier. Plus large que `simulationDansLEspace` : il a fait une simulation, même si son rendu n'est pas arrivé.
 */
async function simulationDuSite(lead: LeadLu | null, dossierId: string | null): Promise<boolean> {
  if (lead && estIssuDuSimulateur(lead)) return true;
  return simulationDansLEspace(dossierId);
}

/** Les appels sans réponse d'affilée d'un dossier sans lead, lus sur ses événements APPEL (aussi la fin d'appel, partie 4). */
export async function tentativesDuDossier(dossierId: string): Promise<number> {
  const appels = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "APPEL" }, select: { metadata: true, contenu: true, createdAt: true, survenuLe: true } });
  return tentativesALaFin(appels.map((a) => ({ issue: issueDesMetadonnees(a.metadata), texte: a.contenu, le: a.survenuLe ?? a.createdAt })));
}

/**
 * Où en est le lien de son espace : jamais reçu (PREMIER), le lien actuel déjà reçu ou ouvert (RAPPEL), ou seulement
 * un lien d'avant « Nouveau lien », mort depuis (NOUVEAU). Le jeton porte la version : un envoi du lien actuel contient
 * `/e/<jeton>`, un envoi d'une version antérieure seulement le code (`/e/<code>-`, celui du client ou, avant le 22/09,
 * celui du projet). « Ouvert avec ce lien » : une visite depuis son émission (`lienEmisLe`, remis à « Nouveau lien »).
 */
type EtatDuLien = "PREMIER" | "RAPPEL" | "NOUVEAU";

/** L'espace ouvert (et le dossier) s'il le faut, son lien, et où en est ce lien (voir `EtatDuLien`). */
async function espaceEtLien(contact: Contact): Promise<{ dossierId: string; lien: string; etat: EtatDuLien }> {
  const ouvert = contact.dossierId
    ? { ...(await ouvrirEspace(contact.dossierId)), dossierId: contact.dossierId }
    : contact.leadId
      ? await ouvrirEspaceDuContact(contact.leadId)
      : null;
  if (!ouvert) throw new ErreurMetier("Indique le contact ou le dossier.", 400);
  const lien = await lienPourLeProjet(ouvert.espace);
  if (!lien) throw new ErreurMetier("L'espace de ce projet est fermé ou son lien désactivé.", 409);
  const { espace, permanent } = ouvert;
  const envoye = async (contient: string) => (await liensEnvoyes(contient)).length > 0;
  const ouvertAvecCeLien = [permanent.dernierAccesLe, espace.dernierAccesLe].some((le) => le && le.getTime() >= permanent.lienEmisLe.getTime());
  // Un autre projet du même client a pu recevoir le lien : il est le même (celui du client), d'où la recherche même pour un projet neuf.
  if (ouvertAvecCeLien || (await envoye(`/e/${jetonEspace(permanent)}`))) return { dossierId: ouvert.dossierId, lien, etat: "RAPPEL" };
  const ancien = Boolean(permanent.premierAccesLe ?? espace.premierAccesLe) || (await envoye(`/e/${permanent.code}-`)) || (await envoye(`/e/${espace.code}-`));
  return { dossierId: ouvert.dossierId, lien, etat: ancien ? "NOUVEAU" : "PREMIER" };
}

/**
 * Le SMS proposé pour une action, prêt à relire et à copier :
 *  - PAS_DE_REPONSE : 2ᵉ tentative ou plus → PAS_DE_REPONSE_2 ; sinon PAS_DE_REPONSE_SIMULATION (lead venu d'une
 *    simulation du site) ou PAS_DE_REPONSE ; {quand} = le rappel posé, demain 18 h à défaut ;
 *  - A_RAPPELER → A_RAPPELER, {quand} = le rappel posé, « prochainement » sans date ;
 *  - INTERESSE, LIEN_ESPACE → LIEN_ESPACE_SIMULATION (simulation du site) ou LIEN_ESPACE ;
 *  - ENVOYER_LIEN (« SMS avec le lien ») → le premier lien comme ci-dessus s'il n'a jamais reçu de lien ni ouvert
 *    son espace ; LIEN_ESPACE_NOUVEAU s'il n'a reçu (ou ouvert) qu'un lien d'avant « Nouveau lien » ; sinon
 *    LIEN_ESPACE_RAPPEL ;
 *  - INJOIGNABLE_LIEN → INJOIGNABLE_LIEN ; LIEN_ESPACE_RAPPEL → LIEN_ESPACE_RAPPEL ;
 *  - RELANCE_PHOTOS (partie 6 : espace ouvert sans photo ni simulation) → comme ENVOYER_LIEN : LIEN_ESPACE_RAPPEL
 *    si son lien lui a été communiqué (ou qu'il a ouvert son espace), LIEN_ESPACE s'il ne l'a jamais reçu (« à
 *    nouveau » serait faux), LIEN_ESPACE_NOUVEAU s'il n'a reçu qu'un lien d'avant « Nouveau lien » ; la relance
 *    `{ type: "PHOTOS", rang }` donnée suit jusqu'à la copie, qui la compte ;
 *  - RELANCE_DEVIS { documentId, rang } → RELANCE_DEVIS_1 ou RELANCE_DEVIS_2, pour un devis que le client attend
 *    dans son espace (`devisARelancer`), du dossier visé.
 * LIEN_ESPACE_SIMULATION suppose une simulation du site déjà dans l'espace (`simulationDansLEspace`).
 * Les actions avec le lien ouvrent l'espace s'il le faut ; aucune n'écrit d'événement.
 */
export async function proposerSms(entree: DemandeSms, maintenant: Date = new Date()): Promise<PropositionSms> {
  let dossierIdDemande = entree.dossierId ?? null;
  const relance = entree.relance ?? null;
  if (entree.action === "RELANCE_DEVIS") {
    if (!relance || estRelancePhotos(relance)) throw new ErreurMetier("Indique le devis à relancer et le rang de la relance.", 400);
    dossierIdDemande = (await devisARelancer(relance.documentId, dossierIdDemande)).dossierId;
  }
  const contact = await contactDe({ leadId: entree.leadId, dossierId: dossierIdDemande });
  const rappel = entree.rappelLe ? new Date(entree.rappelLe) : null;
  let dossierId = contact.dossierId;
  let code: CodeSms;
  let lien: string | undefined;
  const variables: Record<string, string> = { prenom: contact.prenom };

  switch (entree.action) {
    case "PAS_DE_REPONSE": {
      const tentatives = entree.tentatives ?? contact.lead?.tentatives ?? (dossierId ? await tentativesDuDossier(dossierId) : 0);
      code = tentatives >= 2 ? "PAS_DE_REPONSE_2" : (await simulationDuSite(contact.lead, dossierId)) ? "PAS_DE_REPONSE_SIMULATION" : "PAS_DE_REPONSE";
      variables.quand = quandLisible(rappel ?? aHeureParis(maintenant, 1, 18), maintenant);
      break;
    }
    case "A_RAPPELER":
      code = "A_RAPPELER";
      variables.quand = quandLisible(rappel, maintenant);
      break;
    case "RELANCE_DEVIS":
      code = (relance?.rang ?? 1) >= 2 ? "RELANCE_DEVIS_2" : "RELANCE_DEVIS_1";
      break;
    default: {
      const espace = await espaceEtLien(contact);
      dossierId = espace.dossierId;
      lien = espace.lien;
      const premier = async (): Promise<CodeSms> => ((await simulationDansLEspace(dossierId)) ? "LIEN_ESPACE_SIMULATION" : "LIEN_ESPACE");
      if (entree.action === "INTERESSE" || entree.action === "LIEN_ESPACE") code = await premier();
      else if (entree.action === "ENVOYER_LIEN" || entree.action === "RELANCE_PHOTOS") code = espace.etat === "RAPPEL" ? "LIEN_ESPACE_RAPPEL" : espace.etat === "NOUVEAU" ? "LIEN_ESPACE_NOUVEAU" : await premier();
      else if (entree.action === "INJOIGNABLE_LIEN") code = "INJOIGNABLE_LIEN";
      else code = "LIEN_ESPACE_RAPPEL";
      variables.lien = lien;
    }
  }

  return {
    code,
    texte: await texteDuCatalogue(code, variables),
    telephone: contact.telephone,
    nom: contact.nom,
    prenom: contact.prenom,
    leadId: contact.leadId,
    dossierId,
    ...(lien ? { lien } : {}),
    ...(entree.action === "RELANCE_DEVIS" && relance && !estRelancePhotos(relance) ? { relance: { documentId: relance.documentId, rang: relance.rang } } : {}),
    ...(entree.action === "RELANCE_PHOTOS" && estRelancePhotos(relance) ? { relance: { type: "PHOTOS" as const, rang: relance.rang } } : {}),
  };
}
