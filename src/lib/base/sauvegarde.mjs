// Sauvegarde cohérente de la base SQLite, prise avant toute migration :
// - au démarrage en production, si le schéma va changer (scripts/avant-demarrage.mjs) ;
// - avant chaque migration de données (src/lib/base/preparation.ts) ;
// - à la main : npm run base:sauvegarder (scripts/sauvegarder-base.mjs).
// En JavaScript pur (sans attente de premier niveau) : importé à la fois par les
// scripts Node du démarrage et par l'application.
// VACUUM INTO produit une copie compacte et cohérente, dont l'intégrité est
// vérifiée avant de rendre la main. Aucune sauvegarde n'est jamais effacée ici.
//
// Variables : DATABASE_URL (file:…), SAUVEGARDES_DIR (optionnel),
//             TURSO_DATABASE_URL (si présente : base distante, pas de copie locale).

import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

/** Chemin du fichier SQLite d'une URL Prisma « file: » (relative au dossier prisma/). */
export function fichierDeLaBase(url = process.env.DATABASE_URL) {
  if (!url || !url.startsWith("file:")) return null;
  const cheminBrut = url.slice("file:".length).split("?")[0];
  return path.isAbsolute(cheminBrut) ? cheminBrut : path.resolve("prisma", cheminBrut);
}

/**
 * @param {{ raison?: string, url?: string }} [options]
 * @returns {Promise<{ fichier: string, octets: number } | { ignoree: string }>}
 *          Lève une erreur si la copie échoue ou n'est pas intègre.
 */
export async function sauvegarderBase({ raison = "manuelle", url = process.env.DATABASE_URL } = {}) {
  if (process.env.TURSO_DATABASE_URL) {
    return { ignoree: "base Turso distante : s'appuyer sur les sauvegardes de Turso" };
  }
  const fichier = fichierDeLaBase(url);
  if (!fichier) throw new Error("DATABASE_URL absente ou non SQLite : sauvegarde impossible");
  if (!existsSync(fichier)) return { ignoree: `${fichier} n'existe pas encore` };

  const dossier = process.env.SAUVEGARDES_DIR ?? path.join(path.dirname(fichier), "sauvegardes");
  mkdirSync(dossier, { recursive: true });
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  const motif = raison.replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
  const cible = path.join(dossier, `${path.basename(fichier, path.extname(fichier))}-${motif}-${horodatage}.db`);
  const cibleUrl = cible.split(path.sep).join("/");

  const base = new PrismaClient({ datasources: { db: { url: `file:${fichier.split(path.sep).join("/")}` } } });
  try {
    await base.$executeRawUnsafe(`VACUUM INTO '${cibleUrl.replace(/'/g, "''")}'`);
  } finally {
    await base.$disconnect();
  }

  const copie = new PrismaClient({ datasources: { db: { url: `file:${cibleUrl}` } } });
  try {
    const [verification] = await copie.$queryRawUnsafe("PRAGMA integrity_check");
    if (verification?.integrity_check !== "ok") {
      throw new Error(`copie ${cible} corrompue (${JSON.stringify(verification)})`);
    }
  } finally {
    await copie.$disconnect();
  }
  return { fichier: cible, octets: statSync(cible).size };
}
