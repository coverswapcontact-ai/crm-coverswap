import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Images reçues du site (photos de la demande, photo avant, rendu après) :
 * écrites sous le dossier des téléversements, servies uniquement par
 * /api/uploads derrière une session. Aucune fonction ici ne lève : une image
 * illisible ne doit jamais faire perdre le contact.
 */

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 Mo décodés

/** Écrit une image base64 (data URL ou brut) et renvoie son chemin relatif, ou null. */
export async function enregistrerImageBase64(base64: string, dossierRelatif: string, nomFichier: string): Promise<string | null> {
  try {
    if (!base64 || typeof base64 !== "string") return null;
    const m = base64.match(/^data:([^;]+);base64,(.+)$/);
    const brut = m ? m[2] : base64;
    const approxBytes = Math.floor((brut.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      console.warn(`[images] image trop grosse (${Math.round(approxBytes / 1024)} Ko), ignorée`);
      return null;
    }
    const buf = Buffer.from(brut, "base64");
    if (buf.length < 64) return null;
    const dossier = path.join(resolveUploadsDir(), dossierRelatif);
    await fs.mkdir(dossier, { recursive: true });
    await fs.writeFile(path.join(dossier, nomFichier), buf);
    return path.posix.join(dossierRelatif.split(path.sep).join("/"), nomFichier);
  } catch (err) {
    console.error("[images] écriture impossible (non bloquant) :", err);
    return null;
  }
}

/** Extension de fichier d'après le type déclaré dans la data URL (jpg par défaut). */
function extensionDe(base64: string): string {
  const type = base64.match(/^data:image\/(\w+);base64,/)?.[1]?.toLowerCase();
  if (type === "png") return "png";
  if (type === "webp") return "webp";
  return "jpg";
}

/** Photos jointes à une demande : une ligne PhotoLead par fichier écrit. */
export async function enregistrerPhotosLead(leadId: string, photos: string[], origine = "FORMULAIRE_SITE"): Promise<number> {
  let ecrites = 0;
  for (const photo of photos.slice(0, 4)) {
    const chemin = await enregistrerImageBase64(photo, path.join(leadId, "photos"), `${randomUUID()}.${extensionDe(photo)}`);
    if (!chemin) continue;
    await prisma.photoLead.create({ data: { leadId, chemin, origine } });
    ecrites += 1;
  }
  return ecrites;
}

const FENETRE_SIMULATION_MS = 30 * 60 * 1000;

/**
 * Photo avant et rendu après d'une simulation générée sur Railway : rattachés
 * à la simulation ouverte par le webhook quelques instants plus tôt (même lead,
 * sans image, moins de 30 min), sinon à une nouvelle simulation.
 */
export async function rattacherImagesSimulation(leadId: string, avantBase64: string, apresBase64: string, referenceChoisie?: string | null): Promise<string | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) {
    console.error(`[images] simulation : lead ${leadId} introuvable`);
    return null;
  }
  const recente = await prisma.simulation.findFirst({
    where: { leadId, imageAfterPath: null, createdAt: { gte: new Date(Date.now() - FENETRE_SIMULATION_MS) } },
    orderBy: { createdAt: "desc" },
  });
  const simulation =
    recente ?? (await prisma.simulation.create({ data: { leadId, source: "SITE_SIMULATEUR", referenceChoisie: referenceChoisie ?? null } }));
  const dossier = path.join(leadId, simulation.id);
  const imageBeforePath = await enregistrerImageBase64(avantBase64, dossier, "before.jpg");
  const imageAfterPath = await enregistrerImageBase64(apresBase64, dossier, "after.png");
  await prisma.simulation.update({
    where: { id: simulation.id },
    data: { imageBeforePath: imageBeforePath ?? simulation.imageBeforePath, imageAfterPath: imageAfterPath ?? simulation.imageAfterPath },
  });
  return simulation.id;
}
