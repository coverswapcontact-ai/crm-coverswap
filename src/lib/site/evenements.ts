import prisma from "@/lib/prisma";

/**
 * Événements de parcours envoyés par le site : sans donnée personnelle, un
 * identifiant de parcours navigateur, la page et l'origine (utm). Ils
 * alimentent la synthèse (audience et entonnoir par source et par page).
 */
export const TYPES_EVENEMENT_SITE = [
  "PAGE_VUE",
  // Mission 15 (partie 4) : l'entonnoir du simulateur, une étape = un événement (pièce → photo → génération → résultat vu → contact).
  "PIECE_CHOISIE",
  "PHOTO_CHARGEE",
  "GENERATION_LANCEE",
  "RESULTAT_VU",
  // Anciens noms (site d'avant la partie 4) : encore lus, comptés avec les nouveaux.
  "SIMULATION_PHOTO",
  "SIMULATION_LANCEE",
  "SIMULATION_RESULTAT",
  "SIMULATION_ECHEC",
  "DEVIS_DEMANDE",
  "CONTACT_ENVOYE",
  "FORMULAIRE_ECHEC",
  // Mission 16 (partie 3) : « Écrire sur WhatsApp » (dernier appel de l'accueil). Son propre type canonique : ce n'est pas un formulaire envoyé.
  "WHATSAPP_CLIQUE",
  // Mission 16 (partie 4) : le tunnel après le rendu — l'estimation affichée, puis la demande d'être rappelé.
  "ESTIMATION_VUE",
  "RAPPEL_DEMANDE",
] as const;
export type TypeEvenementSite = (typeof TYPES_EVENEMENT_SITE)[number];

export const LIBELLES_EVENEMENT_SITE: Record<TypeEvenementSite, string> = {
  PAGE_VUE: "Pages vues",
  PIECE_CHOISIE: "Pièces choisies (simulateur)",
  PHOTO_CHARGEE: "Photos chargées (simulateur)",
  GENERATION_LANCEE: "Générations lancées",
  RESULTAT_VU: "Résultats vus",
  SIMULATION_PHOTO: "Photos chargées (ancien site)",
  SIMULATION_LANCEE: "Générations lancées (ancien site)",
  SIMULATION_RESULTAT: "Résultats vus (ancien site)",
  SIMULATION_ECHEC: "Simulations échouées",
  DEVIS_DEMANDE: "Devis demandés",
  CONTACT_ENVOYE: "Formulaires envoyés",
  FORMULAIRE_ECHEC: "Formulaires en échec",
  WHATSAPP_CLIQUE: "Clics WhatsApp",
  ESTIMATION_VUE: "Estimations vues",
  RAPPEL_DEMANDE: "Rappels demandés",
};

export type EntreeEvenementSite = {
  parcoursId: string;
  type: TypeEvenementSite;
  page?: string | null;
  source?: string | null;
  campagne?: string | null;
  meta?: Record<string, unknown> | null;
};

export function estTypeEvenementSite(valeur: unknown): valeur is TypeEvenementSite {
  return typeof valeur === "string" && (TYPES_EVENEMENT_SITE as readonly string[]).includes(valeur);
}

export async function enregistrerEvenementSite(entree: EntreeEvenementSite): Promise<void> {
  await prisma.evenementSite.create({
    data: {
      parcoursId: entree.parcoursId,
      type: entree.type,
      page: entree.page?.slice(0, 200) ?? null,
      source: entree.source?.slice(0, 120) ?? null,
      campagne: entree.campagne?.slice(0, 120) ?? null,
      meta: entree.meta ? JSON.stringify(entree.meta).slice(0, 1000) : null,
    },
  });
}

/**
 * Les anciens noms (site d'avant la partie 4) rangés sous le nouveau : `parType`
 * a UNE ligne par étape, anciens et nouveaux événements additionnés — la
 * synthèse ne montre jamais « 3 résultats vus · 2 résultats vus ». Un type
 * nouveau (`WHATSAPP_CLIQUE`, mission 16) n'y figure pas : il est son propre
 * type canonique (`typeCanonique` le rend tel quel) et a sa ligne à lui.
 */
