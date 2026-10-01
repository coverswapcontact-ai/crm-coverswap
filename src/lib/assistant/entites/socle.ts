import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { euros, jourHeure, jourLong } from "@/lib/commun/format";
import { jourParis } from "@/lib/dossiers/dates";
import { lireDateDictee } from "../agenda";
import type { ContexteOutil, ResultatOutil } from "../definition";
import { CibleAmbigue, resoudreCible, texteAmbigu, type Cible } from "../outils/lecture";

/**
 * Le socle du registre des entités (mission 17, partie C) : ce que chaque entité déclare — son résolveur, sa
 * modification (schéma zod du service, libellés, sensibilité par champ, lecture de l'état, application par la
 * fonction de service), sa création, son archivage et sa restauration — et les aides communes : traduction
 * snake_case ↔ camelCase, valeurs en mots, candidats en cas de doute. Aucune écriture brute ici : chaque entité
 * n'écrit que par la fonction de service de l'écran.
 */

export const ENTITES = [
  "LEAD",
  "DOSSIER",
  "CLIENT",
  "COORDONNEE",
  "CONSENTEMENT",
  "NOTE",
  "NOTE_APPEL",
  "DOCUMENT",
  "ENCAISSEMENT",
  "DEPENSE",
  "SIMULATION",
  "TARIF",
  "SOUS_PARTIE",
  "PUBLICATION",
  "REGLE_EXPEDITEUR",
  "TACHE",
  "PARAMETRE",
  "COMPTEUR",
  "AUTOMATISME",
  "MODELE_SMS",
  "MODELE_MAIL",
  "GUIDE_STYLE",
  "CONSIGNES",
  "POSITIONNEMENT",
  "PROMPT_SIMULATION",
  "REPRISE",
] as const;
export type Entite = (typeof ENTITES)[number];

export type Valeurs = Record<string, unknown>;

/** L'enregistrement visé, résolu : son identifiant (ou sa clé : code, série, type), son nom en mots, et ce qu'il faut pour l'écrire. */
export type Resolu = { id: string; nom: string; archive: boolean; contexte: Valeurs };

/** Une référence donnée par Claude : un identifiant, ou une cible par nom (les contacts), jamais un choix fait à sa place. */
export type Reference = { id?: string | null; cible?: Cible | null };

export type Candidat = { id: string; nom: string; detail?: string };

/** Plusieurs enregistrements possibles : rendus à Claude, qui demande à Lucas lequel. */
export class EntiteAmbigue extends Error {
  constructor(
    readonly candidats: Candidat[],
    readonly texte: string
  ) {
    super(texte);
  }
}

export const ambiguite = (candidats: Candidat[], quoi: string) =>
  new EntiteAmbigue(candidats, `Plusieurs ${quoi} correspondent, je ne choisis pas à ta place :\n${candidats.map((c) => `- ${c.nom}${c.detail ? ` — ${c.detail}` : ""} [${c.id}]`).join("\n")}\nDis-moi lequel (ou rappelle l'outil avec son identifiant).`);

export const resultatAmbigu = (e: EntiteAmbigue): ResultatOutil => ({ texte: e.texte, donnees: { candidats: e.candidats } });

/** Une modification champ par champ, telle qu'elle est tracée : valeurs d'avant et d'après, et leur texte. */
export type Changement = { champ: string; cle: string; libelle: string; avant: unknown; apres: unknown; texteAvant: string; texteApres: string };

export type ContexteEcriture = Pick<ContexteOutil, "commande" | "maintenant" | "utilisateur">;

export type DefinitionModification = {
  /** Le schéma zod du service (ou de la route de l'écran), en camelCase : l'outil n'accepte rien d'autre. */
  schema: z.ZodObject<z.ZodRawShape>;
  /** Libellé en mots de chaque champ (clé camelCase). */
  libelles: Record<string, string>;
  /** Champs dont le changement est sensible (client, argent, paramètre, irréversible), ou règle calculée. */
  sensible?: readonly string[] | ((apres: Valeurs, avant: Valeurs, cible: Resolu) => boolean);
  /** L'état actuel, dans le format de sortie du schéma (jours AAAA-MM-JJ, montants en euros…). */
  lire: (cible: Resolu) => Promise<Valeurs>;
  /** Avant validation (clés camelCase) : dates dictées, valeurs par défaut. */
  pretraiter?: (entree: Valeurs, contexte: ContexteEcriture) => Valeurs;
  /** Tracer les changements prévus plutôt que l'état relu après écriture (une valeur datée qui ne vaut que demain). */
  tracePrevue?: boolean;
  /** Entrée validée → valeurs d'après (un raccourci comme `defaut: true` ou `principale: true` devient une valeur). */
  preparer?: (entree: Valeurs, avant: Valeurs, cible: Resolu, contexte: ContexteEcriture) => Promise<Valeurs> | Valeurs;
  /** Écrit par la fonction de service ; rend les avertissements à dire à Lucas. */
  appliquer: (cible: Resolu, valeurs: Valeurs, contexte: ContexteEcriture) => Promise<string[] | void>;
  /** Valeur en mots d'un champ, quand le format par défaut ne suffit pas. */
  texte?: Record<string, (valeur: unknown) => string>;
  /** Champs que l'annulation ne sait pas remettre, avec la raison. */
  irreversibles?: Record<string, string>;
  /** Ce que l'annulation remet mais dont un effet de bord reste (à dire à Lucas à l'aperçu et au résultat de « annuler_modification »). */
  annulationPartielle?: (changements: Changement[]) => string | null;
  /** Une phrase ajoutée à l'aperçu (effet de bord à connaître). */
  note?: (apres: Valeurs, avant: Valeurs, cible: Resolu) => Promise<string | null> | string | null;
};

