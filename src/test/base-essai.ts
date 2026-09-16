/**
 * Bases d'essai des tests : jamais la base de développement, jamais la prod.
 *
 * Une base modèle au schéma courant est créée une fois (prisma db push dans le
 * dossier temporaire, clé = empreinte du schéma), puis chaque test en reçoit
 * une copie neuve. À appeler AVANT d'importer @/lib/prisma : le client lit
 * DATABASE_URL à sa création.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const RACINE = path.resolve(__dirname, "..", "..");
const SCHEMA = path.join(RACINE, "prisma", "schema.prisma");

function versUrl(fichier: string): string {
  return `file:${fichier.split(path.sep).join("/")}`;
}

function baseModele(): string {
  const empreinte = createHash("sha256").update(readFileSync(SCHEMA)).digest("hex").slice(0, 16);
  const dossier = path.join(tmpdir(), "coverswap-essais");
  mkdirSync(dossier, { recursive: true });
  const modele = path.join(dossier, `modele-${empreinte}.db`);
  if (existsSync(modele)) return modele;

  const provisoire = `${modele}.${process.pid}.tmp`;
  const prismaCli = createRequire(SCHEMA).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", SCHEMA], {
    env: { ...process.env, DATABASE_URL: versUrl(provisoire) },
    stdio: "pipe",
  });
  // Renommage atomique : deux fichiers de test lancés en parallèle ne lisent jamais une base à moitié créée.
  if (!existsSync(modele)) renameSync(provisoire, modele);
  return modele;
}

/** Copie neuve de la base modèle ; positionne DATABASE_URL et rend le chemin. */
export function preparerBaseEssai(): string {
  const dossier = mkdtempSync(path.join(tmpdir(), "coverswap-essai-"));
  const fichier = path.join(dossier, "essai.db");
  copyFileSync(baseModele(), fichier);
  process.env.DATABASE_URL = versUrl(fichier);
  delete process.env.TURSO_DATABASE_URL;
  process.env.SAUVEGARDES_DIR = path.join(dossier, "sauvegardes");
  return fichier;
}
