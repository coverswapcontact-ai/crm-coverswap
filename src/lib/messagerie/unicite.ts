/**
 * Mission 25 (corrections du 12/10) — un seul message préparé par client à la fois. Les relances d'une même étape (le
 * même devis, le même lot de simulations, les mêmes appels manqués) se remplacent : quand plusieurs sont voulues en même
 * temps (relances en retard au démarrage : D2 et D4 d'un devis vieux de douze jours), la plus avancée reste, les autres
 * sont annulées (déjà écrites) ou ne sont pas préparées. D3 passe devant D4 : il n'existe que si le devis a été ouvert,
 * il en parle. Entre deux étapes, la garde fait attendre le second message tant que le premier n'est pas parti
 * (garde.ts, « attend déjà ta confirmation »). Pur.
 */
import { definitionMessage, estCodeMessage, type CodeMessage } from "./catalogue";
import { STATUTS_OUVERTS, type StatutMessage } from "./types";

/** Rang dans son étape : plus haut = plus avancé. */
const RANGS: Partial<Record<CodeMessage, number>> = {
  A2: 1,
  A4: 2,
  A5: 3,
  P2: 1,
  P3: 2,
  S3: 1,
  S4: 2,
  S5: 3,
  D2: 1,
  D4: 2,
  D3: 3,
  D5: 4,
  C4: 1,
  C5: 2,
  R1: 1,
  R2: 2,
};

export const rangDe = (code: string): number => RANGS[code as CodeMessage] ?? 0;

/**
 * L'étape d'un message et ce qu'elle vise (« DEVIS|<devis> », « CONTACT|suivi:<id> »), ou null pour un message qui ne
 * se remplace pas (premier contact, événements, réponses, messages rapides).
 */
export function etapeDe(code: string, cle: string): string | null {
  if (!estCodeMessage(code) || !RANGS[code as CodeMessage]) return null;
  const etape = definitionMessage(code as CodeMessage).etape;
  return etape ? `${etape}|${cle.slice(cle.indexOf(":") + 1)}` : null;
}

type Candidat = { code: string; cle: string };
type Connu = Candidat & { id: string; statut: StatutMessage | string; motif?: string | null };

/**
 * Un message connu tient sa place dans l'étape s'il est ouvert, parti, retenu ou non envoyé — ou annulé par Lucas, ou
 * remplacé par un plus avancé. Annulé parce que la situation a changé (le client a réagi, le devis a changé), il laisse
 * la suite de l'étape continuer : D3 annulé n'empêche pas D4.
 */
const tientSaPlace = (m: Connu) => m.statut !== "ANNULE" || /^(annulé par toi|remplacé par )/.test(m.motif ?? "");

/** Le message déjà connu (ouvert, parti, ou annulé par Lucas) plus avancé dans la même étape, ou null. */
export function plusAvanceConnu(candidat: Candidat & { id?: string }, messages: readonly Connu[]): Connu | null {
  const etape = etapeDe(candidat.code, candidat.cle);
  if (!etape) return null;
  return messages.filter((m) => m.id !== candidat.id && tientSaPlace(m) && etapeDe(m.code, m.cle) === etape && rangDe(m.code) > rangDe(candidat.code)).sort((a, b) => rangDe(b.code) - rangDe(a.code))[0] ?? null;
}

/**
 * Un seul par étape : des intentions voulues maintenant et des messages connus, garde la plus avancée de chaque étape.
 * Rend les intentions à préparer et les messages ouverts à annuler, avec le code qui les remplace.
 */
export function unSeulParEtape<I extends Candidat>(intentions: readonly I[], messages: readonly Connu[]): { gardees: I[]; remplaces: { messageId: string; par: string }[] } {
  const meilleur = new Map<string, Candidat>();
  for (const c of [...messages.filter(tientSaPlace), ...intentions]) {
    const etape = etapeDe(c.code, c.cle);
    if (!etape) continue;
    const actuel = meilleur.get(etape);
    if (!actuel || rangDe(c.code) > rangDe(actuel.code)) meilleur.set(etape, c);
  }
  const gardees = intentions.filter((i) => {
    const etape = etapeDe(i.code, i.cle);
    return !etape || meilleur.get(etape) === i;
  });
  const remplaces: { messageId: string; par: string }[] = [];
  for (const m of messages) {
    const etape = etapeDe(m.code, m.cle);
    const tete = etape ? meilleur.get(etape) : null;
    if (tete && tete !== m && (STATUTS_OUVERTS as readonly string[]).includes(m.statut) && rangDe(tete.code) > rangDe(m.code)) remplaces.push({ messageId: m.id, par: tete.code });
  }
  return { gardees, remplaces };
}
