import prisma from "@/lib/prisma";
import { estPhotoApres, idPhoto, lireFichier, lirePhotos } from "@/lib/dossiers/stockage";

/**
 * L'inventaire des photos d'un contact, pour « voir_photos » (mission 10) :
 * celles du dossier (avant, après chantier, rendus du site rangés dans le
 * dossier) et celles du lead pas encore rangées. Chacune avec sa date (l'id
 * d'une photo du dossier est l'horodatage en base 36), son origine (client dans
 * son espace, formulaire ou simulateur du site, déposée dans le CRM) et, quand
 * on la connaît, la zone. Rien n'est deviné : ce qu'on ne sait pas est dit
 * « non renseigné ».
 */

export type OriginePhoto = "CLIENT_ESPACE" | "SITE_FORMULAIRE" | "SITE_SIMULATEUR" | "RENDU_SITE" | "CRM" | "LEAD";

export const LIBELLES_ORIGINE_PHOTO: Record<OriginePhoto, string> = {
  CLIENT_ESPACE: "déposée par le client dans son espace",
  SITE_FORMULAIRE: "jointe à sa demande sur le site",
  SITE_SIMULATEUR: "photo avant du simulateur du site",
  RENDU_SITE: "rendu du simulateur du site (pas une photo du client)",
  CRM: "déposée dans le CRM",
  LEAD: "jointe à sa demande (lead, pas encore de dossier)",
};

export type PhotoListee = {
  id: string;
  chemin: string;
  /** Date connue de la photo (ISO), sinon null. */
  le: string | null;
  origine: OriginePhoto;
  libelleOrigine: string;
  apres: boolean;
  zone: string | null;
  source: "DOSSIER" | "LEAD";
};

/** L'id d'une photo du dossier commence par son horodatage en base 36 (stockage.ts). */
export function dateDeLId(id: string): Date | null {
  const tete = id.split("-")[0];
  if (!/^[a-z0-9]{6,10}$/.test(tete)) return null;
  const ms = parseInt(tete, 36);
  const date = new Date(ms);
  return ms > Date.UTC(2020, 0, 1) && ms < Date.now() + 86_400_000 ? date : null;
}

const libelleOrigineLead = (origine: string): string => (origine === "SIMULATEUR" || /SIMUL/i.test(origine) ? "simulateur du site" : origine === "FORMULAIRE_SITE" ? "formulaire du site" : origine.toLowerCase().replace(/_/g, " "));

export async function photosDuContact(ids: { dossierId: string | null; leadId: string | null }): Promise<PhotoListee[]> {
  const liste: PhotoListee[] = [];
  if (ids.dossierId) {
    const [dossier, simulationsSite, photosLead, depots] = await Promise.all([
      prisma.dossier.findUnique({ where: { id: ids.dossierId }, select: { photos: true } }),
      prisma.simulation.findMany({ where: { dossierId: ids.dossierId, photosDossier: { not: null } }, select: { photosDossier: true, createdAt: true } }),
      prisma.photoLead.findMany({ where: { dossierId: ids.dossierId }, select: { id: true, origine: true, createdAt: true } }),
      prisma.dossierEvenement.findMany({ where: { dossierId: ids.dossierId, type: "ESPACE_PHOTOS", archiveLe: null }, select: { createdAt: true } }),
    ]);
    const rendus = new Map<string, Date>();
    const avants = new Map<string, Date>();
    for (const s of simulationsSite) {
      try {
        const { avant, rendu } = JSON.parse(s.photosDossier!) as { avant?: string | null; rendu?: string | null };
        if (rendu) rendus.set(rendu, s.createdAt);
        if (avant) avants.set(avant, s.createdAt);
      } catch {
        // métadonnée illisible : la photo passe pour une photo du CRM
      }
    }
    const parLead = new Map(photosLead.map((p) => [`photo-${p.id}`, p]));
    for (const chemin of lirePhotos(dossier?.photos ?? "[]")) {
      const id = idPhoto(chemin);
      const apres = estPhotoApres(chemin);
      const duLead = parLead.get(id);
      const dateId = dateDeLId(id);
      let origine: OriginePhoto = "CRM";
      let le: Date | null = dateId;
      if (rendus.has(id)) {
        origine = "RENDU_SITE";
        le = rendus.get(id) ?? le;
      } else if (avants.has(id)) {
        origine = "SITE_SIMULATEUR";
        le = avants.get(id) ?? le;
      } else if (duLead) {
        origine = "SITE_FORMULAIRE";
        le = duLead.createdAt;
      } else if (dateId && depots.some((d) => dateId.getTime() >= d.createdAt.getTime() - 60_000 && dateId.getTime() <= d.createdAt.getTime() + 20 * 60_000)) {
        // Le client dépose dans son espace : l'événement ESPACE_PHOTOS est ouvert un quart d'heure autour du dépôt.
        origine = "CLIENT_ESPACE";
      }
      liste.push({ id, chemin, le: le?.toISOString() ?? null, origine, libelleOrigine: LIBELLES_ORIGINE_PHOTO[origine] + (duLead && duLead.origine !== "FORMULAIRE_SITE" ? ` (${libelleOrigineLead(duLead.origine)})` : ""), apres, zone: null, source: "DOSSIER" });
    }
  }
  if (ids.leadId) {
    const photos = await prisma.photoLead.findMany({ where: { leadId: ids.leadId, archiveLe: null, ...(ids.dossierId ? { OR: [{ dossierId: null }, { dossierId: { not: ids.dossierId } }] } : {}) }, orderBy: { createdAt: "asc" } });
    for (const p of photos) liste.push({ id: p.id, chemin: p.chemin, le: p.createdAt.toISOString(), origine: "LEAD", libelleOrigine: `${LIBELLES_ORIGINE_PHOTO.LEAD}, ${libelleOrigineLead(p.origine)}`, apres: false, zone: null, source: "LEAD" });
  }
  // Les plus récentes d'abord ; une photo sans date passe après celles qui en ont une (ordre de dépôt gardé).
  return liste
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.le ? new Date(b.p.le).getTime() : -1) - (a.p.le ? new Date(a.p.le).getTime() : -1) || b.i - a.i)
    .map((x) => x.p);
}

/** Les octets d'une photo listée (chemin relatif au dossier des téléversements). */
export async function octetsDeLaPhoto(photo: Pick<PhotoListee, "chemin">): Promise<Buffer | null> {
  return lireFichier(photo.chemin);
}
