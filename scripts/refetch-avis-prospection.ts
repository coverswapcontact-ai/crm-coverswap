// ─────────────────────────────────────────────
// Re-récupération des avis Google des prospects existants.
// Utile après un changement de langue/format des avis stockés
// (ex. correctif languageCode=fr) ou pour rafraîchir des avis anciens.
// Usage : npm run prospection:avis-refresh           (tous les prospects)
//         npm run prospection:avis-refresh -- hotels (un seul agent)
// ─────────────────────────────────────────────
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

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
import { AGENT_SLUGS } from "../src/lib/prospection/constants";
import { fetchPlaceReviews } from "../src/lib/prospection/places";

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (slug && !(AGENT_SLUGS as readonly string[]).includes(slug)) {
    console.log("Usage : npm run prospection:avis-refresh [-- hotels|restaurants]");
    process.exitCode = 1;
    return;
  }

  const prospects = await prisma.prospect.findMany({
    where: slug ? { agentProfile: { slug } } : {},
    select: { id: true, googlePlaceId: true, nom: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(
    `Re-récupération des avis (fr) pour ${prospects.length} prospect(s)${slug ? ` — agent ${slug}` : ""}…\n`
  );

  let maj = 0;
  let vides = 0;
  let erreurs = 0;
  for (const p of prospects) {
    try {
      const avis = await fetchPlaceReviews(p.googlePlaceId);
      await prisma.prospect.update({
        where: { id: p.id },
        data: { avisBruts: JSON.stringify(avis) },
      });
      maj++;
      if (avis.length === 0) vides++;
      console.log(`[avis] ${p.nom} : ${avis.length} avis`);
    } catch (erreur) {
      erreurs++;
      console.warn(
        `[avis] ÉCHEC ${p.nom} : ${erreur instanceof Error ? erreur.message : erreur}`
      );
    }
  }

  console.log(
    `\n── Résultat : ${maj} mis à jour (${vides} sans avis), ${erreurs} échec(s) sur ${prospects.length}.`
  );
}

main()
  .catch((erreur) => {
    console.error("Échec :", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
