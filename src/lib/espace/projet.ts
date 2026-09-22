import { z } from "zod/v4";
import { LIBELLES_STYLE, STYLES_CLIENT, type StyleClient } from "@/lib/simulateur/types-surface";
import {
  famille,
  famillesDe,
  IDS_FAMILLE,
  libelleTaille,
  normaliserSelection,
  resumerSelection,
  selectionDepuisZones,
  type IdFamille,
  type SelectionPrestations,
  type TaillesProjet,
} from "@/lib/prestations/prestations";

/**
 * Le projet tel que le client le précise dans son espace (mission 5) : les
 * FAMILLES qu'il veut rénover et leurs sous-parties (source unique :
 * src/lib/prestations), la taille à peu près pour chaque famille, un mot libre.
 *
 * Les familles vivent sur le dossier (`Dossier.prestations`, que Lucas modifie
 * aussi) ; la taille et le mot dans `EspaceClient.souhaits` (JSON). Les formats
 * d'avant restent lisibles : les zones cochées de la v3 deviennent des
 * sous-parties, leurs mètres la taille de la cuisine ; goûts et délai (v2) sont
 * gardés tels quels, plus demandés.
 */

/** Anciens repères de taille de la cuisine (v3) : ce sont ceux de la famille Cuisine. */
export const REPERES_METRES = famille("CUISINE").taille.reperes.map((r) => ({ id: r.id, libelle: r.libelle, aide: r.aide, metres: r.valeur }));

export const DELAIS_CLIENT = [
  { id: "vite", libelle: "Dès que possible" },
  { id: "1-3-mois", libelle: "Dans 1 à 3 mois" },
  { id: "plus-tard", libelle: "Plus tard" },
] as const;

const schemaTaille = z.object({
  repere: z.string().max(40).nullable().default(null),
  valeur: z.number("Taille invalide.").min(0, "Taille invalide.").max(100, "Au plus 100 : dites-le plutôt dans la note.").nullable().default(null),
});

/** Ce que l'écran envoie (v4). Les champs des versions précédentes sont acceptés, pour une page restée ouverte. */
export const schemaProjet = z.object({
  familles: z.record(z.string().max(20), z.array(z.string().max(40)).max(12)).optional(),
  tailles: z.record(z.string().max(20), schemaTaille).optional(),
  precisions: z.string().trim().max(1000, "Message trop long (1 000 caractères au plus).").default(""),
  // v3
  zones: z.array(z.string().max(40)).max(12).optional(),
  metres: z.number().min(0.5, "Au moins un demi-mètre.").max(60, "Au plus 60 mètres : dites-le plutôt en commentaire.").nullable().optional(),
  repere: z.string().max(40).nullable().optional(),
  // v2
  styles: z.array(z.enum(STYLES_CLIENT)).max(6).optional(),
  propositions: z.boolean().optional(),
  delai: z.enum(DELAIS_CLIENT.map((d) => d.id) as [string, ...string[]]).nullable().optional(),
});
export type EntreeProjet = z.output<typeof schemaProjet>;

/** Le projet lu : familles (du dossier), tailles, mot ; et, pour les écrans d'avant, les zones et les mètres qui en découlent. */
export type ProjetClient = {
  familles: SelectionPrestations;
  tailles: TaillesProjet;
  precisions: string;
  styles: StyleClient[];
  propositions: boolean;
  delai: string | null;
  /** Anciens écrans (v3) : surfaces du moteur cochées et taille de la cuisine. */
  zones: string[];
  metres: number | null;
  repere: string | null;
};

/** Ce qui se range dans `EspaceClient.souhaits` (les familles vont au dossier). */
export type SouhaitsV4 = { version: 4; tailles: TaillesProjet; precisions: string; styles?: StyleClient[]; propositions?: boolean; delai?: string | null };

const ANCIENNES_TEINTES: Record<string, StyleClient> = {
  "Bois clair": "bois-clair",
  "Bois foncé": "bois-fonce",
  Blanc: "blanc",
  "Effet marbre": "marbre",
  "Effet béton": "beton",
  "Une couleur": "uni-colore",
};

function tailleValide(t: unknown): { repere: string | null; valeur: number | null } | null {
  const lu = schemaTaille.safeParse(t);
  if (!lu.success || (!lu.data.repere && !lu.data.valeur)) return null;
  return lu.data;
}

function normaliserTailles(brut: unknown): TaillesProjet {
  const sortie: TaillesProjet = {};
  if (!brut || typeof brut !== "object") return sortie;
  for (const id of IDS_FAMILLE) {
    const t = tailleValide((brut as Record<string, unknown>)[id]);
    if (t) sortie[id] = t;
  }
  return sortie;
}