export type DefinitionCreation = {
  /** Schéma du service ; `cles: "snake"` quand il est déjà en snake_case (création d'un contact). */
  schema: z.ZodType<Valeurs>;
  cles?: "snake" | "camel";
  /** La cible (parent) est exigée : le dossier, le lead ou le client concerné. */
  cible?: "EXIGEE" | "FACULTATIVE";
  /** Le genre de contact que la cible désigne (sinon : dossier, lead ou client, le premier trouvé). */
  typeCible?: "CLIENT" | "LEAD" | "DOSSIER";
  pretraiter?: (entree: Valeurs, contexte: ContexteEcriture) => Valeurs;
  sensible?: (entree: Valeurs) => boolean;
  apercu: (entree: Valeurs, cible: Resolu | null, contexte: ContexteEcriture) => Promise<string>;
  executer: (entree: Valeurs, cible: Resolu | null, contexte: ContexteEcriture) => Promise<ResultatOutil>;
};

export type DefinitionEntite = {
  code: Entite;
  /** « le lead », « la dépense » : pour les phrases. */
  libelle: string;
  /** Aide pour la description de l'outil : comment la désigner. */
  designation: string;
  resoudre?: (reference: Reference) => Promise<Resolu>;
  modifier?: DefinitionModification;
  creer?: DefinitionCreation;
  archiver?: (cible: Resolu, motif: string, contexte: ContexteEcriture) => Promise<string[] | void>;
  restaurer?: (cible: Resolu, contexte: ContexteEcriture) => Promise<string[] | void>;
  /** Restaurer une version d'un texte (consignes, positionnement, prompt). */
  restaurerVersion?: (cible: Resolu, numero: number, contexte: ContexteEcriture) => Promise<string>;
  /** Lien vers l'écran de l'enregistrement. */
  chemin?: (cible: Resolu) => string;
};

/* ── snake_case ↔ camelCase ────────────────────────────────────────── */

const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

