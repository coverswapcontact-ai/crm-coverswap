import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lienEspace, ouvrirEspace, ouvrirEspaceDuContact } from "@/lib/espace/liens";
import { dossierDeLaConversation } from "./conversations";
import { listerModeles } from "./modeles";
import { mesurerSms, remplirModele } from "./texte";

/**
 * Messages types remplis pour UNE conversation : le CRM pré-remplit, Lucas
 * relit, corrige, envoie. Rien ne part d'ici. Le texte proposé est rendu tel
 * quel à l'écran, qui le renverra avec le message final : c'est la trace de ce
 * que Lucas garde et de ce qu'il réécrit.
 */
export type Suggestion = {
  code: string;
  libelle: string;
  /** Texte prêt à corriger ; null quand il manque le lien de l'espace (à ouvrir d'abord). */
  texte: string | null;
  necessiteEspace: boolean;
  segments: number;
  /** Mis en avant selon l'étape : ce que Lucas enverrait le plus probablement maintenant. */
  conseille: boolean;
};

const VALIDITE_DEVIS_JOURS = 30;

function prenomDe(nomAffiche: string | null): string {
  const premier = (nomAffiche ?? "").trim().split(/\s+/)[0] ?? "";
  return /^(inconnu|client)$/i.test(premier) ? "" : premier;
}

async function variablesDe(conversationId: string): Promise<{ variables: Record<string, string | null>; etape: string | null; lien: string | null; statutContact: string | null }> {
  const conversation = await prisma.conversationSms.findUnique({ where: { id: conversationId }, include: { lead: { select: { prenom: true, statut: true } } } });
  if (!conversation) throw new ErreurMetier("Conversation introuvable.", 404);
  const dossierRef = await dossierDeLaConversation(conversation);
  const dossier = dossierRef
    ? await prisma.dossier.findUnique({
        where: { id: dossierRef.id },
        select: {
          etape: true,
          espaces: { where: { archiveLe: null, revoqueLe: null }, take: 1 },
          documents: { where: { type: "DEVIS", archiveLe: null, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { totalHt: true, dateEmission: true, createdAt: true } },
        },
      })
    : null;
  const espace = dossier?.espaces[0] ?? null;
  const devis = dossier?.documents[0] ?? null;
  const lien = espace ? lienEspace(espace) : null;
  const validite = devis ? new Date((devis.dateEmission ?? devis.createdAt).getTime() + VALIDITE_DEVIS_JOURS * 86_400_000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : null;
  return {
    variables: {
      prenom: prenomDe(conversation.lead?.prenom ?? conversation.nomAffiche),
      lien,
      montant: devis ? `${devis.totalHt.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} EUR` : null,
      validite,
    },
    etape: dossier?.etape ?? null,
    lien,
    statutContact: conversation.lead?.statut ?? null,
  };
}

/** Le message le plus probable à cette étape. */
function codeConseille(etape: string | null, statutContact: string | null, aLien: boolean): string[] {
  if (!etape) return statutContact === "NOUVEAU" || statutContact === "DEVIS_DEMANDE" ? ["LIEN_ESPACE", "INJOIGNABLE_LIEN"] : ["LIEN_ESPACE"];
  if (etape === "QUALIFICATION") return aLien ? ["RELANCE_PHOTOS"] : ["LIEN_ESPACE"];
  if (etape === "SIMULATION") return ["SIMULATION_PRETE", "RELANCE_SIMULATION"];
  if (etape === "DEVIS_ENVOYE") return ["DEVIS_PRET", "RELANCE_DEVIS"];
  if (etape === "RELANCE") return ["RELANCE_DEVIS", "RELANCE_DERNIERE"];
  if (etape === "SIGNE") return ["MERCI_ACCORD"];
  return [];
}

export async function suggestionsPourConversation(conversationId: string): Promise<Suggestion[]> {
  const [{ variables, etape, lien, statutContact }, modeles] = await Promise.all([variablesDe(conversationId), listerModeles()]);
  const conseilles = codeConseille(etape, statutContact, Boolean(lien));
  return modeles
    .filter((m) => m.actif && !m.automatique)
    .map((m) => {
      const necessiteEspace = /\{lien\}/.test(m.texte) && !lien;
      const texte = necessiteEspace ? null : remplirModele(m.texte, variables);
      return { code: m.code, libelle: m.libelle, texte, necessiteEspace, segments: texte ? mesurerSms(texte).segments : 0, conseille: conseilles.includes(m.code) };
    })
    .sort((a, b) => Number(b.conseille) - Number(a.conseille));
}

/**
 * « Envoyer le lien de l'espace client » : ouvre l'espace (et le dossier s'il
 * n'existe pas encore), puis rend le message prêt à corriger. N'envoie rien.
 */
export async function preparerLienEspace(conversationId: string, code: "LIEN_ESPACE" | "INJOIGNABLE_LIEN" = "LIEN_ESPACE"): Promise<{ texte: string; lien: string; modele: string; dossierId: string }> {
  const conversation = await prisma.conversationSms.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new ErreurMetier("Conversation introuvable.", 404);
  const dossierRef = await dossierDeLaConversation(conversation);
  let lien: string;
  let dossierId: string;
  if (dossierRef) {
    ({ lien } = await ouvrirEspace(dossierRef.id));
    dossierId = dossierRef.id;
  } else if (conversation.leadId) {
    ({ lien, dossierId } = await ouvrirEspaceDuContact(conversation.leadId));
  } else {
    throw new ErreurMetier("Cette conversation n'est rattachée à aucun contact : la rattacher d'abord, l'espace client appartient à un dossier.", 409);
  }
  const { variables } = await variablesDe(conversationId);
  const modele = (await listerModeles()).find((m) => m.code === code && m.actif) ?? null;
  const texte = modele ? remplirModele(modele.texte, { ...variables, lien }) : `Voici votre espace personnel CoverSwap : ${lien}`;
  return { texte, lien, modele: modele?.code ?? code, dossierId };
}
