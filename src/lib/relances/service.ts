import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { dateEnLettres } from "@/lib/dossiers/dates";
import { lireParametre } from "@/lib/parametres/service";
import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { proposer } from "@/lib/validation/service";

/**
 * Relances de devis : proposées, jamais envoyées seules. Un devis resté sans
 * réponse au-delà du délai paramétré (DELAI_RELANCE_DEVIS) donne une
 * proposition « Envoyer un mail » pré-rédigée dans « À valider » ; la personne
 * relit, corrige, envoie ou rejette. Deux relances par devis au plus ; un
 * client qui a refusé les mails n'en reçoit pas (à relancer autrement).
 */

export const RELANCES_MAX_PAR_DEVIS = 2;
const JOUR_MS = 24 * 60 * 60_000;

export type ResumeRelances = { proposees: number; dejaProposees: number; parametreManquant: boolean; sansAdresse: number; refusMail: number };

/** Mission 13 (B16) : sans DELAI_RELANCE_DEVIS renseigné, 5 jours — le système n'attend pas un réglage pour suivre les devis. */
export const DELAI_RELANCE_DEFAUT_JOURS = 5;

/** Le délai de relance en vigueur : le paramètre daté, sinon la valeur par défaut. `parametre` : vrai quand il est renseigné. */
export async function lireDelaiRelance(maintenant: Date = new Date()): Promise<{ jours: number; parametre: boolean }> {
  const valeur = await lireParametre("DELAI_RELANCE_DEVIS", maintenant);
  return valeur === null ? { jours: DELAI_RELANCE_DEFAUT_JOURS, parametre: false } : { jours: Number(valeur), parametre: true };
}

function texteRelance(entree: { prenom: string | null; numero: string; emisLe: Date; rang: number }): { objet: string; texte: string } {
  const bonjour = entree.prenom ? `Bonjour ${entree.prenom},` : "Bonjour,";
  const corps =
    entree.rang === 1
      ? `Je me permets de revenir vers vous au sujet du devis n° ${entree.numero} que je vous ai adressé le ${dateEnLettres(entree.emisLe)}. Avez-vous pu en prendre connaissance ?\n\nJe reste à votre disposition pour toute question, ou pour l'ajuster si besoin.`
      : `Je reviens vers vous une dernière fois au sujet du devis n° ${entree.numero} du ${dateEnLettres(entree.emisLe)}. Si votre projet a changé ou a été reporté, un simple mot me permettra de mettre à jour mon suivi.\n\nJe reste à votre disposition.`;
  return {
    objet: `Votre devis n° ${entree.numero} — CoverSwap`,
    texte: `${bonjour}\n\n${corps}\n\nBien cordialement,\n\nLucas Villemin\nCoverSwap\n${EMETTEUR.telephone}`,
  };
}

