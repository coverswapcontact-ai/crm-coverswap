/**
 * Types de surface du simulateur du CRM et leurs zones — constantes partagées
 * par l'écran et le serveur (aucune dépendance Node).
 *
 * Une zone porte l'identifiant d'une surface du simulateur du site
 * (coverswap/src/lib/simulateur/surfaces.ts) : en mode API, le CRM envoie ces
 * identifiants au site, qui construit la consigne avec SES prompts. Le mode
 * ChatGPT, lui, s'appuie sur la bibliothèque de prompts du CRM.
 */

export type IdZone =
  | "meubles-hauts"
  | "meubles-bas"
  | "plan-de-travail"
  | "credence"
  | "plan-vasque"
  | "meuble-vasque"
  | "portes-dressing"
  | "meuble-tv"
  | "comptoir-habillage"
  | "comptoir-plateau"
  | "mobilier-pro"
  | "rangements-pro";

/** Libellé de la zone (écran, planche des teintes) et sens de pose d'un décor directionnel. */
export const ZONES: Record<IdZone, { libelle: string; anglais: string; sens: "vertical" | "longueur" | "horizontal" }> = {
  "meubles-hauts": { libelle: "Meubles hauts", anglais: "wall units (upper cabinets)", sens: "vertical" },
  "meubles-bas": { libelle: "Meubles bas", anglais: "base units, tall units and island fronts", sens: "vertical" },
  "plan-de-travail": { libelle: "Plan de travail", anglais: "worktop", sens: "longueur" },
  credence: { libelle: "Crédence", anglais: "backsplash", sens: "horizontal" },
  "plan-vasque": { libelle: "Plan vasque", anglais: "vanity top", sens: "longueur" },
  "meuble-vasque": { libelle: "Meuble vasque", anglais: "vanity cabinet fronts", sens: "vertical" },
  "portes-dressing": { libelle: "Portes du dressing", anglais: "wardrobe doors", sens: "vertical" },
  "meuble-tv": { libelle: "Meuble TV", anglais: "TV unit", sens: "horizontal" },
  "comptoir-habillage": { libelle: "Façade du bar", anglais: "bar front cladding", sens: "vertical" },
  "comptoir-plateau": { libelle: "Plateau du bar", anglais: "bar top", sens: "longueur" },
  "mobilier-pro": { libelle: "Mobilier", anglais: "commercial furniture body panels", sens: "vertical" },
  "rangements-pro": { libelle: "Rangements", anglais: "storage fronts", sens: "vertical" },
};

export type TypeSurface = {
  id: string;
  libelle: string;
  /** Projet du simulateur du site (cuisine, salle-de-bain, meubles, professionnel). */
  projet: "cuisine" | "salle-de-bain" | "meubles" | "professionnel";
  zones: IdZone[];
  aide: string;
};

export const TYPES_SURFACE: readonly TypeSurface[] = [
  { id: "cuisine", libelle: "Cuisine", projet: "cuisine", zones: ["meubles-hauts", "meubles-bas", "plan-de-travail", "credence"], aide: "Une teinte par zone : meubles hauts, bas, plan de travail, crédence" },
  { id: "meubles-hauts", libelle: "Meubles hauts", projet: "cuisine", zones: ["meubles-hauts"], aide: "Les portes au-dessus du plan de travail" },
  { id: "meubles-bas", libelle: "Meubles bas", projet: "cuisine", zones: ["meubles-bas"], aide: "Portes et tiroirs sous le plan, colonnes, îlot" },
  { id: "plan-de-travail", libelle: "Plan de travail", projet: "cuisine", zones: ["plan-de-travail"], aide: "Le dessus et son chant" },
  { id: "credence", libelle: "Crédence", projet: "cuisine", zones: ["credence"], aide: "Le mur entre le plan et les meubles hauts" },
  { id: "plan-vasque", libelle: "Plan vasque", projet: "salle-de-bain", zones: ["plan-vasque", "meuble-vasque"], aide: "Le dessus autour du lavabo, et le meuble dessous si besoin" },
  { id: "dressing", libelle: "Dressing", projet: "meubles", zones: ["portes-dressing"], aide: "Portes battantes ou coulissantes" },
  { id: "meuble-tv", libelle: "Meuble TV", projet: "meubles", zones: ["meuble-tv"], aide: "Façades, dessus et côtés" },
  { id: "bar", libelle: "Bar", projet: "professionnel", zones: ["comptoir-habillage", "comptoir-plateau"], aide: "La façade et le plateau du comptoir" },
  { id: "mobilier-pro", libelle: "Mobilier professionnel", projet: "professionnel", zones: ["mobilier-pro", "rangements-pro"], aide: "Distributeur, borne, casiers, rangements du local" },
];

