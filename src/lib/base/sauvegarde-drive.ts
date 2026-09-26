import { readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { creerDossierDrive, envoyerFichierDrive, lireElementDrive } from "@/lib/drive/client";
import { PORTEES_GOOGLE, connexionActive } from "@/lib/google/connexion";
import { mettreEnFile } from "@/lib/taches/file";
import { AttenteExterne, ErreurDefinitive, enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { chiffrerTampon, cleSauvegarde } from "./chiffrement-sauvegarde.mjs";
import { sauvegarderBase } from "./sauvegarde.mjs";

/**
 * Mission 13 (lot 2) — une copie de la base HORS de l'hébergeur, chaque
 * semaine : le volume Railway et ses sauvegardes disparaissent ensemble. La
 * copie vérifiée (VACUUM INTO + integrity_check) est compressée, chiffrée
 * (chiffrement-sauvegarde.mjs : AES-256-GCM, clé dérivée de GOOGLE_TOKEN_KEY ou
 * SAUVEGARDE_CLE) et envoyée dans un dossier Google Drive du compte connecté,
 * par une tâche de fond : Tâches de fond garde le bilan (nom, taille, identifiant
 * Drive). Rien n'est retiré de Drive : ≈ 3 Mo par semaine. Restaurer :
 * scripts/dechiffrer-sauvegarde.mjs.
 */
export const TYPE_TACHE_SAUVEGARDE_DRIVE = "SAUVEGARDE_DRIVE";
export const NOM_TRAVAIL_SAUVEGARDE_DRIVE = "sauvegarde-drive-hebdomadaire";
export const NOM_DOSSIER_DRIVE = "CoverSwap CRM — sauvegardes chiffrées";
const CLE_REGLAGE_DOSSIER = "SAUVEGARDE_DRIVE_DOSSIER_ID";
const ACTEUR = "SYSTEME:sauvegardes";

/** « 2026-S39 » : la semaine ISO, clé d'unicité de la tâche hebdomadaire. */
export function semaineIso(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semaine = Math.ceil(((d.getTime() - debutAnnee.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-S${String(semaine).padStart(2, "0")}`;
}

const baseLocale = () => Boolean(process.env.DATABASE_URL?.startsWith("file:")) && !process.env.TURSO_DATABASE_URL;

/** Le dossier Drive des sauvegardes : retrouvé par son identifiant gardé en base, recréé s'il a disparu (corbeille). */
async function dossierDrive(): Promise<string> {
  const reglage = await prisma.reglageTexte.findUnique({ where: { cle: CLE_REGLAGE_DOSSIER } });
  if (reglage?.valeur) {
    const element = await lireElementDrive(reglage.valeur).catch(() => null);
    if (element && !element.trashed) return element.id;
  }
  const id = await creerDossierDrive(NOM_DOSSIER_DRIVE, null);
  await prisma.reglageTexte.upsert({ where: { cle: CLE_REGLAGE_DOSSIER }, create: { cle: CLE_REGLAGE_DOSSIER, valeur: id, par: ACTEUR }, update: { valeur: id, par: ACTEUR } });
  return id;
}

export type BilanSauvegardeDrive = { nom: string; semaine: string; octetsBase: number; octetsEnvoyes: number; driveId: string; dossierDriveId: string };

/** Ce qui empêche la sauvegarde vers Drive, en une phrase ; null quand tout est prêt. */
export async function empechementSauvegardeDrive(): Promise<string | null> {
  if (!baseLocale()) return "Base non locale : rien à copier (Turso garde ses propres sauvegardes).";
  if (!cleSauvegarde()) return "Clé de chiffrement absente : poser SAUVEGARDE_CLE (32 octets en base64) ou GOOGLE_TOKEN_KEY sur Railway.";
  if (!(await connexionActive(PORTEES_GOOGLE.DRIVE))) return "Google Drive non connecté (Paramètres → Connexions).";
  return null;
}

/** Copie vérifiée → gzip → chiffrement → Drive. La copie locale intermédiaire est retirée ensuite (les quotidiennes restent). */
export async function sauvegardeVersDrive(maintenant: Date = new Date()): Promise<BilanSauvegardeDrive> {
  if (!baseLocale()) throw new ErreurDefinitive("Base non locale : rien à copier (Turso garde ses propres sauvegardes).");
  const cle = cleSauvegarde();
  if (!cle) throw new ErreurDefinitive("Clé de chiffrement absente : poser SAUVEGARDE_CLE (32 octets en base64) ou GOOGLE_TOKEN_KEY sur Railway.");
  if (!(await connexionActive(PORTEES_GOOGLE.DRIVE))) throw new AttenteExterne("Google Drive non connecté : la sauvegarde attend la reconnexion (Paramètres → Connexions).", 6 * 60 * 60_000);
  const copie = await sauvegarderBase({ raison: "drive" });
  if ("ignoree" in copie) throw new ErreurDefinitive(`Sauvegarde impossible : ${copie.ignoree}.`);
  try {
    const brut = readFileSync(/*turbopackIgnore: true*/ copie.fichier);
    const chiffre = chiffrerTampon(gzipSync(brut, { level: 6 }), cle);
    const semaine = semaineIso(maintenant);
    const nom = `crm-coverswap-${jourParis(maintenant)}-${semaine}.db.gz.chiffre`;
    const dossierDriveId = await dossierDrive();
    const driveId = await envoyerFichierDrive({ nom, type: "application/octet-stream", contenu: chiffre, parentId: dossierDriveId });
    console.log(`[sauvegarde] Drive : ${nom} envoyé (${(chiffre.length / 1024 / 1024).toFixed(1)} Mo chiffrés pour ${(brut.length / 1024 / 1024).toFixed(1)} Mo de base).`);
    return { nom, semaine, octetsBase: brut.length, octetsEnvoyes: chiffre.length, driveId, dossierDriveId };
  } finally {
    rmSync(/*turbopackIgnore: true*/ copie.fichier, { force: true });
  }
}

export function enregistrerTachesSauvegardeDrive(): void {
  enregistrerTraitement(TYPE_TACHE_SAUVEGARDE_DRIVE, {
    libelle: "Sauvegarde hebdomadaire chiffrée vers Google Drive",
    acteur: ACTEUR,
    tentativesMax: 4,
    delaiMaxMs: 10 * 60_000,
    executer: async () => sauvegardeVersDrive(),
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_SAUVEGARDE_DRIVE,
    libelle: "Sauvegarde hebdomadaire chiffrée vers Google Drive (une tâche par semaine, journalisée)",
    acteur: ACTEUR,
    intervalleMs: 6 * 60 * 60_000,
    estActif: async () => (await empechementSauvegardeDrive()) === null,
    executer: async () => {
      const semaine = semaineIso(new Date());
      await mettreEnFile({ type: TYPE_TACHE_SAUVEGARDE_DRIVE, cle: `sauvegarde-drive:${semaine}`, charge: { semaine }, priorite: -1 });
    },
  });
}
