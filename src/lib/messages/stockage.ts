import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { PHOTO_OCTETS_MAX } from "@/lib/dossiers/constants";
import { FORMATS_JUSTIFICATIF, enregistrerFichier } from "@/lib/fichiers/stockage";
import { AttenteExterne, ErreurDefinitive } from "@/lib/taches/registre";
import { LIBELLE_BRUIT, libelleGmail, lirePieceGmail, modifierLibellesGmail, type MessageRecu } from "./gmail";

/**
 * Enregistrement des messages et de leurs pièces jointes, et rangement dans la
 * boîte du fournisseur. Tout est rejouable : un message déjà enregistré ne
 * l'est pas deux fois, une pièce conservée ne se retélécharge pas, archiver un
 * message déjà archivé ne fait rien.
 */

export const TYPE_TACHE_ANALYSE = "ANALYSE_MESSAGE";
export const TYPE_TACHE_BOITE = "BOITE_MESSAGE";
export const TYPE_TACHE_PIECES = "PIECES_MESSAGE";
export const TYPE_TACHE_RELEVE = "RELEVE_BOITE";

/** Image intégrée plus petite : logo, signature ; pas une photo de chantier. */
const IMAGE_EN_LIGNE_MIN = 50 * 1024;

/** Enregistre un message reçu (ou envoyé) ; rend son identifiant et s'il est nouveau. */
export async function enregistrerMessageRecu(recu: MessageRecu): Promise<{ id: string; nouveau: boolean }> {
  const existant = await prisma.message.findFirst({
    where: { ...AVEC_ARCHIVES, canal: recu.canal, identifiantCanal: recu.identifiantCanal },
    select: { id: true },
  });
  if (existant) return { id: existant.id, nouveau: false };
  try {
    const id = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          canal: recu.canal,
          compte: recu.compte,
          identifiantCanal: recu.identifiantCanal,
          filCanal: recu.filCanal,
          sens: recu.sens,
          de: recu.de,
          deNom: recu.deNom,
          a: JSON.stringify(recu.a),
          objet: recu.objet,
          extrait: recu.extrait,
          recuLe: recu.recuLe,
        },
      });
      await tx.contenuMessage.create({
        data: { messageId: message.id, texte: recu.texte, entetes: JSON.stringify({ ...recu.entetes, libelles: recu.libelles.join(" ") }) },
      });
      for (const piece of recu.pieces) {
        await tx.pieceMessage.create({
          data: { messageId: message.id, rang: piece.rang, nom: piece.nom, typeMime: piece.typeMime, taille: piece.taille, partie: piece.partie, enLigne: piece.enLigne },
        });
      }
      return message.id;
    });
    return { id, nouveau: true };
  } catch (erreur) {
    // Relevé simultané du même message : l'autre l'a enregistré.
    if ((erreur as { code?: string }).code !== "P2002") throw erreur;
    const concurrent = await prisma.message.findFirst({ where: { ...AVEC_ARCHIVES, canal: recu.canal, identifiantCanal: recu.identifiantCanal }, select: { id: true } });
    if (!concurrent) throw erreur;
    return { id: concurrent.id, nouveau: false };
  }
}

export function lireEntetes(json: string | null | undefined): Record<string, string> {
  try {
    const valeur: unknown = JSON.parse(json ?? "{}");
    return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur) ? (valeur as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function lireListe(json: string | null | undefined): string[] {
  try {
    const valeur: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(valeur) ? valeur.filter((element): element is string => typeof element === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Conserve dans le CRM les photos et PDF joints (9 Mo au plus chacun) ; les
 * autres pièces restent consultables dans la boîte mail. Une pièce en échec
 * garde son erreur et sera reprise au prochain passage.
 */
export async function conserverPieces(messageId: string): Promise<{ conservees: number; erreurs: number }> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, canal: true, identifiantCanal: true, recuLe: true, pieces: { where: { statut: "A_CONSERVER" }, orderBy: { rang: "asc" } } },
  });
  if (!message) return { conservees: 0, erreurs: 0 };
  let conservees = 0;
  let erreurs = 0;
  for (const piece of message.pieces) {
    let refus: string | null = null;
    if (!FORMATS_JUSTIFICATIF[piece.typeMime]) refus = "Format non conservé dans le CRM : à ouvrir dans la boîte mail.";
    else if (piece.taille > PHOTO_OCTETS_MAX) refus = "Plus de 9 Mo : à ouvrir dans la boîte mail.";
    else if (piece.enLigne && piece.taille < IMAGE_EN_LIGNE_MIN) refus = "Image intégrée au mail (logo, signature).";
    else if (message.canal !== "EMAIL") refus = "Canal sans téléchargement des pièces.";
    if (refus) {
      await prisma.pieceMessage.update({ where: { id: piece.id }, data: { statut: "NON_CONSERVEE", raison: refus } });
      continue;
    }
    try {
      const octets = await lirePieceGmail(message.identifiantCanal, piece.partie);
      const fichier = await enregistrerFichier("messages", new File([new Uint8Array(octets)], piece.nom, { type: piece.typeMime }), message.recuLe);
      await prisma.pieceMessage.update({ where: { id: piece.id }, data: { statut: "CONSERVEE", fichierId: fichier.id, raison: null } });
      conservees++;
    } catch (erreur) {
      if (erreur instanceof ErreurDefinitive || erreur instanceof AttenteExterne) {
        await prisma.pieceMessage.update({ where: { id: piece.id }, data: { raison: `Non téléchargée : ${erreur.message}` } });
        throw erreur;
      }
      erreurs++;
      await prisma.pieceMessage.update({
        where: { id: piece.id },
        data: { raison: `Téléchargement en échec, repris plus tard : ${(erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 300)}` },
      });
    }
  }
  return { conservees, erreurs };
}

/**
 * Range le message dans la boîte du fournisseur, selon son état dans le CRM :
 * bruit → retiré de la boîte de réception, sous le libellé du CRM ; bruit
 * annulé → remis dans la boîte. Jamais de corbeille ni de suppression.
 */
export async function rangerDansBoite(messageId: string): Promise<"ARCHIVE" | "REMIS" | "RIEN"> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, canal: true, identifiantCanal: true, statut: true, boiteArchiveLe: true },
  });
  if (!message || message.canal !== "EMAIL") return "RIEN";
  const libelle = await libelleGmail(LIBELLE_BRUIT);
  if (message.statut === "BRUIT") {
    if (message.boiteArchiveLe) return "RIEN";
    const resultat = await modifierLibellesGmail(message.identifiantCanal, { ajouter: [libelle], retirer: ["INBOX"] });
    if (resultat === "INTROUVABLE") throw new ErreurDefinitive("Message introuvable dans la boîte mail (déjà retiré à la main ?).");
    await prisma.message.update({ where: { id: message.id }, data: { boiteArchiveLe: new Date() } });
    return "ARCHIVE";
  }
  if (!message.boiteArchiveLe) return "RIEN";
  const resultat = await modifierLibellesGmail(message.identifiantCanal, { ajouter: ["INBOX"], retirer: [libelle] });
  if (resultat === "INTROUVABLE") throw new ErreurDefinitive("Message introuvable dans la boîte mail.");
  await prisma.message.update({ where: { id: message.id }, data: { boiteArchiveLe: null } });
  return "REMIS";
}
