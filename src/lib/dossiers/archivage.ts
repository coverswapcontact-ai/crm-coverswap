import prisma, { type BaseDonnees } from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { ErreurMetier } from "./erreurs";

/**
 * Archiver un dossier — et pouvoir le restaurer. Rien ne se supprime.
 *
 * Un dossier archivé sort de Dossiers, d'Espaces clients et des relances. Son
 * lead, lui, REVIENT dans Leads (la liste ne retient que les leads sans dossier
 * vivant) avec ses simulations et ses photos sur sa fiche : elles sont
 * détachées du dossier archivé (`dossierId` remis à null), si bien qu'un
 * nouveau dossier ouvert plus tard les reprendra. Les copies déjà rangées dans
 * le dossier archivé y restent. La restauration rattache ce qui avait été
 * détaché (la liste est gardée dans l'événement d'archivage).
 *
 * Refusé si le dossier porte de l'argent ou un engagement : document émis,
 * encaissement, dépense, accord en vigueur. Ceux-là se perdent ou s'annulent,
 * ils ne s'archivent pas.
 */

type Detache = { simulations: string[]; photos: string[] };

export async function verifierArchivable(client: BaseDonnees, dossierId: string): Promise<string | null> {
  const dossier = await client.dossier.findFirst({
    where: { ...AVEC_ARCHIVES, id: dossierId },
    select: { archiveLe: true, _count: { select: { documents: { where: { numero: { not: null } } }, encaissements: true, depenses: true, accords: { where: { retireLe: null } } } } },
  });
  if (!dossier) return "Dossier introuvable.";
  if (dossier.archiveLe) return "Ce dossier est déjà archivé.";
  if (dossier._count.documents > 0) return "Ce dossier porte un document émis : il ne s'archive pas (le passer en « Perdu » si l'affaire est finie).";
  if (dossier._count.encaissements > 0 || dossier._count.depenses > 0) return "Ce dossier porte un paiement ou une dépense : il ne s'archive pas.";
  if (dossier._count.accords > 0) return "Ce dossier porte un bon pour accord en vigueur : il ne s'archive pas.";
  return null;
}

/** Archive le dossier, désactive son espace client (lien mort, rien d'effacé), rend au lead ses simulations et ses photos. */
export async function archiverDossierAvec(client: BaseDonnees, dossierId: string, motif: string): Promise<{ leadId: string | null; detache: Detache }> {
  const refus = await verifierArchivable(client, dossierId);
  if (refus) throw new ErreurMetier(refus, 409);
  const maintenant = new Date();
  const dossier = await client.dossier.findFirst({ where: { id: dossierId }, select: { leadId: true, etape: true } });
  const [simulations, photos] = await Promise.all([
    client.simulation.findMany({ where: { dossierId }, select: { id: true } }),
    client.photoLead.findMany({ where: { dossierId }, select: { id: true } }),
  ]);
  const detache: Detache = { simulations: simulations.map((s) => s.id), photos: photos.map((p) => p.id) };
  await client.dossier.update({ where: { id: dossierId }, data: { archiveLe: maintenant, archiveMotif: motif.slice(0, 300) } });
  if (detache.simulations.length) await client.simulation.updateMany({ where: { id: { in: detache.simulations } }, data: { dossierId: null, rangeeLe: null } });
  if (detache.photos.length) await client.photoLead.updateMany({ where: { id: { in: detache.photos } }, data: { dossierId: null, rangeeLe: null } });
  await client.espaceClient.updateMany({ where: { dossierId, revoqueLe: null }, data: { revoqueLe: maintenant } });
  await client.dossierEvenement.create({
    data: { dossierId, type: "DOSSIER_ARCHIVE", direction: "INTERNE", contenu: `Dossier archivé : ${motif}${dossier?.leadId ? ". Son lead revient dans Leads, avec ses simulations et ses photos." : ""}`.slice(0, 1500), metadata: JSON.stringify({ motif, etape: dossier?.etape ?? null, detache }) },
  });
  return { leadId: dossier?.leadId ?? null, detache };
}

