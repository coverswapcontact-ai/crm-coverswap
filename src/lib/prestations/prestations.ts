import type { Unite } from "@/lib/dossiers/constants";
import type { IdZone } from "@/lib/simulateur/types-surface";

/**
 * LES PRESTATIONS DE COVERSWAP — source unique (22/09/2026).
 *
 * Quatre familles, et pour chacune les sous-parties que Lucas facture. Tout le
 * système lit ce fichier : l'espace client (onglet Projet, guide photo, zones du
 * simulateur, mots de l'écran), le CRM (familles d'un dossier, carte du kanban,
 * simulateur, devis prérempli, tarifs) et le site (formulaire de devis,
 * simulateur public), qui le reçoit par `GET /api/prestations`.
 *
 * Ajouter une sous-partie ici suffit : elle apparaît partout. Les identifiants
 * ne changent jamais (ils sont écrits dans les dossiers) ; un libellé, si.
 *
 * Chaque sous-partie est reliée :
 *  - aux SURFACES du moteur de simulation (identifiants du simulateur du site,
 *    lib/simulateur/surfaces) — toujours prises dans le projet du simulateur de
 *    sa famille, car la consigne refuse une surface d'un autre projet ;
 *  - à un TARIF : celui que Lucas lui attribue dans ses tarifs (Dossiers →
 *    Tarifs), sinon le premier de ses tarifs dont la désignation contient les
 *    mots donnés ici ; sinon aucun (prix à saisir : rien n'est inventé).
 *
 * Aucune dépendance serveur : importé tel quel par les écrans.
 */

export const IDS_FAMILLE = ["CUISINE", "SDB", "MEUBLES", "PRO"] as const;
export type IdFamille = (typeof IDS_FAMILLE)[number];

export type TarifParDefaut = {
  /** Désignation de la ligne de devis quand aucun tarif n'est trouvé. */
  designation: string;
  unite: Unite;
  /** Mots cherchés dans la désignation des tarifs (sans accents), essayés dans l'ordre. */
  mots: string[][];
};

export type SousPartie = {
  id: string;
  libelle: string;
  aide: string;
  /** Surfaces du moteur que cette sous-partie habille. */
  zones: IdZone[];
  tarif: TarifParDefaut;
  /** La taille donnée par le client (mètres de meubles) chiffre cette ligne : jamais un plan de travail ni une crédence. */
  metrage?: true;
};

/** La taille demandée dans l'onglet Projet, selon la famille. */
export type QuestionTaille = {
  titre: string;
  aide: string;
  /** « m » : des mètres (meubles mis bout à bout) ; « portes » : un nombre de portes. */
  unite: "m" | "portes";
  min: number;
  max: number;
  pas: number;
  depart: number;
  /** Repères cliquables (forme de la cuisine…), avec la valeur qu'ils posent. */
  reperes: { id: string; libelle: string; aide: string; valeur: number }[];
  /** La taille est-elle nécessaire pour valider le projet ? */
  requise: boolean;
};

/** Une prise conseillée dans le guide photo. `cadre` : dessin de cuisine à montrer (cuisine seulement). */
export type PrisePhoto = { titre: string; aide: string; cadre?: "ensemble" | "hauts" | "bas" | "plan" | "detail" };

export type Famille = {
  id: IdFamille;
  libelle: string;
  /** Ce qu'elle couvre, en une ligne (carte de la famille). */
  aide: string;
  /** Mots de l'écran : « Envoyez-nous quelques photos de votre salle de bain ». */
  mots: { nom: string; votre: string; de: string };
  /** Projet du simulateur du site (lib/simulateur/projets) et type de surface de l'espace. */
  projetSimulateur: "cuisine" | "salle-de-bain" | "meubles" | "professionnel";
  typeSurfaceEspace: string;
  /** Les surfaces proposées au simulateur, dans les mots du client, dans l'ordre de l'écran. */
  zonesSimulateur: { zone: IdZone; libelle: string }[];
  sousParties: SousPartie[];
  taille: QuestionTaille;
  photos: PrisePhoto[];
};

const ml = (designation: string, ...mots: string[][]): TarifParDefaut => ({ designation, unite: "ml", mots });

