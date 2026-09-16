// Après `prisma db push` en local : réinstalle les déclencheurs du journal et
// passe les migrations de données, comme le fait le démarrage de l'application.
import { preparerBase } from "../src/lib/base/preparation";
import prisma from "../src/lib/prisma";

preparerBase()
  .catch((erreur) => {
    console.error("[base] Préparation impossible :", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