async function chargerDossiersARelancer(dossierId?: string) {
  return prisma.dossier.findMany({
    where: dossierId ? { id: dossierId } : { etape: { in: ["DEVIS_ENVOYE", "RELANCE"] }, archiveLe: null },
    include: {
      documents: { where: { type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { dateEmission: "desc" } },
      client: {
        select: {
          prenom: true,
          emails: { orderBy: [{ principale: "desc" }, { createdAt: "asc" }], select: { adresse: true } },
          consentements: { orderBy: { recueilliLe: "desc" }, take: 1, select: { statut: true } },
        },
      },
    },
  });
}

type DossierARelancer = Awaited<ReturnType<typeof chargerDossiersARelancer>>[number];

async function relancesFaites(dossierId: string, devisId: string) {
  return prisma.dossierEvenement.findMany({
    where: { dossierId, type: "MAIL_ENVOYE", AND: [{ metadata: { contains: "RELANCE_DEVIS" } }, { metadata: { contains: devisId } }] },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
}

export type DevisARelancer = {
  dossierId: string;
  clientNom: string;
  documentId: string;
  numero: string;
  totalHt: number;
  emisLe: string;
  joursDepuisEmission: number;
  relancesFaites: number;
  derniereRelanceLe: string | null;
  prochaineProposableLe: string | null;
  adresse: string | null;
  refusMail: boolean;
  propositionEnAttente: { id: string; expireLe: string | null } | null;
};

/** Mission 11 : l'état des relances, devis par devis — pour « voir_relances ». Rien n'est écrit. */
export async function listerRelances(maintenant: Date = new Date()): Promise<{ delai: number; delaiParDefaut: boolean; devis: DevisARelancer[] }> {
  const { jours: delai, parametre } = await lireDelaiRelance(maintenant);
  const enAttente = await prisma.proposition.findMany({ where: { type: "ENVOI_MAIL", statut: "EN_ATTENTE", contenu: { contains: "RELANCE_DEVIS" } }, select: { id: true, contenu: true, expireLe: true } });
  const liste: DevisARelancer[] = [];
  for (const dossier of await chargerDossiersARelancer()) {
    const devis = dossier.documents[0];
    if (!devis?.numero || !devis.dateEmission) continue;
    const consentement = dossier.client?.consentements[0]?.statut;
    const adresse = dossier.clientEmail ?? dossier.client?.emails[0]?.adresse ?? null;
    const relances = await relancesFaites(dossier.id, devis.id);
    const reference = relances[0]?.createdAt ?? devis.dateEmission;
    const proposition = enAttente.find((p) => p.contenu.includes(devis.id));
    liste.push({
      dossierId: dossier.id,
      clientNom: dossier.clientNom,
      documentId: devis.id,
      numero: devis.numero,
      totalHt: devis.totalHt,
      emisLe: devis.dateEmission.toISOString(),
      joursDepuisEmission: Math.floor((maintenant.getTime() - devis.dateEmission.getTime()) / JOUR_MS),
      relancesFaites: relances.length,
      derniereRelanceLe: relances[0]?.createdAt.toISOString() ?? null,
      prochaineProposableLe: relances.length < RELANCES_MAX_PAR_DEVIS ? new Date(reference.getTime() + delai * JOUR_MS).toISOString() : null,
      adresse,
      refusMail: consentement === "REFUSE" || consentement === "RETIRE",
      propositionEnAttente: proposition ? { id: proposition.id, expireLe: proposition.expireLe?.toISOString() ?? null } : null,
    });
  }
  return { delai, delaiParDefaut: !parametre, devis: liste.sort((a, b) => b.joursDepuisEmission - a.joursDepuisEmission) };
}

export type RelanceProposee = { propositionId: string; creee: boolean; rang: number; numero: string; documentId: string; a: string; objet: string; texte: string };

/**
 * La relance d'un devis : une proposition « Envoyer un mail » pré-rédigée. `forcer` passe outre le délai
 * (jamais le refus des mails, l'absence d'adresse ni le plafond) ; `apercuSeulement` ne crée rien.
 */
export async function relancerDevis(dossierId: string, options: { maintenant?: Date; forcer?: boolean; documentId?: string; apercuSeulement?: boolean; delai?: number | null } = {}): Promise<RelanceProposee> {
  const maintenant = options.maintenant ?? new Date();
  const dossier: DossierARelancer | undefined = (await chargerDossiersARelancer(dossierId))[0];
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const devis = options.documentId ? dossier.documents.find((d) => d.id === options.documentId) : dossier.documents[0];
  if (!devis?.numero || !devis.dateEmission) throw new ErreurMetier(`Aucun devis envoyé en attente de réponse pour ${dossier.clientNom}.`, 409);
  const consentement = dossier.client?.consentements[0]?.statut;
  if (consentement === "REFUSE" || consentement === "RETIRE") throw new ErreurMetier(`${dossier.clientNom} a refusé les mails : relancer par téléphone.`, 409);
  const adresse = dossier.clientEmail ?? dossier.client?.emails[0]?.adresse ?? null;
  if (!adresse) throw new ErreurMetier(`Aucune adresse e-mail pour ${dossier.clientNom} : relancer par téléphone ou SMS.`, 409);
  const relances = await relancesFaites(dossier.id, devis.id);
  if (relances.length >= RELANCES_MAX_PAR_DEVIS) throw new ErreurMetier(`Déjà ${RELANCES_MAX_PAR_DEVIS} relances envoyées pour le devis ${devis.numero} : plus de relance par mail.`, 409);
  const delai = options.delai === undefined || options.delai === null ? (await lireDelaiRelance(maintenant)).jours : options.delai;
  const reference = relances[0]?.createdAt ?? devis.dateEmission;
  if (!options.forcer && maintenant.getTime() - reference.getTime() < delai * JOUR_MS) throw new ErreurMetier("Délai de relance pas encore écoulé.", 409);
  const rang = relances.length + 1;
  const jours = Math.floor((maintenant.getTime() - devis.dateEmission.getTime()) / JOUR_MS);
  const { objet, texte } = texteRelance({ prenom: dossier.client?.prenom ?? null, numero: devis.numero, emisLe: devis.dateEmission, rang });
  if (options.apercuSeulement) return { propositionId: "", creee: false, rang, numero: devis.numero, documentId: devis.id, a: adresse, objet, texte };
  const { id, creee } = await proposer({
    type: "ENVOI_MAIL",
    titre: `Relancer ${dossier.clientNom} : devis ${devis.numero}`,
    resume: `Devis envoyé il y a ${jours} jours, sans réponse enregistrée. Relance n° ${rang} sur ${RELANCES_MAX_PAR_DEVIS}.${options.forcer ? " Demandée par Lucas (sans attendre le délai)." : ""}`,
    raisonnement: `Dossier à l'étape « ${dossier.etape === "RELANCE" ? "Relance" : "Devis envoyé"} » ; ${
      relances.length ? `dernière relance le ${dateEnLettres(relances[0].createdAt)}` : `devis émis le ${dateEnLettres(devis.dateEmission)}`
    } ; délai de relance : ${delai} jours.`,
    contenu: { motif: "RELANCE_DEVIS", dossierId: dossier.id, clientId: dossier.clientId, a: adresse, objet, texte, documentIds: [devis.id] },
    cleUnicite: `relance:${devis.id}:${rang}`,
    dossierId: dossier.id,
    clientId: dossier.clientId ?? undefined,
    expireLe: new Date(maintenant.getTime() + 14 * JOUR_MS),
  });
  return { propositionId: id, creee, rang, numero: devis.numero, documentId: devis.id, a: adresse, objet, texte };
}

export async function proposerRelances(maintenant: Date = new Date()): Promise<ResumeRelances> {
  const resume: ResumeRelances = { proposees: 0, dejaProposees: 0, parametreManquant: false, sansAdresse: 0, refusMail: 0 };
  const { jours: delai } = await lireDelaiRelance(maintenant);

  for (const dossier of await chargerDossiersARelancer()) {
    const devis = dossier.documents[0];
    if (!devis?.numero || !devis.dateEmission) continue;
    const consentement = dossier.client?.consentements[0]?.statut;
    if (consentement === "REFUSE" || consentement === "RETIRE") {
      resume.refusMail++;
      continue;
    }
    const adresse = dossier.clientEmail ?? dossier.client?.emails[0]?.adresse ?? null;
    if (!adresse) {
      resume.sansAdresse++;
      continue;
    }
    const relances = await relancesFaites(dossier.id, devis.id);
    if (relances.length >= RELANCES_MAX_PAR_DEVIS) continue;
    const reference = relances[0]?.createdAt ?? devis.dateEmission;
    if (maintenant.getTime() - reference.getTime() < delai * JOUR_MS) continue;
    const { creee } = await relancerDevis(dossier.id, { maintenant, delai });
    if (creee) resume.proposees++;
    else resume.dejaProposees++;
  }
  return resume;
}

export function enregistrerTachesRelances(): void {
  enregistrerTravailPeriodique({
    nom: "propositions-relances",
    libelle: "Propositions de relance des devis sans réponse",
    acteur: "SYSTEME:relances",
    intervalleMs: 6 * 60 * 60_000,
    executer: async () => {
      const resume = await proposerRelances();
      if (resume.parametreManquant) console.info("[relances] délai de relance non renseigné : aucune proposition");
    },
  });
}