export const FAMILLES: readonly Famille[] = [
  {
    id: "CUISINE",
    libelle: "Cuisine",
    aide: "Façades, plan de travail, crédence, îlot",
    mots: { nom: "cuisine", votre: "votre cuisine", de: "de votre cuisine" },
    projetSimulateur: "cuisine",
    typeSurfaceEspace: "cuisine",
    zonesSimulateur: [
      { zone: "meubles-hauts", libelle: "Façades hautes" },
      { zone: "meubles-bas", libelle: "Façades basses, îlot" },
      { zone: "plan-de-travail", libelle: "Plan de travail" },
      { zone: "credence", libelle: "Crédence" },
    ],
    sousParties: [
      { id: "facades-hautes", metrage: true, libelle: "Façades hautes", aide: "Les meubles au-dessus du plan de travail", zones: ["meubles-hauts"], tarif: ml("Revêtement adhésif — façades hautes", ["revetement", "facade"], ["revetement", "cuisine"]) },
      { id: "facades-basses", metrage: true, libelle: "Façades basses", aide: "Les portes et tiroirs sous le plan", zones: ["meubles-bas"], tarif: ml("Revêtement adhésif — façades basses", ["revetement", "facade"], ["revetement", "cuisine"]) },
      { id: "plan-de-travail", libelle: "Plan de travail", aide: "Le dessus et son chant", zones: ["plan-de-travail"], tarif: ml("Revêtement adhésif — plan de travail", ["revetement", "plan de travail"]) },
      { id: "credence", libelle: "Crédence", aide: "Le mur entre le plan et les meubles hauts", zones: ["credence"], tarif: ml("Revêtement adhésif — crédence", ["revetement", "credence"]) },
      { id: "ilot", metrage: true, libelle: "Îlot", aide: "Ses façades et son plan", zones: ["meubles-bas", "plan-de-travail"], tarif: ml("Revêtement adhésif — îlot", ["revetement", "ilot"], ["revetement", "facade"], ["revetement", "cuisine"]) },
      { id: "electromenager", metrage: true, libelle: "Électroménager intégré", aide: "Portes du lave-vaisselle, du réfrigérateur", zones: ["meubles-bas"], tarif: ml("Revêtement adhésif — électroménager intégré", ["revetement", "electromenager"], ["revetement", "facade"], ["revetement", "cuisine"]) },
    ],
    taille: {
      titre: "La taille de la cuisine, à peu près",
      aide: "Des meubles mis bout à bout. Une estimation suffit : nous mesurons sur place.",
      unite: "m",
      min: 0.5,
      max: 60,
      pas: 0.5,
      depart: 3,
      reperes: [
        { id: "une-rangee", libelle: "Un seul mur", aide: "≈ 3 m", valeur: 3 },
        { id: "en-l", libelle: "En L", aide: "≈ 5 m", valeur: 5 },
        { id: "en-u", libelle: "En U", aide: "≈ 7 m", valeur: 7 },
        { id: "ilot", libelle: "Avec îlot", aide: "≈ 8 m", valeur: 8 },
      ],
      requise: true,
    },
    photos: [
      { cadre: "ensemble", titre: "Vue d'ensemble", aide: "Reculez au maximum, toute la pièce dans l'image" },
      { cadre: "hauts", titre: "Meubles hauts", aide: "De face, les portes entières" },
      { cadre: "bas", titre: "Meubles bas", aide: "De face, à hauteur de poitrine" },
      { cadre: "plan", titre: "Plan de travail", aide: "En légère plongée, sur toute sa longueur" },
      { cadre: "detail", titre: "Un détail", aide: "Une porte et sa poignée, de près" },
    ],
  },
  {
    id: "SDB",
    libelle: "Salle de bain",
    aide: "Meuble vasque, plan vasque, crédence, placards",
    mots: { nom: "salle de bain", votre: "votre salle de bain", de: "de votre salle de bain" },
    projetSimulateur: "salle-de-bain",
    typeSurfaceEspace: "espace-salle-de-bain",
    zonesSimulateur: [
      { zone: "meuble-vasque", libelle: "Meuble vasque, placards" },
      { zone: "plan-vasque", libelle: "Plan vasque" },
      { zone: "carrelage-mural", libelle: "Crédence, murs carrelés" },
    ],
    sousParties: [
      { id: "meuble-vasque", metrage: true, libelle: "Meuble vasque", aide: "Les portes et tiroirs sous le lavabo", zones: ["meuble-vasque"], tarif: ml("Revêtement adhésif — meuble vasque", ["revetement", "meuble vasque"], ["revetement", "salle de bain"]) },
      { id: "plan-vasque", libelle: "Plan vasque", aide: "Le dessus autour du lavabo", zones: ["plan-vasque"], tarif: ml("Revêtement adhésif — plan vasque", ["revetement", "plan vasque"]) },
      { id: "credence", libelle: "Crédence", aide: "Le mur derrière le lavabo", zones: ["carrelage-mural"], tarif: ml("Revêtement adhésif — crédence de salle de bain", ["revetement", "credence"]) },
      { id: "portes-placard", libelle: "Portes de placard", aide: "Colonnes et placards de la pièce", zones: ["meuble-vasque"], tarif: ml("Revêtement adhésif — portes de placard", ["revetement", "placard"], ["revetement", "salle de bain"]) },
    ],
    taille: {
      titre: "La longueur du meuble vasque, à peu près",
      aide: "Une estimation suffit : nous mesurons sur place.",
      unite: "m",
      min: 0.4,
      max: 10,
      pas: 0.2,
      depart: 0.8,
      reperes: [
        { id: "un-lavabo", libelle: "Un lavabo", aide: "≈ 80 cm", valeur: 0.8 },
        { id: "deux-lavabos", libelle: "Deux lavabos", aide: "≈ 1,40 m", valeur: 1.4 },
      ],
      requise: false,
    },
    photos: [
      { titre: "Vue d'ensemble", aide: "Depuis la porte, toute la pièce dans l'image" },
      { titre: "Le meuble vasque", aide: "De face, les portes et le plan entiers" },
      { titre: "Un détail", aide: "Une porte, une poignée ou un joint, de près" },
    ],
  },
  {
    id: "MEUBLES",
    libelle: "Mobilier",
    aide: "Dressing, placards, meuble TV, bar, bibliothèque, bureau",
    mots: { nom: "mobilier", votre: "vos meubles", de: "de vos meubles" },
    projetSimulateur: "meubles",
    typeSurfaceEspace: "espace-meubles",
    zonesSimulateur: [
      { zone: "portes-dressing", libelle: "Portes de dressing, placards" },
      { zone: "meuble-tv", libelle: "Meuble TV" },
      { zone: "meuble-complet", libelle: "Bar, bibliothèque, bureau, autre meuble" },
    ],
    sousParties: [
      { id: "portes-dressing", libelle: "Portes de dressing", aide: "Battantes ou coulissantes, placards compris", zones: ["portes-dressing"], tarif: ml("Revêtement adhésif — portes de dressing", ["revetement", "dressing"], ["revetement", "placard"]) },
      { id: "meuble-tv", libelle: "Meuble TV", aide: "Façades, dessus et côtés", zones: ["meuble-tv"], tarif: ml("Revêtement adhésif — meuble TV", ["revetement", "meuble tv"]) },
      { id: "bar", libelle: "Bar", aide: "Sa façade et son plateau", zones: ["meuble-complet"], tarif: ml("Revêtement adhésif — bar", ["revetement", "bar"]) },
      { id: "bibliotheque", libelle: "Bibliothèque", aide: "Montants, étagères et portes", zones: ["meuble-complet"], tarif: ml("Revêtement adhésif — bibliothèque", ["revetement", "bibliotheque"]) },
      { id: "bureau", libelle: "Bureau", aide: "Le plateau, les côtés, les tiroirs", zones: ["meuble-complet"], tarif: ml("Revêtement adhésif — bureau", ["revetement", "bureau"]) },
      { id: "autre-meuble", libelle: "Autre meuble", aide: "Commode, buffet, table : dites lequel dans la note", zones: ["meuble-complet"], tarif: ml("Revêtement adhésif — mobilier", ["revetement", "mobilier"]) },
    ],
    taille: {
      titre: "Combien de portes, à peu près",
      aide: "Comptez chaque porte et chaque tiroir. Pour un meuble sans porte, passez.",
      unite: "portes",
      min: 1,
      max: 60,
      pas: 1,
      depart: 4,
      reperes: [],
      requise: false,
    },
    photos: [
      { titre: "Le meuble entier", aide: "De face : reculez pour qu'il tienne dans l'image" },
      { titre: "Les portes", aide: "Bien droit, portes fermées" },
      { titre: "Un détail", aide: "Une poignée, un chant, l'état de la surface" },
    ],
  },
  {
    id: "PRO",
    libelle: "Professionnel",
    aide: "Comptoir, mobilier d'accueil, distributeur, agencement",
    mots: { nom: "local professionnel", votre: "votre local", de: "de votre local" },
    projetSimulateur: "professionnel",
    typeSurfaceEspace: "espace-professionnel",
    zonesSimulateur: [
      { zone: "comptoir-habillage", libelle: "Façade du comptoir" },
      { zone: "comptoir-plateau", libelle: "Plateau du comptoir" },
      { zone: "mobilier-pro", libelle: "Mobilier, distributeur" },
      { zone: "rangements-pro", libelle: "Façades de rangements" },
      { zone: "habillage-mural", libelle: "Un mur, un panneau" },
    ],
    sousParties: [
      { id: "comptoir", metrage: true, libelle: "Comptoir", aide: "Sa façade et son plateau", zones: ["comptoir-habillage", "comptoir-plateau"], tarif: ml("Revêtement adhésif — comptoir", ["revetement", "comptoir"], ["revetement", "bar"]) },
      { id: "mobilier", metrage: true, libelle: "Mobilier", aide: "Mobilier d'accueil, présentoirs, casiers", zones: ["mobilier-pro"], tarif: ml("Revêtement adhésif — mobilier professionnel", ["revetement", "mobilier"]) },
      { id: "distributeur", metrage: true, libelle: "Distributeur", aide: "Distributeur automatique, borne", zones: ["mobilier-pro"], tarif: ml("Revêtement adhésif — distributeur", ["revetement", "distributeur"]) },
      { id: "facade", libelle: "Façade", aide: "Façades de rangements, un mur, un panneau", zones: ["rangements-pro", "habillage-mural"], tarif: ml("Revêtement adhésif — façade, agencement", ["revetement", "agencement"], ["revetement", "habillage"]) },
      { id: "autre", libelle: "Autre", aide: "Dites-nous quoi dans la note", zones: [], tarif: ml("Revêtement adhésif — à préciser") },
    ],
    taille: {
      titre: "Combien de mètres de comptoir ou de mobilier, à peu près",
      aide: "Une estimation suffit : nous mesurons sur place.",
      unite: "m",
      min: 0.5,
      max: 60,
      pas: 0.5,
      depart: 3,
      reperes: [],
      requise: false,
    },
    photos: [
      { titre: "Vue d'ensemble", aide: "Le comptoir ou le mobilier dans son local" },
      { titre: "De face", aide: "Chaque meuble à recouvrir, bien droit" },
      { titre: "Un détail", aide: "Un angle, un chant, l'état de la surface" },
    ],
  },
];

