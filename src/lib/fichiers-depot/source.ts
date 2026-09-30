import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireFichierConserve } from "@/lib/fichiers/stockage";
import { lirePieceMessage } from "@/lib/messages/consultation";
import { octetsDuDepot, type LigneDepot } from "./enregistrement";
import { telechargerUrl } from "./url";
import type { VoieFichier } from "./types";

/**
 * Mission 17 (partie C) — les cinq voies d'un fichier, les mêmes pour toutes
 * les cibles (reprend et étend `lireSource` de deposer_document) :
 * lien de dépôt, URL (téléchargement sûr), base64, pièce jointe de mail,
 * fichier déjà conservé.
 */

export const schemaSourceFichier = z
  .object({
    lien_depot: z.string().trim().max(40).optional().describe("Fichier(s) reçus par un lien de dépôt : l'identifiant du dépôt rendu par « lien_depot », ou celui d'un fichier reçu (voir_fichiers genre a_ranger)."),
    url: z.string().trim().max(2000).optional().describe("Lien public http(s) ou lien de partage Google Drive / Docs : le CRM le télécharge (9 Mo au plus, photo ou PDF)."),
    base64: z.string().max(13_000_000).optional().describe("Le fichier lui-même, en base64 (data URL acceptée)."),
    nom: z.string().trim().max(200).optional().describe("Avec base64 ou url : le nom du fichier (« devis-cuisine.pdf »)."),
    piece_mail: z.object({ message_id: z.string().max(40), piece: z.string().max(40).describe("Identifiant de la pièce (« lire_mail » les liste).") }).optional(),
    fichier_id: z.string().max(40).optional().describe("Un fichier déjà conservé dans le CRM (identifiant)."),
  })
  .refine((s) => [s.lien_depot, s.url, s.base64, s.piece_mail, s.fichier_id].filter(Boolean).length === 1, { message: "Donne UNE source : lien_depot, url, base64, piece_mail { message_id, piece } ou fichier_id." });
export type SourceFichier = z.output<typeof schemaSourceFichier>;

export type FichierSource = { contenu: Buffer; nom: string | null; voie: VoieFichier; origine: string | null; ligneDepot?: LigneDepot };

/** Le ou les fichiers reçus par un lien : par l'identifiant du dépôt (tous ceux encore à placer) ou d'un fichier reçu. */
export async function lignesDuLien(identifiant: string): Promise<LigneDepot[]> {
  const fichier = await prisma.fichierDepose.findUnique({ where: { id: identifiant } });
  if (fichier) return fichier.archiveLe ? [] : [fichier];
  const jeton = await prisma.jetonDepot.findUnique({ where: { id: identifiant } });
  if (!jeton) throw new ErreurMetier(`Aucun dépôt ni fichier reçu « ${identifiant} ».`, 404);
  return prisma.fichierDepose.findMany({ where: { jetonId: jeton.id, archiveLe: null }, orderBy: { createdAt: "asc" } });
}

/** Lit la source (hors lien de dépôt, traité par lignesDuLien) : octets, nom, voie. */
export async function lireSourceFichier(source: SourceFichier): Promise<FichierSource> {
  if (source.url) {
    const f = await telechargerUrl(source.url);
    return { contenu: f.contenu, nom: source.nom || f.nom, voie: "URL", origine: f.urlFinale };
  }
  if (source.base64) {
    const brut = source.base64.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(brut)) throw new ErreurMetier("Contenu base64 invalide.", 400);
    return { contenu: Buffer.from(brut, "base64"), nom: source.nom ?? null, voie: "BASE64", origine: null };
  }
  if (source.piece_mail) {
    const p = await lirePieceMessage(source.piece_mail.message_id, source.piece_mail.piece);
    return { contenu: p.contenu, nom: p.nom, voie: "PIECE_MAIL", origine: `mail ${source.piece_mail.message_id}, pièce ${source.piece_mail.piece}` };
  }
  if (source.fichier_id) {
    const f = await lireFichierConserve(source.fichier_id);
    return { contenu: f.contenu, nom: f.nom, voie: "FICHIER", origine: `fichier ${source.fichier_id}` };
  }
  if (source.lien_depot) {
    const lignes = await lignesDuLien(source.lien_depot);
    if (lignes.length !== 1) throw new ErreurMetier(lignes.length === 0 ? "Aucun fichier reçu par ce lien (ou déjà rangés)." : "Plusieurs fichiers reçus par ce lien : désigne-les un par un.", 409);
    const contenu = await octetsDuDepot(lignes[0]);
    if (!contenu) throw new ErreurMetier("Le fichier reçu n'est plus lisible sur le serveur.", 404);
    return { contenu, nom: lignes[0].nom, voie: "LIEN_DEPOT", origine: lignes[0].origine, ligneDepot: lignes[0] };
  }
  throw new ErreurMetier("Donne une source.", 400);
}
