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
  // État du miroir Drive : réécrit à chaque synchronisation ; le miroir ne porte
  // aucune donnée métier (la base reste la source), ses échecs se lisent sur la ligne.
  "MiroirDrive",
  // Contenu d'un message reçu : écrit une fois avec son message (lui journalisé),
  // jamais modifié (la base le refuse) ; le journal en dupliquerait chaque mail.
  "ContenuMessage",
  // Registre des alertes envoyées au gérant : déjà un historique (une ligne par
  // envoi, jamais modifiée), sans donnée métier ni donnée personnelle.
  "AlerteEnvoi",
  // Clés générées par le serveur (paire VAPID du push web) : le journal en garderait une copie.
  "CleInterne",
  // Abonnements aux notifications du navigateur : état technique d'un appareil
  // (adresse de livraison et clés de chiffrement), réécrit à chaque envoi.
  "AbonnementPush",
]);

export type RegleImmuabilite = {
  /** Colonnes qui peuvent encore changer. */
  modifiables: readonly string[];
  /** Colonnes qui peuvent être renseignées une fois (depuis NULL), jamais changées ensuite. */
  completables?: readonly string[];
  /** Condition SQL sur OLD à partir de laquelle la ligne est figée (par défaut : dès sa création). */
  quand?: string;
  message?: string;
  /** Changements refusés en plus, chacun avec sa condition SQL (sur OLD et NEW) et son message. */
  interdits?: readonly { condition: string; message: string }[];
};

/**
 * Modèles dont une ligne, une fois écrite (ou une fois émise), ne se modifie
 * plus : la base le refuse. Un consentement se retire par une nouvelle
 * déclaration, un paramètre change par une nouvelle valeur datée, une facture
 * émise s'annule par un avoir.
 */
export const MODELES_IMMUABLES: ReadonlyMap<string, RegleImmuabilite> = new Map<string, RegleImmuabilite>([
  ["ConsentementMail", { modifiables: ["clientId", "ecriture"] }],
  ["Parametre", { modifiables: ["ecriture"] }],
  ["InstantaneMensuel", { modifiables: ["ecriture"], message: "Un instantané mensuel est figé : il ne se recalcule ni ne se modifie." }],
  [
    "ContenuMessage",
    {
      modifiables: ["texte", "entetes", "ecriture"],
      completables: ["anonymiseLe"],
      message: "Le contenu d'un message reçu ne se modifie pas.",
      interdits: [
        {
          condition: `(NEW."texte" IS NOT OLD."texte" OR NEW."entetes" IS NOT OLD."entetes") AND NOT (OLD."anonymiseLe" IS NULL AND NEW."anonymiseLe" IS NOT NULL)`,
          message: "Le contenu d'un message reçu ne se modifie pas : seul son effacement RGPD est permis, une fois.",
        },
      ],
    },
  ],
  [
    "AnalyseMessage",
    {
      modifiables: ["raisonnement", "resultat", "ecriture"],
      completables: ["anonymiseLe"],
      message: "L'analyse d'un message est gardée telle quelle : une nouvelle analyse s'ajoute.",
      interdits: [
        {
          condition: `(NEW."raisonnement" IS NOT OLD."raisonnement" OR NEW."resultat" IS NOT OLD."resultat") AND NOT (OLD."anonymiseLe" IS NULL AND NEW."anonymiseLe" IS NOT NULL)`,
          message: "L'analyse d'un message est gardée telle quelle : seul son effacement RGPD est permis, une fois.",
        },
      ],
    },
  ],
  ["AppelIa", { modifiables: ["ecriture"], message: "Un appel au modèle d'IA est enregistré tel quel : il ne se modifie pas." }],
  ["GenerationImage", { modifiables: ["ecriture"], message: "Une génération d'image est enregistrée telle quelle : elle ne se modifie pas." }],
  ["PromptSimulationVersion", { modifiables: ["ecriture"], message: "Une version de prompt ne se modifie pas : enregistrer une nouvelle version (revenir en arrière en crée une aussi)." }],
  [
    "Document",
    {
      // Généré par le CRM : figé à l'émission. Repris d'avant le CRM : il se corrige, sauf son numéro.
      quand: `OLD."numero" IS NOT NULL AND OLD."origine" = 'CRM'`,
      modifiables: ["statut", "pdfPath", "clientId", "updatedAt", "ecriture", "libelleVariante", "visibleEspace", "consultations", "consulteLe"],
      completables: ["destinataire", "categorieClient"],
      message: "Document émis : il ne se modifie plus. Pour une facture, faire un avoir puis une nouvelle facture ; pour un devis, le refaire.",
      interdits: [
        {
          condition: `OLD."numero" IS NOT NULL AND (NEW."numero" IS NOT OLD."numero" OR NEW."type" IS NOT OLD."type")`,
          message: "Le numéro d'un document émis ne change jamais.",
        },
        {
          condition: `NEW."origine" IS NOT OLD."origine"`,
          message: "L'origine d'un document (généré par le CRM ou repris) ne change pas.",
        },
      ],
    },
  ],
  [
    "NumeroDocument",
    {
      modifiables: ["type", "documentId", "destinataire", "montant", "note", "ecriture"],
      // Numéro manuel inscrit sans date : elle se renseigne une fois.
      completables: ["emisLe"],
      message: "Un numéro inscrit au registre ne change pas : seuls ses compléments se renseignent.",
    },
  ],
  [
    "Encaissement",
    {
      // Montant, dates, moyen, référence et payeur se corrigent (le journal garde chaque valeur) ;
      // l'origine et la clé de reprise ne changent pas.
      modifiables: ["clientId", "note", "statut", "updatedAt", "ecriture", "payeur", "montant", "moyen", "reference", "recuLe", "crediteLe"],
      completables: ["dossierId", "finLe", "motifFin"],
      message: "Un encaissement garde son origine : seuls son montant, ses dates, son moyen, sa référence, son payeur et sa note se corrigent.",
      interdits: [
        {
          condition: `OLD."statut" <> 'VALIDE' AND (NEW."montant" IS NOT OLD."montant" OR NEW."recuLe" IS NOT OLD."recuLe")`,
          message: "Un paiement annulé ou rejeté ne se corrige plus : enregistrer le bon paiement.",
        },
        {
          condition: `OLD."statut" <> 'VALIDE' AND NEW."statut" IS NOT OLD."statut"`,
          message: "Un encaissement annulé ou rejeté le reste : enregistrer un nouvel encaissement.",
        },
        {
          condition: `NEW."statut" <> 'VALIDE' AND (NEW."finLe" IS NULL OR NEW."motifFin" IS NULL)`,
          message: "Un rejet ou une annulation d'encaissement se date et se motive.",
        },
      ],
    },
  ],
  [
    "AffectationEncaissement",
    {
      modifiables: ["statut", "ecriture"],
      completables: ["finLe", "motifFin"],
      message: "Une affectation de paiement ne se modifie pas : elle cesse de compter et une nouvelle la remplace.",
      interdits: [
        {
          condition: `OLD."statut" <> 'ACTIVE' AND NEW."statut" IS NOT OLD."statut"`,
          message: "Une affectation qui a cessé de compter ne revient pas.",
        },
      ],
    },
  ],
]);