/* ── Lecture ─────────────────────────────────────────────────────────── */

export function estFamille(id: unknown): id is IdFamille {
  return typeof id === "string" && (IDS_FAMILLE as readonly string[]).includes(id);
}

export function famille(id: IdFamille): Famille {
  return FAMILLES.find((f) => f.id === id)!;
}

/** Les familles et sous-parties d'un projet : `{ CUISINE: ["facades-hautes", …], SDB: [] }`. Une famille cochée sans sous-partie est permise. */
export type SelectionPrestations = Partial<Record<IdFamille, string[]>>;

/** Clé d'une sous-partie, unique dans tout le fichier : « CUISINE.credence ». */
export const cleSousPartie = (familleId: IdFamille, sousPartieId: string) => `${familleId}.${sousPartieId}`;

export function sousPartieDeCle(cle: string): { famille: Famille; sousPartie: SousPartie } | null {
  const [id, sp] = cle.split(".");
  if (!estFamille(id)) return null;
  const f = famille(id);
  const sousPartie = f.sousParties.find((s) => s.id === sp);
  return sousPartie ? { famille: f, sousPartie } : null;
}

/** Remet une sélection en ordre : familles et sous-parties connues seulement, dans l'ordre du fichier, sans doublon. */
export function normaliserSelection(brut: unknown): SelectionPrestations {
  const sortie: SelectionPrestations = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return sortie;
  const entree = brut as Record<string, unknown>;
  for (const f of FAMILLES) {
    if (!(f.id in entree)) continue;
    const valeur = entree[f.id];
    const ids = Array.isArray(valeur) ? new Set(valeur.filter((v): v is string => typeof v === "string")) : new Set<string>();
    sortie[f.id] = f.sousParties.filter((s) => ids.has(s.id)).map((s) => s.id);
  }
  return sortie;
}

