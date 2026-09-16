/**
 * Déclencheurs SQLite du journal, générés depuis le schéma Prisma (DMMF).
 *
 * Pour chaque table :
 * - AFTER INSERT / AFTER UPDATE : une ligne dans JournalModification avec
 *   l'enregistrement complet avant et après (JSON), l'auteur et l'origine lus
 *   dans la colonne `ecriture` ;
 * - BEFORE DELETE : refus. Rien ne se supprime, on archive (archiveLe).
 *
 * Parce qu'ils vivent dans la base, aucune écriture ne leur échappe : ni une
 * route oubliée, ni un script, ni du SQL brut. Une écriture passée hors de la
 * couche Prisma garde l'ancienne valeur de `ecriture` : elle est journalisée
 * avec l'acteur « INCONNU:hors-couche ».
 *
 * `prisma db push` supprime les déclencheurs des tables qu'il reconstruit : ils
 * sont réinstallés à chaque démarrage (src/lib/base/preparation.ts).
 */

export type ModeleSql = {
  name: string;
  dbName?: string | null;
  primaryKey?: { fields: readonly string[] } | null;
  fields: readonly {
    name: string;
    dbName?: string | null;
    kind: string;
    isId?: boolean;
    isUpdatedAt?: boolean;
  }[];
};

export type Declencheur = { nom: string; sql: string };

export const TABLE_JOURNAL = "JournalModification";

/**
 * Modèles écrits en rafale par la mécanique interne, dont l'historique complet
 * n'apporte rien et noierait le journal. Leurs suppressions restent refusées.
 * Chaque ajout ici se justifie dans docs/ARCHITECTURE-PILOTAGE.md.
 */
export const MODELES_HORS_JOURNAL: ReadonlySet<string> = new Set([
  TABLE_JOURNAL,
  // File de tâches et travaux périodiques : leurs lignes sont déjà un historique
  // d'exécution (tentatives, erreurs, résultat) ; les effets des tâches, eux, sont journalisés.
  "Tache",
  "Planification",
]);

/**
 * Modèles dont une ligne, une fois écrite, ne se modifie plus (la base le
 * refuse) : un consentement se retire par une nouvelle déclaration, un
 * instantané mensuel ne se recalcule pas. Seules les colonnes listées peuvent
 * encore changer (rattachement à la fiche conservée lors d'une fusion).
 */
export const MODELES_IMMUABLES: ReadonlyMap<string, readonly string[]> = new Map([
  ["ConsentementMail", ["clientId", "ecriture"]],
  ["Parametre", ["ecriture"]],
]);

/** Préfixes de nom : tout déclencheur ainsi nommé appartient à cette couche. */
export const PREFIXES_DECLENCHEURS = ["journal_", "interdit_suppression_", "immuable_"] as const;

// Au-delà, json_object dépasserait la limite d'arguments de SQLite (127 par défaut).
const COLONNES_PAR_BLOC = 50;

export const MAINTENANT_MS = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000.0) AS INTEGER)";

export function ident(nom: string): string {
  return `"${nom.replace(/"/g, '""')}"`;
}

export function texte(valeur: string): string {
  return `'${valeur.replace(/'/g, "''")}'`;
}

export function nomTable(modele: ModeleSql): string {
  return modele.dbName ?? modele.name;
}

function colonnes(modele: ModeleSql) {
  return modele.fields
    .filter((champ) => champ.kind === "scalar" || champ.kind === "enum")
    .map((champ) => ({ nom: champ.dbName ?? champ.name, champ: champ.name, isUpdatedAt: champ.isUpdatedAt ?? false }));
}

export function expressionIdentifiant(modele: ModeleSql, alias: string): string {
  const champs = modele.primaryKey?.fields.length
    ? [...modele.primaryKey.fields]
    : modele.fields.filter((champ) => champ.isId).map((champ) => champ.name);
  if (champs.length === 0) throw new Error(`Modèle ${modele.name} sans clé primaire : journal impossible`);
  const nomsDb = champs.map((nom) => modele.fields.find((champ) => champ.name === nom)?.dbName ?? nom);
  return nomsDb.map((nom) => `CAST(${alias}.${ident(nom)} AS TEXT)`).join(" || ':' || ");
}

/** JSON de la ligne entière ; au-delà d'un bloc, les objets sont concaténés. */
export function expressionJson(modele: ModeleSql, alias: string): string {
  const liste = colonnes(modele);
  const blocs: string[] = [];
  for (let debut = 0; debut < liste.length; debut += COLONNES_PAR_BLOC) {
    const bloc = liste.slice(debut, debut + COLONNES_PAR_BLOC);
    blocs.push(`json_object(${bloc.map((colonne) => `${texte(colonne.champ)}, ${alias}.${ident(colonne.nom)}`).join(", ")})`);
  }
  if (blocs.length === 1) return blocs[0];
  // json_object rend « {…} » : on retire les accolades de chaque bloc et on recolle.
  return `'{' || ${blocs.map((bloc) => `substr(${bloc}, 2, length(${bloc}) - 2)`).join(" || ',' || ")} || '}'`;
}

function champEcriture(cle: "acteur" | "jeton" | "origine" | "requete", condition: string | null, repli: string): string {
  if (condition === null) return repli;
  return `CASE WHEN ${condition} THEN coalesce(json_extract(NEW."ecriture", '$.${cle}'), ${repli}) ELSE ${repli} END`;
}