export function messageImmuabilite(nomModele: string): string {
  return MODELES_IMMUABLES.get(nomModele)?.message ?? `Une ligne de « ${nomModele} » ne se modifie pas : enregistrer une nouvelle ligne.`;
}

/** Tous les refus possibles d'un modèle immuable (colonnes figées et changements interdits). */
export function messagesRefus(nomModele: string): string[] {
  return [messageImmuabilite(nomModele), ...(MODELES_IMMUABLES.get(nomModele)?.interdits ?? []).map((interdit) => interdit.message)];
}

export function messageSuppression(nomModele: string): string {
  return `Suppression interdite sur « ${nomModele} » : rien ne se supprime, l'enregistrement s'archive.`;
}

export const MESSAGE_JOURNAL_IMMUABLE = "Le journal des modifications est immuable : seul un caviardage RGPD est permis, une seule fois.";

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
  SELECT RAISE(ABORT, ${texte(messageSuppression(modele.name))});
END;`,
    },
  ];
  const regle = MODELES_IMMUABLES.get(modele.name);
  if (regle) {
    const completables = regle.completables ?? [];
    const verrouillees = liste.filter((colonne) => !regle.modifiables.includes(colonne.champ) && !completables.includes(colonne.champ));
    const changements = [
      ...verrouillees.map((colonne) => `OLD.${ident(colonne.nom)} IS NOT NEW.${ident(colonne.nom)}`),
      ...liste
        .filter((colonne) => completables.includes(colonne.champ))
        .map((colonne) => `(OLD.${ident(colonne.nom)} IS NOT NULL AND OLD.${ident(colonne.nom)} IS NOT NEW.${ident(colonne.nom)})`),
    ];
    resultat.push({
      nom: `immuable_${table}_modification`,
      sql: `CREATE TRIGGER ${ident(`immuable_${table}_modification`)} BEFORE UPDATE ON ${ident(table)}
WHEN ${regle.quand ? `(${regle.quand}) AND ` : ""}(${changements.join(" OR ")})
BEGIN
  SELECT RAISE(ABORT, ${texte(messageImmuabilite(modele.name))});
END;`,
    });
    (regle.interdits ?? []).forEach((interdit, index) => {
      resultat.push({
        nom: `immuable_${table}_regle_${index + 1}`,
        sql: `CREATE TRIGGER ${ident(`immuable_${table}_regle_${index + 1}`)} BEFORE UPDATE ON ${ident(table)}
WHEN ${interdit.condition}
BEGIN
  SELECT RAISE(ABORT, ${texte(interdit.message)});
END;`,
      });
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
  SELECT RAISE(ABORT, ${texte(MESSAGE_JOURNAL_IMMUABLE)});
END;`,
    },
  ];
}

export function tousLesDeclencheurs(modeles: readonly ModeleSql[]): Declencheur[] {
  return [...modeles.flatMap((modele) => declencheursDuModele(modele)), ...declencheursDuJournal()];
}