/** Surfaces du moteur d'une sélection (ce que lisaient les écrans v3). */
export function zonesDeLaSelection(selection: SelectionPrestations): string[] {
  const zones = famillesDe(selection).flatMap((id) => (selection[id] ?? []).flatMap((sp) => famille(id).sousParties.find((s) => s.id === sp)?.zones ?? []));
  return [...new Set(zones)];
}

/**
 * Lit ce que le client a dit de son projet. `selectionDossier` : les familles
 * rangées sur le dossier ; sans elles, celles qui découlent des anciennes zones.
 * `typeProjet` range un ancien « autre chose » dans sa famille.
 */
export function lireProjet(json: string | null | undefined, selectionDossier: SelectionPrestations = {}, typeProjet?: string | null): ProjetClient | null {
  let brut: Record<string, unknown> | null = null;
  if (json) {
    try {
      const valeur: unknown = JSON.parse(json);
      brut = valeur && typeof valeur === "object" && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null;
    } catch {
      brut = null;
    }
  }
  const aSelection = Object.keys(selectionDossier).length > 0;
  if (!brut && !aSelection) return null;
  const b = brut ?? {};
  // v2 (20/09) : teintes et ambiance en mots.
  const anciennesTeintes = Array.isArray(b.teintes) ? (b.teintes as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const styles = [
    ...new Set([
      ...(Array.isArray(b.styles) ? (b.styles as unknown[]).filter((s): s is StyleClient => typeof s === "string" && (STYLES_CLIENT as readonly string[]).includes(s)) : []),
      ...anciennesTeintes.map((t) => ANCIENNES_TEINTES[t]).filter(Boolean),
    ]),
  ];
  const autresTeintes = anciennesTeintes.filter((t) => !ANCIENNES_TEINTES[t]);
  const precisions = [typeof b.precisions === "string" ? b.precisions.trim() : "", autresTeintes.length ? `Teintes : ${autresTeintes.join(", ")}` : "", typeof b.style === "string" && b.style && !Array.isArray(b.styles) ? `Ambiance : ${b.style}` : ""]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1000);
  // v3 : zones cochées, mètres et repère de la cuisine.
  const anciennesZones = Array.isArray(b.zones) ? (b.zones as unknown[]).filter((z): z is string => typeof z === "string") : [];
  const familles = aSelection ? normaliserSelection(selectionDossier) : selectionDepuisZones(anciennesZones, typeProjet);
  const tailles = normaliserTailles(b.tailles);
  const metresV3 = typeof b.metres === "number" && b.metres > 0 ? b.metres : null;
  const repereV3 = typeof b.repere === "string" ? b.repere : null;
  if (!tailles.CUISINE && (metresV3 || repereV3)) tailles.CUISINE = { repere: repereV3, valeur: metresV3 };
  return {
    familles,
    tailles,
    precisions,
    styles,
    propositions: Boolean(b.propositions),
    delai: typeof b.delai === "string" ? b.delai : null,
    zones: [...zonesDeLaSelection(familles), ...(anciennesZones.includes("autre") ? ["autre"] : [])],
    metres: tailles.CUISINE?.valeur ?? null,
    repere: tailles.CUISINE?.repere ?? null,
  };
}

/**
 * Ce que l'écran a envoyé → la sélection (pour le dossier) et les souhaits (pour
 * l'espace). Un envoi v3 (zones, mètres) est traduit ; les goûts d'avant, s'il y
 * en a, restent.
 */
export function projetDepuisEntree(entree: EntreeProjet, avant: ProjetClient | null, typeProjet?: string | null): { selection: SelectionPrestations; souhaits: SouhaitsV4 } {
  const selection = entree.familles ? normaliserSelection(entree.familles) : entree.zones ? selectionDepuisZones(entree.zones, typeProjet) : (avant?.familles ?? {});
  const tailles = entree.tailles ? normaliserTailles(entree.tailles) : { ...(avant?.tailles ?? {}) };
  if (!entree.tailles && (entree.metres !== undefined || entree.repere !== undefined)) {
    const t = { repere: entree.repere ?? null, valeur: entree.metres ?? null };
    if (t.repere || t.valeur) tailles.CUISINE = t;
    else delete tailles.CUISINE;
  }
  // La taille d'une famille décochée ne se garde pas : elle ne voudrait plus rien dire.
  for (const id of IDS_FAMILLE) if (!(id in selection)) delete tailles[id];
  const styles = entree.styles ?? avant?.styles ?? [];
  const propositions = entree.propositions ?? avant?.propositions ?? false;
  const delai = entree.delai !== undefined ? entree.delai : (avant?.delai ?? null);
  return {
    selection,
    souhaits: { version: 4, tailles, precisions: entree.precisions, ...(styles.length ? { styles } : {}), ...(propositions ? { propositions } : {}), ...(delai ? { delai } : {}) },
  };
}