export const TYPE_CANONIQUE: Partial<Record<TypeEvenementSite, TypeEvenementSite>> = {
  SIMULATION_PHOTO: "PHOTO_CHARGEE",
  SIMULATION_LANCEE: "GENERATION_LANCEE",
  SIMULATION_RESULTAT: "RESULTAT_VU",
};
export const typeCanonique = (type: string): string => (TYPE_CANONIQUE as Record<string, string | undefined>)[type] ?? type;

export type SyntheseSite = {
  parcours: number;
  /** Une ligne par type canonique (les anciens noms sont comptés sous le nouveau). */
  parType: { cle: TypeEvenementSite; libelle: string; valeur: number; parcours: number }[];
  parSource: { cle: string; libelle: string; parcours: number; simulations: number; devis: number }[];
  parPage: { cle: string; libelle: string; vues: number; simulations: number; devis: number }[];
  /** Simulations lancées ayant vu un résultat, en pourcentage. */
  tauxCompletionSimulateur: number | null;
  /** Parcours ayant vu un résultat et demandé un devis, en pourcentage. */
  tauxDevisApresResultat: number | null;
};

const libelleSource = (cle: string) => (cle === "direct" ? "Accès direct / inconnu" : cle);
/** Une génération lancée, un résultat vu : nouveau nom (partie 4) ou ancien, comptés ensemble. */
const estLancee = (type: string) => typeCanonique(type) === "GENERATION_LANCEE";
const estResultat = (type: string) => typeCanonique(type) === "RESULTAT_VU";

/** Entonnoir et audience du site sur la période, par source et par page. */
export async function syntheseSite(du: string, au: string): Promise<SyntheseSite> {
  const evenements = await prisma.evenementSite.findMany({
    where: { createdAt: { gte: new Date(du), lte: new Date(`${au}T23:59:59.999Z`) } },
    select: { parcoursId: true, type: true, page: true, source: true },
  });
  const parcours = new Set(evenements.map((e) => e.parcoursId));
  const parType = TYPES_EVENEMENT_SITE.filter((type) => !TYPE_CANONIQUE[type]).map((type) => {
    const lignes = evenements.filter((e) => typeCanonique(e.type) === type);
    return { cle: type, libelle: LIBELLES_EVENEMENT_SITE[type], valeur: lignes.length, parcours: new Set(lignes.map((e) => e.parcoursId)).size };
  }).filter((ligne) => ligne.valeur > 0);

  const groupes = (cle: (e: (typeof evenements)[number]) => string) => {
    const index = new Map<string, (typeof evenements)[number][]>();
    for (const e of evenements) {
      const k = cle(e);
      index.set(k, [...(index.get(k) ?? []), e]);
    }
    return [...index.entries()];
  };
  const parSource = groupes((e) => e.source || "direct")
    .map(([cle, lignes]) => ({
      cle,
      libelle: libelleSource(cle),
      parcours: new Set(lignes.map((e) => e.parcoursId)).size,
      simulations: lignes.filter((e) => estLancee(e.type)).length,
      devis: lignes.filter((e) => e.type === "DEVIS_DEMANDE").length,
    }))
    .sort((a, b) => b.parcours - a.parcours);
  const parPage = groupes((e) => e.page || "?")
    .map(([cle, lignes]) => ({
      cle,
      libelle: cle,
      vues: lignes.filter((e) => e.type === "PAGE_VUE").length,
      simulations: lignes.filter((e) => estLancee(e.type)).length,
      devis: lignes.filter((e) => e.type === "DEVIS_DEMANDE").length,
    }))
    .sort((a, b) => b.vues + b.simulations - (a.vues + a.simulations))
    .slice(0, 20);

  const lancees = new Set(evenements.filter((e) => estLancee(e.type)).map((e) => e.parcoursId));
  const resultats = new Set(evenements.filter((e) => estResultat(e.type)).map((e) => e.parcoursId));
  const devis = new Set(evenements.filter((e) => e.type === "DEVIS_DEMANDE").map((e) => e.parcoursId));
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
  return {
    parcours: parcours.size,
    parType,
    parSource,
    parPage,
    tauxCompletionSimulateur: pct([...lancees].filter((p) => resultats.has(p)).length, lancees.size),
    tauxDevisApresResultat: pct([...resultats].filter((p) => devis.has(p)).length, resultats.size),
  };
}

/* ── Entonnoir du simulateur (mission 15, partie 4 ; mission 16, partie 4) ───────────────── */

