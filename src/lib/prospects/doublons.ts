import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { fusionnerClients } from "@/lib/clients/fusion";
import { ouvrirDossierDuLead } from "@/lib/dossiers/depuis-lead";

/**
 * Le même client revenu avec un autre numéro ET une autre adresse e-mail : le
 * CRM ne peut pas le reconnaître (la règle d'identité, c'est le téléphone puis
 * l'e-mail). Il signale le doublon PROBABLE — même nom, même ville, dans les
 * trois semaines — et Lucas fusionne en un clic, ou écarte le signalement.
 * Jamais de fusion sans lui.
 *
 * Fusionner : les simulations, photos, échanges et conversations du nouveau
 * contact rejoignent l'ancien ; ses nouvelles simulations du site entrent dans
 * le dossier (et l'espace) de l'ancien ; les deux fiches client n'en font plus
 * qu'une ; le dossier ouvert d'office pour le nouveau contact, s'il est resté
 * vide, est archivé ; le nouveau contact est archivé (« doublon, fusionné »).
 * Rien n'est supprimé.
 */

export const FENETRE_DOUBLON_JOURS = 21;

export function nomNormalise(prenom: string | null | undefined, nom: string | null | undefined): string {
  return `${prenom ?? ""} ${nom ?? ""}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\binconnu\b/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function villeNormalisee(ville: string | null | undefined): string {
  const v = (ville ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\bst\b/g, "saint")
    .trim();
  return /^(non renseignee?|inconnue?)$/.test(v) ? "" : v;
}

const chiffres = (telephone: string | null | undefined) => (telephone ?? "").replace(/\D/g, "").slice(-9);

/** À l'arrivée d'un contact : cherche une personne déjà connue au même nom, dans la même ville, ces trois dernières semaines. */
export async function reperDoublonProbable(leadId: string, maintenant: Date = new Date()): Promise<{ doublonDe: string; motif: string } | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, prenom: true, nom: true, ville: true, codePostal: true, telephone: true, email: true, doublonDe: true } });
  if (!lead || lead.doublonDe) return null;
  const nom = nomNormalise(lead.prenom, lead.nom);
  const ville = villeNormalisee(lead.ville);
  // Un prénom seul, ou une ville inconnue : trop peu pour soupçonner qui que ce soit.
  if (nom.split(" ").length < 2 || (!ville && !lead.codePostal)) return null;
  const depuis = new Date(maintenant.getTime() - FENETRE_DOUBLON_JOURS * 86_400_000);
  const candidats = await prisma.lead.findMany({
    where: { id: { not: lead.id }, OR: [{ createdAt: { gte: depuis } }, { dossiers: { some: { updatedAt: { gte: depuis }, archiveLe: null } } }] },
    select: { id: true, prenom: true, nom: true, ville: true, codePostal: true, telephone: true, email: true, createdAt: true, dossiers: { where: { archiveLe: null }, select: { id: true }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const homonymes = candidats.filter((c) => nomNormalise(c.prenom, c.nom) === nom && ((ville && villeNormalisee(c.ville) === ville) || (lead.codePostal && c.codePostal === lead.codePostal)));
  // Un homonyme au même téléphone ou au même e-mail : c'est la règle d'identité qui s'applique, pas un soupçon.
  const identique = homonymes.some((c) => (chiffres(c.telephone) && chiffres(c.telephone) === chiffres(lead.telephone)) || (c.email && lead.email && c.email.toLowerCase() === lead.email.toLowerCase()));
  const trouve = identique ? null : (homonymes[0] ?? null);
  if (!trouve) return null;
  const motif = `Même nom et même ville que ${`${trouve.prenom} ${trouve.nom}`.replace(/\bInconnu\b/g, "").trim()} (contact du ${trouve.createdAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}${trouve.dossiers.length ? ", dossier en cours" : ""}), autre numéro et autre e-mail`;
  await prisma.lead.update({ where: { id: lead.id }, data: { doublonDe: trouve.id, doublonMotif: motif } });
  return { doublonDe: trouve.id, motif };
}

export type ResultatFusion = { dossierId: string | null; simulations: number; photos: number; dossiersArchives: number };

export async function fusionnerDoublon(leadId: string): Promise<ResultatFusion> {
  const nouveau = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!nouveau) throw new ErreurMetier("Contact introuvable.", 404);
  if (!nouveau.doublonDe) throw new ErreurMetier("Aucun doublon signalé pour ce contact.", 400);
  if (nouveau.doublonTraiteLe) throw new ErreurMetier("Ce signalement a déjà été traité.", 409);
  const ancien = await prisma.lead.findFirst({ where: { ...AVEC_ARCHIVES, id: nouveau.doublonDe } });
  if (!ancien || ancien.archiveLe) throw new ErreurMetier("Le contact d'origine n'existe plus ou est archivé : rien à fusionner.", 409);
  const maintenant = new Date();
  const nomNouveau = `${nouveau.prenom} ${nouveau.nom}`.replace(/\bInconnu\b/g, "").trim();
  const nomAncien = `${ancien.prenom} ${ancien.nom}`.replace(/\bInconnu\b/g, "").trim();

  const bilan = await prisma.$transaction(async (tx) => {
    // Une seule fiche client : celle du contact d'origine absorbe l'autre (coordonnées comprises).
    if (nouveau.clientId && ancien.clientId && nouveau.clientId !== ancien.clientId) {
      await fusionnerClients(tx, ancien.clientId, nouveau.clientId, `Doublon fusionné par Lucas : ${nomNouveau} (${nouveau.telephone || "sans numéro"}) = ${nomAncien}`);
    } else if (!ancien.clientId && nouveau.clientId) {
      await tx.lead.update({ where: { id: ancien.id }, data: { clientId: nouveau.clientId } });
    }
    const clientId = ancien.clientId ?? nouveau.clientId;
    // Ce qui appartenait au nouveau contact rejoint l'ancien ; ses simulations et photos repartent pour être rangées dans le bon dossier.
    const simulations = await tx.simulation.updateMany({ where: { leadId: nouveau.id }, data: { leadId: ancien.id, dossierId: null, rangeeLe: null, photosDossier: null } });
    const photos = await tx.photoLead.updateMany({ where: { leadId: nouveau.id }, data: { leadId: ancien.id, dossierId: null, rangeeLe: null } });
    await tx.simulationSite.updateMany({ where: { ...AVEC_ARCHIVES, leadId: nouveau.id }, data: { leadId: ancien.id } });
    await tx.interaction.updateMany({ where: { leadId: nouveau.id }, data: { leadId: ancien.id } });
    await tx.metaLead.updateMany({ where: { leadId: nouveau.id }, data: { leadId: ancien.id } });
    await tx.conversationSms.updateMany({ where: { leadId: nouveau.id }, data: { leadId: ancien.id, ...(clientId ? { clientId } : {}) } });
    // Le dossier ouvert d'office pour le nouveau contact : archivé s'il est resté vide.
    const dossiers = await tx.dossier.findMany({
      where: { leadId: nouveau.id },
      select: { id: true, _count: { select: { documents: true, encaissements: true, depenses: true, accords: true } }, espaces: { select: { premierAccesLe: true } } },
    });
    let dossiersArchives = 0;
    for (const dossier of dossiers) {
      const vide = Object.values(dossier._count).every((n) => n === 0) && dossier.espaces.every((e) => !e.premierAccesLe);
      if (!vide) continue;
      await tx.dossier.update({ where: { id: dossier.id }, data: { archiveLe: maintenant, archiveMotif: `Doublon : fusionné dans le dossier de ${nomAncien}` } });
      dossiersArchives++;
    }
    await tx.lead.update({
      where: { id: nouveau.id },
      data: { doublonTraiteLe: maintenant, archiveLe: maintenant, archiveMotif: `Doublon de ${nomAncien} : fusionné le ${maintenant.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}` },
    });
    return { simulations: simulations.count, photos: photos.count, dossiersArchives };
  });

  // Les simulations rejoignent le dossier vivant du contact d'origine (ouvert au besoin), et son espace.
  const ouverture = bilan.simulations + bilan.photos > 0 ? await ouvrirDossierDuLead(ancien.id, { motif: "SIMULATION", silencieux: true }) : null;
  const dossierId = ouverture?.dossierId ?? (await prisma.dossier.findFirst({ where: { leadId: ancien.id }, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id ?? null;
  if (dossierId) {
    await prisma.dossierEvenement.create({
      data: {
        dossierId,
        type: "NOTE_AJOUTEE",
        direction: "INTERNE",
        contenu: `Contact en double fusionné : ${nomNouveau}${nouveau.telephone ? `, ${nouveau.telephone}` : ""}${nouveau.email ? `, ${nouveau.email}` : ""} (arrivé le ${nouveau.createdAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })})${bilan.simulations ? ` — ${bilan.simulations} simulation(s) rejoignent ce dossier` : ""}.`,
        metadata: JSON.stringify({ leadFusionne: nouveau.id }),
      },
    });
  }
  return { dossierId, ...bilan };
}

export async function ecarterDoublon(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { doublonDe: true, doublonTraiteLe: true, doublonMotif: true } });
  if (!lead?.doublonDe) throw new ErreurMetier("Aucun doublon signalé pour ce contact.", 400);
  if (lead.doublonTraiteLe) return;
  await prisma.lead.update({ where: { id: leadId }, data: { doublonTraiteLe: new Date(), doublonMotif: `${lead.doublonMotif ?? "Doublon probable"} — écarté : ce n'est pas la même personne` } });
}
