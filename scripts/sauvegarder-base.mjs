#!/usr/bin/env node
// Sauvegarde manuelle de la base : npm run base:sauvegarder [raison]
// (logique dans src/lib/base/sauvegarde.mjs)

import { sauvegarderBase } from "../src/lib/base/sauvegarde.mjs";

try {
  const resultat = await sauvegarderBase({ raison: process.argv[2] ?? "manuelle" });
  if ("ignoree" in resultat) console.log(`[sauvegarde] Ignorée : ${resultat.ignoree}.`);
  else console.log(`[sauvegarde] ${resultat.fichier} (${Math.round(resultat.octets / 1024)} Ko), intégrité vérifiée.`);
} catch (erreur) {
  console.error("[sauvegarde] Échec :", erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
}
