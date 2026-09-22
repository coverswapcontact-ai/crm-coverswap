// Sauvegarde cohérente de la base SQLite, prise avant toute migration :
// - au démarrage en production, si le schéma va changer (scripts/avant-demarrage.mjs) ;
// - avant chaque migration de données (src/lib/base/preparation.ts) ;
// - à la main : npm run base:sauvegarder (scripts/sauvegarder-base.mjs).
// En JavaScript pur (sans attente de premier niveau) : importé à la fois par les
// scripts Node du démarrage et par l'application.
// VACUUM INTO produit une copie compacte et cohérente, dont l'intégrité est
// vérifiée avant de rendre la main.
//
// Aucune sauvegarde n'est jamais perdue. Le volume de production est petit
// (500 Mo) : le 22/09/2026, les copies accumulées l'ont rempli et la sauvegarde
// d'avant migration a échoué (« database or disk is full »). Désormais :
// - la copie s'écrit sous un nom provisoire (.partiel) et ne prend son nom
//   qu'une fois vérifiée ; une copie inachevée (disque plein) est retirée : ce
//   n'est pas une sauvegarde, la base qu'elle copiait est intacte ;
// - les sauvegardes plus anciennes que la dernière sont archivées compressées
//   (.db.gz, gzip) ; l'original n'est retiré qu'une fois l'archive relue et son
//   empreinte SHA-256 identique à la sienne. Pour restaurer : gunzip -k <fichier>.db.gz ;
//   disque plein au point de ne pas pouvoir écrire l'archive à côté : elle est
//   préparée et vérifiée en mémoire, puis écrite à la place de l'original ;
// - s'il n'y a toujours pas la place d'une copie, arrêt (aucune migration sans sauvegarde).
//
// Les commentaires turbopackIgnore empêchent Next de tracer tout le projet : ces
// chemins ne sont connus qu'à l'exécution.
//
// Variables : DATABASE_URL (file:…), SAUVEGARDES_DIR (optionnel),
//             TURSO_DATABASE_URL (si présente : base distante, pas de copie locale).

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gunzipSync, gzipSync } from "node:zlib";

/** Marge gardée libre en plus de la copie : journaux SQLite, écritures des migrations, dépôts de photos. */
const MARGE_OCTETS = 16 * 1024 * 1024;
const PARTIEL = ".partiel";

/**
 * Copies laissées par la sauvegarde qui a échoué le 22/09/2026 (disque plein), avant
 * que la copie ne s'écrive sous un nom provisoire. Retirées seulement si elles ne
 * s'ouvrent pas comme une base intègre.
 */
const ECHEC_DU_22_09 = /-avant-schema-2026-09-22T08-\d{2}-\d{2}-\d{3}Z\.db$/;

/** Chemin du fichier SQLite d'une URL Prisma « file: » (relative au dossier prisma/). */
export function fichierDeLaBase(url = process.env.DATABASE_URL) {
  if (!url || !url.startsWith("file:")) return null;
  const cheminBrut = url.slice("file:".length).split("?")[0];
  return path.isAbsolute(cheminBrut) ? cheminBrut : path.resolve(/*turbopackIgnore: true*/ process.cwd(), "prisma", cheminBrut);
}

const mo = (octets) => `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;

/** Place disponible sur le volume du dossier, en octets. */
export function placeLibre(dossier) {
  const s = statfsSync(/*turbopackIgnore: true*/ dossier);
  return Number(s.bavail) * Number(s.bsize);
}

/** Empreinte SHA-256 d'un fichier (de son contenu décompressé si `gz`). */
async function empreinte(chemin, gz = false) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(/*turbopackIgnore: true*/ chemin), ...(gz ? [createGunzip()] : []), hash);
  return hash.digest("hex");
}

/** La copie s'ouvre-t-elle comme une base intègre ? */
async function integre(chemin) {
  const copie = new PrismaClient({ datasources: { db: { url: `file:${chemin.split(path.sep).join("/")}` } } });
  try {
    const [verification] = await copie.$queryRawUnsafe("PRAGMA integrity_check");
    return verification?.integrity_check === "ok";
  } catch {
    return false;
  } finally {
    await copie.$disconnect();
  }
}

/**
 * Archive une sauvegarde en .db.gz : l'archive est écrite sous un nom provisoire,
 * relue, comparée à l'original par empreinte, synchronisée sur le disque ; alors
 * seulement l'original est retiré. En cas d'échec, l'original reste intact.
 */
export async function compresserSauvegarde(chemin) {
  const archive = `${chemin}.gz`;
  const provisoire = `${archive}${PARTIEL}`;
  try {
    await pipeline(createReadStream(/*turbopackIgnore: true*/ chemin), createGzip({ level: 6 }), createWriteStream(/*turbopackIgnore: true*/ provisoire));
    const [avant, apres] = await Promise.all([empreinte(chemin), empreinte(provisoire, true)]);
    if (avant !== apres) throw new Error(`archive de ${path.basename(chemin)} différente de l'original`);
    const fd = openSync(/*turbopackIgnore: true*/ provisoire, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(/*turbopackIgnore: true*/ provisoire, /*turbopackIgnore: true*/ archive);
  } catch (erreur) {
    rmSync(/*turbopackIgnore: true*/ provisoire, { force: true });
    if (erreur?.code === "ENOSPC") return compresserSurPlace(chemin);
    throw erreur;
  }
  rmSync(/*turbopackIgnore: true*/ chemin);
  return archive;
}

