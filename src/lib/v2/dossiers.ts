import type { EtapeDossier, RubriqueDossier } from "@/lib/dossiers/constants";
import { gestePrincipal, type GestePrincipal } from "@/lib/dossiers/geste-principal";
import { echeanceDe, mainDe } from "@/lib/dossiers/pilotage";
import type { DossierResume } from "@/lib/dossiers/types";

/**
 * Mission 22 (A4) — la logique pure de l'écran Dossiers v2 (`components/v2/dossiers/`), importable par les essais :
 * les segments (Chez moi · Chez le client · Tous · Archives) et la vue serveur de chacun, la barre de couleur d'une
 * ligne, le tri « ce qui m'attend », le geste principal d'une ligne (la règle du panneau, sans tâche connue) et la
 * demande d'ouverture du panneau qui l'exécute, les bornes des listes (cinq lignes puis « Voir les N autres »).
 */
export type SegmentDossiers = "MOI" | "CLIENT" | "TOUS" | "ARCHIVES";

export const SEGMENTS_DOSSIERS: readonly { valeur: SegmentDossiers; libelle: string }[] = [
  { valeur: "MOI", libelle: "Chez moi" },
  { valeur: "CLIENT", libelle: "Chez le client" },
  { valeur: "TOUS", libelle: "Tous" },
  { valeur: "ARCHIVES", libelle: "Archives" },
];

/** Cinq lignes avant « Voir les N autres » (règle 2 de docs/CRM-V2.md). */
export const LIGNES_VISIBLES = 5;

/** La préférence de vue de la v1, conservée telle quelle (`localStorage`). */
export const CLE_VUE_DOSSIERS = "dossiers:vue";
export type VueDossiersV2 = "liste" | "kanban";

export type VueServeur = "A_FAIRE" | "EN_COURS" | "TOUS";

/** La vue demandée au serveur (`GET /api/dossiers?vue=`) : « Chez moi » = le filtre « À faire » (`whereAFaire`). */
export function vueDuSegment(segment: SegmentDossiers): VueServeur {
  if (segment === "MOI") return "A_FAIRE";
  if (segment === "TOUS") return "TOUS";
  return "EN_COURS";
}

type Datable = Pick<DossierResume, "etape" | "prochaineActionDate" | "main">;

/** De quel côté est le dossier : à moi (la main, ou le client en retard à relancer), chez le client, ou plus personne. */
export function coteDe(dossier: Datable, maintenant: Date): "MOI" | "CLIENT" | "AUCUNE" {
  const main = mainDe(dossier, maintenant);
  if (main === "MOI" || main === "A_RELANCER") return "MOI";
  return main === "CLIENT" ? "CLIENT" : "AUCUNE";
}

/** « Chez le client » se filtre dans le navigateur sur la page « en cours » (la même règle que `mainDe`). */
export function dansLeSegment(dossier: Datable, segment: SegmentDossiers, maintenant: Date): boolean {
  if (segment === "TOUS") return true;
  if (segment === "ARCHIVES") return false;
  return coteDe(dossier, maintenant) === segment;
}

/** La barre à gauche de la ligne : vert = chez moi, gris = chez le client, rouge = argent en retard ou perdu. */
export type CouleurBarre = "MOI" | "CLIENT" | "ROUGE";

export function couleurBarre(dossier: Datable, maintenant: Date): CouleurBarre {
  if (dossier.etape === "PERDU") return "ROUGE";
  if (dossier.etape === "FACTURE" && echeanceDe(dossier, maintenant) === "retard") return "ROUGE";
  return coteDe(dossier, maintenant) === "MOI" ? "MOI" : "CLIENT";
}

/**
 * « Ce qui m'attend » : les actions datées d'abord (la plus ancienne en tête : les retards passent devant), puis les
 * dossiers sans date par dernière activité ; les dossiers sans personne à la manœuvre (perdus, encaissés) en dernier.
 */
export function comparerCeQuiMattend(maintenant: Date): (a: DossierResume, b: DossierResume) => number {
  const rang = (d: DossierResume) => (coteDe(d, maintenant) === "AUCUNE" ? 1 : 0);
  return (a, b) => {
    const r = rang(a) - rang(b);
    if (r !== 0) return r;
    if (a.prochaineActionDate && b.prochaineActionDate) return a.prochaineActionDate.localeCompare(b.prochaineActionDate);
    if (a.prochaineActionDate) return -1;
    if (b.prochaineActionDate) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  };
}