export function lireSelection(json: string | null | undefined): SelectionPrestations {
  if (!json) return {};
  try {
    return normaliserSelection(JSON.parse(json));
  } catch {
    return {};
  }
}

export const selectionVide = (s: SelectionPrestations) => Object.keys(s).length === 0;

/** Les familles cochées, dans l'ordre du fichier. */
export function famillesDe(s: SelectionPrestations): IdFamille[] {
  return IDS_FAMILLE.filter((id) => id in s);
}

export function nombreSousParties(s: SelectionPrestations): number {
  return famillesDe(s).reduce((n, id) => n + (s[id]?.length ?? 0), 0);
}

export const memeSelection = (a: SelectionPrestations, b: SelectionPrestations) => JSON.stringify(normaliserSelection(a)) === JSON.stringify(normaliserSelection(b));

/** « Cuisine : façades hautes, plan de travail · Mobilier : portes de dressing » (une famille sans sous-partie : son nom seul). */
export function resumerSelection(s: SelectionPrestations): string {
  return famillesDe(s)
    .map((id) => {
      const f = famille(id);
      const parties = (s[id] ?? []).map((sp) => f.sousParties.find((x) => x.id === sp)?.libelle.toLowerCase()).filter(Boolean);
      return parties.length ? `${f.libelle} : ${parties.join(", ")}` : f.libelle;
    })
    .join(" · ");
}

