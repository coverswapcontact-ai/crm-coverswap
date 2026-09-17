import { promises as fs } from "fs";
import path from "path";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { analyser } from "@/lib/commun/api";
import { estPhotoApres, lirePhotos } from "@/lib/dossiers/stockage";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Ce que le CRM publie sur le site : réalisations (photos après, éventuellement
 * avant) et avis clients, avec l'accord écrit de la personne. Le site ne voit
 * que les publications publiées, par une route publique dédiée ; les photos
 * sont servies par /api/site/photos/<id>/<avant|apres>, jamais par /api/uploads.
 */
export const TYPES_PUBLICATION = ["REALISATION", "AVIS"] as const;
export type TypePublication = (typeof TYPES_PUBLICATION)[number];
export const TYPES_PROJET_PUBLICATION = ["CUISINE", "SDB", "MEUBLES", "PRO", "AUTRE"] as const;

const texte = (max: number) => z.string().trim().max(max);

export const schemaPublication = z.object({
  type: z.enum(TYPES_PUBLICATION),
  titre: texte(120).min(3, "Titre trop court."),
  texte: texte(1500).optional().nullable(),
  ville: texte(80).optional().nullable(),
  typeProjet: z.enum(TYPES_PROJET_PUBLICATION).optional().nullable(),
  note: z.number().int().min(1).max(5).optional().nullable(),
  auteur: texte(60).optional().nullable(),
  dossierId: z.string().max(40).optional().nullable(),
  clientId: z.string().max(40).optional().nullable(),
  photoAvant: z.string().max(300).optional().nullable(),
  photoApres: z.string().max(300).optional().nullable(),
  accordClientLe: z.string().optional().nullable(),
  ordre: z.number().int().min(0).max(9999).optional(),
});
export type EntreePublication = z.infer<typeof schemaPublication>;

export type PublicationVue = {
  id: string;
  type: TypePublication;
  titre: string;
  texte: string | null;
  ville: string | null;
  typeProjet: string | null;
  note: number | null;
  auteur: string | null;
  dossierId: string | null;
  clientId: string | null;
  photoAvant: string | null;
  photoApres: string | null;
  accordClientLe: string | null;
  ordre: number;
  publieLe: string | null;
  retireLe: string | null;
  creeLe: string;
};

type Ligne = NonNullable<Awaited<ReturnType<typeof prisma.publicationSite.findUnique>>>;

function versVue(p: Ligne): PublicationVue {
  return {
    id: p.id,
    type: p.type as TypePublication,
    titre: p.titre,
    texte: p.texte,
    ville: p.ville,
    typeProjet: p.typeProjet,
    note: p.note,
    auteur: p.auteur,
    dossierId: p.dossierId,
    clientId: p.clientId,
    photoAvant: p.photoAvant,
    photoApres: p.photoApres,
    accordClientLe: p.accordClientLe?.toISOString() ?? null,
    ordre: p.ordre,
    publieLe: p.publieLe?.toISOString() ?? null,
    retireLe: p.retireLe?.toISOString() ?? null,
    creeLe: p.createdAt.toISOString(),
  };
}

/** Les photos qu'une publication peut utiliser : celles du dossier désigné, avant et après. */
export async function photosDuDossierPourPublication(dossierId: string): Promise<{ chemin: string; apres: boolean; url: string }[]> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { photos: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  return lirePhotos(dossier.photos).map((chemin) => ({
    chemin,
    apres: estPhotoApres(chemin),
    url: `/api/dossiers/${dossierId}/photos/${path.posix.basename(chemin).replace(/\.[a-z0-9]+$/i, "")}`,
  }));
}

/** Dossiers ayant au moins une photo après chantier : la matière première des réalisations. */
export async function dossiersAvecPhotosApres(): Promise<{ id: string; objet: string; clientNom: string; ville: string | null; typeProjet: string | null; clientId: string | null; nbApres: number }[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { photos: { contains: "photos-apres" } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, objet: true, clientNom: true, clientVille: true, clientId: true, photos: true },
  });
  return dossiers.map((d) => ({ id: d.id, objet: d.objet, clientNom: d.clientNom, ville: d.clientVille || null, typeProjet: null, clientId: d.clientId, nbApres: lirePhotos(d.photos).filter(estPhotoApres).length }));
}

async function verifierPhotos(entree: Pick<EntreePublication, "dossierId" | "photoAvant" | "photoApres">): Promise<void> {
  const chemins = [entree.photoAvant, entree.photoApres].filter((c): c is string => !!c);
  if (chemins.length === 0) return;
  if (!entree.dossierId) throw new ErreurMetier("Une photo publiée vient toujours d'un dossier.", 400);
  const disponibles = new Set((await photosDuDossierPourPublication(entree.dossierId)).map((p) => p.chemin));
  for (const c of chemins) if (!disponibles.has(c)) throw new ErreurMetier("Cette photo n'appartient pas au dossier.", 400);
}