/** Le projet est-il « précisé » ? Une famille cochée, ou un mot pour CoverSwap (les goûts d'avant comptent encore). */
export function projetPrecise(projet: ProjetClient | null): boolean {
  return Boolean(projet && (Object.keys(projet.familles).length > 0 || projet.precisions.trim().length > 0 || projet.propositions || projet.styles.length > 0));
}

/**
 * Ce qui manque pour VALIDER le projet (null : il est complet), dit au client :
 * au moins une famille ; dans chaque famille cochée, ce qu'il veut traiter ; un
 * mot s'il n'a coché que « autre » ; la taille quand la famille la demande.
 */
export function projetComplet(projet: ProjetClient | null): string | null {
  const familles = projet ? famillesDe(projet.familles) : [];
  if (!projet || familles.length === 0) return "Choisissez d'abord ce que vous voulez rénover.";
  for (const id of familles) {
    const f = famille(id);
    if ((projet.familles[id] ?? []).length === 0) return `${f.libelle} : cochez ce que vous voulez traiter.`;
  }
  const seulementAutre = familles.every((id) => (projet.familles[id] ?? []).every((sp) => sp === "autre" || sp === "autre-meuble"));
  if (seulementAutre && !projet.precisions.trim()) return "Vous avez choisi « autre » : dites-nous quoi, en quelques mots.";
  for (const id of familles) {
    const f = famille(id);
    const t = projet.tailles[id];
    if (f.taille.requise && !t?.repere && !t?.valeur) return `Indiquez la taille ${f.mots.de}, à peu près.`;
  }
  return null;
}

/** Résumé en une ligne, pour le dossier et le CRM : « Cuisine : façades hautes, plan de travail · Cuisine ≈ 5 m (en L) · « garder les poignées » ». */
export function resumerProjet(projet: ProjetClient | null): string {
  if (!projet) return "";
  // Une seule famille : sa taille seule (« ≈ 5 m (en L) ») ; plusieurs : chacune nommée (« cuisine ≈ 5 m, mobilier 6 portes »).
  const mesurees = famillesDe(projet.familles)
    .map((id) => ({ id, t: libelleTaille(id, projet.tailles[id]) }))
    .filter((m): m is { id: IdFamille; t: string } => Boolean(m.t));
  const tailles = mesurees.length === 1 && famillesDe(projet.familles).length === 1 ? mesurees[0].t : mesurees.map((m) => `${famille(m.id).libelle.toLowerCase()} ${m.t}`).join(", ");
  const styles = projet.styles.map((s) => LIBELLES_STYLE[s]).join(", ");
  const delai = DELAIS_CLIENT.find((d) => d.id === projet.delai);
  return [
    resumerSelection(projet.familles) || null,
    tailles || null,
    [styles, projet.propositions ? "veut des propositions" : ""].filter(Boolean).join(", ") || null,
    delai ? delai.libelle.toLowerCase() : null,
    projet.precisions ? `« ${projet.precisions} »` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Les familles d'un projet, cochées. */
export const famillesDuProjet = (projet: ProjetClient | null): IdFamille[] => (projet ? famillesDe(projet.familles) : []);

/** Surfaces du simulateur du site → ce que le client veut traiter (préremplissage). Gardé pour les appelants d'avant. */
export const ZONES_DEPUIS_SITE: Record<string, string[]> = {
  "facades-cuisine": ["meubles-hauts", "meubles-bas"],
  "meubles-hauts": ["meubles-hauts"],
  "meubles-bas": ["meubles-bas"],
  "plan-de-travail": ["plan-de-travail"],
  credence: ["credence"],
  "meuble-vasque": ["meuble-vasque"],
  "plan-vasque": ["plan-vasque"],
  "carrelage-mural": ["carrelage-mural"],
  "portes-dressing": ["portes-dressing"],
  "meuble-tv": ["meuble-tv"],
  "meuble-complet": ["meuble-complet"],
  "comptoir-habillage": ["comptoir-habillage"],
  "comptoir-plateau": ["comptoir-habillage"],
  "mobilier-pro": ["mobilier-pro"],
  "rangements-pro": ["rangements-pro"],
  "habillage-mural": ["habillage-mural"],
};
