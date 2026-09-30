import type { Moteur } from "../reglages";
import type { IdPiece, IdZone } from "../zones";

/**
 * Le banc de comparaison (mission 15, partie 3) — six cas fixes et trois
 * variantes. Un cas désigne la PHOTO d'un dossier existant en production par
 * son identifiant (`Dossier.photos` → `idPhoto`) : rien n'est copié dans le
 * dépôt, la photo reste sur le volume. Si elle manque (identifiant inconnu,
 * dossier archivé), le cas est affiché « photo introuvable » et n'est pas lancé.
 *
 * Aucune dépendance Node : l'écran lit ce fichier.
 */

export type VarianteBanc = "v1-swatches" | "v2-planche" | "v2-swatches";

export type DefinitionVariante = {
  id: VarianteBanc;
  libelle: string;
  description: string;
  moteur: Moteur;
  planche: boolean;
  /** `espace` : la qualité de l'espace et du CRM (Paramètres) ; sinon la qualité fixe. */
  qualite: "medium" | "espace";
};

export const VARIANTES_BANC: readonly DefinitionVariante[] = [
  { id: "v1-swatches", libelle: "V1 · échantillons", description: "L'ancien prompt tel que le CRM le reconstruit (V1 revu : mêmes étages, textes des zones de la source unique — pas le prompt signé que le site envoie encore), échantillons bruts, qualité medium.", moteur: "V1", planche: false, qualite: "medium" },
  { id: "v2-planche", libelle: "V2 · planche", description: "Le moteur studio avec la planche étiquetée, analyse et contrôle, qualité de l'espace.", moteur: "V2", planche: true, qualite: "espace" },
  { id: "v2-swatches", libelle: "V2 · échantillons", description: "Le moteur studio avec les échantillons bruts, analyse et contrôle, qualité de l'espace.", moteur: "V2", planche: false, qualite: "espace" },
];

export function estVarianteBanc(valeur: unknown): valeur is VarianteBanc {
  return typeof valeur === "string" && VARIANTES_BANC.some((v) => v.id === valeur);
}

export function varianteBanc(id: VarianteBanc): DefinitionVariante {
  return VARIANTES_BANC.find((v) => v.id === id)!;
}

export type CasBanc = {
  /** Identifiant stable (nom du dossier de stockage `banc/<cas>/`). */
  id: string;
  /** Libellé sans nom de client (initiale seulement). */
  libelle: string;
  dossierId: string;
  photoId: string;
  piece: IdPiece;
  zones: { zone: IdZone; ref: string }[];
};

/**
 * Les six cas de la campagne (identifiants de production, 29/09/2026). Les
 * teintes reprennent celles des simulations déjà faites pour chaque dossier ;
 * quand une zone n'en avait pas (plan de travail de Ba. et F., façades basses
 * de Ba.), une teinte vue ailleurs dans les simulations de prod est prise.
 */
export const CAS_BANC: readonly CasBanc[] = [
  { id: "t-cuisine", libelle: "Cuisine T.", dossierId: "cmucgglcp002ftfxdtbsp8j5p", photoId: "mucifqya-1ed7104f", piece: "cuisine", zones: [{ zone: "meubles-hauts", ref: "AB02" }, { zone: "meubles-bas", ref: "D1" }, { zone: "plan-de-travail", ref: "MK15" }] },
  { id: "b-sdb", libelle: "Salle de bain B.", dossierId: "cmul0pavz09mkvo4xw8ktlf3l", photoId: "mul5exbt-92217717", piece: "salle-de-bain", zones: [{ zone: "meuble-vasque", ref: "CT68" }] },
  { id: "ba-cuisine", libelle: "Cuisine Ba.", dossierId: "cmul0zzrl09szvo4xrp4ws95w", photoId: "mumgd2en-638e8615", piece: "cuisine", zones: [{ zone: "meubles-bas", ref: "NE55" }, { zone: "plan-de-travail", ref: "NH73" }] },
  { id: "be-sdb", libelle: "Salle de bain Be.", dossierId: "cmugsp3we07pqzd4d18h5i1bz", photoId: "mugswcyz-deb39a02", piece: "salle-de-bain", zones: [{ zone: "meuble-vasque", ref: "AA12" }, { zone: "portes-dressing", ref: "AA12" }] },
  { id: "f-cuisine", libelle: "Cuisine F.", dossierId: "cmugt1jhf07u2zd4dy3ldogaa", photoId: "mugw6ldt-51b00d82", piece: "cuisine", zones: [{ zone: "meubles-hauts", ref: "NF15" }, { zone: "meubles-bas", ref: "NF15" }, { zone: "plan-de-travail", ref: "MK15" }] },
  { id: "d-sdb", libelle: "Salle de bain D.", dossierId: "cmul0vb9609n8vo4xz88avwtz", photoId: "mul0vbb4-49fc3c86", piece: "salle-de-bain", zones: [{ zone: "carrelage-mural", ref: "AL23" }, { zone: "tablier-baignoire", ref: "AL23" }] },
];

/** Le nombre de films distincts d'un cas (ce qui fait le coût d'un rendu). */
export function filmsDuCas(cas: Pick<CasBanc, "zones">): number {
  return new Set(cas.zones.map((z) => z.ref)).size;
}
