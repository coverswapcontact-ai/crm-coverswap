/**
 * Calibrage Sunburst (consigne du gérant du 07/10, mission 23) — le budget de la campagne, tenu dans SON journal
 * (`~/coverswap-photos/sunburst-23/journal.json`, hors dépôt), jamais dans `GenerationImage` : 2,30 $ au plus, en quatre
 * enveloppes ayant chacune son plafond, relu avant CHAQUE appel (rendu et vision). Fonctions pures : le script lit et
 * écrit le fichier, ces fonctions décident.
 *  - un appel qui ferait dépasser l'enveloppe ou 2,30 $ n'est pas lancé ;
 *  - un appel raté n'est rejoué qu'une fois ;
 *  - un appel qui coûte plus du double de son estimation arrête tout (plus aucun appel n'est autorisé ensuite) ;
 *  - l'argent non dépensé d'une enveloppe ne passe à une autre que par un report écrit, avec sa justification.
 */

export const BUDGET_DOLLARS = 2.3;
export type Enveloppe = "E1" | "E2" | "E3" | "E4";
export type PhaseCampagne = "S1" | "S2" | "S3" | "S4";

/** Part de chaque enveloppe (consigne) : masque automatique, familles faibles, familles fortes, validation. */
export const ENVELOPPES: Record<Enveloppe, { part: number; phase: PhaseCampagne; libelle: string }> = {
  E1: { part: 0.1, phase: "S1", libelle: "masque automatique" },
  E2: { part: 0.6, phase: "S2", libelle: "familles faibles (beiges / taupes, bois clairs)" },
  E3: { part: 0.15, phase: "S3", libelle: "familles fortes avec le masque automatique" },
  E4: { part: 0.15, phase: "S4", libelle: "validation sur photos jamais vues" },
};
export const enveloppeDe = (phase: PhaseCampagne): Enveloppe => (Object.entries(ENVELOPPES).find(([, e]) => e.phase === phase)![0] as Enveloppe);

/** Estimation d'un rendu Sunburst medium avec planche et masque : le plus cher des 45 rendus de la mission 24 (0,0431 $), + 1 %. */
export const ESTIMATION_RENDU = 0.0435;

export type AppelJournal = {
  n: number;
  le: string;
  phase: PhaseCampagne;
  enveloppe: Enveloppe;
  type: "rendu" | "vision";
  modele: string;
  /** Ce qui identifie l'appel (pour la règle « rejoué une fois ») : photo, teinte, tour… */
  cle: string;
  estimation: number;
  /** Coût réel par jetons (0 si l'appel a échoué sans réponse facturée). */
  cout: number;
  cumul: number;
  usage: { entree?: number; texte?: number; image?: number; sortie: number } | null;
  erreur: string | null;
  fichier?: string | null;
  /** Ce que l'appel a donné, mesuré (score, ΔE, IoU…). */
  mesure?: unknown;
};

export type Report = { le: string; de: Enveloppe; vers: Enveloppe; montant: number; justification: string };
export type Journal = { appels: AppelJournal[]; reports: Report[]; arret?: { le: string; raison: string } };

export const journalVide = (): Journal => ({ appels: [], reports: [] });
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

export const cumul = (j: Journal) => r4(j.appels.reduce((s, a) => s + a.cout, 0));
export const depenseEnveloppe = (j: Journal, e: Enveloppe) => r4(j.appels.filter((a) => a.enveloppe === e).reduce((s, a) => s + a.cout, 0));

/** Le plafond d'une enveloppe : sa part de 2,30 $, plus les reports reçus, moins les reports cédés. */
export function plafondEnveloppe(j: Journal, e: Enveloppe): number {
  const recu = j.reports.filter((r) => r.vers === e).reduce((s, r) => s + r.montant, 0);
  const cede = j.reports.filter((r) => r.de === e).reduce((s, r) => s + r.montant, 0);
  return r4(ENVELOPPES[e].part * BUDGET_DOLLARS + recu - cede);
}

export type Autorisation = { ok: true; cumul: number; enveloppe: number; plafond: number } | { ok: false; raison: string };