/** `conditionEcriture` : quand lire la colonne `ecriture` ; null si le modèle ne la porte pas. */
function insertionJournal(modele: ModeleSql, operation: string, avant: string, conditionEcriture: string | null): string {
  const acteurRepli = texte("INCONNU:hors-couche");
  return `INSERT INTO ${ident(TABLE_JOURNAL)} ("id", "horodatage", "modele", "enregistrementId", "operation", "acteur", "jeton", "origine", "requete", "avant", "apres")
  VALUES (
    lower(hex(randomblob(16))),
    ${MAINTENANT_MS},
    ${texte(modele.name)},
    ${expressionIdentifiant(modele, "NEW")},
    ${operation},
    ${champEcriture("acteur", conditionEcriture, acteurRepli)},
    ${champEcriture("jeton", conditionEcriture, "NULL")},
    ${champEcriture("origine", conditionEcriture, "NULL")},
    ${champEcriture("requete", conditionEcriture, "NULL")},
    ${avant},
    ${expressionJson(modele, "NEW")}
  );`;
}

export function declencheursDuModele(modele: ModeleSql): Declencheur[] {
  const table = nomTable(modele);
  const liste = colonnes(modele);
  const aEcriture = liste.some((colonne) => colonne.champ === "ecriture");
  const aArchive = liste.some((colonne) => colonne.champ === "archiveLe");
  const resultat: Declencheur[] = [
    {
      nom: `interdit_suppression_${table}`,
      sql: `CREATE TRIGGER ${ident(`interdit_suppression_${table}`)} BEFORE DELETE ON ${ident(table)}
BEGIN
  SELECT RAISE(ABORT, ${texte(`Suppression interdite sur « ${modele.name} » : rien ne se supprime, l'enregistrement s'archive.`)});
END;`,
    },
  ];
  const modifiables = MODELES_IMMUABLES.get(modele.name);
  if (modifiables) {
    const verrouillees = liste.filter((colonne) => !modifiables.includes(colonne.champ));
    resultat.push({
      nom: `immuable_${table}_modification`,
      sql: `CREATE TRIGGER ${ident(`immuable_${table}_modification`)} BEFORE UPDATE ON ${ident(table)}
WHEN ${verrouillees.map((colonne) => `OLD.${ident(colonne.nom)} IS NOT NEW.${ident(colonne.nom)}`).join(" OR ")}
BEGIN
  SELECT RAISE(ABORT, ${texte(`Une ligne de « ${modele.name} » ne se modifie pas : enregistrer une nouvelle ligne.`)});
END;`,
    });
  }
  if (MODELES_HORS_JOURNAL.has(modele.name)) return resultat;

  const valide = aEcriture ? `json_valid(NEW."ecriture")` : null;
  // En modification, `ecriture` inchangée = écriture passée hors de la couche.
  const change = aEcriture ? `NEW."ecriture" IS NOT OLD."ecriture" AND json_valid(NEW."ecriture")` : null;
  // Une mise à jour qui ne change que `ecriture` ou `updatedAt` ne change rien : pas de ligne.
  const colonnesSignificatives = liste.filter((colonne) => colonne.champ !== "ecriture" && !colonne.isUpdatedAt);
  const quelqueChoseChange = colonnesSignificatives
    .map((colonne) => `OLD.${ident(colonne.nom)} IS NOT NEW.${ident(colonne.nom)}`)
    .join("\n    OR ");
  const operationModification = aArchive
    ? `CASE WHEN OLD."archiveLe" IS NULL AND NEW."archiveLe" IS NOT NULL THEN 'ARCHIVAGE' WHEN OLD."archiveLe" IS NOT NULL AND NEW."archiveLe" IS NULL THEN 'RESTAURATION' ELSE 'MODIFICATION' END`
    : `'MODIFICATION'`;

  resultat.push(
    {
      nom: `journal_${table}_creation`,
      sql: `CREATE TRIGGER ${ident(`journal_${table}_creation`)} AFTER INSERT ON ${ident(table)}
BEGIN
  ${insertionJournal(modele, "'CREATION'", "NULL", valide)}
END;`,
    },
    {
      nom: `journal_${table}_modification`,
      sql: `CREATE TRIGGER ${ident(`journal_${table}_modification`)} AFTER UPDATE ON ${ident(table)}
WHEN ${quelqueChoseChange || "0"}
BEGIN
  ${insertionJournal(modele, operationModification, expressionJson(modele, "OLD"), change)}
END;`,
    }
  );
  return resultat;
}

/** Le journal : ni suppression, ni modification, sauf un caviardage RGPD (une fois). */
export function declencheursDuJournal(): Declencheur[] {
  const inchanges = ["id", "horodatage", "modele", "enregistrementId", "operation", "acteur", "jeton", "origine", "requete"]
    .map((colonne) => `NEW.${ident(colonne)} IS OLD.${ident(colonne)}`)
    .join(" AND ");
  return [
    {
      nom: `immuable_${TABLE_JOURNAL}_modification`,
      sql: `CREATE TRIGGER ${ident(`immuable_${TABLE_JOURNAL}_modification`)} BEFORE UPDATE ON ${ident(TABLE_JOURNAL)}
WHEN NOT (OLD."caviardeLe" IS NULL AND NEW."caviardeLe" IS NOT NULL AND ${inchanges})
BEGIN
  SELECT RAISE(ABORT, 'Le journal des modifications est immuable : seul un caviardage RGPD est permis, une seule fois.');
END;`,
    },
  ];
}

export function tousLesDeclencheurs(modeles: readonly ModeleSql[]): Declencheur[] {
  return [...modeles.flatMap((modele) => declencheursDuModele(modele)), ...declencheursDuJournal()];
}
