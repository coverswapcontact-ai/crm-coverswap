import { Prisma } from "@prisma/client";
import {
  MAINTENANT_MS,
  MODELES_HORS_JOURNAL,
  TABLE_JOURNAL,
  expressionIdentifiant,
  expressionJson,
  ident,
  nomTable,
  texte,
} from "@/lib/journal/declencheurs";
import type { MigrationDonnees } from "./index";

/**
 * Photographie de départ : chaque enregistrement qui n'a encore aucune ligne
 * au journal y entre tel quel (opération ETAT_INITIAL). L'état de n'importe
 * quel enregistrement à n'importe quelle date se lit ensuite dans le journal
 * seul, sans dépendre de ce qui précédait son installation.
 */
export const journalEtatInitial: MigrationDonnees = {
  nom: "2026-09-16-journal-etat-initial",
  description: "Photographie de départ de toutes les tables dans le journal",
  async executer(client) {
    const resume: Record<string, number> = {};
    for (const modele of Prisma.dmmf.datamodel.models) {
      if (MODELES_HORS_JOURNAL.has(modele.name)) continue;
      const identifiant = expressionIdentifiant(modele, "t");
      const lignes = await client.$executeRawUnsafe(`
        INSERT INTO ${ident(TABLE_JOURNAL)} ("id", "horodatage", "modele", "enregistrementId", "operation", "acteur", "origine", "apres")
        SELECT lower(hex(randomblob(16))), ${MAINTENANT_MS}, ${texte(modele.name)}, ${identifiant}, 'ETAT_INITIAL',
               ${texte(`MIGRATION:${journalEtatInitial.nom}`)}, 'demarrage', ${expressionJson(modele, "t")}
        FROM ${ident(nomTable(modele))} AS t
        WHERE NOT EXISTS (
          SELECT 1 FROM ${ident(TABLE_JOURNAL)} AS j
          WHERE j."modele" = ${texte(modele.name)} AND j."enregistrementId" = ${identifiant}
        )`);
      if (lignes > 0) resume[modele.name] = lignes;
    }
    return resume;
  },
};
