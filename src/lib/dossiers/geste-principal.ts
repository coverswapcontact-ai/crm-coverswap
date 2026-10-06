import type { Raccourci, TacheVue } from "@/lib/a-faire/types";
import type { EspaceResume } from "@/lib/espace/suivi-types";
import { LIBELLES_ETAPE, type EtapeActive, type EtapeDossier } from "./constants";
import { transitionsPossibles } from "./regles";

/**
 * Mission 22 (A3) — la règle pure du bouton principal d'un dossier (règle 3 de docs/CRM-V2.md : un seul bouton vert
 * par panneau). Importable par les écrans v2 comme par les essais : aucune base, aucun composant.
 *
 * 1. La première tâche d'Aujourd'hui qui concerne ce dossier, si elle existe : son raccourci (le même bouton que dans
 *    Aujourd'hui, exécuté par `useGestesTaches`, qui répond par une ligne et « Annuler » 5 s).
 * 2. Sinon le geste de l'étape :
 *    Qualification → photos reçues ? « Préparer la simulation » : « Appeler » ;
 *    Simulation → un brouillon à publier dans l'espace ? « Publier la simulation » : « Faire le devis » ;
 *    Devis envoyé, Relance → « Relancer » (la relance proposable la plus pertinente, sinon par téléphone) ;
 *    Signé → « Fixer la date du chantier » (date déjà posée : « Passer en planifié ») ;
 *    Planifié → « Passer en chantier » ; Chantier → « Facturer » ; Facturé → « Encaisser » ;
 *    Encaissé → « Demander un avis » ; Perdu, En pause → « Reprendre ».
 * « Autres gestes » (repliés, en contour) : le reste des passages d'étape possibles, archiver, déposer un devis PDF,
 * modifier la prochaine action.
 */
export type GenreGestePrincipal = "TACHE" | "APPEL" | "SIMULATEUR" | "PUBLIER" | "DEVIS" | "RELANCER" | "DATE_CHANTIER" | "ETAPE" | "FACTURE" | "ENCAISSER" | "AVIS" | "REPRISE";

export type GestePrincipal = {
  genre: GenreGestePrincipal;
  libelle: string;
  /** Le raccourci de la tâche (genre TACHE) : exécuté comme dans Aujourd'hui. */
  raccourci?: Raccourci;
  tache?: TacheVue;
  /** L'étape visée (ETAPE, REPRISE). */
  etape?: EtapeDossier;
};

export type AutreGeste = { genre: "ETAPE" | "ARCHIVER" | "DEPOSER_PDF" | "PROCHAINE_ACTION"; libelle: string; etape?: EtapeDossier };

export type DossierPourGeste = {
  etape: EtapeDossier;
  etapeAvantSortie: EtapeActive | null;
  dateChantier: string | null;
  photos: readonly unknown[];
};

/** Une tâche encore à faire maintenant : « à faire », ou un « Plus tard » dont l'heure de retour est passée. */
export function tachePrete(taches: readonly TacheVue[] | null | undefined, maintenant: Date): TacheVue | null {
  for (const t of taches ?? []) {
    if (t.statut === "A_FAIRE") return t;
    if (t.statut === "PLUS_TARD" && t.plusTardJusqua && Date.parse(t.plusTardJusqua) <= maintenant.getTime()) return t;
  }
  return null;
}

/** Un brouillon de simulation attend d'être publié dans l'espace du client (signal de l'espace). */
export const brouillonAPublier = (espace: Pick<EspaceResume, "signaux"> | null | undefined): boolean => Boolean(espace?.signaux.some((s) => s.code === "BROUILLONS"));

/** L'étape où un dossier perdu ou en pause reprend : celle qu'il a quittée, à défaut la première. */
export const etapeDeReprise = (detail: Pick<DossierPourGeste, "etapeAvantSortie">): EtapeActive => detail.etapeAvantSortie ?? "QUALIFICATION";

export function gestePrincipal({ detail, espace, tache }: { detail: DossierPourGeste; espace: Pick<EspaceResume, "signaux"> | null; tache: TacheVue | null; maintenant: Date }): GestePrincipal {
  if (tache) return { genre: "TACHE", libelle: tache.raccourci.libelle, raccourci: tache.raccourci, tache };
  switch (detail.etape) {
    case "QUALIFICATION":
      return detail.photos.length > 0 ? { genre: "SIMULATEUR", libelle: "Préparer la simulation" } : { genre: "APPEL", libelle: "Appeler" };
    case "SIMULATION":
      return brouillonAPublier(espace) ? { genre: "PUBLIER", libelle: "Publier la simulation" } : { genre: "DEVIS", libelle: "Faire le devis" };
    case "DEVIS_ENVOYE":
    case "RELANCE":
      return { genre: "RELANCER", libelle: "Relancer" };
    case "SIGNE":
      return detail.dateChantier ? { genre: "ETAPE", libelle: "Passer en planifié", etape: "PLANIFIE" } : { genre: "DATE_CHANTIER", libelle: "Fixer la date du chantier" };
    case "PLANIFIE":
      return { genre: "ETAPE", libelle: "Passer en chantier", etape: "CHANTIER" };
    case "CHANTIER":
      return { genre: "FACTURE", libelle: "Facturer" };
    case "FACTURE":
      return { genre: "ENCAISSER", libelle: "Encaisser" };
    case "ENCAISSE":
      return { genre: "AVIS", libelle: "Demander un avis" };
    case "PERDU":
    case "EN_PAUSE": {
      const etape = etapeDeReprise(detail);
      return { genre: "REPRISE", libelle: `Reprendre en « ${LIBELLES_ETAPE[etape]} »`, etape };
    }
  }
}

/** Le libellé d'un passage d'étape dans « Autres gestes » : comme la fenêtre d'étape de la v1, en phrase. */
export function libellePassage(de: EtapeDossier, vers: EtapeDossier): string {
  if (vers === "PERDU") return "Marquer perdu";
  if (vers === "EN_PAUSE") return "Mettre en pause";
  if (de === "PERDU" || de === "EN_PAUSE") return `Reprendre en « ${LIBELLES_ETAPE[vers]} »`;
  return `Passer en « ${LIBELLES_ETAPE[vers]} »`;
}

/**
 * Les autres gestes, repliés : les passages d'étape possibles (les suggérés d'abord) sauf celui que porte déjà le
 * bouton principal, puis déposer un devis PDF, modifier la prochaine action, archiver (en dernier, toujours).
 */
export function autresGestes(detail: DossierPourGeste, principal: GestePrincipal): AutreGeste[] {
  const etapePrincipale = principal.genre === "ETAPE" || principal.genre === "REPRISE" ? principal.etape : null;
  const transitions = transitionsPossibles(detail.etape, detail.etapeAvantSortie).filter((t) => t.vers !== etapePrincipale);
  const passages: AutreGeste[] = [...transitions.filter((t) => t.suggeree), ...transitions.filter((t) => !t.suggeree)].map((t) => ({ genre: "ETAPE", libelle: libellePassage(detail.etape, t.vers), etape: t.vers }));
  return [...passages, { genre: "DEPOSER_PDF", libelle: "Déposer un devis PDF" }, { genre: "PROCHAINE_ACTION", libelle: "Modifier la prochaine action" }, { genre: "ARCHIVER", libelle: "Archiver le dossier" }];
}
