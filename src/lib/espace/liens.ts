import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { EspaceClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ouvrirDossierDuLead } from "@/lib/dossiers/depuis-lead";

/**
 * Le lien de l'espace client : https://coverswap.fr/e/<code>-<signature>
 *
 *  - `code` : huit caractères tirés au hasard, propres à l'espace ;
 *  - `signature` : HMAC-SHA256(secret, code + version), 12 octets en base64url
 *    (16 caractères : le lien doit tenir dans un SMS). Sans le secret du serveur,
 *    un lien ne se fabrique pas et ne se devine pas (2^96 essais, et chaque essai
 *    est une requête au serveur) ; le code seul ne donne accès à rien.
 *  - Expirable : `expireLe`. Révocable : `revoqueLe`. Renouvelable : incrémenter
 *    `version` tue d'un coup tous les liens déjà envoyés, un nouveau est émis.
 *
 * Le jeton n'est jamais stocké : le CRM le recalcule quand il doit l'écrire
 * dans un SMS. Secret : ESPACE_CLIENT_SECRET, à défaut une clé dérivée de
 * NEXTAUTH_SECRET (rien de nouveau à poser pour que l'espace fonctionne).
 */
export const DUREE_LIEN_JOURS = 90;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // sans 0/o, 1/l/i : un lien se dicte parfois au téléphone

function secretEspace(): string {
  const propre = process.env.ESPACE_CLIENT_SECRET?.trim();
  if (propre) return propre;
  const racine = process.env.NEXTAUTH_SECRET?.trim();
  if (!racine) throw new Error("Espace client : ni ESPACE_CLIENT_SECRET ni NEXTAUTH_SECRET ne sont posées, aucun lien ne peut être signé.");
  return createHmac("sha256", racine).update("espace-client/v1").digest("hex");
}

function signer(code: string, version: number): string {
  return createHmac("sha256", secretEspace()).update(`${code}.${version}`).digest().subarray(0, 12).toString("base64url");
}

function nouveauCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function adresseDuSite(): string {
  return (process.env.SITE_URL || "https://coverswap.fr").replace(/\/$/, "");
}

export function jetonEspace(espace: Pick<EspaceClient, "code" | "version">): string {
  return `${espace.code}-${signer(espace.code, espace.version)}`;
}

export function lienEspace(espace: Pick<EspaceClient, "code" | "version">): string {
  return `${adresseDuSite()}/e/${jetonEspace(espace)}`;
}

export class LienEspaceInvalide extends ErreurMetier {
  constructor(message: string, status: number, readonly raison: "inconnu" | "expire" | "revoque") {
    super(message, status, { raison });
  }
}

/**
 * Vérifie un jeton présenté par un visiteur et rend l'espace. Un lien inconnu,
 * mal signé ou d'une version révoquée rend la même réponse : on ne dit pas à
 * un curieux si un code existe.
 */
export async function espaceDuJeton(jeton: string): Promise<EspaceClient> {
  const inconnu = () => new LienEspaceInvalide("Ce lien n'est pas valide. Demandez-en un nouveau à CoverSwap.", 404, "inconnu");
  const correspondance = /^([a-z0-9]{8})-([A-Za-z0-9_-]{16})$/.exec(jeton.trim());
  if (!correspondance) throw inconnu();
  const [, code, signature] = correspondance;
  const espace = await prisma.espaceClient.findUnique({ where: { code } });
  // La signature est comparée même si le code n'existe pas : temps de réponse identique.
  const attendue = Buffer.from(signer(code, espace?.version ?? 0));
  const recue = Buffer.from(signature);
  const valide = attendue.length === recue.length && timingSafeEqual(attendue, recue);
  if (!espace || !valide || espace.archiveLe) throw inconnu();
  if (espace.revoqueLe) throw new LienEspaceInvalide("Ce lien a été désactivé. Demandez-en un nouveau à CoverSwap.", 410, "revoque");
  if (espace.expireLe.getTime() < Date.now()) throw new LienEspaceInvalide("Ce lien a expiré. Demandez-en un nouveau à CoverSwap.", 410, "expire");
  return espace;
}

/** Le dossier vivant d'un contact ; ouvert (avec tout ce qu'on sait de lui) s'il n'en a pas encore. */
export async function dossierDuContact(leadId: string): Promise<string> {
  return (await ouvrirDossierDuLead(leadId, { motif: "ESPACE", prochaineAction: "Attendre les photos du client" })).dossierId;
}

export type EspaceOuvert = { espace: EspaceClient; lien: string; nouveau: boolean };

/** L'espace d'un dossier : créé au besoin, prolongé s'il approchait de l'expiration. */
export async function ouvrirEspace(dossierId: string): Promise<EspaceOuvert> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, archiveLe: true } });
  if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  const expireLe = new Date(Date.now() + DUREE_LIEN_JOURS * 86_400_000);
  const existant = await prisma.espaceClient.findUnique({ where: { dossierId } });
  if (existant) {
    if (existant.revoqueLe || existant.archiveLe) throw new ErreurMetier("L'espace de ce dossier est désactivé : le renouveler pour émettre un nouveau lien.", 409);
    // Un lien renvoyé repart pour la durée entière : le client ne tombe pas sur un lien mort la semaine suivante.
    const espace = await prisma.espaceClient.update({ where: { id: existant.id }, data: { expireLe } });
    return { espace, lien: lienEspace(espace), nouveau: false };
  }
  let espace: EspaceClient | null = null;
  for (let essai = 0; essai < 5 && !espace; essai++) {
    try {
      espace = await prisma.$transaction(async (tx) => {
        const cree = await tx.espaceClient.create({ data: { code: nouveauCode(), dossierId, expireLe } });
        await tx.dossierEvenement.create({ data: { dossierId, type: "ESPACE_LIEN_CREE", direction: "INTERNE", contenu: `Espace client ouvert, lien valable jusqu'au ${expireLe.toLocaleDateString("fr-FR")}`, metadata: JSON.stringify({ espaceId: cree.id }) } });
        return cree;
      });
    } catch (erreur) {
      // Code déjà pris (une chance sur des milliards) ou espace créé en même temps par une autre requête.
      const concurrent = await prisma.espaceClient.findUnique({ where: { dossierId } });
      if (concurrent) return { espace: concurrent, lien: lienEspace(concurrent), nouveau: false };
      if (essai === 4) throw erreur;
    }
  }
  return { espace: espace!, lien: lienEspace(espace!), nouveau: true };
}

/** Depuis la fiche d'un contact : ouvre le dossier s'il le faut, puis l'espace. */
export async function ouvrirEspaceDuContact(leadId: string): Promise<EspaceOuvert & { dossierId: string }> {
  const dossierId = await dossierDuContact(leadId);
  return { ...(await ouvrirEspace(dossierId)), dossierId };
}

/** Désactive le lien : le client qui l'ouvre lit « lien désactivé ». Rien n'est effacé. */
export async function revoquerEspace(espaceId: string): Promise<EspaceClient> {
  return prisma.espaceClient.update({ where: { id: espaceId }, data: { revoqueLe: new Date() } });
}

/** Nouveau lien : la version monte (tous les liens déjà envoyés meurent), la durée repart. */
export async function renouvelerEspace(espaceId: string): Promise<EspaceOuvert> {
  const espace = await prisma.espaceClient.update({
    where: { id: espaceId },
    data: { version: { increment: 1 }, revoqueLe: null, expireLe: new Date(Date.now() + DUREE_LIEN_JOURS * 86_400_000) },
  });
  return { espace, lien: lienEspace(espace), nouveau: false };
}