export async function archiverDossier(dossierId: string, motif: string): Promise<{ leadId: string | null }> {
  if (!motif.trim()) throw new ErreurMetier("Indique pourquoi ce dossier est archivé.", 400);
  const { leadId } = await archiverDossierAvec(prisma, dossierId, motif.trim());
  return { leadId };
}

/** Restaure un dossier archivé : il revient dans Dossiers, son lead sort de Leads, ce qui avait été détaché est rattaché. */
export async function restaurerDossier(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findFirst({ where: { ...AVEC_ARCHIVES, id: dossierId }, select: { archiveLe: true, leadId: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  if (!dossier.archiveLe) return;
  if (dossier.leadId) {
    const autre = await prisma.dossier.findFirst({ where: { leadId: dossier.leadId, id: { not: dossierId }, etape: { notIn: ["PERDU", "ENCAISSE"] } }, select: { id: true } });
    if (autre) throw new ErreurMetier("Ce contact a déjà un autre dossier en cours : deux dossiers vivants pour le même projet feraient un doublon.", 409, { dossierId: autre.id });
  }
  const archivage = await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "DOSSIER_ARCHIVE" }, orderBy: { createdAt: "desc" }, select: { metadata: true } });
  let detache: Detache = { simulations: [], photos: [] };
  try {
    detache = { simulations: [], photos: [], ...((JSON.parse(archivage?.metadata || "{}") as { detache?: Detache }).detache ?? {}) };
  } catch {
    // métadonnées illisibles : on restaure sans rattacher
  }
  await prisma.dossier.update({ where: { id: dossierId }, data: { archiveLe: null, archiveMotif: null } });
  // Seulement ce qui n'a pas été rangé ailleurs entre-temps.
  if (detache.simulations.length) await prisma.simulation.updateMany({ where: { id: { in: detache.simulations }, dossierId: null }, data: { dossierId, rangeeLe: new Date() } });
  if (detache.photos.length) await prisma.photoLead.updateMany({ where: { id: { in: detache.photos }, dossierId: null }, data: { dossierId, rangeeLe: new Date() } });
  // Un projet d'un espace permanent (mission 5) réapparaît dans l'espace du client, si son lien est actif ; un ancien espace
  // (sans espace permanent) reste désactivé tant qu'un nouveau lien n'est pas émis.
  const projet = await prisma.espaceClient.findUnique({ where: { dossierId }, select: { id: true, revoqueLe: true, permanent: { select: { revoqueLe: true } } } });
  const reapparait = Boolean(projet?.revoqueLe && projet.permanent && !projet.permanent.revoqueLe);
  if (reapparait) await prisma.espaceClient.update({ where: { id: projet!.id }, data: { revoqueLe: null } });
  await prisma.dossierEvenement.create({ data: { dossierId, type: "DOSSIER_RESTAURE", direction: "INTERNE", contenu: `Dossier restauré : il revient dans Dossiers, son lead sort de Leads. ${reapparait ? "Le projet réapparaît dans l'espace du client." : projet ? "L'espace client reste désactivé tant qu'un nouveau lien n'est pas émis." : ""}`.trim(), metadata: "{}" } });
}

export async function dossiersArchives(): Promise<{ id: string; clientNom: string; objet: string; etape: string; archiveLe: string; archiveMotif: string | null; leadId: string | null }[]> {
  const lignes = await prisma.dossier.findMany({ where: { archiveLe: { not: null } }, orderBy: { archiveLe: "desc" }, take: 200, select: { id: true, clientNom: true, objet: true, etape: true, archiveLe: true, archiveMotif: true, leadId: true } });
  return lignes.map((d) => ({ ...d, archiveLe: d.archiveLe!.toISOString() }));
}
