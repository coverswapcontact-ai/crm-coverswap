/**
 * Mission 25 — remplir un message de la liste validée : prénom fiable (règle d'or 9), pièce accordée, variables, mention
 * STOP au premier SMS, et les liens qui ouvrent Messages ou le mail avec le texte déjà rempli. Pur.
 */
import { avecMentionStop } from "@/lib/sms/texte";
import { CATALOGUE_MESSAGES, definitionMessage, type CodeMessage, type VariableMessage, type VarianteMessage } from "./catalogue";
import { estPrenomConnu, normaliserPrenom } from "./prenoms";

/* ── Prénom fiable ──────────────────────────────────────────────────────────── */

const PAS_UN_PRENOM = new Set([
  "inconnu", "inconnue", "client", "cliente", "madame", "monsieur", "mme", "mr", "m", "mlle", "melle", "mademoiselle", "test", "essai", "ok", "oui", "non", "nan", "null",
  "undefined", "contact", "famille", "sas", "sarl", "sci", "eurl", "sa", "entreprise", "societe", "société", "particulier", "x", "xx", "xxx", "aucun", "na", "n/a",
]);

/** « marie-claire » → « Marie-Claire » ; « MARIE » → « Marie ». */
function enCasse(mot: string): string {
  return mot
    .toLowerCase()
    .split(/([-'’])/)
    .map((partie) => (/^[-'’]$/.test(partie) ? partie : partie.charAt(0).toUpperCase() + partie.slice(1)))
    .join("");
}

/** Les mots d'un nom, minuscules sans accent, sans initiale ni mot de remplissage (« Mme », « Inconnu », « et »). */
function motsDuNom(...parties: (string | null | undefined)[]): Set<string> {
  const mots = parties
    .join(" ")
    .split(/[^\p{L}]+/u)
    .map(normaliserPrenom)
    .filter((m) => m.length >= 2 && m !== "et" && !PAS_UN_PRENOM.has(m));
  return new Set(mots);
}

const inclus = (a: Set<string>, b: Set<string>) => [...a].every((m) => b.has(m));

/**
 * Le prénom qu'on peut écrire au client, ou null (« Bonjour, » tout court vaut mieux qu'un prénom faux). Corrections
 * du 12/10, toutes requises :
 * - la fiche sépare le prénom du nom : les deux champs remplis (fiche client, puis lead) ;
 * - toutes les fiches parlent de la même personne : les mots de chaque nom connu (fiche client, lead, `autresNoms` :
 *   nom affiché du client, nom du dossier) sont contenus les uns dans les autres — un lead et une fiche client aux noms
 *   différents, pas de prénom ;
 * - un seul mot (prénom composé à trait d'union permis), lettres seules, 2 à 20 caractères, ni mot de remplissage ;
 * - pas un nom de famille (celui d'aucune fiche) ;
 * - un prénom reconnu (prenoms.ts) : ni pseudo, ni surnom, ni nom de famille rangé à la place du prénom.
 */
export function prenomFiable(candidats: { prenom?: string | null; nom?: string | null }[], autresNoms: (string | null | undefined)[] = []): string | null {
  const identites = [...candidats.map((c) => motsDuNom(c.prenom, c.nom)), ...autresNoms.map((n) => motsDuNom(n))].filter((m) => m.size > 0);
  for (let i = 0; i < identites.length; i++) for (let j = i + 1; j < identites.length; j++) if (!inclus(identites[i], identites[j]) && !inclus(identites[j], identites[i])) return null;
  const nomsDeFamille = new Set(candidats.flatMap((c) => [...motsDuNom(c.nom)]));
  for (const { prenom, nom } of candidats) {
    const brut = (prenom ?? "").trim();
    if (!brut || motsDuNom(nom).size === 0) continue;
    if (!/^\p{L}[\p{L}-]{1,19}$/u.test(brut)) continue;
    const bas = normaliserPrenom(brut);
    if (PAS_UN_PRENOM.has(bas) || bas.split("-").some((m) => nomsDeFamille.has(m))) continue;
    if (!estPrenomConnu(brut)) continue;
    return enCasse(brut);
  }
  return null;
}

/** « Bonjour Marie, » ou « Bonjour, ». */
export const formuleBonjour = (prenom: string | null) => (prenom ? `Bonjour ${prenom},` : "Bonjour,");

/* ── Pièce ──────────────────────────────────────────────────────────────────── */

export type Piece = { nom: string; feminin: boolean; connue: boolean };
const PIECES: Record<string, Piece> = {
  CUISINE: { nom: "cuisine", feminin: true, connue: true },
  SDB: { nom: "salle de bain", feminin: true, connue: true },
  MEUBLES: { nom: "mobilier", feminin: false, connue: true },
  PRO: { nom: "local", feminin: false, connue: true },
};
export const PIECE_INCONNUE: Piece = { nom: "intérieur", feminin: false, connue: false };

/** La pièce d'après les familles du projet (la première), sinon le type de projet du lead. */
export function pieceDe(familles: readonly string[], typeProjet?: string | null): Piece {
  for (const famille of familles) if (PIECES[famille]) return PIECES[famille];
  if (typeProjet && PIECES[typeProjet]) return PIECES[typeProjet];
  return PIECE_INCONNUE;
}

/* ── Remplissage ────────────────────────────────────────────────────────────── */

export type ValeursMessage = Partial<Record<VariableMessage, string | null>>;

/**
 * Remplit un texte : accords de la pièce (« votre mobilier rénové », « votre nouveau local »), pièce inconnue
 * (« votre projet de rénovation », « votre intérieur »), variables, espaces et ponctuation. Une variable sans valeur
 * disparaît ; `manquantes` dit lesquelles, pour que l'appelant choisisse une autre variante ou retienne le message.
 */
export function remplirTexte(texte: string, valeurs: ValeursMessage, piece: Piece): { texte: string; manquantes: VariableMessage[] } {
  let t = texte;
  if (!piece.connue) t = t.replace(/projet de \{piece\}/g, "projet de rénovation");
  // « nouvel intérieur », « nouveau local » : devant une voyelle, nouvel.
  if (!piece.feminin) t = t.replace(/\{piece\} rénovée/g, "{piece} rénové").replace(/nouvelle \{piece\}/g, /^[aeiouyàâéèêëîïôûüh]/i.test(piece.nom) ? "nouvel {piece}" : "nouveau {piece}");
  const manquantes: VariableMessage[] = [];
  const rempli = t
    .replace(/\{(\w+)\}/g, (_tout, nom: string) => {
      if (nom === "piece") return piece.nom;
      const valeur = (valeurs as Record<string, string | null | undefined>)[nom];
      if (valeur === undefined || valeur === null || valeur === "") {
        manquantes.push(nom as VariableMessage);
        return "";
      }
      return valeur.trim();
    })
    .replace(/ {2,}/g, " ")
    .replace(/ +([,.])/g, "$1")
    .replace(/^Bonjour ,/, "Bonjour,")
    .trim();
  return { texte: rempli, manquantes };
}

/** Le texte de la liste pour un code et une variante (le texte par défaut si la variante n'existe pas). */
export function texteDeLaListe(code: CodeMessage, variante: VarianteMessage, surcharges?: Record<string, string>): string {
  const cle = variante === "defaut" ? code : `${code}.${variante}`;
  if (surcharges?.[cle]) return surcharges[cle];
  const textes = definitionMessage(code).textes as Partial<Record<VarianteMessage, string>>;
  return textes[variante] ?? (surcharges?.[code] || textes.defaut!);
}

/** Le premier SMS envoyé à un numéro finit par la mention STOP (règle déjà codée côté fournisseur, reprise ici). */
export function avecStopSiPremier(texte: string, premierSms: boolean): string {
  return premierSms ? avecMentionStop(texte) : texte;
}

/* ── Liens d'envoi ──────────────────────────────────────────────────────────── */

export type Plateforme = "IOS" | "ANDROID" | "AUTRE";

/** iPhone, iPad, Mac : « sms:+336…&body=… » ; Android et le reste : « sms:+336…?body=… ». */
export function plateformeDe(agent: string | null | undefined): Plateforme {
  const a = agent ?? "";
  if (/iPhone|iPad|iPod|Macintosh/.test(a)) return "IOS";
  if (/Android/.test(a)) return "ANDROID";
  return "AUTRE";
}

/** Le lien qui ouvre Messages avec le numéro et le texte remplis. */
export function lienSms(numero: string, texte: string, plateforme: Plateforme): string {
  const corps = encodeURIComponent(texte);
  return plateforme === "IOS" ? `sms:${numero}&body=${corps}` : `sms:${numero}?body=${corps}`;
}

/** Le lien qui ouvre le mail avec l'adresse, l'objet et le texte remplis. */
export function lienMail(adresse: string, objet: string, texte: string): string {
  return `mailto:${adresse}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(texte)}`;
}

/** L'objet d'un message parti par mail (pas de mobile) : le libellé du code, sans jargon. */
export function objetMail(code: string): string {
  const definition = CATALOGUE_MESSAGES.find((m) => m.code === code);
  if (!definition) return "CoverSwap";
  switch (definition.groupe) {
    case "DEVIS":
      return "Votre devis CoverSwap";
    case "SIMULATION":
      return "Votre simulation CoverSwap";
    case "PHOTOS":
      return "Vos photos pour CoverSwap";
    case "CHANTIER":
    case "APRES":
      return "Votre chantier CoverSwap";
    default:
      return "Votre projet CoverSwap";
  }
}
