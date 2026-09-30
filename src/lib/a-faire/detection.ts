import { pluriel } from "@/lib/commun/format";
import { DETECTEURS } from "./detecteurs";
import type { Achevement, ContexteDetection, Detecteur } from "./detecteurs/types";
import { reconcilier, type BilanReconciliation } from "./moteur";
import { SOURCES_TACHE, TYPES_TACHE, type Detection, type SourceTache } from "./types";
import { actionsManuellesEnVigueur } from "./vigueur";

/**
 * Mission 17 (partie A) : un passage des détecteurs (docs/TACHES.md § 2). Le contexte (instant, prochaines actions
 * manuelles en vigueur) est lu une fois ; chaque détecteur tourne à part : une erreur (ou une détection mal formée) est
 * journalisée et SA source n'est pas couverte ce passage (ses tâches ne sont pas cochées à tort) ; les autres
 * continuent. Puis le moteur écrit.
 * Le filtre de vigueur est appliqué par le moteur (moteur.ts › reconcilier), pas ici.
 */

export type BilanSource = { source: SourceTache; couverte: boolean; detections: number; acheves: number; dureeMs: number; erreur?: string };
export type BilanPasse = { maintenant: string; dureeMs: number; sources: BilanSource[]; reconciliation: BilanReconciliation };

const TYPES = TYPES_TACHE as readonly string[];

/** Une détection mal formée est écartée (et dite) plutôt que d'arrêter le passage. La source est celle du détecteur. */
function valide(d: Detection, source: SourceTache): Detection | null {
  const correcte =
    typeof d?.cle === "string" &&
    d.cle.length > 0 &&
    d.cle.length <= 300 &&
    TYPES.includes(d.type) &&
    [1, 2, 3, 4, 5].includes(d.niveau) &&
    d.depuis instanceof Date &&
    !Number.isNaN(d.depuis.getTime()) &&
    typeof d.titre === "string" &&
    typeof d.raison === "string" &&
    Boolean(d.sujet?.type) &&
    Boolean(d.raccourci?.genre);
  if (!correcte) {
    console.warn(`[a-faire] détection écartée (${source}) : ${JSON.stringify(d)?.slice(0, 300)}`);
    return null;
  }
  return d.source === source ? d : { ...d, source };
}

/**
 * Lance les détecteurs (tous, ou ceux des `sources` demandées) puis `reconcilier`. `detecteurs` remplace la liste
 * (essais). Rend un bilan par source et celui du moteur.
 */
export async function passeComplete(maintenant: Date = new Date(), options: { sources?: readonly SourceTache[]; detecteurs?: readonly Detecteur[] } = {}): Promise<BilanPasse> {
  const debut = Date.now();
  const voulues = new Set(options.sources ?? SOURCES_TACHE);
  const detecteurs = (options.detecteurs ?? DETECTEURS).filter((d) => voulues.has(d.source));
  const contexte: ContexteDetection = { maintenant, vigueur: await actionsManuellesEnVigueur(maintenant) };

  const resultats = await Promise.all(
    detecteurs.map(async (detecteur) => {
      const depart = Date.now();
      try {
        const [detections, acheves] = await Promise.all([detecteur.detecter(contexte), detecteur.acheves ? detecteur.acheves(contexte) : Promise.resolve<Achevement[]>([])]);
        const retenues = detections.map((d) => valide(d, detecteur.source)).filter((d): d is Detection => d !== null);
        // Mission 17 (partie A, relecture) : une détection mal formée ne doit pas faire cocher sa tâche. Les détections
        // valides sont écrites, mais la source n'est pas couverte ce passage (rien de ce qu'elle ne voit plus n'est coché).
        const malFormees = detections.length - retenues.length;
        if (malFormees > 0) {
          const erreur = `${pluriel(malFormees, "détection mal formée", "détections mal formées")} : source non couverte ce passage`;
          return { source: detecteur.source, couverte: false, detections: retenues, acheves, dureeMs: Date.now() - depart, erreur } as const;
        }
        return { source: detecteur.source, couverte: true, detections: retenues, acheves, dureeMs: Date.now() - depart } as const;
      } catch (erreur) {
        console.error(`[a-faire] détecteur ${detecteur.source} en échec (source non couverte ce passage) :`, erreur);
        const message = erreur instanceof Error ? erreur.message : String(erreur);
        return { source: detecteur.source, couverte: false, detections: [], acheves: [], dureeMs: Date.now() - depart, erreur: message.slice(0, 500) } as const;
      }
    })
  );

  const couvertes = resultats.filter((r) => r.couverte).map((r) => r.source);
  const reconciliation = await reconcilier(
    resultats.flatMap((r) => r.detections),
    { sources: couvertes, maintenant, vigueur: contexte.vigueur, acheves: resultats.flatMap((r) => r.acheves) }
  );
  return {
    maintenant: maintenant.toISOString(),
    dureeMs: Date.now() - debut,
    sources: resultats.map((r) => ({ source: r.source, couverte: r.couverte, detections: r.detections.length, acheves: r.acheves.length, dureeMs: r.dureeMs, ...("erreur" in r ? { erreur: r.erreur } : {}) })),
    reconciliation,
  };
}

/** Le bilan d'un passage en une phrase (écran des tâches de fond). */
export function resumePasse(bilan: BilanPasse): string {
  const r = bilan.reconciliation;
  const echecs = bilan.sources.filter((s) => !s.couverte).map((s) => s.source);
  const parties = [pluriel(r.crees, "créée"), pluriel(r.misesAJour, "mise à jour", "mises à jour"), pluriel(r.cochees, "cochée"), pluriel(r.rouvertes, "rouverte"), pluriel(r.ecartees, "écartée")];
  return `Tâches : ${parties.join(", ")}${echecs.length ? ` ; en échec : ${echecs.join(", ")}` : ""} (${bilan.dureeMs} ms).`;
}