const sha256 = (octets) => createHash("sha256").update(octets).digest("hex");

/**
 * Disque plein (pas même la place de l'archive à côté de l'original) : l'archive est
 * préparée et vérifiée en mémoire, l'original retiré, l'archive écrite à sa place,
 * synchronisée, relue et comparée. Si l'écriture échoue malgré la place libérée,
 * l'original est réécrit tel quel.
 */
export function compresserSurPlace(chemin) {
  const archive = `${chemin}.gz`;
  const original = readFileSync(/*turbopackIgnore: true*/ chemin);
  const attendue = sha256(original);
  const compresse = gzipSync(original, { level: 6 });
  if (sha256(gunzipSync(compresse)) !== attendue) throw new Error(`archive de ${path.basename(chemin)} différente de l'original`);
  rmSync(/*turbopackIgnore: true*/ chemin);
  try {
    writeFileSync(/*turbopackIgnore: true*/ archive, compresse);
    const fd = openSync(/*turbopackIgnore: true*/ archive, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (sha256(gunzipSync(readFileSync(/*turbopackIgnore: true*/ archive))) !== attendue) throw new Error(`archive de ${path.basename(chemin)} relue différente`);
  } catch (erreur) {
    rmSync(/*turbopackIgnore: true*/ archive, { force: true });
    writeFileSync(/*turbopackIgnore: true*/ chemin, original);
    throw erreur;
  }
  console.log(`[sauvegarde] Disque plein : ${path.basename(chemin)} archivée en mémoire puis écrite à sa place (${mo(original.length)} → ${mo(compresse.length)}).`);
  return archive;
}

/** Les sauvegardes non compressées du dossier, de la plus ancienne à la plus récente. */
function copiesNonCompressees(dossier) {
  return readdirSync(/*turbopackIgnore: true*/ dossier)
    .filter((nom) => nom.endsWith(".db"))
    .map((nom) => path.join(/*turbopackIgnore: true*/ dossier, nom))
    .map((chemin) => ({ chemin, le: statSync(/*turbopackIgnore: true*/ chemin).mtimeMs }))
    .sort((a, b) => a.le - b.le)
    .map((c) => c.chemin);
}

/** Retire les copies inachevées : fichiers provisoires, et celles de l'échec du 22/09 qui ne s'ouvrent pas. */
async function retirerCopiesInachevees(dossier) {
  const retirees = [];
  for (const nom of readdirSync(/*turbopackIgnore: true*/ dossier)) {
    const chemin = path.join(/*turbopackIgnore: true*/ dossier, nom);
    const inachevee = nom.endsWith(PARTIEL) || (ECHEC_DU_22_09.test(nom) && (statSync(/*turbopackIgnore: true*/ chemin).size === 0 || !(await integre(chemin))));
    if (inachevee) {
      rmSync(/*turbopackIgnore: true*/ chemin, { force: true });
      retirees.push(nom);
    }
  }
  if (retirees.length) console.log(`[sauvegarde] Copies inachevées retirées (disque plein, jamais valides) : ${retirees.join(", ")}`);
}

/** Taille d'un fichier ou d'un dossier (récursive). */
function taille(chemin) {
  const s = statSync(/*turbopackIgnore: true*/ chemin);
  if (!s.isDirectory()) return s.size;
  return readdirSync(/*turbopackIgnore: true*/ chemin).reduce((t, nom) => t + taille(path.join(/*turbopackIgnore: true*/ chemin, nom)), 0);
}

/** Ce qui occupe le volume de la base : chaque entrée de son dossier (noms de premier niveau seulement). */
function bilanDuVolume(dossierBase) {
  try {
    const entrees = readdirSync(/*turbopackIgnore: true*/ dossierBase)
      .map((nom) => ({ nom, octets: taille(path.join(/*turbopackIgnore: true*/ dossierBase, nom)) }))
      .sort((a, b) => b.octets - a.octets);
    return `${entrees.map((e) => `${e.nom} ${mo(e.octets)}`).join(", ")} ; ${mo(placeLibre(dossierBase))} libres`;
  } catch (erreur) {
    return `illisible (${erreur instanceof Error ? erreur.message : erreur})`;
  }
}

/** Une ligne sur l'occupation : base, sauvegardes, place libre. */
function bilan(dossier, fichier) {
  const noms = readdirSync(/*turbopackIgnore: true*/ dossier);
  const octets = noms.reduce((s, nom) => s + statSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dossier, nom)).size, 0);
  const archives = noms.filter((nom) => nom.endsWith(".gz")).length;
  return `base ${mo(statSync(/*turbopackIgnore: true*/ fichier).size)}, ${noms.length} sauvegarde(s) dont ${archives} compressée(s) (${mo(octets)}), ${mo(placeLibre(dossier))} libres`;
}