export function typeSurface(id: string | null | undefined): TypeSurface | null {
  return TYPES_SURFACE.find((t) => t.id === id) ?? null;
}

export function estZone(id: string): id is IdZone {
  return id in ZONES;
}

/** Une teinte posée sur une zone : ce que garde une simulation, et ce que montre l'espace client. */
export type ZoneTeinte = { zone: string; libelle: string; ref: string; nom: string };

export function lireZones(json: string | null | undefined): ZoneTeinte[] {
  if (!json) return [];
  try {
    const valeur: unknown = JSON.parse(json);
    if (!Array.isArray(valeur)) return [];
    return valeur
      .filter((z): z is ZoneTeinte => !!z && typeof z === "object" && typeof (z as ZoneTeinte).ref === "string")
      .map((z) => ({ zone: String(z.zone ?? ""), libelle: String(z.libelle ?? ""), ref: z.ref, nom: String(z.nom ?? "") }));
  } catch {
    return [];
  }
}

/* ── Goûts du client (espace) → familles du catalogue ─────────────── */

/** Les familles de rendu proposées au client dans son espace. */
export const STYLES_CLIENT = ["bois-clair", "bois-fonce", "blanc", "uni-colore", "marbre", "beton"] as const;
export type StyleClient = (typeof STYLES_CLIENT)[number];

export const LIBELLES_STYLE: Record<StyleClient, string> = {
  "bois-clair": "Bois clair",
  "bois-fonce": "Bois foncé",
  blanc: "Blanc",
  "uni-colore": "Uni coloré",
  marbre: "Effet marbre",
  beton: "Effet béton",
};

/** Ce que le client veut traiter, selon son projet. */
export const ZONES_PROJET_CLIENT: Record<string, { id: string; libelle: string; aide: string }[]> = {
  CUISINE: [
    { id: "meubles-hauts", libelle: "Façades hautes", aide: "Les meubles au-dessus du plan de travail" },
    { id: "meubles-bas", libelle: "Façades basses", aide: "Les portes et tiroirs sous le plan, l'îlot" },
    { id: "plan-de-travail", libelle: "Plan de travail", aide: "Le dessus et son chant" },
    { id: "credence", libelle: "Crédence", aide: "Le mur entre le plan et les meubles hauts" },
  ],
  SDB: [
    { id: "meuble-vasque", libelle: "Meuble vasque", aide: "Les façades sous le lavabo" },
    { id: "plan-vasque", libelle: "Plan vasque", aide: "Le dessus autour du lavabo" },
    { id: "carrelage-mural", libelle: "Murs carrelés", aide: "Recouvrir le carrelage existant" },
  ],
  MEUBLES: [
    { id: "portes-dressing", libelle: "Dressing, placards", aide: "Portes battantes ou coulissantes" },
    { id: "meuble-tv", libelle: "Meuble TV", aide: "Façades, dessus et côtés" },
    { id: "meuble-complet", libelle: "Commode, buffet, bureau", aide: "Un meuble seul" },
  ],
  PRO: [
    { id: "comptoir-habillage", libelle: "Bar, comptoir", aide: "La façade et le plateau" },
    { id: "mobilier-pro", libelle: "Mobilier", aide: "Distributeur, présentoir, casiers" },
    { id: "rangements-pro", libelle: "Rangements", aide: "Portes de placards et d'armoires" },
    { id: "habillage-mural", libelle: "Un mur", aide: "Un mur ou un panneau du local" },
  ],
};

/** Type de surface du simulateur le plus proche du projet du client. */
export function typeSurfacePourProjet(typeProjet: string | null | undefined, zones: string[] = []): string {
  if (typeProjet === "SDB") return "plan-vasque";
  if (typeProjet === "MEUBLES") return zones.includes("meuble-tv") && !zones.includes("portes-dressing") ? "meuble-tv" : "dressing";
  if (typeProjet === "PRO") return zones.includes("mobilier-pro") || zones.includes("rangements-pro") ? "mobilier-pro" : "bar";
  const cuisine = zones.filter((z) => ["meubles-hauts", "meubles-bas", "plan-de-travail", "credence"].includes(z));
  return cuisine.length === 1 ? cuisine[0] : "cuisine";
}