export const trierCeQuiMattend = (dossiers: readonly DossierResume[], maintenant: Date): DossierResume[] => [...dossiers].sort(comparerCeQuiMattend(maintenant));

/** Le geste principal d'une ligne : la règle du panneau (`gestePrincipal`), sans tâche connue ici. */
export function gesteDeLaLigne(dossier: Pick<DossierResume, "etape" | "etapeAvantSortie" | "dateChantier" | "nbPhotos" | "espace">, maintenant: Date): GestePrincipal {
  return gestePrincipal({
    detail: { etape: dossier.etape, etapeAvantSortie: dossier.etapeAvantSortie, dateChantier: dossier.dateChantier ?? null, photos: Array.from({ length: dossier.nbPhotos ?? 0 }) },
    espace: dossier.espace ?? null,
    tache: null,
    maintenant,
  });
}

/** Le numéro composable d'une ligne (`tel:`), ou null. */
export function telephoneComposable(numero: string | null | undefined): { lisible: string; href: string } | null {
  const lisible = (numero ?? "").trim();
  const brut = lisible.replace(/[^\d+]/g, "");
  return brut.length >= 6 ? { lisible, href: `tel:${brut}` } : null;
}

/** Les gestes qu'une ligne demande au panneau d'exécuter à l'ouverture (ceux qui passent par ses modales et feuilles). */
export type GesteDemande = "FACTURE" | "ENCAISSER" | "DATE_CHANTIER" | "RELANCER" | "AVIS";

/** La demande d'ouverture du panneau v2 : celle de la v1 (`?rubrique=`, `?devis=`, étape), plus le geste à exécuter. */
export type DemandeOuvertureV2 = { rubrique: RubriqueDossier; etape?: EtapeDossier | null; devis?: "nouveau" | "pdf" | "gmail" | null; piece?: string | null; cle: number; geste?: GesteDemande | null };

/**
 * Comment la ligne exécute son geste principal : « Appeler » compose (si le numéro est lisible), « Préparer la
 * simulation » va au simulateur ; le reste ouvre le panneau avec la demande qui lance le geste (devis, facture,
 * encaissement, date du chantier, passage d'étape, relance, avis). `null` : le panneau s'ouvre simplement (Publier :
 * la rubrique Simulations est celle de l'étape).
 */
export function demandePourGeste(geste: GestePrincipal): Omit<DemandeOuvertureV2, "cle"> | null {
  switch (geste.genre) {
    case "DEVIS":
      return { rubrique: "devis", devis: "nouveau" };
    case "FACTURE":
      return { rubrique: "devis", geste: "FACTURE" };
    case "ENCAISSER":
      return { rubrique: "encaisser", geste: "ENCAISSER" };
    case "DATE_CHANTIER":
      return { rubrique: "etape", geste: "DATE_CHANTIER" };
    case "ETAPE":
    case "REPRISE":
      return geste.etape ? { rubrique: "etape", etape: geste.etape } : null;
    case "RELANCER":
      return { rubrique: "devis", geste: "RELANCER" };
    case "AVIS":
      return { rubrique: "encaisser", geste: "AVIS" };
    default:
      return null;
  }
}

/** « Voir les N autres » : les cinq premières lignes, ou toutes. */
export function decouperLignes<T>(lignes: readonly T[], tout: boolean, visibles = LIGNES_VISIBLES): { visibles: T[]; reste: number } {
  if (tout || lignes.length <= visibles) return { visibles: [...lignes], reste: 0 };
  return { visibles: lignes.slice(0, visibles), reste: lignes.length - visibles };
}

/** « Page 2 sur 4 · 51 à 100 sur 180 » ; vide quand tout tient sur une page. */
export function phrasePage(page: number, parPage: number, total: number): string {
  if (total <= parPage) return "";
  const derniere = Math.max(1, Math.ceil(total / parPage));
  return `Page ${page} sur ${derniere} · ${(page - 1) * parPage + 1} à ${Math.min(page * parPage, total)} sur ${total}`;
}
