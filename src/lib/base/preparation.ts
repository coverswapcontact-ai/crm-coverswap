import { Prisma } from "@prisma/client";
import prisma, { type BaseDonnees } from "@/lib/prisma";
import { avecActeur } from "@/lib/journal/contexte";
import { PREFIXES_DECLENCHEURS, ident, nomTable, texte, tousLesDeclencheurs, type ModeleSql } from "@/lib/journal/declencheurs";
import { MIGRATIONS_DONNEES } from "./migrations";
import { sauvegarderBase } from "./sauvegarde.mjs";

const MODELES: readonly ModeleSql[] = Prisma.dmmf.datamodel.models;

export class SchemaIncomplet extends Error {
  constructor(manques: string[]) {
    super(
      `La base n'a pas le schéma attendu par l'application (${manques.join(", ")}). ` +
        "Appliquer le schéma (npm run base:pousser en local ; en production, npm start s'en charge) avant de démarrer."
    );
    this.name = "SchemaIncomplet";
  }
}

/** Chaque table et chaque colonne du schéma Prisma existent-elles en base ? */
export async function verifierSchema(client: BaseDonnees = prisma): Promise<void> {
  const manques: string[] = [];
  for (const modele of MODELES) {
    const table = nomTable(modele);
    const lignes = await client.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM pragma_table_info(${texte(table)})`);
    if (lignes.length === 0) {
      manques.push(`table ${table}`);
      continue;
    }
    const presentes = new Set(lignes.map((ligne) => ligne.name));
    for (const champ of modele.fields) {
      if (champ.kind !== "scalar" && champ.kind !== "enum") continue;
      const colonne = champ.dbName ?? champ.name;
      if (!presentes.has(colonne)) manques.push(`colonne ${table}.${colonne}`);
    }
  }
  if (manques.length > 0) throw new SchemaIncomplet(manques);
}

/**
 * (Ré)installe les déclencheurs du journal, dans une seule transaction :
 * retire ceux de la couche qui ne correspondent plus au schéma, recrée les
 * autres, puis vérifie qu'ils sont tous là. Idempotent.
 */
export async function installerDeclencheurs(client: BaseDonnees = prisma): Promise<number> {
  const attendus = tousLesDeclencheurs(MODELES);
  const existants = await client.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'trigger'"
  );
  const aRetirer = existants
    .map((ligne) => ligne.name)
    .filter((nom) => PREFIXES_DECLENCHEURS.some((prefixe) => nom.startsWith(prefixe)));

  await client.$transaction([
    ...aRetirer.map((nom) => client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${ident(nom)}`)),
    ...attendus.map((declencheur) => client.$executeRawUnsafe(declencheur.sql)),
  ]);

  const installes = new Set(
    (await client.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map(
      (ligne) => ligne.name
    )
  );
  const absents = attendus.filter((declencheur) => !installes.has(declencheur.nom));
  if (absents.length > 0) {
    throw new Error(`Déclencheurs du journal non installés : ${absents.map((declencheur) => declencheur.nom).join(", ")}`);
  }
  return attendus.length;
}

/**
 * Exécute, dans l'ordre, les migrations de données pas encore passées. Une
 * sauvegarde vérifiée précède la première ; chaque migration est idempotente
 * (rejouable si le démarrage s'interrompt avant son enregistrement).
 */
export async function executerMigrationsDonnees(client: BaseDonnees = prisma): Promise<string[]> {
  const faites = new Set((await client.migrationDonnees.findMany({ select: { nom: true } })).map((ligne) => ligne.nom));
  const enAttente = MIGRATIONS_DONNEES.filter((migration) => !faites.has(migration.nom));
  if (enAttente.length === 0) return [];

  const sauvegarde = await sauvegarderBase({ raison: `avant-${enAttente[0].nom}` });
  console.log(
    "ignoree" in sauvegarde
      ? `[base] Sauvegarde avant migration ignorée : ${sauvegarde.ignoree}.`
      : `[base] Sauvegarde avant migration : ${sauvegarde.fichier}`
  );

  for (const migration of enAttente) {
    const debut = Date.now();
    const resume = await avecActeur({ acteur: `MIGRATION:${migration.nom}`, origine: "demarrage" }, () =>
      migration.executer(client)
    );
    await avecActeur({ acteur: `MIGRATION:${migration.nom}`, origine: "demarrage" }, () =>
      client.migrationDonnees.create({
        data: { nom: migration.nom, executeeLe: new Date(), dureeMs: Date.now() - debut, resume: JSON.stringify(resume) },
      })
    );
    console.log(`[base] Migration de données « ${migration.nom} » : ${JSON.stringify(resume)}`);
  }
  return enAttente.map((migration) => migration.nom);
}

/** Au démarrage, avant de servir la moindre requête (src/instrumentation.ts). */
export async function preparerBase(client: BaseDonnees = prisma): Promise<void> {
  const debut = Date.now();
  await verifierSchema(client);
  const declencheurs = await installerDeclencheurs(client);
  const migrations = await executerMigrationsDonnees(client);
  console.log(
    `[base] Prête en ${Date.now() - debut} ms : ${declencheurs} déclencheurs du journal, ` +
      `${migrations.length} migration(s) de données exécutée(s).`
  );
}
