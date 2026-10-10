/**
 * Mission 25 — un suivi par dossier, ou par lead tant qu'il n'a pas de dossier. Quand le dossier arrive, le suivi du
 * lead passe au dossier (mêmes faits, même journal, mêmes messages : les clés suivent le suivi). Les leads d'avant le
 * début de la campagne (25/09/2026) n'ont de suivi que si quelque chose leur arrive (un appel, un message) : ils ne
 * génèrent rien d'eux-mêmes.
 */
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireParametre, enregistrerParametre } from "@/lib/parametres/service";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { estDossierClos } from "@/lib/dossiers/constants";
import type { Suivi } from "@prisma/client";

/** Début de la campagne Meta : les leads reçus avant ne génèrent rien (bouton « Archiver les anciens leads »). */
export const DEBUT_CAMPAGNE = new Date("2026-09-24T22:00:00.000Z"); // 25/09/2026 00:00, heure de Paris
/** Démarrage en douceur : 14 jours de propositions pour les dossiers ouverts avant la mise en service. */
export const DUREE_DOUCEUR_MS = 14 * 86_400_000;

const CLE_LANCEMENT = "__coverswapLancementMessagerie";
const memoire = globalThis as unknown as Record<string, Date | undefined>;

/**
 * L'instant de mise en service (paramètre MESSAGERIE_LANCEMENT) ; posé à la première lecture s'il manque (mise en
 * service = premier passage du moteur après le déploiement).
 */
export async function lancementMessagerie(maintenant: Date = new Date()): Promise<Date> {
  const lu = await lireParametre("MESSAGERIE_LANCEMENT", maintenant);
  if (typeof lu === "string" && !Number.isNaN(Date.parse(lu))) return new Date(lu);
  if (memoire[CLE_LANCEMENT]) return memoire[CLE_LANCEMENT]!;
  // La date d'effet est un jour : midi UTC du jour, pour que la valeur soit lisible dès maintenant.
  const valableDu = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()) - 86_400_000);
  await enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: maintenant.toISOString(), valableDu, source: "Mise en service de la messagerie (mission 25)" });
  memoire[CLE_LANCEMENT] = maintenant;
  return maintenant;
}

/**
 * Mission 25 (lot 6) — la messagerie est en service (sa mise en service est posée, sans rien écrire ici) : c'est elle
 * qui prépare les relances. L'ancien circuit (tâches RELANCER_*, REACTIVER, « relances proposables ») se tait.
 */
export async function messagerieEnService(maintenant: Date = new Date()): Promise<boolean> {
  const lu = await lireParametre("MESSAGERIE_LANCEMENT", maintenant);
  return typeof lu === "string" && !Number.isNaN(Date.parse(lu)) && Date.parse(lu) <= maintenant.getTime();
}

/** Oublie la date de lancement gardée en mémoire (essais). */
export function oublierLancement(): void {
  memoire[CLE_LANCEMENT] = undefined;
}

const nomDuLead = (lead: { prenom: string; nom: string }) => [lead.prenom, lead.nom].filter((x) => x && !/^inconnu$/i.test(x.trim())).join(" ").trim() || "Contact sans nom";

/** Le dossier vivant d'un lead (le plus récent non clos, sinon le plus récent), ou null. */
async function dossierDuLead(leadId: string): Promise<{ id: string; etape: string } | null> {
  const dossiers = await prisma.dossier.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, select: { id: true, etape: true } });
  return dossiers.find((d) => !estDossierClos(d.etape)) ?? dossiers[0] ?? null;
}

/**
 * Le suivi d'un dossier ou d'un lead, créé s'il manque (et s'il a lieu d'être). `geste` : quelque chose vient d'arriver
 * à ce contact (un vieux lead reçoit alors son suivi).
 */
export async function suiviPour(cible: { leadId?: string | null; dossierId?: string | null }, options: { geste?: boolean; lancement?: Date } = {}): Promise<Suivi | null> {
  let dossierId = cible.dossierId ?? null;
  if (!dossierId && cible.leadId) dossierId = (await dossierDuLead(cible.leadId))?.id ?? null;

  if (dossierId) {
    const existant = await prisma.suivi.findFirst({ where: { ...AVEC_ARCHIVES, dossierId } });
    if (existant) return existant;
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, leadId: true, clientId: true, clientNom: true, clientTelephone: true, createdAt: true, archiveLe: true } });
    if (!dossier) return null;
    const lancement = options.lancement ?? (await lancementMessagerie());
    // Le suivi du lead passe au dossier : rien ne se perd (faits, journal, messages préparés).
    const duLead = dossier.leadId ? await prisma.suivi.findFirst({ where: { ...AVEC_ARCHIVES, leadId: dossier.leadId, dossierId: null } }) : null;
    if (duLead) {
      return prisma.suivi.update({ where: { id: duLead.id }, data: { dossierId: dossier.id, clientId: dossier.clientId ?? duLead.clientId, nom: dossier.clientNom || duLead.nom, telephone: normaliserTelephone(dossier.clientTelephone) ?? duLead.telephone, revoirLe: new Date() } });
    }
    const leadLibre = dossier.leadId ? !(await prisma.suivi.findFirst({ where: { ...AVEC_ARCHIVES, leadId: dossier.leadId } })) : false;
    try {
      return await prisma.suivi.create({
        data: {
          dossierId: dossier.id,
          leadId: leadLibre ? dossier.leadId : null,
          clientId: dossier.clientId,
          nom: dossier.clientNom || "Dossier sans nom",
          telephone: normaliserTelephone(dossier.clientTelephone),
          demarrageDoux: dossier.createdAt.getTime() < lancement.getTime(),
          revoirLe: new Date(),
        },
      });
    } catch (erreur) {
      if ((erreur as { code?: string }).code !== "P2002") throw erreur;
      return prisma.suivi.findFirst({ where: { ...AVEC_ARCHIVES, dossierId: dossier.id } });
    }
  }

  if (!cible.leadId) return null;
  const existant = await prisma.suivi.findFirst({ where: { ...AVEC_ARCHIVES, leadId: cible.leadId } });
  if (existant) return existant;
  const lead = await prisma.lead.findUnique({ where: { id: cible.leadId }, select: { id: true, prenom: true, nom: true, telephone: true, clientId: true, createdAt: true, archiveLe: true } });
  if (!lead) return null;
  if (lead.createdAt.getTime() < DEBUT_CAMPAGNE.getTime() && !options.geste) return null;
  if (lead.archiveLe && !options.geste) return null;
  const lancement = options.lancement ?? (await lancementMessagerie());
  try {
    return await prisma.suivi.create({
      data: { leadId: lead.id, clientId: lead.clientId, nom: nomDuLead(lead), telephone: normaliserTelephone(lead.telephone), demarrageDoux: lead.createdAt.getTime() < lancement.getTime(), revoirLe: new Date() },
    });
  } catch (erreur) {
    if ((erreur as { code?: string }).code !== "P2002") throw erreur;
    return prisma.suivi.findFirst({ where: { ...AVEC_ARCHIVES, leadId: lead.id } });
  }
}

/** Le démarrage en douceur vaut-il encore pour ce suivi ? */
export function enDouceur(suivi: Pick<Suivi, "demarrageDoux">, lancement: Date, maintenant: Date): boolean {
  return suivi.demarrageDoux && maintenant.getTime() < lancement.getTime() + DUREE_DOUCEUR_MS;
}
