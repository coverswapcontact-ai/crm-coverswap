// ─────────────────────────────────────────────
// Sourcing en ligne de commande — module Prospection
// Permet de tester le pipeline SANS lancer le serveur Next (léger pour la machine).
// Usage : npm run prospection:sourcing -- hotels
//         npm run prospection:sourcing -- restaurants --max=10
// ─────────────────────────────────────────────
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// Next charge .env/.env.local tout seul ; en CLI il faut le faire nous-mêmes.
// Ne réécrase jamais une variable déjà présente dans l'environnement.
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
import { sourceProspects } from "../src/lib/prospection/sourcing";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const argMax = args.find((a) => a.startsWith("--max="));
  const maxNouveaux = argMax ? parseInt(argMax.split("=")[1], 10) : undefined;

  if (!slug || !(AGENT_SLUGS as readonly string[]).includes(slug)) {
    console.log("Usage : npm run prospection:sourcing -- <hotels|restaurants> [--max=60]");
    process.exitCode = slug ? 1 : 0;
    return;
  }
  if (argMax && (!Number.isInteger(maxNouveaux) || (maxNouveaux as number) < 1)) {
    console.error("--max doit être un entier positif, ex. --max=10");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Sourcing "${slug}" — plafond ${maxNouveaux ?? 60} nouveaux (Ctrl+C pour interrompre)…\n`
  );
  const resultat = await sourceProspects(slug as AgentSlug, { maxNouveaux });

  console.log("\n── Résultat ──");
  console.log(JSON.stringify(resultat, null, 2));
}

main()
  .catch((erreur) => {
    console.error("Échec du sourcing :", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
