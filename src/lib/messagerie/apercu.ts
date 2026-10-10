/**
 * Mission 25 (lot 3) — un texte de la liste tel que le client le recevra : rempli avec des valeurs d'exemple, mesuré,
 * vérifié. Pur : Paramètres → SMS l'appelle à chaque frappe, le serveur avant d'enregistrer.
 *  - erreurs (bloquantes) : texte vide ou trop long, variable que le moteur ne sait pas remplir pour ce texte, lien prévu
 *    absent ou lien en trop : le message ne pourrait pas partir juste ;
 *  - à revoir (sans blocage) : les règles du contrôleur (une question, 320 caractères, ni montant ni date, vouvoiement,
 *    présentation au premier contact seulement…) : Lucas reste l'auteur de ses textes, l'écran le prévient.
 */
import { definitionMessage, variantesDe, type CodeMessage, type VariableMessage, type VarianteMessage } from "./catalogue";
import { controlerTexte } from "./controleur";
import { formuleBonjour, pieceDe, remplirTexte } from "./texte";

/** Un client d'exemple, fictif : il sert à compter les caractères et à relire le texte rempli. */
export const PRENOM_EXEMPLE = "Camille";
export const VALEURS_EXEMPLE: Record<Exclude<VariableMessage, "bonjour" | "piece">, string> = {
  lien: "https://coverswap.fr/e/AB12CD-Xy3kP9qLm2",
  lien_avis: "https://g.page/r/coverswap/review",
  quand_rappel: "dans la journée",
  quand_reponse: "demain matin",
  quand: "jeudi vers 10 h",
  date_chantier: "mardi 20 octobre",
  heure: "8 h 30",
  nombre: "3",
  creneau_1: "jeudi 15 octobre à 14 h",
  creneau_2: "vendredi 16 octobre à 10 h",
};

export const LONGUEUR_MAX_MODELE = 600;
const TOUJOURS: readonly VariableMessage[] = ["bonjour", "piece"];
const LIENS: readonly VariableMessage[] = ["lien", "lien_avis"];
const variablesDuTexte = (texte: string) => [...new Set((texte.match(/\{(\w+)\}/g) ?? []).map((v) => v.slice(1, -1)))];

/** Le texte validé d'une variante (la liste du 10/10). */
export function texteDeDepart(code: CodeMessage, variante: VarianteMessage): string {
  const textes = definitionMessage(code).textes as Partial<Record<VarianteMessage, string>>;
  return textes[variante] ?? textes.defaut!;
}

/**
 * Les variables qu'un texte peut porter : celles de son texte validé (le moteur sait les remplir pour cette variante),
 * plus {bonjour} et {piece}, toujours connues.
 */
export function variablesPermises(code: CodeMessage, variante: VarianteMessage): VariableMessage[] {
  const depart = variablesDuTexte(texteDeDepart(code, variante)) as VariableMessage[];
  return [...new Set([...TOUJOURS, ...depart])];
}

export type Apercu = {
  /** Le texte rempli pour le client d'exemple (prénom fiable, cuisine). */
  texte: string;
  longueur: number;
  /** Ce qui empêcherait le message de partir juste : l'enregistrement est refusé. */
  erreurs: string[];
  /** Les règles du contrôleur que le texte ne suit pas : affiché, sans bloquer. */
  aRevoir: string[];
};

export function apercuDuTexte(code: CodeMessage, variante: VarianteMessage, texte: string): Apercu {
  const erreurs: string[] = [];
  const brut = texte.trim();
  if (!brut) erreurs.push("Le texte est vide.");
  if (brut.length > LONGUEUR_MAX_MODELE) erreurs.push(`${brut.length} caractères : ${LONGUEUR_MAX_MODELE} au plus.`);
  if (!variantesDe(code).includes(variante)) erreurs.push("Variante inconnue pour ce message.");

  const permises = variablesPermises(code, variante);
  const portees = variablesDuTexte(brut);
  const inconnues = portees.filter((v) => !(permises as string[]).includes(v));
  if (inconnues.length) erreurs.push(`${inconnues.map((v) => `{${v}}`).join(", ")} : variable que le CRM ne remplit pas pour ce message (permises : ${permises.map((v) => `{${v}}`).join(", ")}).`);
  const depart = variablesDuTexte(texteDeDepart(code, variante));
  for (const lien of LIENS) {
    if (depart.includes(lien) && !portees.includes(lien)) erreurs.push(`Le lien {${lien}} manque : ce message le porte.`);
  }
  if (/https?:\/\//i.test(brut)) erreurs.push("Pas d'adresse écrite en dur : le lien vient du CRM ({lien} ou {lien_avis}).");

  const rempli = remplir(brut);
  // Le contrôleur, sauf ce que le texte validé fait déjà (« demain » dans la veille du chantier, par exemple) : seul
  // ce que la modification ajoute est signalé.
  const deja = new Set(ecartsDe(code, remplir(texteDeDepart(code, variante))).map((e) => e.regle));
  const aRevoir = brut ? ecartsDe(code, rempli).filter((e) => !deja.has(e.regle)).map((e) => e.detail) : [];
  return { texte: rempli, longueur: rempli.length, erreurs, aRevoir };
}

const remplir = (texte: string) => remplirTexte(texte, { bonjour: formuleBonjour(PRENOM_EXEMPLE), ...VALEURS_EXEMPLE }, pieceDe(["CUISINE"])).texte;

function ecartsDe(code: CodeMessage, rempli: string) {
  const lienAttendu = rempli.includes(VALEURS_EXEMPLE.lien) ? VALEURS_EXEMPLE.lien : rempli.includes(VALEURS_EXEMPLE.lien_avis) ? VALEURS_EXEMPLE.lien_avis : null;
  return controlerTexte(rempli, { lienAttendu, premierContact: Boolean(definitionMessage(code).premierContact), prenom: PRENOM_EXEMPLE, permis: Object.values(VALEURS_EXEMPLE) }).filter(
    (e) => e.regle !== "LIEN_ABSENT" && e.regle !== "LIEN_ETRANGER"
  );
}
