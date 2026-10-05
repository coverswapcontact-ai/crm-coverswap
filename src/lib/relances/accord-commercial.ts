import prisma from "@/lib/prisma";
import { normaliserEmail } from "@/lib/clients/normalisation";

/**
 * Mission 18 (A4) — l'accord aux messages commerciaux, pour la réactivation à 6 mois (de la prospection : jamais sans
 * accord). LA règle, partagée par la liste des réactivations (`relances/reactivation.ts`), la proposition du SMS et sa
 * copie (`sms/proposition.ts`, `sms/copie.ts`) :
 *  - la déclaration la plus récente du client (`ConsentementMail`) est un accord (ACCORDE) — elle vaut pour le mail
 *    comme pour le SMS ;
 *  - aucune de ses adresses (celle du contact, celles de la fiche) n'est désinscrite (`Desinscription`, définitive).
 */

export type EtatCommercial = { nom: string; consentement: string | null; adresses: readonly (string | null | undefined)[] };

/** Pourquoi pas de message commercial (pur), ou null s'il est permis. */
export function refusCommercial(etat: EtatCommercial, desinscrites: ReadonlySet<string>): string | null {
  if (etat.consentement !== "ACCORDE") return `${etat.nom} n'a pas donné son accord aux messages commerciaux : pas de réactivation.`;
  const adresses = etat.adresses.map((a) => normaliserEmail(a)).filter((a): a is string => Boolean(a));
  if (adresses.some((a) => desinscrites.has(a))) return `${etat.nom} s'est désinscrit des messages commerciaux : pas de réactivation.`;
  return null;
}

/** Les adresses désinscrites parmi celles-ci (en minuscules). */
export async function adressesDesinscrites(adresses: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const propres = [...new Set(adresses.map((a) => normaliserEmail(a)).filter((a): a is string => Boolean(a)))];
  if (propres.length === 0) return new Set();
  return new Set((await prisma.desinscription.findMany({ where: { adresse: { in: propres } }, select: { adresse: true } })).map((d) => d.adresse));
}

/** Le client d'un lead tel que la règle le lit : la dernière déclaration, les adresses (archivées exclues). */
export const SELECTION_CLIENT_COMMERCIAL = {
  anonymiseLe: true,
  consentements: { orderBy: [{ recueilliLe: "desc" as const }, { createdAt: "desc" as const }], take: 1, select: { statut: true } },
  emails: { where: { archiveLe: null }, select: { adresse: true } },
};

/** Pourquoi ce contact ne peut pas recevoir de réactivation (accord, désinscription), ou null. */
export async function refusReactivation(leadId: string): Promise<string | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { prenom: true, nom: true, email: true, archiveLe: true, client: { select: SELECTION_CLIENT_COMMERCIAL } } });
  if (!lead || lead.archiveLe) return "Contact introuvable ou archivé : pas de réactivation.";
  const nom = [lead.prenom, lead.nom].filter((x) => x && !/^(inconnu|client)$/i.test(x)).join(" ") || "Ce contact";
  if (!lead.client || lead.client.anonymiseLe) return `${nom} n'a pas de fiche client avec son accord aux messages commerciaux : pas de réactivation.`;
  const adresses = [lead.email, ...lead.client.emails.map((e) => e.adresse)];
  return refusCommercial({ nom, consentement: lead.client.consentements[0]?.statut ?? null, adresses }, await adressesDesinscrites(adresses));
}
