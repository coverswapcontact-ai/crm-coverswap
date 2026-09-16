import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { resoudreContexte } from "./acteur";
import { InjecteurEcriture, SuppressionInterdite } from "./injection";
import { traduireRefus } from "./refus";

const OPERATIONS_ECRITURE = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert"]);
// findUnique n'y est pas : un lien direct vers un enregistrement archivé doit l'afficher (« archivé le … »).
const OPERATIONS_LISTE = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);

const MODELES = Prisma.dmmf.datamodel.models;
const injecteur = new InjecteurEcriture(MODELES);
const MODELES_ARCHIVABLES = new Set(
  MODELES.filter((modele) => modele.fields.some((champ) => champ.name === "archiveLe")).map((modele) => modele.name)
);

/**
 * À étaler dans un `where` pour lire aussi les enregistrements archivés :
 * `prisma.lead.findMany({ where: { ...AVEC_ARCHIVES, ville } })`.
 */
export const AVEC_ARCHIVES = { archiveLe: undefined } as const;

function mentionneArchive(where: unknown): boolean {
  if (typeof where !== "object" || where === null) return false;
  if ("archiveLe" in where) return true;
  const composes = ["AND", "OR", "NOT"].flatMap((cle) => {
    const valeur = (where as Record<string, unknown>)[cle];
    return Array.isArray(valeur) ? valeur : valeur ? [valeur] : [];
  });
  return composes.some(mentionneArchive);
}

/**
 * La couche unique par laquelle passent toutes les lectures et écritures Prisma :
 * - chaque écriture (imbriquées comprises) porte son auteur, son origine et un
 *   jeton propre dans la colonne `ecriture`, que les déclencheurs SQLite
 *   recopient dans le journal ;
 * - delete et deleteMany sont refusés avant même d'atteindre la base (qui les
 *   refuserait aussi) : rien ne se supprime, on archive ;
 * - un refus de la base (document émis, registre, journal…) remonte avec son
 *   message en français (voir refus.ts) ;
 * - les listes et les comptes ignorent les enregistrements archivés, sauf si la
 *   requête parle elle-même de `archiveLe` (voir AVEC_ARCHIVES).
 */
export const extensionJournal = Prisma.defineExtension({
  name: "journal",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (operation === "delete" || operation === "deleteMany") throw new SuppressionInterdite(model);

        if (OPERATIONS_LISTE.has(operation) && MODELES_ARCHIVABLES.has(model)) {
          const actuels = (args ?? {}) as { where?: Record<string, unknown> };
          if (!mentionneArchive(actuels.where)) {
            return query({ ...actuels, where: { ...actuels.where, archiveLe: null } } as typeof args);
          }
          return query(args);
        }

        if (!OPERATIONS_ECRITURE.has(operation)) return query(args);
        const ecriture = await ecritureCourante();
        try {
          return await query(injecteur.injecter(model, operation, args, ecriture) as typeof args);
        } catch (erreur) {
          throw traduireRefus(erreur, model, operation, args);
        }
      },
    },
    // SQL brut : le refus d'un déclencheur garde son message, en français.
    async $executeRaw({ args, query }) {
      try {
        return await query(args);
      } catch (erreur) {
        throw traduireRefus(erreur);
      }
    },
    async $executeRawUnsafe({ args, query }) {
      try {
        return await query(args);
      } catch (erreur) {
        throw traduireRefus(erreur);
      }
    },
    async $queryRaw({ args, query }) {
      try {
        return await query(args);
      } catch (erreur) {
        throw traduireRefus(erreur);
      }
    },
    async $queryRawUnsafe({ args, query }) {
      try {
        return await query(args);
      } catch (erreur) {
        throw traduireRefus(erreur);
      }
    },
  },
});

/** Valeur de `ecriture` pour une écriture en SQL brut (le journal l'attribue alors correctement). */
export async function ecritureCourante(): Promise<string> {
  const contexte = await resoudreContexte();
  return JSON.stringify({
    acteur: contexte.acteur,
    jeton: randomUUID(),
    origine: contexte.origine ?? null,
    requete: contexte.requete ?? null,
  });
}