/** Relu avant CHAQUE appel. */
export function autoriserAppel(j: Journal, e: Enveloppe, estimation: number, cle: string): Autorisation {
  if (j.arret) return { ok: false, raison: `campagne arrêtée le ${j.arret.le} : ${j.arret.raison}` };
  if (!(estimation > 0)) return { ok: false, raison: "estimation absente : aucun appel sans coût estimé" };
  const total = cumul(j);
  const dansEnveloppe = depenseEnveloppe(j, e);
  const plafond = plafondEnveloppe(j, e);
  if (dansEnveloppe + estimation > plafond + 1e-9) return { ok: false, raison: `enveloppe ${e} : ${dansEnveloppe.toFixed(4)} $ + ${estimation.toFixed(4)} $ dépasserait ${plafond.toFixed(4)} $` };
  if (total + estimation > BUDGET_DOLLARS + 1e-9) return { ok: false, raison: `budget : ${total.toFixed(4)} $ + ${estimation.toFixed(4)} $ dépasserait ${BUDGET_DOLLARS} $` };
  const echecs = j.appels.filter((a) => a.cle === cle && a.erreur).length;
  const reussis = j.appels.filter((a) => a.cle === cle && !a.erreur).length;
  if (reussis > 0) return { ok: false, raison: `${cle} : déjà fait (une nouvelle tentative porte une autre clé)` };
  if (echecs >= 2) return { ok: false, raison: `${cle} : déjà raté puis rejoué une fois` };
  return { ok: true, cumul: total, enveloppe: dansEnveloppe, plafond };
}

/** Après un appel : l'inscrit et pose l'arrêt si son coût dépasse le double de l'estimation. */
export function inscrireAppel(j: Journal, appel: Omit<AppelJournal, "n" | "cumul">): { journal: Journal; appel: AppelJournal; arret: boolean } {
  const n = (j.appels.at(-1)?.n ?? 0) + 1;
  const complet: AppelJournal = { ...appel, n, cout: r4(appel.cout), cumul: r4(cumul(j) + appel.cout) };
  const arret = appel.cout > 2 * appel.estimation;
  const journal: Journal = { ...j, appels: [...j.appels, complet], ...(arret ? { arret: { le: appel.le, raison: `appel n°${n} à ${appel.cout.toFixed(4)} $ pour ${appel.estimation.toFixed(4)} $ estimés (plus du double)` } } : {}) };
  return { journal, appel: complet, arret };
}

/** Un report d'une enveloppe à une autre : seulement ce qui reste, et jamais sans justification écrite. */
export function reporter(j: Journal, de: Enveloppe, vers: Enveloppe, montant: number, justification: string, le = new Date().toISOString()): Journal {
  if (de === vers) throw new Error("Report vers la même enveloppe.");
  if (!(montant > 0)) throw new Error("Report sans montant.");
  if (justification.trim().length < 20) throw new Error("Un report demande une justification écrite (une phrase au moins).");
  const reste = plafondEnveloppe(j, de) - depenseEnveloppe(j, de);
  if (montant > reste + 1e-9) throw new Error(`Report de ${montant} $ : il ne reste que ${r4(reste)} $ dans ${de}.`);
  return { ...j, reports: [...j.reports, { le, de, vers, montant: r4(montant), justification: justification.trim() }] };
}

/** La ligne affichée après chaque appel. */
export function ligneCumul(j: Journal, e: Enveloppe): string {
  return `CUMUL ${cumul(j).toFixed(4)} $ / ${BUDGET_DOLLARS} $ — enveloppe ${e} (${ENVELOPPES[e].libelle}) ${depenseEnveloppe(j, e).toFixed(4)} $ / ${plafondEnveloppe(j, e).toFixed(4)} $`;
}

/** Le total affiché après chaque phase. */
export function totalPhase(j: Journal, phase: PhaseCampagne): { appels: number; rendus: number; vision: number; echecs: number; cout: number; cumul: number } {
  const liste = j.appels.filter((a) => a.phase === phase);
  return { appels: liste.length, rendus: liste.filter((a) => a.type === "rendu").length, vision: liste.filter((a) => a.type === "vision").length, echecs: liste.filter((a) => a.erreur).length, cout: r4(liste.reduce((s, a) => s + a.cout, 0)), cumul: cumul(j) };
}