function versDonnees(entree: EntreePublication) {
  return {
    type: entree.type,
    titre: entree.titre,
    texte: entree.texte ?? null,
    ville: entree.ville ?? null,
    typeProjet: entree.typeProjet ?? null,
    note: entree.type === "AVIS" ? (entree.note ?? null) : null,
    auteur: entree.auteur ?? null,
    dossierId: entree.dossierId ?? null,
    clientId: entree.clientId ?? null,
    photoAvant: entree.photoAvant ?? null,
    photoApres: entree.photoApres ?? null,
    accordClientLe: entree.accordClientLe ? new Date(entree.accordClientLe) : null,
    ordre: entree.ordre ?? 0,
  };
}

export async function listerPublications(): Promise<PublicationVue[]> {
  const lignes = await prisma.publicationSite.findMany({ orderBy: [{ ordre: "asc" }, { createdAt: "desc" }] });
  return lignes.map(versVue);
}

export async function creerPublication(brut: unknown): Promise<PublicationVue> {
  const entree = analyser(schemaPublication, brut);
  await verifierPhotos(entree);
  const creee = await prisma.publicationSite.create({ data: versDonnees(entree) });
  return versVue(creee);
}

export async function modifierPublication(id: string, brut: unknown): Promise<PublicationVue> {
  const entree = analyser(schemaPublication, brut);
  await verifierPhotos(entree);
  const existante = await prisma.publicationSite.findUnique({ where: { id } });
  if (!existante) throw new ErreurMetier("Publication introuvable.", 404);
  const maj = await prisma.publicationSite.update({ where: { id }, data: versDonnees(entree) });
  return versVue(maj);
}

/** Publier exige l'accord écrit de la personne et, pour une réalisation, une photo après. */
export async function publierPublication(id: string): Promise<PublicationVue> {
  const p = await prisma.publicationSite.findUnique({ where: { id } });
  if (!p) throw new ErreurMetier("Publication introuvable.", 404);
  if (!p.accordClientLe) throw new ErreurMetier("Publier sans l'accord écrit de la personne est refusé : renseigne la date de l'accord.", 400);
  if (p.type === "REALISATION" && !p.photoApres) throw new ErreurMetier("Une réalisation se publie avec au moins une photo après chantier.", 400);
  if (p.type === "AVIS" && !p.texte) throw new ErreurMetier("Un avis se publie avec son texte.", 400);
  const maj = await prisma.publicationSite.update({ where: { id }, data: { publieLe: new Date(), retireLe: null } });
  return versVue(maj);
}

export async function retirerPublication(id: string): Promise<PublicationVue> {
  const p = await prisma.publicationSite.findUnique({ where: { id } });
  if (!p) throw new ErreurMetier("Publication introuvable.", 404);
  const maj = await prisma.publicationSite.update({ where: { id }, data: { retireLe: new Date() } });
  return versVue(maj);
}

/* ── Côté public (site) ─────────────────────────────────────────── */

export type PublicationPublique = {
  id: string;
  type: TypePublication;
  titre: string;
  texte: string | null;
  ville: string | null;
  typeProjet: string | null;
  note: number | null;
  auteur: string | null;
  photoAvant: string | null;
  photoApres: string | null;
  publieLe: string;
};

function estVisible(p: Ligne): boolean {
  if (!p.publieLe || p.retireLe || p.archiveLe) return false;
  if (p.type === "REALISATION" && !p.photoApres) return false;
  if (p.type === "AVIS" && !p.texte) return false;
  return true;
}

export async function publicationsPubliees(base = ""): Promise<PublicationPublique[]> {
  const lignes = await prisma.publicationSite.findMany({ where: { publieLe: { not: null }, retireLe: null }, orderBy: [{ ordre: "asc" }, { publieLe: "desc" }], take: 60 });
  return lignes.filter(estVisible).map((p) => ({
    id: p.id,
    type: p.type as TypePublication,
    titre: p.titre,
    texte: p.texte,
    ville: p.ville,
    typeProjet: p.typeProjet,
    note: p.note,
    auteur: p.auteur,
    photoAvant: p.photoAvant ? `${base}/api/site/photos/${p.id}/avant` : null,
    photoApres: p.photoApres ? `${base}/api/site/photos/${p.id}/apres` : null,
    publieLe: p.publieLe!.toISOString(),
  }));
}

const TYPES_MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** Photo d'une publication publiée, ou rien : le fichier n'est lu que si la publication est visible. */
export async function lirePhotoPublique(id: string, quelle: "avant" | "apres"): Promise<{ contenu: Buffer; type: string } | null> {
  const p = await prisma.publicationSite.findUnique({ where: { id } });
  if (!p || !estVisible(p)) return null;
  const chemin = quelle === "avant" ? p.photoAvant : p.photoApres;
  if (!chemin || chemin.includes("..")) return null;
  try {
    const contenu = await fs.readFile(path.join(resolveUploadsDir(), chemin));
    return { contenu, type: TYPES_MIME[path.extname(chemin).toLowerCase()] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
