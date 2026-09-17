// Seed du module Prospection — idempotent, ne touche à rien d'autre.
// Usage : npm run db:seed:prospection  (ou npx tsx prisma/seed-prospection.ts)
// Les agents sont aussi créés au démarrage de l'application s'ils manquent
// (migration de données « 2026-09-17-agents-prospection »).
import prisma from "../src/lib/prisma";
import { assurerAgentsProspection } from "../src/lib/prospection/agents";

assurerAgentsProspection(prisma)
  .then((crees) => console.log(`✔ ${crees} agent(s) de prospection créé(s)`))
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
