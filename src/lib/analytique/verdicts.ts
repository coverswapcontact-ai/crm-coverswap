import type { Verdict } from "./types";

/**
 * Mission 17 (partie B) — le verdict par publicité, d'après le protocole de campagne des consignes (docs/ANALYTIQUE.md
 * § 4). Pur. Les bornes des tranches de jours sont lues dans le texte du protocole quand il les donne (« Jours 8 à 14 :
 * on coupe… »), sinon celles du protocole par défaut :
 * - jours 1 à 3 (apprentissage) : ATTENDRE, on ne touche à rien ;
 * - jours 4 à 7 (lecture) : GARDER, on lit le coût par lead sans changer le budget ;
 * - jours 8 à 14 (coupe) : COUPER si le coût par lead dépasse 2 × celui de la meilleure publicité ET la publicité a au
 *   moins 5 leads ; SURVEILLER si elle dépasse 2 × avec moins de 5 leads (ou si elle a dépensé plus de 2 × le coût par
 *   lead de la meilleure sans aucun lead) ; sinon GARDER. La meilleure = le plus faible coût par lead parmi les
 *   publicités d'au moins 5 leads, à défaut parmi celles qui ont au moins un lead ;
 * - jours 15 et suivants (bilan) : au coût par chantier signé (≤ 300 € : GARDER, au-delà : COUPER) ; sans signature,
 *   au coût par devis (≤ 300 € : SURVEILLER, en attente de signature) ; ni devis ni signature après 300 € dépensés :
 *   COUPER ; sinon SURVEILLER.
 * Sans dépense connue pour la publicité (pas de synchronisation Meta : le budget n'est connu qu'en total), pas de
 * verdict chiffré : null, avec la raison.
 */

export const SEUIL_COUT_CHANTIER = 300;
export const MULTIPLE_COUPE = 2;
export const LEADS_MINIMUM = 5;

export type Tranches = { apprentissage: [number, number]; lecture: [number, number]; coupe: [number, number]; bilan: [number, number] };
export const TRANCHES_DEFAUT: Tranches = { apprentissage: [1, 3], lecture: [4, 7], coupe: [8, 14], bilan: [15, 21] };

/** Les tranches du protocole lues dans le texte des consignes (mots-clés par ligne), sinon celles par défaut. */
export function tranchesDuProtocole(protocole: string): Tranches {
  const t: Tranches = { ...TRANCHES_DEFAUT };
  for (const ligne of protocole.split("\n")) {
    const plage = /jours?\s+(\d+)\s*(?:à|-|–)\s*(\d+)\s*:\s*(.+)$/i.exec(ligne);
    if (!plage) continue;
    const bornes: [number, number] = [Number(plage[1]), Number(plage[2])];
    const texte = plage[3].toLowerCase();
    if (/coup/.test(texte) && /double|2\s*×|deux fois/.test(texte)) t.coupe = bornes;
    else if (/renouvel|bilan|chantier sign|par devis/.test(texte)) t.bilan = bornes;
    else if (/apprentissage|touche à rien|touche a rien/.test(texte)) t.apprentissage = bornes;
    else if (/lit|lire|sans changer/.test(texte)) t.lecture = bornes;
  }
  return t;
}

export type EntreeVerdict = { id: string; depense: number | null; leads: number; devis: number; signes: number };
export type ResultatVerdict = { verdict: Verdict | null; raison: string };

const eur = (v: number) => `${Math.round(v * 100) / 100} €`.replace(".", ",");
/** Coût par lead : seulement avec une dépense réelle POSITIVE (relecture B, point 2 : une publicité sans dépense rattachée n'a pas un coût de 0 €). */
const cpl = (l: Pick<EntreeVerdict, "depense" | "leads">) => (l.depense !== null && l.depense > 0 && l.leads > 0 ? l.depense / l.leads : null);

/** Le coût par lead de la meilleure publicité (null si aucune n'a de lead et de dépense positive). */
export function meilleurCoutParLead(lignes: readonly Pick<EntreeVerdict, "depense" | "leads">[]): number | null {
  const avecCout = lignes.map((l) => ({ l, c: cpl(l) })).filter((x): x is { l: Pick<EntreeVerdict, "depense" | "leads">; c: number } => x.c !== null);
  const solides = avecCout.filter((x) => x.l.leads >= LEADS_MINIMUM);
  const base = solides.length ? solides : avecCout;
  return base.length ? Math.min(...base.map((x) => x.c)) : null;
}

