import prisma from "@/lib/prisma";

/**
 * Événements de parcours envoyés par le site : sans donnée personnelle, un
 * identifiant de parcours navigateur, la page et l'origine (utm). Ils
 * alimentent la synthèse (audience et entonnoir par source et par page).
 */
export const TYPES_EVENEMENT_SITE = [
  "PAGE_VUE",
  "SIMULATION_PHOTO",
  "SIMULATION_LANCEE",
  "SIMULATION_RESULTAT",
  "SIMULATION_ECHEC",
  "DEVIS_DEMANDE",
  "CONTACT_ENVOYE",
  "FORMULAIRE_ECHEC",
] as const;
export type TypeEvenementSite = (typeof TYPES_EVENEMENT_SITE)[number];

export const LIBELLES_EVENEMENT_SITE: Record<TypeEvenementSite, string> = {
  PAGE_VUE: "Pages vues",
  SIMULATION_PHOTO: "Photos envoyées au simulateur",
  SIMULATION_LANCEE: "Simulations lancées",
  SIMULATION_RESULTAT: "Résultats vus",
  SIMULATION_ECHEC: "Simulations échouées",
  DEVIS_DEMANDE: "Devis demandés",
  CONTACT_ENVOYE: "Formulaires envoyés",
  FORMULAIRE_ECHEC: "Formulaires en échec",
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

export type SyntheseSite = {
  parcours: number;
  parType: { cle: TypeEvenementSite; libelle: string; valeur: number; parcours: number }[];
  parSource: { cle: string; libelle: string; parcours: number; simulations: number; devis: number }[];
  parPage: { cle: string; libelle: string; vues: number; simulations: number; devis: number }[];
  /** Simulations lancées ayant vu un résultat, en pourcentage. */
  tauxCompletionSimulateur: number | null;
  /** Parcours ayant vu un résultat et demandé un devis, en pourcentage. */
  tauxDevisApresResultat: number | null;
};

const libelleSource = (cle: string) => (cle === "direct" ? "Accès direct / inconnu" : cle);

/** Entonnoir et audience du site sur la période, par source et par page. */
export async function syntheseSite(du: string, au: string): Promise<SyntheseSite> {
  const evenements = await prisma.evenementSite.findMany({
    where: { createdAt: { gte: new Date(du), lte: new Date(`${au}T23:59:59.999Z`) } },
    select: { parcoursId: true, type: true, page: true, source: true },
  });
  const parcours = new Set(evenements.map((e) => e.parcoursId));
  const parType = TYPES_EVENEMENT_SITE.map((type) => {
    const lignes = evenements.filter((e) => e.type === type);
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
      simulations: lignes.filter((e) => e.type === "SIMULATION_LANCEE").length,
      devis: lignes.filter((e) => e.type === "DEVIS_DEMANDE").length,
    }))
    .sort((a, b) => b.parcours - a.parcours);
  const parPage = groupes((e) => e.page || "?")
    .map(([cle, lignes]) => ({
      cle,
      libelle: cle,
      vues: lignes.filter((e) => e.type === "PAGE_VUE").length,
      simulations: lignes.filter((e) => e.type === "SIMULATION_LANCEE").length,
      devis: lignes.filter((e) => e.type === "DEVIS_DEMANDE").length,
    }))
    .sort((a, b) => b.vues + b.simulations - (a.vues + a.simulations))
    .slice(0, 20);

  const lancees = new Set(evenements.filter((e) => e.type === "SIMULATION_LANCEE").map((e) => e.parcoursId));
  const resultats = new Set(evenements.filter((e) => e.type === "SIMULATION_RESULTAT").map((e) => e.parcoursId));
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