/**
 * Une étape de l'entonnoir : les types qui la marquent (nouveau nom, puis ancien). Mission 16 (partie 4) : sept
 * étapes — la visite (une page vue) en tête, l'estimation vue entre le rendu et le contact, et la demande de rappel
 * comptée comme un contact. L'estimation est FACULTATIVE : la demande part aussi sans taille choisie (cuisine), donc
 * elle n'est pas un passage obligé — comptée parmi les résultats vus, sans abandons, et le contact se compte parmi
 * les résultats vus (pas parmi les estimations vues : sinon une demande sans taille serait un « abandon »).
 */
export const ETAPES_ENTONNOIR: readonly { cle: string; libelle: string; types: readonly TypeEvenementSite[]; facultative?: true }[] = [
  { cle: "visite", libelle: "Visite", types: ["PAGE_VUE"] },
  { cle: "piece", libelle: "Pièce choisie", types: ["PIECE_CHOISIE"] },
  { cle: "photo", libelle: "Photo chargée", types: ["PHOTO_CHARGEE", "SIMULATION_PHOTO"] },
  { cle: "generation", libelle: "Génération lancée", types: ["GENERATION_LANCEE", "SIMULATION_LANCEE"] },
  { cle: "resultat", libelle: "Résultat vu", types: ["RESULTAT_VU", "SIMULATION_RESULTAT"] },
  { cle: "estimation", libelle: "Estimation vue", types: ["ESTIMATION_VUE"], facultative: true },
  { cle: "contact", libelle: "Contact ou rappel", types: ["DEVIS_DEMANDE", "CONTACT_ENVOYE", "RAPPEL_DEMANDE"] },
];

export type EtapeEntonnoir = {
  cle: string;
  libelle: string;
  parcours: number;
  /** Parcours de l'étape obligatoire d'avant qui ne sont pas allés plus loin (null pour la première et pour une étape facultative). */
  abandons: number | null;
  /** Étape qu'on peut sauter (l'estimation) : l'étape suivante se compte sans elle. */
  facultative?: true;
};
export type EntonnoirSite = { jours: number; etapes: EtapeEntonnoir[] };

/**
 * L'entonnoir emboîté : un parcours compte à une étape s'il l'a atteinte ET
 * avait atteint la précédente (une demande de contact sans résultat vu n'est
 * pas un « contact après simulation »). Une étape facultative (l'estimation) se
 * compte parmi les parcours de l'étape d'avant, sans abandons, et ne sert pas
 * d'étape précédente à la suivante. Pur : testable sans base.
 */
export function calculerEntonnoir(evenements: { parcoursId: string; type: string }[], jours = 7): EntonnoirSite {
  const parType = new Map<string, Set<string>>();
  for (const e of evenements) {
    if (!parType.has(e.type)) parType.set(e.type, new Set());
    parType.get(e.type)!.add(e.parcoursId);
  }
  let precedent: Set<string> | null = null;
  const etapes: EtapeEntonnoir[] = [];
  for (const etape of ETAPES_ENTONNOIR) {
    const atteint = new Set<string>();
    for (const type of etape.types) for (const p of parType.get(type) ?? []) if (!precedent || precedent.has(p)) atteint.add(p);
    if (etape.facultative) {
      etapes.push({ cle: etape.cle, libelle: etape.libelle, parcours: atteint.size, abandons: null, facultative: true });
      continue;
    }
    etapes.push({ cle: etape.cle, libelle: etape.libelle, parcours: atteint.size, abandons: precedent ? Math.max(0, precedent.size - atteint.size) : null });
    precedent = atteint;
  }
  return { jours, etapes };
}

/** L'entonnoir des `jours` derniers jours (rubrique « Sur le site cette semaine »). */
export async function entonnoirSite(jours = 7, maintenant: Date = new Date()): Promise<EntonnoirSite> {
  const depuis = new Date(maintenant.getTime() - jours * 24 * 60 * 60_000);
  const types = ETAPES_ENTONNOIR.flatMap((e) => [...e.types]);
  const evenements = await prisma.evenementSite.findMany({ where: { createdAt: { gte: depuis }, type: { in: types } }, select: { parcoursId: true, type: true } });
  return calculerEntonnoir(evenements, jours);
}