/** Les libellés courts des familles : « Cuisine, Salle de bain ». */
export const libellesFamilles = (ids: IdFamille[]) => ids.map((id) => famille(id).libelle).join(", ");

/** Les familles en une phrase, pour nommer un projet : « Cuisine, salle de bain et mobilier ». */
export function phraseFamilles(ids: IdFamille[]): string {
  const mots = ids.map((id, i) => (i === 0 ? famille(id).libelle : famille(id).libelle.toLowerCase()));
  return mots.length > 1 ? `${mots.slice(0, -1).join(", ")} et ${mots.at(-1)}` : (mots[0] ?? "");
}

/** Les mots de l'écran pour un projet : ceux de SA famille s'il n'en a qu'une, sinon « votre projet ». */
export function motsDuProjet(familles: IdFamille[]): { nom: string; votre: string; de: string } {
  if (familles.length === 1) return famille(familles[0]).mots;
  return { nom: "projet", votre: "votre projet", de: "de votre projet" };
}

/** Le `typeProjet` d'un lead (formulaire du site, simulateur) → une famille ; AUTRE ou inconnu → aucune. */
export function familleDuTypeProjet(typeProjet: string | null | undefined): IdFamille | null {
  return estFamille(typeProjet) ? typeProjet : null;
}

/** Surfaces du moteur → la sous-partie qu'elles désignent (préremplissage depuis une simulation du site). */
const SOUS_PARTIE_DES_ZONES: Record<string, [IdFamille, string]> = {
  "facades-cuisine": ["CUISINE", "facades-hautes"],
  "meubles-hauts": ["CUISINE", "facades-hautes"],
  "meubles-bas": ["CUISINE", "facades-basses"],
  "plan-de-travail": ["CUISINE", "plan-de-travail"],
  credence: ["CUISINE", "credence"],
  "meuble-vasque": ["SDB", "meuble-vasque"],
  "plan-vasque": ["SDB", "plan-vasque"],
  "carrelage-mural": ["SDB", "credence"],
  "tablier-baignoire": ["SDB", "meuble-vasque"],
  "portes-dressing": ["MEUBLES", "portes-dressing"],
  "meuble-tv": ["MEUBLES", "meuble-tv"],
  "meuble-complet": ["MEUBLES", "autre-meuble"],
  "comptoir-habillage": ["PRO", "comptoir"],
  "comptoir-plateau": ["PRO", "comptoir"],
  "mobilier-pro": ["PRO", "mobilier"],
  "rangements-pro": ["PRO", "facade"],
  "habillage-mural": ["PRO", "facade"],
};

