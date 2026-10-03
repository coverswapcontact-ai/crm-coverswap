import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { normaliserEmail } from "@/lib/clients/normalisation";

/**
 * La désinscription des mails commerciaux (mission 7, gardée seule par la mission 18, A4 : les séquences de mails sont
 * retirées du code, leurs lignes restent en base). Un lien signé par adresse (`SITE_URL/desinscription?e=&j=`), suivi
 * depuis la page du site (`POST /api/site/desinscription`) : la désinscription est définitive, enregistrée
 * (`Desinscription`), et le retrait de l'accord aux e-mails commerciaux est inscrit sur la fiche de chaque client qui
 * porte cette adresse. Les relances de devis et la réactivation à 6 mois lisent ce retrait (et la désinscription).
 */

function cleDesinscription(): string {
  const racine = process.env.NEXTAUTH_SECRET?.trim();
  if (!racine) throw new Error("NEXTAUTH_SECRET absente : aucun lien de désinscription ne peut être signé.");
  return createHmac("sha256", racine).update("desinscription/v1").digest("hex");
}

export function jetonDesinscription(adresse: string): string {
  return createHmac("sha256", cleDesinscription()).update(adresse.trim().toLowerCase()).digest().subarray(0, 16).toString("base64url");
}

export function lienDesinscription(adresse: string): string {
  const site = (process.env.SITE_URL || "https://coverswap.fr").replace(/\/$/, "");
  const propre = adresse.trim().toLowerCase();
  return `${site}/desinscription?e=${Buffer.from(propre).toString("base64url")}&j=${jetonDesinscription(propre)}`;
}

/**
 * Le lien de désinscription a été suivi : enregistrée pour toujours, et le retrait de l'accord aux e-mails commerciaux
 * inscrit sur la fiche de chaque client qui porte cette adresse (preuve datée). Rejouable : un second clic n'écrit rien.
 */
export async function desinscrire(adresseEncodee: string, jeton: string, source: "LIEN" | "LUCAS" = "LIEN"): Promise<{ adresse: string }> {
  let adresse: string;
  try {
    adresse = Buffer.from(adresseEncodee, "base64url").toString("utf8").trim().toLowerCase();
  } catch {
    throw new ErreurMetier("Lien de désinscription illisible.", 400);
  }
  if (!normaliserEmail(adresse)) throw new ErreurMetier("Lien de désinscription illisible.", 400);
  const attendu = Buffer.from(jetonDesinscription(adresse));
  const recu = Buffer.from(jeton);
  if (source === "LIEN" && (attendu.length !== recu.length || !timingSafeEqual(attendu, recu))) throw new ErreurMetier("Lien de désinscription invalide.", 403);
  const deja = await prisma.desinscription.findUnique({ where: { adresse }, select: { adresse: true } });
  await prisma.desinscription.upsert({ where: { adresse }, create: { adresse, source }, update: {} });
  if (!deja) {
    const clients = await prisma.clientEmail.findMany({ where: { adresse, archiveLe: null, client: { anonymiseLe: null } }, select: { clientId: true }, distinct: ["clientId"] });
    for (const { clientId } of clients) {
      await prisma.consentementMail.create({
        data: { clientId, statut: "RETIRE", moyen: "EMAIL", recueilliLe: new Date(), preuve: source === "LIEN" ? "Lien de désinscription d'un mail commercial" : "Désinscription notée par Lucas" },
      });
    }
  }
  return { adresse };
}
