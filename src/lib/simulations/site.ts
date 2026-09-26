import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireImage } from "./dossier";

/**
 * Mission 13 (B19) — les simulations faites sur coverswap.fr, lisibles dans le
 * CRM (rubrique « Sur le site cette semaine » de Leads) et non plus seulement
 * par l'outil MCP `simulations_site`. Anonymes (un visiteur qui n'a pas laissé
 * ses coordonnées) ou rattachées à un lead. Les simulations purgées (30 jours
 * sans demande) ne sont pas listées : elles n'ont plus d'image.
 */

export const LIBELLES_PROJET_SITE: Record<string, string> = {
  cuisine: "Cuisine",
  "salle-de-bain": "Salle de bain",
  meubles: "Meubles",
  "mur-plafond": "Mur / plafond",
  professionnel: "Professionnel",
};

type Reference = { zone?: string; libelle?: string; ref?: string; nom?: string };

export function lireReferencesSite(json: string | null | undefined): Reference[] {
  try {
    const lu: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(lu) ? (lu as Reference[]) : [];
  } catch {
    return [];
  }
}

/** « Façades : Chêne clair (NE31), Plan : Noyer » — ou « teintes non renseignées ». */
export function teintesDe(references: Reference[]): string {
  if (references.length === 0) return "teintes non renseignées";
  return references.map((r) => `${r.libelle || r.zone || "zone"} : ${r.nom || r.ref || "?"}${r.ref && r.nom ? ` (${r.ref})` : ""}`).join(", ");
}

export type SimulationSiteLigne = {
  id: string;
  le: string;
  projet: string;
  projetLibelle: string;
  teintes: string;
  teinteRetenue: string | null;
  leadId: string | null;
  leadNom: string | null;
  leadVille: string | null;
  page: string | null;
  source: string | null;
  campagne: string | null;
  /** Le rendu existe encore (non purgé) : l'image se lit par /api/simulations-site/<id>/image. */
  image: boolean;
  /** La photo du visiteur existe encore : /api/simulations-site/<id>/avant. */
  avant: boolean;
};

export type SimulationsSiteRecentes = { jours: number; total: number; anonymes: number; rattachees: number; lignes: SimulationSiteLigne[] };

/** Les simulations du site des `jours` derniers jours (7 par défaut), les plus récentes d'abord, `limite` lignes au plus. */
export async function simulationsSiteRecentes(jours = 7, maintenant: Date = new Date(), limite = 40): Promise<SimulationsSiteRecentes> {
  const depuis = new Date(maintenant.getTime() - jours * 24 * 60 * 60_000);
  const [total, anonymes, lignes] = await Promise.all([
    prisma.simulationSite.count({ where: { createdAt: { gte: depuis } } }),
    prisma.simulationSite.count({ where: { createdAt: { gte: depuis }, leadId: null } }),
    prisma.simulationSite.findMany({ where: { createdAt: { gte: depuis } }, orderBy: { createdAt: "desc" }, take: limite }),
  ]);
  const ids = [...new Set(lignes.map((s) => s.leadId).filter((id): id is string => Boolean(id)))];
  const leads = new Map(
    (ids.length ? await prisma.lead.findMany({ where: { id: { in: ids }, archiveLe: undefined }, select: { id: true, prenom: true, nom: true, ville: true } }) : []).map((l) => [l.id, l])
  );
  return {
    jours,
    total,
    anonymes,
    rattachees: total - anonymes,
    lignes: lignes.map((s) => {
      const lead = s.leadId ? leads.get(s.leadId) : undefined;
      return {
        id: s.id,
        le: s.createdAt.toISOString(),
        projet: s.projet,
        projetLibelle: LIBELLES_PROJET_SITE[s.projet] ?? s.projet,
        teintes: teintesDe(lireReferencesSite(s.references)),
        teinteRetenue: s.referenceChoisie,
        leadId: s.leadId,
        leadNom: lead ? `${lead.prenom} ${lead.nom}`.trim() || null : null,
        leadVille: lead?.ville ?? null,
        page: s.page,
        source: s.source,
        campagne: s.campagne,
        image: Boolean(s.imageAfterPath) && !s.archiveLe,
        avant: Boolean(s.imageBeforePath) && !s.archiveLe,
      };
    }),
  };
}

/** Le rendu d'une simulation du site (« image »), ou la photo du visiteur (« avant ») — derrière la session du CRM. */
export async function imageSimulationSite(id: string, quoi: "image" | "avant"): Promise<{ contenu: Buffer; type: string }> {
  const simulation = await prisma.simulationSite.findUnique({ where: { id }, select: { imageAfterPath: true, imageBeforePath: true, archiveLe: true } });
  if (!simulation || simulation.archiveLe) throw new ErreurMetier("Image introuvable (simulation purgée).", 404);
  return lireImage(quoi === "image" ? simulation.imageAfterPath : simulation.imageBeforePath);
}