/**
 * Ce que le client a dit avant les familles (zones cochées dans son Projet v3,
 * surfaces de ses simulations du site) → une sélection. « facades-cuisine »
 * (toutes les façades) donne les façades hautes ET basses. `typeProjet` range
 * « autre chose » dans sa famille.
 */
export function selectionDepuisZones(zones: string[], typeProjet?: string | null): SelectionPrestations {
  const brut: Record<string, string[]> = {};
  const ajouter = (f: IdFamille, sp: string | null) => {
    brut[f] = brut[f] ?? [];
    if (sp && !brut[f].includes(sp)) brut[f].push(sp);
  };
  for (const zone of zones) {
    if (zone === "facades-cuisine") {
      ajouter("CUISINE", "facades-hautes");
      ajouter("CUISINE", "facades-basses");
      continue;
    }
    const cible = SOUS_PARTIE_DES_ZONES[zone];
    if (cible) ajouter(cible[0], cible[1]);
    else if (zone === "autre") {
      const f = familleDuTypeProjet(typeProjet);
      if (f) ajouter(f, f === "MEUBLES" ? "autre-meuble" : f === "PRO" ? "autre" : null);
    }
  }
  return normaliserSelection(brut);
}

/**
 * Les surfaces à proposer au simulateur pour une famille du projet : celles de
 * ses sous-parties cochées (dans l'ordre de l'écran), toutes celles de la
 * famille s'il n'en a coché aucune.
 */
export function zonesPourSimulation(familleId: IdFamille, s: SelectionPrestations): { zone: IdZone; libelle: string; cochee: boolean }[] {
  const f = famille(familleId);
  const cochees = new Set((s[familleId] ?? []).flatMap((sp) => f.sousParties.find((x) => x.id === sp)?.zones ?? []));
  return f.zonesSimulateur.map((z) => ({ ...z, cochee: cochees.has(z.zone) }));
}

/** La famille du simulateur d'une surface (pour ranger une ancienne simulation). */
export function familleDeLaZone(zone: string): IdFamille | null {
  return FAMILLES.find((f) => f.zonesSimulateur.some((z) => z.zone === zone))?.id ?? SOUS_PARTIE_DES_ZONES[zone]?.[0] ?? null;
}

/* ── Taille ──────────────────────────────────────────────────────────── */

/** La taille dite par le client, par famille : un repère et/ou une valeur (mètres ou portes). */
export type TailleProjet = { repere: string | null; valeur: number | null };
export type TaillesProjet = Partial<Record<IdFamille, TailleProjet>>;

/** « ≈ 5 m (en L) », « en L », « 6 portes » : la taille dite par le client, en clair. */
export function libelleTaille(familleId: IdFamille, t: TailleProjet | undefined): string | null {
  if (!t || (!t.repere && !t.valeur)) return null;
  const q = famille(familleId).taille;
  const repere = q.reperes.find((r) => r.id === t.repere);
  const forme = repere ? repere.libelle.charAt(0).toLowerCase() + repere.libelle.slice(1) : null;
  const valeur = t.valeur ? (q.unite === "portes" ? `${t.valeur} porte${t.valeur > 1 ? "s" : ""}` : `≈ ${String(t.valeur).replace(".", ",")} m`) : null;
  if (valeur && forme) return `${valeur} (${forme})`;
  return valeur ?? forme;
}

/* ── Pour le site et l'espace (JSON public) ──────────────────────────── */

export type PrestationsPubliques = {
  version: 1;
  familles: {
    id: IdFamille;
    libelle: string;
    aide: string;
    mots: Famille["mots"];
    projetSimulateur: Famille["projetSimulateur"];
    sousParties: { id: string; libelle: string; aide: string }[];
    taille: QuestionTaille;
    photos: PrisePhoto[];
  }[];
};

/** Ce que le site et l'espace client lisent : aucun tarif, aucun mot-clé interne. */
export function prestationsPubliques(): PrestationsPubliques {
  return {
    version: 1,
    familles: FAMILLES.map((f) => ({
      id: f.id,
      libelle: f.libelle,
      aide: f.aide,
      mots: f.mots,
      projetSimulateur: f.projetSimulateur,
      sousParties: f.sousParties.map((s) => ({ id: s.id, libelle: s.libelle, aide: s.aide })),
      taille: f.taille,
      photos: f.photos,
    })),
  };
}
