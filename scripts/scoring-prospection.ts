// ─────────────────────────────────────────────
// Scoring en ligne de commande — module Prospection
// 100 % local (SQLite uniquement, aucune API externe ni LLM).
// Usage : npm run prospection:scoring -- hotels
//         npm run prospection:scoring -- restaurants --limit=10
//         npm run prospection:scoring -- hotels --rescore   (rescorer QUALIFIE/ECARTE)
// ─────────────────────────────────────────────
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// Next charge .env/.env.local tout seul ; en CLI il faut le faire nous-mêmes.
function chargerEnv(nomFichier: string): void {
  const chemin = resolve(process.cwd(), nomFichier);
  if (!existsSync(chemin)) return;
  for (const ligne of readFileSync(chemin, "utf8").split(/\r?\n/)) {
    const propre = ligne.trim();
    if (!propre || propre.startsWith("#")) continue;
    const egal = propre.indexOf("=");
    if (egal === -1) continue;
    const cle = propre.slice(0, egal).trim();
    let valeur = propre.slice(egal + 1).trim();
    if (
      (valeur.startsWith('"') && valeur.endsWith('"')) ||
      (valeur.startsWith("'") && valeur.endsWith("'"))
    ) {
      valeur = valeur.slice(1, -1);
    }
    if (!(cle in process.env)) process.env[cle] = valeur;
  }
}
chargerEnv(".env");
chargerEnv(".env.local");

import prisma from "../src/lib/prisma";
import { AGENT_SLUGS, type AgentSlug } from "../src/lib/prospection/constants";
import { scoreProspects } from "../src/lib/prospection/scoring";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const argLimit = args.find((a) => a.startsWith("--limit="));
  const limit = argLimit ? parseInt(argLimit.split("=")[1], 10) : undefined;
  const rescore = args.includes("--rescore");

  if (!slug || !(AGENT_SLUGS as readonly string[]).includes(slug)) {
    console.log(
      "Usage : npm run prospection:scoring -- <hotels|restaurants> [--limit=N] [--rescore]"
    );
    process.exitCode = slug ? 1 : 0;
    return;
  }
  if (argLimit && (!Number.isInteger(limit) || (limit as number) < 1)) {
    console.error("--limit doit être un entier positif, ex. --limit=10");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Scoring "${slug}" — ${rescore ? "rescoring complet (SOURCE + déjà scorés)" : "statut SOURCE uniquement"}…\n`
  );
  const resultat = await scoreProspects(slug as AgentSlug, {
    limit,
    inclureDejaScores: rescore,
  });

  console.log("\n── Résultat ──");
  console.log(JSON.stringify(resultat, null, 2));
}

main()
  .catch((erreur) => {
    console.error("Échec du scoring :", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
