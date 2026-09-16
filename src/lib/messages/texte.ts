// Lecture des mails : texte brut depuis le HTML, historique cité retiré,
// adresses, et ce qu'un mail dit de son auteur (téléphone, code postal).
// Fonctions pures, testées. Le HTML d'un mail n'est jamais affiché tel quel
// dans le CRM : seul le texte extrait l'est.

const ENTITES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ouml: "ö",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  oelig: "œ",
  Eacute: "É",
  Egrave: "È",
  Agrave: "À",
  Ccedil: "Ç",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  euro: "€",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
  zwnj: "",
  zwj: "",
  shy: "",
};

export function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entite, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const valeur = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(valeur) && valeur > 0 && valeur < 0x110000 ? String.fromCodePoint(valeur) : entite;
    }
    if (code.startsWith("#")) {
      const valeur = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(valeur) && valeur > 0 && valeur < 0x110000 ? String.fromCodePoint(valeur) : entite;
    }
    return ENTITES[code] ?? entite;
  });
}

/** Espaces normalisés, lignes vides en trop retirées. */
export function nettoyerTexte(texte: string): string {
  return texte
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .split("\n")
    .map((ligne) => ligne.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlEnTexte(html: string): string {
  const sansBlocs = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|h[1-6]|li|ul|ol|table|blockquote)>/gi, "\n")
    .replace(/<(p|div|tr|h[1-6]|table|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return nettoyerTexte(decoderEntites(sansBlocs));
}

// Début de l'historique cité d'une réponse ou d'un transfert.
const MARQUEURS_CITATION: RegExp[] = [
  // « Le lun. 14 sept. 2026 à 10:02, Lucas <…> a écrit : », coupé n'importe où par un retour à la ligne.
  /^Le (?:[^\n]|\n(?!\n)){3,300}?\ba\s+écrit\s?:/m,
  /^On (?:[^\n]|\n(?!\n)){3,300}?\bwrote\s?:/m,
  /^-{2,} ?(?:Message d'origine|Message transféré|Original Message|Forwarded message) ?-{2,}/im,
  /^_{10,}\s*$/m,
  /^De ?: [^\n]+\n(?:[^\n]*\n){0,3}?(?:Envoyé|Date) ?: /m,
  /^From: [^\n]+\n(?:[^\n]*\n){0,3}?(?:Sent|Date): /m,
];

/** Le texte écrit par l'auteur, sans l'historique cité (le texte complet reste consultable). */
export function retirerCitations(texte: string): string {
  let fin = texte.length;
  for (const marqueur of MARQUEURS_CITATION) {
    const trouve = marqueur.exec(texte);
    if (trouve && trouve.index < fin) fin = trouve.index;
  }
  let utile = texte.slice(0, fin);
  // Lignes citées « > » en fin de texte.
  const lignes = utile.split("\n");
  while (lignes.length > 0 && (/^\s*>/.test(lignes[lignes.length - 1]) || lignes[lignes.length - 1].trim() === "")) lignes.pop();
  utile = nettoyerTexte(lignes.join("\n"));
  return utile || nettoyerTexte(texte);
}

export type Adresse = { adresse: string; nom: string | null };

/** « "Alice Durand" <Alice@Example.fr> » → { adresse: "alice@example.fr", nom: "Alice Durand" }. */
export function lireAdresse(valeur: string | null | undefined): Adresse | null {
  const brute = (valeur ?? "").trim();
  if (!brute) return null;
  const chevrons = /^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/.exec(brute);
  const adresse = (chevrons ? chevrons[2] : brute).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse)) return null;
  const nom = chevrons ? decoderEntites(chevrons[1]).replace(/^["'\s]+|["'\s]+$/g, "").replace(/\\"/g, '"').trim() : "";
  return { adresse, nom: nom && nom.toLowerCase() !== adresse ? nom.slice(0, 120) : null };
}

/** Liste d'adresses d'un en-tête To ou Cc (virgules hors guillemets). */
export function lireAdresses(valeur: string | null | undefined): Adresse[] {
  const morceaux: string[] = [];
  let courant = "";
  let guillemets = false;
  for (const caractere of valeur ?? "") {
    if (caractere === '"') guillemets = !guillemets;
    if (caractere === "," && !guillemets) {
      morceaux.push(courant);
      courant = "";
    } else {
      courant += caractere;
    }
  }
  morceaux.push(courant);
  return morceaux.map(lireAdresse).filter((adresse): adresse is Adresse => adresse !== null);
}

/** « Re: TR : Fwd: Devis » → « Devis ». */
export function objetSansPrefixes(objet: string | null | undefined): string {
  let resultat = (objet ?? "").trim();
  for (;;) {
    const suivant = resultat.replace(/^(re|tr|fw|fwd|réf|ref)\s*(\[\d+\])?\s*:\s*/i, "");
    if (suivant === resultat) return resultat;
    resultat = suivant;
  }
}

/** Adresse d'envoi automatique (noreply, notifications…) : un signal de bruit, jamais une preuve. */
export function estAdresseAutomatique(adresse: string): boolean {
  const locale = adresse.split("@")[0] ?? "";
  return /^(no-?reply|do-?not-?reply|ne-?pas-?repondre|nepasrepondre|noreponse|notifications?|newsletters?|mailer-daemon|postmaster|bounces?|info-?lettre|marketing|news|alerts?|automated)([._+-]|$)/i.test(
    locale
  );
}

/** Premier numéro de téléphone français écrit dans le texte, tel qu'écrit. */
export function trouverTelephone(texte: string): string | null {
  const trouve = /(?<![\d+])(?:\+33\s?\(?0?\)?\s?|0033\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/.exec(texte);
  return trouve ? trouve[0].trim() : null;
}

/** « 34000 Montpellier » écrit sur une ligne du texte. */
export function trouverCodePostalVille(texte: string): { codePostal: string; ville: string } | null {
  for (const ligne of texte.split("\n")) {
    const trouve = /(?<!\d)((?:0[1-9]|[1-8]\d|9[0-5]|97)\d{3})\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?:[ -][A-Za-zÀ-ÿ'’]+){0,3})\s*$/.exec(ligne.trim());
    if (trouve) return { codePostal: trouve[1], ville: trouve[2].trim() };
  }
  return null;
}

/** « Alice Durand » → prénom et nom ; un seul mot reste le nom. */
export function decouperNom(nom: string | null | undefined): { prenom: string | null; nomFamille: string | null } {
  const mots = (nom ?? "").replace(/[()"]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return { prenom: null, nomFamille: null };
  if (mots.length === 1) return { prenom: null, nomFamille: mots[0] };
  return { prenom: mots[0], nomFamille: mots.slice(1).join(" ") };
}

/** Tronque sans couper un caractère combiné en deux. */
export function tronquer(texte: string, longueur: number): string {
  if (texte.length <= longueur) return texte;
  return `${Array.from(texte.slice(0, longueur + 1)).slice(0, -1).join("").slice(0, longueur)}…`;
}