export const versCamel = (cle: string) => (SNAKE.test(cle) ? cle.replace(/_([a-z0-9])/g, (_m, l: string) => l.toUpperCase()) : cle);
export const versSnake = (cle: string) => (/^[a-z][a-zA-Z0-9]*$/.test(cle) ? cle.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`) : cle);

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Les clés snake_case d'une entrée MCP deviennent celles du service (récursif ; les clés de données, « CUISINE.ilot » ou « DEVIS_ENVOYE », ne bougent pas). */
export function clesEnCamel(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(clesEnCamel);
  if (!estObjet(valeur)) return valeur;
  return Object.fromEntries(Object.entries(valeur).map(([cle, v]) => [versCamel(cle), clesEnCamel(v)]));
}

/** Les champs permis, en snake_case, tels que Claude les écrit. */
export const champsPermis = (schema: z.ZodObject<z.ZodRawShape>) => Object.keys(schema.shape).map(versSnake);

/** Valide des champs (déjà en camelCase) contre le schéma du service ; un champ inconnu est refusé, avec la liste des permis. */
export function validerChamps(schema: z.ZodObject<z.ZodRawShape>, entree: Valeurs, entite: string): Valeurs {
  const permis = Object.keys(schema.shape);
  const inconnus = Object.keys(entree).filter((cle) => !permis.includes(cle));
  if (inconnus.length) throw new ErreurMetier(`Champ${inconnus.length > 1 ? "s" : ""} inconnu${inconnus.length > 1 ? "s" : ""} pour ${entite} : ${inconnus.map(versSnake).join(", ")}. Champs permis : ${permis.map(versSnake).join(", ")}.`, 400);
  const r = schema.safeParse(entree);
  if (!r.success) throw new ErreurMetier(`Champs invalides pour ${entite} : ${r.error.issues.map((i) => `${i.path.map((p) => (typeof p === "string" ? versSnake(p) : String(p))).join(".") || "champs"} : ${i.message}`).join(" ; ")}.`, 400);
  // Seules les clés données comptent : un défaut du schéma (`.default`) ne devient pas un changement.
  return Object.fromEntries(Object.entries(r.data as Valeurs).filter(([cle]) => cle in entree));
}

/* ── Valeurs en mots ───────────────────────────────────────────────── */

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function texteValeur(cle: string, valeur: unknown): string {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  if (typeof valeur === "boolean") return valeur ? "oui" : "non";
  if (typeof valeur === "number") return /montant|prix|budget|payeur/i.test(cle) ? euros(valeur) : valeur.toLocaleString("fr-FR");
  if (typeof valeur === "string") {
    if (JOUR.test(valeur)) return jourLong(`${valeur}T12:00:00.000Z`) ?? valeur;
    if (INSTANT.test(valeur)) return jourHeure(valeur) ?? valeur;
    const propre = valeur.replace(/\s+/g, " ").trim();
    return propre.length > 120 ? `« ${propre.slice(0, 100)}… » (${valeur.length} caractères)` : `« ${propre} »`;
  }
  if (Array.isArray(valeur)) return valeur.length ? valeur.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ") : "aucun";
  return JSON.stringify(valeur);
}

const memeValeur = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Les changements réels (valeur d'après différente de celle d'avant), avec leur texte. */
export function changementsDe(definition: DefinitionModification, apres: Valeurs, avant: Valeurs): Changement[] {
  return Object.keys(apres)
    .filter((cle) => !cle.startsWith("_") && !memeValeur(apres[cle], avant[cle]))
    .map((cle) => {
      const texte = definition.texte?.[cle] ?? ((v: unknown) => texteValeur(cle, v));
      return { champ: versSnake(cle), cle, libelle: definition.libelles[cle] ?? versSnake(cle).replace(/_/g, " "), avant: avant[cle] ?? null, apres: apres[cle] ?? null, texteAvant: texte(avant[cle]), texteApres: texte(apres[cle]) };
    });
}

/** « le montant estimé passe de 5 000 € à 6 200 € » */
export const phraseChangement = (c: Pick<Changement, "libelle" | "texteAvant" | "texteApres">) => `${c.libelle} ${/^les /i.test(c.libelle) ? "passent" : "passe"} de ${c.texteAvant} à ${c.texteApres}`;

export function estSensible(definition: DefinitionModification, apres: Valeurs, avant: Valeurs, cible: Resolu): boolean {
  if (!definition.sensible) return false;
  if (typeof definition.sensible === "function") return definition.sensible(apres, avant, cible);
  return definition.sensible.some((cle) => cle in apres && !memeValeur(apres[cle], avant[cle]));
}

/* ── Résolution ────────────────────────────────────────────────────── */

const iso = (d: Date | null | undefined) => (d ? jourParis(d) : null);
export const jourDe = iso;

/** Un contact (lead, dossier, client) par identifiant ou par nom ; les archivés restent lisibles (par identifiant, et par nom en dernier recours). */
export async function resoudreContact(reference: Reference, type: "LEAD" | "DOSSIER" | "CLIENT"): Promise<Resolu> {
  const id = reference.id?.trim();
  if (id) {
    if (type === "LEAD") {
      const l = await prisma.lead.findUnique({ where: { id }, select: { id: true, prenom: true, nom: true, ville: true, archiveLe: true, clientId: true } });
      if (!l) throw new ErreurMetier(`Lead introuvable : ${id}.`, 404);
      return { id: l.id, nom: `${l.prenom} ${l.nom}`.trim() || "lead sans nom", archive: Boolean(l.archiveLe), contexte: { clientId: l.clientId } };
    }
    if (type === "DOSSIER") {
      const d = await prisma.dossier.findUnique({ where: { id }, select: { id: true, clientNom: true, objet: true, archiveLe: true, leadId: true, clientId: true } });
      if (!d) throw new ErreurMetier(`Dossier introuvable : ${id}.`, 404);
      return { id: d.id, nom: d.clientNom, archive: Boolean(d.archiveLe), contexte: { leadId: d.leadId, clientId: d.clientId, objet: d.objet } };
    }
    const c = await prisma.client.findUnique({ where: { id }, select: { id: true, nom: true, archiveLe: true } });
    if (!c) throw new ErreurMetier(`Client introuvable : ${id}.`, 404);
    return { id: c.id, nom: c.nom, archive: Boolean(c.archiveLe), contexte: {} };
  }
  const cible = reference.cible;
  if (!cible || !(cible.dossierId || cible.leadId || cible.clientId || cible.nom?.trim())) throw new ErreurMetier(`Désigne ${type === "LEAD" ? "le lead" : type === "DOSSIER" ? "le dossier" : "le client"} : « id », ou « cible » (identifiant ou nom).`, 400);
  let ids: Awaited<ReturnType<typeof resoudreCible>>;
  try {
    ids = await resoudreCible(cible, type);
  } catch (e) {
    if (e instanceof CibleAmbigue) throw new EntiteAmbigue(e.candidats.map((c) => ({ id: c.id, nom: c.nom, detail: `${c.type.toLowerCase()}${c.ville ? `, ${c.ville}` : ""}, ${c.etat}` })), texteAmbigu(e));
    if (e instanceof Error && /^Aucun contact/.test(e.message) && cible.nom) return resoudreArchive(cible.nom, type);
    if (e instanceof Error && !(e instanceof ErreurMetier)) throw new ErreurMetier(e.message, 404);
    throw e;
  }
  const choisi = type === "LEAD" ? ids.leadId : type === "DOSSIER" ? ids.dossierId : ids.clientId;
  if (!choisi) throw new ErreurMetier(`${ids.nom} n'a pas de ${type === "LEAD" ? "lead" : type === "DOSSIER" ? "dossier ouvert" : "fiche client"}.`, 404);
  return resoudreContact({ id: choisi }, type);
}

