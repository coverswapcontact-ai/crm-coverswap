/**
 * Injection de la colonne `ecriture` dans les arguments d'une écriture Prisma,
 * écritures imbriquées comprises (create, connectOrCreate, upsert, update…),
 * en suivant les relations décrites par le DMMF. Module pur, sans base.
 *
 * Limite connue : `connect`, `disconnect` et `set` sur une relation « vers
 * plusieurs », écrits depuis le parent, modifient la clé étrangère des enfants
 * sans passer par leurs données. Le journal les attribue alors à
 * « INCONNU:hors-couche ». Convention du dépôt : modifier la clé étrangère sur
 * l'enfant lui-même (update de l'enfant), jamais par ces opérations.
 */

export type ChampDmmf = {
  name: string;
  kind: string;
  type: string;
  isList: boolean;
};

export type ModeleDmmf = {
  name: string;
  fields: readonly ChampDmmf[];
};

export class SuppressionInterdite extends Error {
  constructor(modele: string) {
    super(`Suppression interdite sur « ${modele} » : rien ne se supprime, l'enregistrement s'archive.`);
    this.name = "SuppressionInterdite";
  }
}

type Objet = Record<string, unknown>;

function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur) && !(valeur instanceof Date);
}

function surChaque(valeur: unknown, transformer: (element: Objet) => Objet): unknown {
  if (Array.isArray(valeur)) return valeur.map((element) => (estObjet(element) ? transformer(element) : element));
  return estObjet(valeur) ? transformer(valeur) : valeur;
}

export class InjecteurEcriture {
  private readonly modeles: Map<string, ModeleDmmf>;

  constructor(modeles: readonly ModeleDmmf[]) {
    this.modeles = new Map(modeles.map((modele) => [modele.name, modele]));
  }

  /** Le modèle porte-t-il la colonne `ecriture` ? (le journal lui-même non) */
  porteEcriture(modele: string): boolean {
    return this.modeles.get(modele)?.fields.some((champ) => champ.name === "ecriture" && champ.kind === "scalar") ?? false;
  }

  /** Arguments de l'opération de premier niveau, avec `ecriture` injectée partout. */
  injecter(modele: string, operation: string, args: unknown, ecriture: string): unknown {
    if (!estObjet(args)) return args;
    switch (operation) {
      case "create":
      case "update":
      case "createMany":
      case "createManyAndReturn":
      case "updateMany":
        return { ...args, data: this.donnees(modele, args.data, ecriture) };
      case "upsert":
        return {
          ...args,
          create: this.donnees(modele, args.create, ecriture),
          update: this.donnees(modele, args.update, ecriture),
        };
      default:
        return args;
    }
  }

  private donnees(modele: string, donnees: unknown, ecriture: string): unknown {
    const definition = this.modeles.get(modele);
    if (!definition) return donnees;
    return surChaque(donnees, (element) => {
      const resultat: Objet = this.porteEcriture(modele) ? { ...element, ecriture } : { ...element };
      for (const champ of definition.fields) {
        if (champ.kind !== "object" || !(champ.name in element)) continue;
        resultat[champ.name] = this.relation(champ, element[champ.name], ecriture);
      }
      return resultat;
    });
  }

  private relation(champ: ChampDmmf, operations: unknown, ecriture: string): unknown {
    if (!estObjet(operations)) return operations;
    const cible = champ.type;
    const resultat: Objet = { ...operations };
    for (const [cle, valeur] of Object.entries(operations)) {
      switch (cle) {
        case "create":
          resultat.create = this.donnees(cible, valeur, ecriture);
          break;
        case "createMany":
          resultat.createMany = estObjet(valeur) ? { ...valeur, data: this.donnees(cible, valeur.data, ecriture) } : valeur;
          break;
        case "connectOrCreate":
          resultat.connectOrCreate = surChaque(valeur, (element) => ({
            ...element,
            create: this.donnees(cible, element.create, ecriture),
          }));
          break;
        case "upsert":
          resultat.upsert = surChaque(valeur, (element) => ({
            ...element,
            create: this.donnees(cible, element.create, ecriture),
            update: this.donnees(cible, element.update, ecriture),
          }));
          break;
        case "update":
          resultat.update = champ.isList
            ? surChaque(valeur, (element) => ({ ...element, data: this.donnees(cible, element.data, ecriture) }))
            : this.enveloppeOuDonnees(cible, valeur, ecriture);
          break;
        case "updateMany":
          resultat.updateMany = surChaque(valeur, (element) => ({
            ...element,
            data: this.donnees(cible, element.data, ecriture),
          }));
          break;
        case "delete":
        case "deleteMany":
          throw new SuppressionInterdite(cible);
      }
    }
    return resultat;
  }

  /** Relation « vers un » : `update` reçoit les données, ou { where?, data }. */
  private enveloppeOuDonnees(modele: string, valeur: unknown, ecriture: string): unknown {
    if (!estObjet(valeur)) return valeur;
    const aUnChampData = this.modeles.get(modele)?.fields.some((champ) => champ.name === "data") ?? false;
    if ("data" in valeur && !aUnChampData) {
      return { ...valeur, data: this.donnees(modele, valeur.data, ecriture) };
    }
    return this.donnees(modele, valeur, ecriture);
  }
}
