import { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel } from "./constantes";

/**
 * Mission 14 (29/09/2026), partie 2 — lire un appel déjà noté : a-t-il abouti ?
 * Pur, sans base (partagé par la migration de la partie 2 et le décompte des
 * tentatives de la partie 3).
 *
 * Un appel est « sans réponse » si son issue, une de ses étiquettes ou son
 * texte le dit : issue PAS_DE_REPONSE, étiquette PAS_JOIGNABLE, ou « pas de
 * réponse », « ne répond pas », « pas répondu », « pas joignable »,
 * « injoignable », « messagerie », « répondeur », « occupé » (sans casse, accents
 * tolérés). Les codes se lisent comme du texte (« PAS_DE_REPONSE » → « pas de
 * reponse ») : une issue ajoutée plus tard (messagerie, occupé) est reconnue.
 */

/** Minuscules, sans accents ni tirets bas : « Répondeur » → « repondeur », « PAS_JOIGNABLE » → « pas joignable ». */
const aplatir = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").replace(/_/g, " ").toLowerCase();

const SANS_REPONSE = /\b(pas de reponse|(ne )?repond pas|pas repondu|pas joignable|injoignable|messagerie|repondeur|occupee?)\b/;

/** Une demande de rappel écrite vite : « rappeler », « rapeller », « rapeler », « rappeller ». */
export const MOTIF_RAPPELER = /rap+el+er/i;

export type AppelLu = {
  /** Code d'issue (NoteAppel.issue, metadata.issue d'un événement APPEL), ou null. */
  issue?: string | null;
  /** Codes d'étiquette d'une note d'appel. */
  etiquettes?: readonly string[];
  /** Ce qui est écrit : contenu de l'échange ou de l'événement, texte de la note. */
  texte?: string | null;
};

export function estSansReponse(appel: AppelLu): boolean {
  return [appel.issue ?? "", ...(appel.etiquettes ?? []), appel.texte ?? ""].some((texte) => SANS_REPONSE.test(aplatir(texte)));
}

/** L'issue d'un échange écrit par la fin d'appel : « Appel — Pas de réponse : … » → PAS_DE_REPONSE ; saisi à la main → null. */
export function issueDuContenu(contenu: string): IssueAppel | null {
  return ISSUES_APPEL.find((issue) => new RegExp(`^Appel — ${LIBELLES_ISSUE[issue]}( :|$)`).test(contenu.trim())) ?? null;
}

/**
 * Ce que Lucas a écrit, sans le libellé d'issue que la fin d'appel met en tête :
 * « Appel — À rappeler : lundi » (échange d'appel) ou « À rappeler — lundi »
 * (note de dossier) → « lundi » ; « Appel — Pas de réponse » → « ». L'issue se
 * lit à part (`issueDuContenu`, métadonnées) : le libellé « À rappeler » n'est
 * pas une note. Un texte saisi à la main revient tel quel.
 */
export function sansLibelleIssue(contenu: string): string {
  const texte = contenu.trim();
  for (const issue of ISSUES_APPEL) {
    const libelle = LIBELLES_ISSUE[issue];
    if (texte === `Appel — ${libelle}`) return "";
    for (const tete of [`Appel — ${libelle} : `, `${libelle} — `]) if (texte.startsWith(tete)) return texte.slice(tete.length);
  }
  return texte;
}
