import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { alertesAnalytique } from "./alertes";
import { etatsDesSources } from "./appuis";
import { ECRANS } from "./ecrans";
import { memoiser, tamponAnalytique, viderCacheAnalytique } from "./memoire";
import { PERIODES_STANDARD, resoudrePeriode } from "./periode";
import { resumeEnregistre } from "./resume";
import { ONGLETS_ANALYTIQUE, type Alerte, type EcranAnalytique, type Famille, type OngletAnalytique, type Periode } from "./types";

/**
 * Mission 17 (partie B) — l'écran servi : `ecranAnalytique(onglet, période, options, maintenant)`.
 * 1. Cache mémoire d'une minute (clé : onglet, période, filtre) — deux ouvertures rapprochées ne recalculent pas.
 * 2. Périodes standard sans filtre : l'instantané du jour (InstantaneAnalytique « onglet:période:AAAA-MM-JJ »), s'il a
 *    moins d'une heure ET porte le tampon courant (memoire.ts : toute écriture qui change les chiffres, synchronisation
 *    réussie comprise, le périme) ; sinon recalcul, et l'instantané est réécrit (upsert) avec le tampon du calcul.
 * 3. Pré-calcul quotidien : le travail périodique « analytique-du-jour » passe, à partir de 7 h (heure de Paris), une
 *    fois par jour : il calcule les cinq onglets sur les cinq périodes standard et le résumé du jour.
 */

export const DUREE_INSTANTANE_MS = 60 * 60_000;
export const HEURE_PRECALCUL = 7;
export const TRAVAIL_PRECALCUL = "analytique-du-jour";

export type OptionsAnalytique = { source?: Famille | null; recalculer?: boolean };

export const cleInstantane = (onglet: OngletAnalytique, periode: Periode) => `${onglet}:${periode.cle}:${periode.au}`;
const estStandard = (periode: Periode) => periode.cle !== "libre";

/** Le contenu d'un instantané : l'écran et le tampon de son calcul (retiré à la lecture). */
type Enregistre = { tampon: string; ecran: EcranAnalytique };

async function calculerEtEnregistrer(onglet: OngletAnalytique, periode: Periode, source: Famille | null, maintenant: Date): Promise<EcranAnalytique> {
  // Le tampon est pris AVANT le calcul : une écriture survenue pendant le calcul périme aussitôt l'instantané.
  const tampon = tamponAnalytique();
  const ecran = await ECRANS[onglet](periode, { source }, maintenant);
  if (estStandard(periode) && !source) {
    const cle = cleInstantane(onglet, periode);
    const contenu = JSON.stringify({ tampon, ecran } satisfies Enregistre);
    await prisma.instantaneAnalytique.upsert({ where: { cle }, create: { cle, calculeLe: maintenant, contenu }, update: { calculeLe: maintenant, contenu } }).catch((erreur) => console.error("[analytique] instantané non écrit :", erreur));
  }
  return ecran;
}

/** L'écran d'un onglet pour une période, servi par le cache (mémoire, puis instantané du jour), sinon calculé. */
export async function ecranAnalytique(onglet: OngletAnalytique, periode: Periode, options: OptionsAnalytique = {}, maintenant: Date = new Date()): Promise<EcranAnalytique> {
  const source = onglet === "ensemble" ? options.source ?? null : null;
  const cle = `ecran:${onglet}:${periode.cle}:${periode.du}:${periode.au}:${source ?? "toutes"}`;
  if (options.recalculer) {
    viderCacheAnalytique(cle);
    return memoiser(cle, () => calculerEtEnregistrer(onglet, periode, source, maintenant));
  }
  return memoiser(cle, async () => {
    if (estStandard(periode) && !source) {
      const instantane = await prisma.instantaneAnalytique.findUnique({ where: { cle: cleInstantane(onglet, periode) } });
      if (instantane && maintenant.getTime() - instantane.calculeLe.getTime() < DUREE_INSTANTANE_MS && maintenant.getTime() >= instantane.calculeLe.getTime()) {
        try {
          const lu = JSON.parse(instantane.contenu) as Partial<Enregistre>;
          if (lu.tampon === tamponAnalytique() && lu.ecran) return lu.ecran;
        } catch {
          // instantané illisible : recalcul
        }
      }
    }
    return calculerEtEnregistrer(onglet, periode, source, maintenant);
  });
}

/** Les alertes pour `sante_systeme` (et toute lecture hors écran). */
export async function alertesPourSante(maintenant: Date = new Date()): Promise<Alerte[]> {
  return alertesAnalytique(maintenant, await etatsDesSources(maintenant));
}

/** Le pré-calcul du jour : cinq onglets × cinq périodes standard, et le résumé du jour. */
export async function precalculerAnalytique(maintenant: Date = new Date(), signal?: AbortSignal): Promise<{ ecrans: number; echecs: string[] }> {
  viderCacheAnalytique();
  const echecs: string[] = [];
  let ecrans = 0;
  await resumeEnregistre(maintenant, { recalculer: true }).catch((erreur) => echecs.push(`résumé : ${erreur instanceof Error ? erreur.message : String(erreur)}`));
  for (const onglet of ONGLETS_ANALYTIQUE) {
    for (const p of PERIODES_STANDARD) {
      if (signal?.aborted) return { ecrans, echecs: [...echecs, "interrompu"] };
      try {
        await calculerEtEnregistrer(onglet, resoudrePeriode({ p }, maintenant), null, maintenant);
        ecrans += 1;
      } catch (erreur) {
        echecs.push(`${onglet} ${p} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
      }
    }
  }
  return { ecrans, echecs };
}

/** Heure de Paris (0-23). */
const heureParis = (d: Date) => Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hour12: false }).formatToParts(d).find((p) => p.type === "hour")?.value ?? 0) % 24;

/** Le pré-calcul est-il dû ? À partir de 7 h, s'il n'a pas encore été fait ce jour-là (le résumé du jour en fait foi). */
export async function precalculDu(maintenant: Date = new Date()): Promise<boolean> {
  if (heureParis(maintenant) < HEURE_PRECALCUL) return false;
  const fait = await prisma.instantaneAnalytique.findUnique({ where: { cle: `precalcul:${jourParis(maintenant)}` }, select: { cle: true } });
  return !fait;
}

export async function executerPrecalcul(maintenant: Date = new Date(), signal?: AbortSignal): Promise<void> {
  if (!(await precalculDu(maintenant))) return;
  const resultat = await precalculerAnalytique(maintenant, signal);
  const cle = `precalcul:${jourParis(maintenant)}`;
  const contenu = JSON.stringify(resultat);
  await prisma.instantaneAnalytique.upsert({ where: { cle }, create: { cle, calculeLe: maintenant, contenu }, update: { calculeLe: maintenant, contenu } });
  if (resultat.echecs.length) throw new Error(`Pré-calcul de l'Analytique incomplet : ${resultat.echecs.join(" ; ")}`);
}

/** Enregistré par src/lib/taches/traitements.ts : passe toutes les 15 minutes, ne travaille qu'une fois par jour dès 7 h. */
export function enregistrerTachesAnalytiqueCalculs(): void {
  enregistrerTravailPeriodique({
    nom: TRAVAIL_PRECALCUL,
    libelle: "Analytique : écrans et résumé du jour (7 h)",
    acteur: "SYSTEME:analytique",
    intervalleMs: 15 * 60_000,
    executer: (signal) => executerPrecalcul(new Date(), signal),
  });
}
