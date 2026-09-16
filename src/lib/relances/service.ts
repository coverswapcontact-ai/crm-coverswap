import prisma from "@/lib/prisma";
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

export async function proposerRelances(maintenant: Date = new Date()): Promise<ResumeRelances> {
  const resume: ResumeRelances = { proposees: 0, dejaProposees: 0, parametreManquant: false, sansAdresse: 0, refusMail: 0 };
  const delai = await lireParametre("DELAI_RELANCE_DEVIS", maintenant);
  if (delai === null) return { ...resume, parametreManquant: true };

  const dossiers = await prisma.dossier.findMany({
    where: { etape: { in: ["DEVIS_ENVOYE", "RELANCE"] } },
    include: {
      documents: {
        where: { type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] } },
        orderBy: { dateEmission: "desc" },
        take: 1,
      },
      client: {
        select: {
          prenom: true,
          emails: { orderBy: [{ principale: "desc" }, { createdAt: "asc" }], select: { adresse: true } },
          consentements: { orderBy: { recueilliLe: "desc" }, take: 1, select: { statut: true } },
        },
      },
    },
  });

  for (const dossier of dossiers) {
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

    const relances = await prisma.dossierEvenement.findMany({
      where: { dossierId: dossier.id, type: "MAIL_ENVOYE", AND: [{ metadata: { contains: "RELANCE_DEVIS" } }, { metadata: { contains: devis.id } }] },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (relances.length >= RELANCES_MAX_PAR_DEVIS) continue;
    const reference = relances[0]?.createdAt ?? devis.dateEmission;
    if (maintenant.getTime() - reference.getTime() < Number(delai) * JOUR_MS) continue;

    const rang = relances.length + 1;
    const jours = Math.floor((maintenant.getTime() - devis.dateEmission.getTime()) / JOUR_MS);
    const { objet, texte } = texteRelance({ prenom: dossier.client?.prenom ?? null, numero: devis.numero, emisLe: devis.dateEmission, rang });
    const { creee } = await proposer({
      type: "ENVOI_MAIL",
      titre: `Relancer ${dossier.clientNom} : devis ${devis.numero}`,
      resume: `Devis envoyé il y a ${jours} jours, sans réponse enregistrée. Relance n° ${rang} sur ${RELANCES_MAX_PAR_DEVIS}.`,
      raisonnement: `Dossier à l'étape « ${dossier.etape === "RELANCE" ? "Relance" : "Devis envoyé"} » ; ${
        relances.length ? `dernière relance le ${dateEnLettres(relances[0].createdAt)}` : `devis émis le ${dateEnLettres(devis.dateEmission)}`
      } ; délai de relance paramétré : ${delai} jours.`,
      contenu: { motif: "RELANCE_DEVIS", dossierId: dossier.id, clientId: dossier.clientId, a: adresse, objet, texte, documentIds: [devis.id] },
      cleUnicite: `relance:${devis.id}:${rang}`,
      dossierId: dossier.id,
      clientId: dossier.clientId ?? undefined,
      expireLe: new Date(maintenant.getTime() + 14 * JOUR_MS),
    });
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