/** Dernier recours : un contact archivé, par son nom (la recherche ordinaire ne voit pas les archivés). */
async function resoudreArchive(nom: string, type: "LEAD" | "DOSSIER" | "CLIENT"): Promise<Resolu> {
  const mots = nom.trim().split(/\s+/).filter((m) => m.length >= 2).slice(0, 3);
  const candidats: Candidat[] =
    type === "LEAD"
      ? (await prisma.lead.findMany({ where: { archiveLe: { not: null }, AND: mots.map((m) => ({ OR: [{ nom: { contains: m } }, { prenom: { contains: m } }] })) }, select: { id: true, prenom: true, nom: true, ville: true }, take: 6 })).map((l) => ({ id: l.id, nom: `${l.prenom} ${l.nom}`.trim(), detail: `lead archivé${l.ville ? `, ${l.ville}` : ""}` }))
      : type === "DOSSIER"
        ? (await prisma.dossier.findMany({ where: { archiveLe: { not: null }, AND: mots.map((m) => ({ clientNom: { contains: m } })) }, select: { id: true, clientNom: true, objet: true }, take: 6 })).map((d) => ({ id: d.id, nom: d.clientNom, detail: `dossier archivé — ${d.objet}` }))
        : (await prisma.client.findMany({ where: { archiveLe: { not: null }, AND: mots.map((m) => ({ nom: { contains: m } })) }, select: { id: true, nom: true, ville: true }, take: 6 })).map((c) => ({ id: c.id, nom: c.nom, detail: `fiche archivée${c.ville ? `, ${c.ville}` : ""}` }));
  if (candidats.length === 0) throw new ErreurMetier(`Aucun ${type === "LEAD" ? "lead" : type === "DOSSIER" ? "dossier" : "client"} ne correspond à « ${nom} », archivés compris.`, 404);
  if (candidats.length > 1) throw ambiguite(candidats, "fiches archivées");
  return resoudreContact({ id: candidats[0].id }, type);
}

/** Une entité désignée seulement par son identifiant (dépense, encaissement, note…). */
export function exigerId(reference: Reference, quoi: string, ou: string): string {
  const id = reference.id?.trim();
  if (!id) throw new ErreurMetier(`Désigne ${quoi} par son identifiant (« id »), rendu par ${ou}.`, 400);
  return id;
}

/** « 12 octobre », « lundi prochain » ou AAAA-MM-JJ → AAAA-MM-JJ ; null efface ; une autre valeur passe telle quelle au schéma. */
export function jourDicte(valeur: unknown, maintenant: Date, champ: string): unknown {
  if (typeof valeur !== "string") return valeur;
  const texte = valeur.trim();
  if (!texte) return null;
  if (JOUR.test(texte) || INSTANT.test(texte)) return texte;
  const date = lireDateDictee(texte, maintenant, 12);
  if (!date) throw new ErreurMetier(`Date non comprise pour « ${champ} » : « ${valeur} ». Donne-la au format AAAA-MM-JJ.`, 400);
  return jourParis(date);
}

/** Ramène les champs de date dictés (clés camelCase) au format AAAA-MM-JJ avant validation. */
export function datesDictees(entree: Valeurs, cles: readonly string[], maintenant: Date): Valeurs {
  const sortie = { ...entree };
  for (const cle of cles) if (cle in sortie) sortie[cle] = jourDicte(sortie[cle], maintenant, versSnake(cle));
  return sortie;
}
