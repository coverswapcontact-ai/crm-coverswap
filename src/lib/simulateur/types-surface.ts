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
  | "rangements-pro"
  // Surfaces du simulateur du site que seul l'espace client propose (mode API : la consigne vient du site).
  | "carrelage-mural"
  | "tablier-baignoire"
  | "meuble-complet"
  | "habillage-mural"
  | "mur-principal"
  | "mur-accent"
  | "plafond";

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
  "carrelage-mural": { libelle: "Murs carrelés", anglais: "tiled walls", sens: "vertical" },
  "tablier-baignoire": { libelle: "Tablier de baignoire", anglais: "bathtub side panel", sens: "horizontal" },
  "meuble-complet": { libelle: "Commode, buffet, bureau", anglais: "freestanding furniture", sens: "horizontal" },
  "habillage-mural": { libelle: "Habillage mural", anglais: "wall cladding", sens: "vertical" },
  "mur-principal": { libelle: "Mur principal", anglais: "main wall", sens: "vertical" },
  "mur-accent": { libelle: "Second mur", anglais: "accent wall", sens: "vertical" },
  plafond: { libelle: "Plafond", anglais: "ceiling", sens: "longueur" },
};

export type TypeSurface = {
  id: string;
  libelle: string;
  /** Projet du simulateur du site (cuisine, salle-de-bain, meubles, professionnel). */
  projet: "cuisine" | "salle-de-bain" | "meubles" | "professionnel" | "mur-plafond";
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

/**
 * Les simulations que le client crée dans son espace : un type par projet, avec
 * toutes les zones de ce projet (il en choisit une ou plusieurs). Hors de la
 * liste du simulateur du CRM, qui garde ses dix types.
 */
export const TYPES_SURFACE_ESPACE: Record<string, TypeSurface> = {
  CUISINE: { id: "cuisine", libelle: "Cuisine", projet: "cuisine", zones: ["meubles-hauts", "meubles-bas", "plan-de-travail", "credence"], aide: "Façades, plan de travail, crédence" },
  SDB: { id: "espace-salle-de-bain", libelle: "Salle de bain", projet: "salle-de-bain", zones: ["meuble-vasque", "plan-vasque", "carrelage-mural", "tablier-baignoire"], aide: "Meuble vasque, plan, murs carrelés, baignoire" },
  MEUBLES: { id: "espace-meubles", libelle: "Meubles, dressing", projet: "meubles", zones: ["portes-dressing", "meuble-tv", "meuble-complet"], aide: "Dressing, placards, meuble TV, commode" },
  PRO: { id: "espace-professionnel", libelle: "Local professionnel", projet: "professionnel", zones: ["comptoir-habillage", "comptoir-plateau", "mobilier-pro", "rangements-pro", "habillage-mural"], aide: "Bar, comptoir, mobilier, rangements" },
  MURS: { id: "espace-murs", libelle: "Murs, plafond", projet: "mur-plafond", zones: ["mur-principal", "mur-accent", "plafond"], aide: "Un mur, deux murs, le plafond" },
};

/** Les pièces que le client peut simuler dans son espace : toutes celles du site. */
export const PIECES_ESPACE = Object.entries(TYPES_SURFACE_ESPACE).map(([piece, type]) => ({ piece, libelle: type.libelle, aide: type.aide, zones: type.zones }));

export function typeSurface(id: string | null | undefined): TypeSurface | null {
  return TYPES_SURFACE.find((t) => t.id === id) ?? Object.values(TYPES_SURFACE_ESPACE).find((t) => t.id === id) ?? null;
}

/** Le type des simulations du client, selon son projet (cuisine par défaut). */
/** La pièce de l'espace (CUISINE, SDB…) d'un type de surface ; null pour un type du simulateur du CRM. */
export function pieceDuType(id: string | null | undefined): string | null {
  return Object.entries(TYPES_SURFACE_ESPACE).find(([, t]) => t.id === id)?.[0] ?? (id === "plan-vasque" ? "SDB" : null);
}

export function typeEspacePourProjet(typeProjet: string | null | undefined): TypeSurface {
  return TYPES_SURFACE_ESPACE[typeProjet ?? "CUISINE"] ?? TYPES_SURFACE_ESPACE.CUISINE;
}

export function estZone(id: string): id is IdZone {
  return id in ZONES;
}

/** Une teinte posée sur une zone : ce que garde une simulation, et ce que montre l'espace client. */
export type ZoneTeinte = { zone: string; libelle: string; ref: string; nom: string };

/**
 * Zones du simulateur du site qui en couvrent plusieurs ici : « Façades (toutes) » habille les
 * meubles hauts ET les meubles bas. Dépliées à la lecture, pour que le choix zone par zone de
 * l'espace et la validation parlent des mêmes zones que le simulateur du CRM.
 */
const ZONES_COMPOSEES: Record<string, IdZone[]> = { "facades-cuisine": ["meubles-hauts", "meubles-bas"] };

/**
 * Libellés du simulateur du site (actuels et anciens) → identifiant de surface. Une simulation
 * du site rangée sans identifiant (ancien parcours, génération de secours du site) ne garde que
 * « Façades (toutes) : K1 (Black Mat) » : on retrouve sa zone par son libellé, sinon le projet
 * ne se préremplit pas et le choix zone par zone ne la reconnaît pas.
 */
const SURFACES_PAR_LIBELLE: Record<string, string> = {
  "facades (toutes)": "facades-cuisine",
  facades: "facades-cuisine",
  "facades de cuisine": "facades-cuisine",
  "meubles hauts": "meubles-hauts",
  "meubles bas": "meubles-bas",
  "meubles bas, colonnes et ilot": "meubles-bas",
  "plan de travail": "plan-de-travail",
  credence: "credence",
  "meuble vasque": "meuble-vasque",
  "plan vasque": "plan-vasque",
  "carrelage mural": "carrelage-mural",
  "tablier de baignoire / douche": "tablier-baignoire",
  "portes de dressing et placards": "portes-dressing",
  "portes de dressing": "portes-dressing",
  "portes du dressing": "portes-dressing",
  "meuble tv": "meuble-tv",
  "commode, buffet, bureau": "meuble-complet",
  "bar / comptoir — habillage": "comptoir-habillage",
  "bar / comptoir — plateau": "comptoir-plateau",
  "distributeur ou mobilier professionnel": "mobilier-pro",
  "facades de rangements": "rangements-pro",
  "habillage mural": "habillage-mural",
  "mur principal": "mur-principal",
  "second mur": "mur-accent",
  plafond: "plafond",
};

export function surfaceDepuisLibelle(libelle: string): string {
  const cle = libelle
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return SURFACES_PAR_LIBELLE[cle] ?? "";
}

export function lireZones(json: string | null | undefined): ZoneTeinte[] {
  if (!json) return [];
  try {
    const valeur: unknown = JSON.parse(json);
    if (!Array.isArray(valeur)) return [];
    const zones = valeur
      .filter((z): z is ZoneTeinte => !!z && typeof z === "object" && typeof (z as ZoneTeinte).ref === "string")
      .map((z) => ({ zone: String(z.zone ?? "") || surfaceDepuisLibelle(String(z.libelle ?? "")), libelle: String(z.libelle ?? ""), ref: z.ref, nom: String(z.nom ?? "") }));
    // Une zone nommée pour elle-même l'emporte sur celle venue du dépliage.
    const explicites = new Set(zones.filter((z) => !ZONES_COMPOSEES[z.zone]).map((z) => z.zone));
    return zones.flatMap((z) => {
      const cibles = ZONES_COMPOSEES[z.zone];
      if (!cibles) return [z];
      return cibles.filter((zone) => !explicites.has(zone)).map((zone) => ({ ...z, zone, libelle: ZONES[zone].libelle }));
    });
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
    { id: "autre", libelle: "Autre chose", aide: "Précisez dans la note" },
  ],
  SDB: [
    { id: "meuble-vasque", libelle: "Meuble vasque", aide: "Les façades sous le lavabo" },
    { id: "plan-vasque", libelle: "Plan vasque", aide: "Le dessus autour du lavabo" },
    { id: "carrelage-mural", libelle: "Murs carrelés", aide: "Recouvrir le carrelage existant" },
    { id: "autre", libelle: "Autre chose", aide: "Précisez dans la note" },
  ],
  MEUBLES: [
    { id: "portes-dressing", libelle: "Dressing, placards", aide: "Portes battantes ou coulissantes" },
    { id: "meuble-tv", libelle: "Meuble TV", aide: "Façades, dessus et côtés" },
    { id: "meuble-complet", libelle: "Commode, buffet, bureau", aide: "Un meuble seul" },
    { id: "autre", libelle: "Autre chose", aide: "Précisez dans la note" },
  ],
  PRO: [
    { id: "comptoir-habillage", libelle: "Bar, comptoir", aide: "La façade et le plateau" },
    { id: "mobilier-pro", libelle: "Mobilier", aide: "Distributeur, présentoir, casiers" },
    { id: "rangements-pro", libelle: "Rangements", aide: "Portes de placards et d'armoires" },
    { id: "habillage-mural", libelle: "Un mur", aide: "Un mur ou un panneau du local" },
    { id: "autre", libelle: "Autre chose", aide: "Précisez dans la note" },
  ],
};

/** Le nom d'une zone dans les mots du client (« Façades hautes » plutôt que « Meubles hauts ») : celui de son Projet. */
export function libelleZoneClient(zone: string, typeProjet: string | null | undefined): string | null {
  const liste = ZONES_PROJET_CLIENT[typeProjet ?? "CUISINE"] ?? ZONES_PROJET_CLIENT.CUISINE;
  return liste.find((z) => z.id === zone)?.libelle ?? Object.values(ZONES_PROJET_CLIENT).flat().find((z) => z.id === zone)?.libelle ?? null;
}

/** Type de surface du simulateur le plus proche du projet du client. */
export function typeSurfacePourProjet(typeProjet: string | null | undefined, zones: string[] = []): string {
  if (typeProjet === "SDB") return "plan-vasque";
  if (typeProjet === "MEUBLES") return zones.includes("meuble-tv") && !zones.includes("portes-dressing") ? "meuble-tv" : "dressing";
  if (typeProjet === "PRO") return zones.includes("mobilier-pro") || zones.includes("rangements-pro") ? "mobilier-pro" : "bar";
  const cuisine = zones.filter((z) => ["meubles-hauts", "meubles-bas", "plan-de-travail", "credence"].includes(z));
  return cuisine.length === 1 ? cuisine[0] : "cuisine";
}
