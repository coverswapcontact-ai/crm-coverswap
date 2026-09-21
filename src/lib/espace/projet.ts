import { z } from "zod/v4";
import { LIBELLES_STYLE, STYLES_CLIENT, ZONES_PROJET_CLIENT } from "@/lib/simulateur/types-surface";

/**
 * Le projet tel que le client le précise dans son espace : ce qu'il veut
 * traiter, ses goûts, un ordre de grandeur, son délai, un mot libre. Rangé en
 * JSON dans `EspaceClient.souhaits` (version 2 ; l'ancien format — teintes,
 * style — reste lisible).
 */

export const REPERES_METRES = [
  { id: "une-rangee", libelle: "Un seul mur", aide: "Petite cuisine", metres: 3 },
  { id: "en-l", libelle: "En L", aide: "Deux murs en angle", metres: 5 },
  { id: "en-u", libelle: "En U", aide: "Trois murs", metres: 7 },
  { id: "ilot", libelle: "Avec îlot", aide: "Grande cuisine", metres: 8 },
] as const;

export const DELAIS_CLIENT = [
  { id: "vite", libelle: "Dès que possible" },
  { id: "1-3-mois", libelle: "Dans 1 à 3 mois" },
  { id: "plus-tard", libelle: "Plus tard" },
] as const;

export const schemaProjet = z.object({
  zones: z.array(z.string().max(40)).max(12).default([]),
  styles: z.array(z.enum(STYLES_CLIENT)).max(6).default([]),
  /** « Je ne sais pas, proposez-moi. » */
  propositions: z.boolean().default(false),
  metres: z.number().min(0.5, "Au moins un demi-mètre.").max(60, "Au plus 60 mètres : dites-le-moi plutôt en commentaire.").nullable().default(null),
  repere: z.enum(REPERES_METRES.map((r) => r.id) as [string, ...string[]]).nullable().default(null),
  delai: z.enum(DELAIS_CLIENT.map((d) => d.id) as [string, ...string[]]).nullable().default(null),
  precisions: z.string().trim().max(1000, "Message trop long (1 000 caractères au plus).").default(""),
});
export type ProjetClient = z.output<typeof schemaProjet>;

/** Ancien format (espace du 20/09) : teintes et ambiance en mots. */
const schemaAncien = z.object({
  teintes: z.array(z.string().max(40)).max(9).default([]),
  style: z.string().max(40).nullable().default(null),
  propositions: z.boolean().default(false),
  precisions: z.string().trim().max(1000).default(""),
});

const ANCIENNES_TEINTES: Record<string, (typeof STYLES_CLIENT)[number]> = {
  "Bois clair": "bois-clair",
  "Bois foncé": "bois-fonce",
  Blanc: "blanc",
  "Effet marbre": "marbre",
  "Effet béton": "beton",
  "Une couleur": "uni-colore",
};

/** Lit un projet enregistré, ancien format compris ; null s'il n'y a rien d'exploitable. */
export function lireProjet(json: string | null | undefined): ProjetClient | null {
  if (!json) return null;
  let brut: unknown;
  try {
    brut = JSON.parse(json);
  } catch {
    return null;
  }
  if (brut && typeof brut === "object" && ("zones" in brut || "styles" in brut || "metres" in brut)) {
    const lu = schemaProjet.safeParse(brut);
    return lu.success ? lu.data : null;
  }
  const ancien = schemaAncien.safeParse(brut);
  if (!ancien.success) return null;
  const styles = [...new Set(ancien.data.teintes.map((t) => ANCIENNES_TEINTES[t]).filter(Boolean))];
  const autres = ancien.data.teintes.filter((t) => !ANCIENNES_TEINTES[t]);
  const precisions = [ancien.data.precisions, autres.length ? `Teintes : ${autres.join(", ")}` : "", ancien.data.style ? `Ambiance : ${ancien.data.style}` : ""].filter(Boolean).join(" · ");
  return { zones: [], styles, propositions: ancien.data.propositions, metres: null, repere: null, delai: null, precisions };
}

/** Le projet est-il « précisé » ? Au moins ce qu'il veut traiter, ou « proposez-moi ». */
export function projetPrecise(projet: ProjetClient | null): boolean {
  return Boolean(projet && (projet.zones.length > 0 || projet.propositions || projet.styles.length > 0));
}

/** Résumé en une ligne, pour le dossier et le CRM : « Façades hautes, Plan de travail · Bois clair, Blanc · ≈ 5 m · dès que possible ». */
export function resumerProjet(projet: ProjetClient | null, typeProjet = "CUISINE"): string {
  if (!projet) return "";
  const libellesZones = new Map((ZONES_PROJET_CLIENT[typeProjet] ?? ZONES_PROJET_CLIENT.CUISINE).map((z) => [z.id, z.libelle]));
  const zones = projet.zones.map((z) => libellesZones.get(z) ?? z).join(", ");
  const styles = projet.styles.map((s) => LIBELLES_STYLE[s]).join(", ");
  const repere = REPERES_METRES.find((r) => r.id === projet.repere);
  const delai = DELAIS_CLIENT.find((d) => d.id === projet.delai);
  return [
    zones || null,
    [styles, projet.propositions ? "veut des propositions" : ""].filter(Boolean).join(", ") || null,
    projet.metres ? `≈ ${String(projet.metres).replace(".", ",")} m${repere ? ` (${repere.libelle.toLowerCase()})` : ""}` : repere ? repere.libelle.toLowerCase() : null,
    delai ? delai.libelle.toLowerCase() : null,
    projet.precisions ? `« ${projet.precisions} »` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Surfaces du simulateur du site → ce que le client veut traiter (préremplissage). */
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
