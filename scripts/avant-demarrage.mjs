#!/usr/bin/env node
// Lancé avant `prisma db push` (npm start, npm run base:pousser).
//
// 1. Le schéma de la base va-t-il changer ? (prisma migrate diff, lecture seule)
// 2. Si oui, ou si on ne peut pas le savoir : sauvegarde vérifiée. Si elle
//    échoue, arrêt : aucune migration sans sauvegarde.
// 3. Si oui : retrait des déclencheurs du journal. `db push` reconstruit
//    certaines tables (copie, suppression, renommage) et SQLite refuse ce
//    renommage tant qu'un déclencheur désigne une table en cours de
//    reconstruction. L'application les réinstalle à son démarrage, avant de
//    servir la moindre requête (src/instrumentation.ts).
//
// Pas de --accept-data-loss dans npm start : une modification du schéma qui
// détruirait des données fait échouer le démarrage au lieu de passer.

import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fichierDeLaBase, sauvegarderBase } from "../src/lib/base/sauvegarde.mjs";

const PREFIXES_DECLENCHEURS = ["journal_", "interdit_suppression_", "immuable_"];

function arreter(message) {
  console.error(`[demarrage] ${message}`);
  process.exit(1);
}

if (process.env.TURSO_DATABASE_URL) {
  console.warn(
    "[demarrage] TURSO_DATABASE_URL est définie : prisma db push ne modifiera pas la base Turso. " +
      "Le schéma doit y être appliqué séparément, sinon l'application refusera de démarrer."
  );
  process.exit(0);
}

const fichier = fichierDeLaBase();
if (!fichier) arreter("DATABASE_URL absente ou non SQLite.");
if (!existsSync(fichier)) {
  console.log(`[demarrage] ${fichier} n'existe pas encore : base neuve, rien à sauvegarder.`);
  process.exit(0);
}

const urlAbsolue = `file:${fichier.split(path.sep).join("/")}`;
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const diff = spawnSync(
  process.execPath,
  [prismaCli, "migrate", "diff", "--from-url", urlAbsolue, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
  { encoding: "utf8" }
);
const schemaChange = diff.status !== 0; // 0 : identique ; 2 : différent ; 1 ou autre : inconnu, donc prudence
if (diff.status === 0) {
  console.log("[demarrage] Schéma de la base à jour : ni sauvegarde ni retrait des déclencheurs.");
  process.exit(0);
}
if (diff.status === 2) {
  console.log(`[demarrage] Le schéma va changer :\n${diff.stdout.trim()}`);
} else {
  console.warn(`[demarrage] Comparaison du schéma impossible (code ${diff.status}) : sauvegarde par prudence.\n${diff.stderr}`);
}

try {
  const resultat = await sauvegarderBase({ raison: "avant-schema" });
  if ("ignoree" in resultat) console.log(`[demarrage] Sauvegarde ignorée : ${resultat.ignoree}.`);
  else console.log(`[demarrage] Sauvegarde ${resultat.fichier} (${Math.round(resultat.octets / 1024)} Ko), intégrité vérifiée.`);
} catch (erreur) {
  arreter(`Sauvegarde impossible, migration annulée : ${erreur instanceof Error ? erreur.message : erreur}`);
}

if (schemaChange) {
  const base = new PrismaClient({ datasources: { db: { url: urlAbsolue } } });
  try {
    const declencheurs = await base.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'trigger'");
    const aRetirer = declencheurs
      .map((ligne) => ligne.name)
      .filter((nom) => PREFIXES_DECLENCHEURS.some((prefixe) => nom.startsWith(prefixe)));
    if (aRetirer.length > 0) {
      await base.$transaction(aRetirer.map((nom) => base.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${nom.replace(/"/g, '""')}"`)));
    }
    console.log(`[demarrage] ${aRetirer.length} déclencheurs du journal retirés le temps de la migration.`);
  } catch (erreur) {
    arreter(`Retrait des déclencheurs impossible : ${erreur instanceof Error ? erreur.message : erreur}`);
  } finally {
    await base.$disconnect();
  }
}
