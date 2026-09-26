import { promises as fs } from "fs";
import path from "path";
import prisma from "@/lib/prisma";
import { resolveUploadsDir } from "@/lib/uploads";
import { enregistrerImageBase64 } from "@/lib/simulations/images";
import { pluriel } from "@/lib/commun/format";

/**
 * Simulations faites sur le site avant toute coordonnée.
 *
 * Cycle : enregistrée à la génération (parcours navigateur, images, références)
 * → rattachée au lead quand la personne demande son devis (copie en
 * `Simulation` sur le lead, images déplacées sous le dossier du lead) → sinon
 * purgée après 30 jours (images effacées, ligne archivée sans image), comme
 * l'annonce la politique de confidentialité du site.
 */
export const RETENTION_SANS_DEMANDE_MS = 30 * 24 * 60 * 60 * 1000;
export const DOSSIER_SITE = "site";

export type ReferenceSimulee = { zone: string; libelle: string; ref: string; nom: string };

export type EntreeSimulationSite = {
  parcoursId: string;
  projet: string;
  references: ReferenceSimulee[];
  imageAvantBase64: string;
  imageApresBase64: string;
  page?: string | null;
  source?: string | null;
  campagne?: string | null;
  ipOrigine?: string | null;
  dureeMs?: number | null;
};

export async function enregistrerSimulationSite(entree: EntreeSimulationSite): Promise<{ id: string; imageBeforePath: string | null; imageAfterPath: string | null }> {
  const creee = await prisma.simulationSite.create({
    data: {
      parcoursId: entree.parcoursId,
      projet: entree.projet,
      references: JSON.stringify(entree.references),
      referenceChoisie: entree.references[0]?.ref ?? null,
      page: entree.page ?? null,
      source: entree.source ?? null,
      campagne: entree.campagne ?? null,
      ipOrigine: entree.ipOrigine ?? null,
      dureeMs: entree.dureeMs ?? null,
    },
  });
  const dossier = path.join(DOSSIER_SITE, entree.parcoursId, creee.id);
  const imageBeforePath = await enregistrerImageBase64(entree.imageAvantBase64, dossier, "avant.jpg");
  const imageAfterPath = await enregistrerImageBase64(entree.imageApresBase64, dossier, "apres.png");
  await prisma.simulationSite.update({ where: { id: creee.id }, data: { imageBeforePath, imageAfterPath } });
  return { id: creee.id, imageBeforePath, imageAfterPath };
}

async function deplacerImage(chemin: string | null, dossierCible: string, nom: string): Promise<string | null> {
  if (!chemin) return null;
  const base = resolveUploadsDir();
  const source = path.join(base, chemin);
  const cible = path.join(base, dossierCible, nom);
  try {
    await fs.mkdir(path.dirname(cible), { recursive: true });
    await fs.copyFile(source, cible);
    await fs.rm(source, { force: true });
    return path.posix.join(dossierCible.split(path.sep).join("/"), nom);
  } catch (err) {
    console.error("[site] déplacement d'image impossible (non bloquant) :", err);
    return null;
  }
}

/**
 * Rattache au lead les simulations du site désignées (par identifiant) et
 * toutes celles du même parcours encore sans lead : chacune devient une
 * `Simulation` du lead, avec ses images. Renvoie les identifiants créés.
 */
export async function rattacherSimulationsSite(leadId: string, parcoursId: string | undefined, ids: string[] = []): Promise<string[]> {
  const ou = [ids.length ? { id: { in: ids } } : null, parcoursId ? { parcoursId } : null].filter(Boolean) as { id?: { in: string[] }; parcoursId?: string }[];
  if (ou.length === 0) return [];
  const candidates = await prisma.simulationSite.findMany({ where: { leadId: null, OR: ou }, orderBy: { createdAt: "asc" } });
  const creees: string[] = [];
  for (const s of candidates) {
    const references = JSON.parse(s.references || "[]") as ReferenceSimulee[];
    const simulation = await prisma.simulation.create({
      data: {
        leadId,
        source: "SITE_SIMULATEUR",
        referenceChoisie: s.referenceChoisie,
        notes: references.length ? references.map((r) => `${r.libelle} : ${r.ref} (${r.nom})`).join(" | ") : null,
      },
    });
    const dossier = path.join(leadId, simulation.id);
    const imageBeforePath = await deplacerImage(s.imageBeforePath, dossier, "before.jpg");
    const imageAfterPath = await deplacerImage(s.imageAfterPath, dossier, "after.png");
    await prisma.simulation.update({ where: { id: simulation.id }, data: { imageBeforePath, imageAfterPath } });
    await prisma.simulationSite.update({
      where: { id: s.id },
      data: { leadId, simulationId: simulation.id, rattacheeLe: new Date(), imageBeforePath: imageBeforePath ? null : s.imageBeforePath, imageAfterPath: imageAfterPath ? null : s.imageAfterPath },
    });
    creees.push(simulation.id);
  }
  return creees;
}

/** Purge des simulations jamais réclamées : images effacées, ligne archivée. Renvoie le nombre purgé. */
export async function purgerSimulationsSite(maintenant: Date = new Date()): Promise<number> {
  const limite = new Date(maintenant.getTime() - RETENTION_SANS_DEMANDE_MS);
  const perimees = await prisma.simulationSite.findMany({ where: { leadId: null, archiveLe: null, createdAt: { lt: limite } }, take: 200 });
  const base = resolveUploadsDir();
  for (const s of perimees) {
    for (const chemin of [s.imageBeforePath, s.imageAfterPath]) {
      if (chemin) await fs.rm(path.join(base, chemin), { force: true }).catch(() => undefined);
    }
    await fs.rm(path.join(base, DOSSIER_SITE, s.parcoursId, s.id), { recursive: true, force: true }).catch(() => undefined);
    await prisma.simulationSite.update({
      where: { id: s.id },
      data: { imageBeforePath: null, imageAfterPath: null, ipOrigine: null, archiveLe: maintenant, archiveMotif: "Sans demande de devis après 30 jours : images effacées" },
    });
  }
  return perimees.length;
}

let dernierePurge = 0;
/** Purge opportuniste, au plus une fois par heure, déclenchée par le trafic du simulateur. */
export async function purgerSiNecessaire(): Promise<void> {
  if (Date.now() - dernierePurge < 60 * 60 * 1000) return;
  dernierePurge = Date.now();
  try {
    const n = await purgerSimulationsSite();
    if (n > 0) console.log(`[site] ${pluriel(n, "simulation sans demande purgée", "simulations sans demande purgées")}`);
  } catch (err) {
    console.error("[site] purge impossible :", err);
  }
}
