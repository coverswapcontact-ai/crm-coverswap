import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { lienPourLeProjet, ouvrirEspace, ouvrirEspaceDuContact } from "@/lib/espace/liens";
import { programmerEnvoi } from "./envoi-crm";
import { mailNotification } from "./notifications";

/**
 * Le lien de l'espace client, par mail (mission 7 : le mail prend le relais du
 * SMS). Après un appel — « intéressé », « pas de réponse » — ou pour renvoyer
 * le lien : l'espace s'ouvre s'il ne l'est pas (et le dossier avec), le mail
 * est proposé — une phrase, le bouton vers son espace, aux couleurs des
 * notifications —, Lucas le relit et l'envoie. Rien ne part sans son clic.
 */

export const CODES_LIEN_MAIL = ["LIEN_ESPACE", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL"] as const;
export type CodeLienMail = (typeof CODES_LIEN_MAIL)[number];

const PROPOSITIONS: Record<CodeLienMail, { objet: string; phrase: string; bouton: string }> = {
  LIEN_ESPACE: {
    objet: "Votre espace CoverSwap",
    phrase: "Comme convenu, voici votre espace personnel : déposez-y 2 ou 3 photos de la pièce, et je vous prépare une simulation dès que je les ai.",
    bouton: "Ouvrir mon espace",
  },
  INJOIGNABLE_LIEN: {
    objet: "Votre projet de rénovation",
    phrase: "J'ai essayé de vous joindre au sujet de votre projet. En attendant, vous pouvez déposer 2 ou 3 photos de la pièce dans votre espace, quand vous le souhaitez : je vous prépare une simulation.",
    bouton: "Déposer mes photos",
  },
  LIEN_ESPACE_RAPPEL: {
    objet: "Votre espace CoverSwap",
    phrase: "Voici à nouveau le lien de votre espace : tout votre projet y est, à jour.",
    bouton: "Ouvrir mon espace",
  },
};

/** Il a déjà fait une simulation sur le site : le mail le lui dit — c'est ce qui fait ouvrir. */
const PHRASE_AVEC_SIMULATION = "Comme convenu, votre simulation vous attend dans votre espace personnel. Ajoutez-y 2 ou 3 photos de la pièce : je vous prépare mes propositions.";

export type PropositionLienMail = { dossierId: string; code: CodeLienMail; a: string | null; prenom: string; objet: string; phrase: string; bouton: string };

async function destinataireDuDossier(dossierId: string) {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: {
      clientEmail: true,
      clientNom: true,
      clientId: true,
      leadId: true,
      client: { select: { prenom: true, emails: { where: { archiveLe: null }, orderBy: [{ principale: "desc" }, { createdAt: "asc" }], take: 1, select: { adresse: true } } } },
      lead: { select: { prenom: true, email: true } },
    },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const brut = (dossier.client?.prenom || dossier.lead?.prenom || dossier.clientNom.split(" ")[0] || "").trim();
  return {
    a: normaliserEmail(dossier.client?.emails[0]?.adresse) ?? normaliserEmail(dossier.clientEmail) ?? normaliserEmail(dossier.lead?.email) ?? null,
    prenom: /^(inconnu|client)$/i.test(brut) ? "" : (brut.split(/\s+/)[0] ?? ""),
    clientId: dossier.clientId,
    leadId: dossier.leadId,
  };
}

/** Ouvre l'espace (et le dossier) s'il le faut, puis rend le mail proposé. N'envoie rien. */
export async function proposerLienParMail(entree: { leadId?: string | null; dossierId?: string | null; code: CodeLienMail }): Promise<PropositionLienMail> {
  let dossierId = entree.dossierId ?? null;
  if (dossierId) await ouvrirEspace(dossierId);
  else if (entree.leadId) dossierId = (await ouvrirEspaceDuContact(entree.leadId)).dossierId;
  else throw new ErreurMetier("Indique le contact ou le dossier.", 400);
  const { a, prenom } = await destinataireDuDossier(dossierId);
  const base = PROPOSITIONS[entree.code];
  const avecSimulation = entree.code === "LIEN_ESPACE" && (await prisma.simulation.count({ where: { dossierId, archiveLe: null, imageAfterPath: { not: null } } })) > 0;
  return { dossierId, code: entree.code, a, prenom, objet: base.objet, phrase: avecSimulation ? PHRASE_AVEC_SIMULATION : base.phrase, bouton: base.bouton };
}

/**
 * Lucas a relu : le mail part, avec le lien du moment (s'il a été régénéré
 * entre-temps, c'est le nouveau). Une fois par ouverture de la fenêtre
 * (`jeton`) : un double clic n'envoie pas deux mails.
 */
export async function envoyerLienParMail(entree: { dossierId: string; code: CodeLienMail; a: string; objet: string; phrase: string; jeton: string }): Promise<{ envoiId: string; deja: boolean }> {
  const a = normaliserEmail(entree.a);
  if (!a) throw new ErreurMetier("Adresse e-mail invalide.", 400);
  const espace = await prisma.espaceClient.findUnique({ where: { dossierId: entree.dossierId } });
  const lien = espace && !espace.archiveLe ? await lienPourLeProjet(espace) : null;
  if (!lien) throw new ErreurMetier("L'espace de ce projet est fermé ou son lien désactivé.", 409);
  const { prenom, clientId, leadId } = await destinataireDuDossier(entree.dossierId);
  const contenu = mailNotification({ objet: entree.objet, phrase: entree.phrase, bouton: PROPOSITIONS[entree.code].bouton, actif: true }, { prenom, lien });
  const { id, deja } = await programmerEnvoi({
    cle: `lien-espace:${entree.dossierId}:${entree.jeton}`,
    nature: "NOUVEAU",
    modele: entree.code,
    a,
    objet: contenu.objet,
    texte: contenu.texte,
    html: contenu.html,
    dossierId: entree.dossierId,
    clientId,
    leadId,
  });
  return { envoiId: id, deja };
}
