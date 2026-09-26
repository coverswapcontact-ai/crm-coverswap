#!/usr/bin/env node
// Mission 13 (lot 2) — restaure une sauvegarde chiffrée envoyée sur Google Drive.
// Usage : GOOGLE_TOKEN_KEY=<la valeur de Railway> node scripts/dechiffrer-sauvegarde.mjs <fichier.db.gz.chiffre> [sortie.db]
// (ou SAUVEGARDE_CLE si elle a été posée). Rend la base SQLite en clair, prête pour DATABASE_URL=file:…
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { cleSauvegarde, dechiffrerTampon } from "../src/lib/base/chiffrement-sauvegarde.mjs";

const [entree, sortieDemandee] = process.argv.slice(2);
if (!entree) {
  console.error("Usage : node scripts/dechiffrer-sauvegarde.mjs <fichier.db.gz.chiffre> [sortie.db]");
  process.exit(2);
}
const cle = cleSauvegarde();
if (!cle) {
  console.error("Clé absente : poser SAUVEGARDE_CLE ou GOOGLE_TOKEN_KEY (32 octets en base64, la valeur de Railway).");
  process.exit(2);
}
const sortie = sortieDemandee ?? entree.replace(/\.db\.gz\.chiffre$/, "") + (entree.endsWith(".db.gz.chiffre") ? ".db" : ".dechiffre.db");
if (existsSync(sortie)) {
  console.error(`${sortie} existe déjà : rien n'est écrasé. Donne un autre nom de sortie.`);
  process.exit(2);
}
const clair = gunzipSync(dechiffrerTampon(readFileSync(entree), cle));
if (clair.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
  console.error("Le contenu déchiffré n'est pas une base SQLite : mauvaise clé ou fichier abîmé.");
  process.exit(1);
}
writeFileSync(sortie, clair);
console.log(`${sortie} écrit (${(clair.length / 1024 / 1024).toFixed(1)} Mo). Vérifier : sqlite3 "${sortie}" "PRAGMA integrity_check;"`);