export function verdictDe(ligne: EntreeVerdict, jour: number | null, meilleur: number | null, tranches: Tranches = TRANCHES_DEFAUT): ResultatVerdict {
  if (jour === null || jour < 1) return { verdict: null, raison: "Aucune campagne en cours : pas de verdict du protocole." };
  if (jour <= tranches.apprentissage[1]) return { verdict: "ATTENDRE", raison: `Jour ${jour} : apprentissage, on ne touche à rien.` };
  if (jour <= tranches.lecture[1]) return { verdict: "GARDER", raison: `Jour ${jour} : on lit le coût par lead sans changer le budget.` };
  if (ligne.depense === null) return { verdict: null, raison: "Dépense par publicité inconnue (synchronisation Meta non branchée) : pas de coût par lead propre à cette publicité." };
  if (ligne.depense <= 0 && ligne.leads > 0) return { verdict: "SURVEILLER", raison: "Des leads mais aucune dépense rattachée à cette publicité : vérifier son rattachement dans Meta avant de juger." };
  if (jour <= tranches.coupe[1]) {
    const c = cpl(ligne);
    if (meilleur === null) return { verdict: ligne.depense > 0 ? "SURVEILLER" : "ATTENDRE", raison: "Aucune publicité n'a encore de lead : pas de meilleure pour comparer." };
    if (c === null) return ligne.depense > MULTIPLE_COUPE * meilleur ? { verdict: "SURVEILLER", raison: `${eur(ligne.depense)} dépensés sans lead, plus de 2 × le coût par lead de la meilleure (${eur(meilleur)}).` } : { verdict: "GARDER", raison: "Pas encore de lead, dépense encore faible." };
    if (c > MULTIPLE_COUPE * meilleur) return ligne.leads >= LEADS_MINIMUM ? { verdict: "COUPER", raison: `Coût par lead ${eur(c)}, plus de 2 × la meilleure (${eur(meilleur)}), sur ${ligne.leads} leads.` } : { verdict: "SURVEILLER", raison: `Coût par lead ${eur(c)}, plus de 2 × la meilleure (${eur(meilleur)}), mais seulement ${ligne.leads} lead${ligne.leads > 1 ? "s" : ""}.` };
    return { verdict: "GARDER", raison: `Coût par lead ${eur(c)}, dans les 2 × de la meilleure (${eur(meilleur)}).` };
  }
  if (ligne.signes > 0) {
    const parSigne = ligne.depense / ligne.signes;
    return parSigne <= SEUIL_COUT_CHANTIER ? { verdict: "GARDER", raison: `Coût par chantier signé ${eur(parSigne)}, sous ${SEUIL_COUT_CHANTIER} €.` } : { verdict: "COUPER", raison: `Coût par chantier signé ${eur(parSigne)}, au-dessus de ${SEUIL_COUT_CHANTIER} €.` };
  }
  if (ligne.devis > 0) {
    const parDevis = ligne.depense / ligne.devis;
    return parDevis <= SEUIL_COUT_CHANTIER ? { verdict: "SURVEILLER", raison: `Coût par devis ${eur(parDevis)}, aucune signature encore.` } : { verdict: "COUPER", raison: `Coût par devis ${eur(parDevis)}, au-dessus de ${SEUIL_COUT_CHANTIER} €, aucune signature.` };
  }
  return ligne.depense > SEUIL_COUT_CHANTIER ? { verdict: "COUPER", raison: `${eur(ligne.depense)} dépensés sans devis ni signature.` } : { verdict: "SURVEILLER", raison: "Ni devis ni signature encore." };
}

/** Le verdict de chaque publicité (clé : son identifiant). */
export function verdictsDesPublicites(lignes: readonly EntreeVerdict[], jour: number | null, tranches: Tranches = TRANCHES_DEFAUT): Map<string, ResultatVerdict> {
  const meilleur = meilleurCoutParLead(lignes);
  return new Map(lignes.map((l) => [l.id, verdictDe(l, jour, meilleur, tranches)]));
}