/**
 * Fait la place d'une copie de `besoin` octets : retire les copies inachevées, puis
 * archive compressées les sauvegardes les plus anciennes tant que la place manque.
 * `libre` est remplaçable pour les essais.
 */
export async function assurerPlace(dossier, besoin, libre = placeLibre) {
  await retirerCopiesInachevees(dossier);
  if (libre(dossier) >= besoin) return;
  console.log(`[sauvegarde] Place à faire (${mo(besoin)} pour la copie) ; volume : ${bilanDuVolume(path.dirname(/*turbopackIgnore: true*/ dossier))}.`);
  for (const chemin of copiesNonCompressees(dossier)) {
    await compresserSauvegarde(chemin);
    if (libre(dossier) >= besoin) return;
  }
  throw new Error(`place insuffisante sur le volume : ${mo(libre(dossier))} libres pour une copie de ${mo(besoin)}, toutes les sauvegardes déjà compressées`);
}

/**
 * @param {{ raison?: string, url?: string, libre?: (dossier: string) => number }} [options]
 * @returns {Promise<{ fichier: string, octets: number } | { ignoree: string }>}
 *          Lève une erreur si la copie échoue ou n'est pas intègre.
 */
export async function sauvegarderBase({ raison = "manuelle", url = process.env.DATABASE_URL, libre = placeLibre } = {}) {
  if (process.env.TURSO_DATABASE_URL) {
    return { ignoree: "base Turso distante : s'appuyer sur les sauvegardes de Turso" };
  }
  const fichier = fichierDeLaBase(url);
  if (!fichier) throw new Error("DATABASE_URL absente ou non SQLite : sauvegarde impossible");
  if (!existsSync(/*turbopackIgnore: true*/ fichier)) return { ignoree: `${fichier} n'existe pas encore` };

  const dossier = process.env.SAUVEGARDES_DIR ?? path.join(/*turbopackIgnore: true*/ path.dirname(/*turbopackIgnore: true*/ fichier), "sauvegardes");
  mkdirSync(/*turbopackIgnore: true*/ dossier, { recursive: true });
  await assurerPlace(dossier, statSync(/*turbopackIgnore: true*/ fichier).size + MARGE_OCTETS, libre);

  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  const motif = raison.replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
  const cible = path.join(/*turbopackIgnore: true*/ dossier, `${path.basename(/*turbopackIgnore: true*/ fichier, path.extname(fichier))}-${motif}-${horodatage}.db`);
  const provisoire = `${cible}${PARTIEL}`;

  try {
    const base = new PrismaClient({ datasources: { db: { url: `file:${fichier.split(path.sep).join("/")}` } } });
    try {
      await base.$executeRawUnsafe(`VACUUM INTO '${provisoire.split(path.sep).join("/").replace(/'/g, "''")}'`);
    } finally {
      await base.$disconnect();
    }
    if (!(await integre(provisoire))) throw new Error(`copie ${cible} corrompue (PRAGMA integrity_check)`);
    renameSync(/*turbopackIgnore: true*/ provisoire, /*turbopackIgnore: true*/ cible);
  } catch (erreur) {
    // Une copie inachevée n'est pas une sauvegarde : elle ne doit pas occuper le volume.
    rmSync(/*turbopackIgnore: true*/ provisoire, { force: true });
    throw erreur;
  }

  // Les précédentes rejoignent les archives compressées : le volume garde la place de la suivante.
  for (const ancienne of copiesNonCompressees(dossier).filter((chemin) => chemin !== cible)) {
    await compresserSauvegarde(ancienne).catch((erreur) => console.warn(`[sauvegarde] ${path.basename(ancienne)} non compressée : ${erreur instanceof Error ? erreur.message : erreur}`));
  }
  console.log(`[sauvegarde] Volume : ${bilan(dossier, fichier)}.`);
  return { fichier: cible, octets: statSync(/*turbopackIgnore: true*/ cible).size };
}
