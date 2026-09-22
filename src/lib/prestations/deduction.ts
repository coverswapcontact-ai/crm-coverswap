import { normaliserSelection, type IdFamille, type SelectionPrestations } from "./prestations";

/**
 * Les familles et sous-parties qu'un texte de devis NOMME sans ambiguïté
 * (« Revêtement adhésif — portes de dressing », « Plan vasque », « Cuisine »).
 * Sert à la reprise des dossiers en cours : un mot douteux ne coche rien —
 * « Plan » seul peut être un plan de travail ou un plan vasque : Lucas complète.
 */

const normaliser = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ");

const SALLE_DE_BAIN = /salle de bains?|\bsdb\b/;

/** `avec` : le texte doit aussi nommer ceci ; `sauf` : il ne doit pas le nommer. */
type Regle = { si: RegExp; avec?: RegExp; sauf?: RegExp; famille: IdFamille; sousParties: string[] };

const REGLES: Regle[] = [
  { si: /facades? (hautes?|murales?)|meubles? hauts?|elements? hauts?/, famille: "CUISINE", sousParties: ["facades-hautes"] },
  { si: /facades? basses?|meubles? bas\b|elements? bas\b/, famille: "CUISINE", sousParties: ["facades-basses"] },
  // « Façades de cuisine » (toutes) : les hautes ET les basses.
  { si: /facades? (de |de la )?cuisine|cuisine ?\/ ?facades?/, famille: "CUISINE", sousParties: ["facades-hautes", "facades-basses"] },
  { si: /plans? de travail/, famille: "CUISINE", sousParties: ["plan-de-travail"] },
  { si: /credence/, sauf: SALLE_DE_BAIN, famille: "CUISINE", sousParties: ["credence"] },
  { si: /\bilots?\b/, famille: "CUISINE", sousParties: ["ilot"] },
  { si: /electromenager|lave[- ]vaisselle|refrigerateur|\bfrigo\b/, famille: "CUISINE", sousParties: ["electromenager"] },
  { si: /\bcuisines?\b/, famille: "CUISINE", sousParties: [] },
  { si: /meubles? (sous |de )?vasques?/, famille: "SDB", sousParties: ["meuble-vasque"] },
  { si: /plans? (de )?vasques?/, famille: "SDB", sousParties: ["plan-vasque"] },
  { si: /credence/, avec: SALLE_DE_BAIN, famille: "SDB", sousParties: ["credence"] },
  { si: /placards?/, avec: SALLE_DE_BAIN, famille: "SDB", sousParties: ["portes-placard"] },
  { si: SALLE_DE_BAIN, famille: "SDB", sousParties: [] },
  { si: /dressings?/, famille: "MEUBLES", sousParties: ["portes-dressing"] },
  { si: /placards?/, sauf: SALLE_DE_BAIN, famille: "MEUBLES", sousParties: ["portes-dressing"] },
  { si: /meubles? (tv|tele|television)/, famille: "MEUBLES", sousParties: ["meuble-tv"] },
  { si: /bibliotheques?/, famille: "MEUBLES", sousParties: ["bibliotheque"] },
  { si: /\bbars?\b/, sauf: /comptoir/, famille: "MEUBLES", sousParties: ["bar"] },
  { si: /comptoirs?/, famille: "PRO", sousParties: ["comptoir"] },
  { si: /distributeurs?/, famille: "PRO", sousParties: ["distributeur"] },
  { si: /mobilier (pro|professionnel|d accueil)|banque d accueil/, famille: "PRO", sousParties: ["mobilier"] },
];

/** Déduit une sélection de textes : désignations et détails des lignes d'un devis, ou son objet. */
export function deduireSelection(textes: string[]): SelectionPrestations {
  const brut: Record<string, string[]> = {};
  for (const texte of textes.map(normaliser)) {
    for (const regle of REGLES) {
      if (!regle.si.test(texte) || regle.sauf?.test(texte) || (regle.avec && !regle.avec.test(texte))) continue;
      brut[regle.famille] = [...(brut[regle.famille] ?? []), ...regle.sousParties];
    }
  }
  return normaliserSelection(brut);
}
