import type { GenreRaccourci, Raccourci, TacheVue } from "@/lib/a-faire/types";

/**
 * Mission 22 (A2) — la règle du « geste prêt » d'Aujourd'hui, pure (importable par les écrans v2 comme par les essais) :
 * à partir d'une tâche, quel est l'unique bouton principal de sa carte et son libellé. Les prédicats reprennent ceux
 * de la ligne v1 (`taches/_components/LigneTache.tsx`, intouchée) sans en dépendre : la v2 ne lit jamais un composant v1
 * pour décider.
 *
 * - une proposition qui se valide d'un geste : « Valider » (et « Ignorer » à côté) ;
 * - une tâche à moi sans rien à ouvrir : « Fait » ;
 * - une proposition sensible (argent, client) : « Relire et valider », son aperçu dans « À valider » ;
 * - un appel avec un numéro lisible : un lien `tel:` ;
 * - une page externe : un lien ouvert dans un nouvel onglet ;
 * - sinon l'action du raccourci (SMS, mail, devis, encaisser, date du chantier…) avec son libellé.
 */
export type FormeGeste = "VALIDER" | "FAIT" | "RELIRE" | "APPEL" | "LIEN_EXTERNE" | "ACTION";

export type GestePret = {
  forme: FormeGeste;
  /** Le libellé du bouton principal : « Appeler », « Faire le devis », « Valider », « Fait »… */
  libelle: string;
  /** Le genre du raccourci (icône) ; null pour « Fait » (rien à ouvrir). */
  genre: GenreRaccourci | null;
  /** `tel:` pour un appel, l'adresse pour une page externe ou l'aperçu d'une proposition sensible. */
  href: string | null;
  /** Le numéro tel qu'il se lit, pour un appel. */
  telephone: string | null;
  /** Vrai pour une proposition sensible : rien ne se valide d'un geste. */
  sensible: boolean;
};

/** Le numéro composable d'un raccourci d'appel (« tel: »), ou null. */
export function numeroDe(tache: Pick<TacheVue, "raccourci">): string | null {
  const brut = tache.raccourci.telephone?.replace(/[^\d+]/g, "") ?? "";
  return brut.length >= 6 ? brut : null;
}

/** Une tâche sans rien à ouvrir (tâche à moi sans cible) : le bouton principal la dit faite. */
export function sansRaccourci(tache: Pick<TacheVue, "raccourci">): boolean {
  const r = tache.raccourci;
  return r.genre === "PAGE" && !r.href;
}

/** L'identifiant de la proposition d'une tâche (raccourci, sinon données du détecteur), ou null. */
export function propositionDe(tache: Pick<TacheVue, "raccourci" | "donnees">): string | null {
  const id = tache.raccourci.propositionId ?? tache.donnees.propositionId;
  return typeof id === "string" && id ? id : null;
}

/** Une proposition sensible (argent ou client) : elle ne se valide qu'avec son aperçu, jamais d'un geste dans la liste. */
export function estSensible(tache: Pick<TacheVue, "raccourci" | "donnees">): boolean {
  return tache.donnees.sensible === true && propositionDe(tache) !== null;
}

/** Validée d'un geste (Valider / Ignorer) : une proposition qui n'est pas sensible. */
export function valideDansLaLigne(tache: Pick<TacheVue, "raccourci" | "donnees">): boolean {
  return tache.raccourci.genre === "VALIDER" && !estSensible(tache);
}

/** Le raccourci à montrer : une proposition sensible encore décrite « Valider » devient « Relire et valider ». */
export function raccourciDe(tache: Pick<TacheVue, "raccourci" | "donnees">): Raccourci {
  const r = tache.raccourci;
  const propositionId = propositionDe(tache);
  if (r.genre === "VALIDER" && estSensible(tache) && propositionId) {
    return { ...r, genre: "PAGE", libelle: "Relire et valider", href: `/validation?proposition=${encodeURIComponent(propositionId)}`, propositionId, externe: false };
  }
  return r;
}

/** Le bouton principal d'une tâche et son libellé (un seul par carte : règle 3 de docs/CRM-V2.md). */
export function gestePret(tache: Pick<TacheVue, "raccourci" | "donnees">): GestePret {
  const r = raccourciDe(tache);
  const sensible = estSensible(tache);
  if (valideDansLaLigne(tache)) return { forme: "VALIDER", libelle: "Valider", genre: "VALIDER", href: null, telephone: null, sensible: false };
  if (sansRaccourci(tache)) return { forme: "FAIT", libelle: "Fait", genre: null, href: null, telephone: null, sensible: false };
  if (sensible && r.genre === "PAGE") return { forme: "RELIRE", libelle: r.libelle, genre: "PAGE", href: r.href ?? null, telephone: null, sensible: true };
  const numero = r.genre === "APPEL" ? numeroDe(tache) : null;
  if (numero) return { forme: "APPEL", libelle: r.libelle, genre: "APPEL", href: `tel:${numero}`, telephone: r.telephone ?? null, sensible: false };
  if (r.genre === "PAGE" && r.href && r.externe) return { forme: "LIEN_EXTERNE", libelle: r.libelle, genre: "PAGE", href: r.href, telephone: null, sensible: false };
  return { forme: "ACTION", libelle: r.libelle, genre: r.genre, href: null, telephone: null, sensible: false };
}

/** Ce que le balayage à droite fait : « Relire » (sensible), « Valider » (proposition), « Fait » sinon. */
export function libelleBalayageDroite(tache: Pick<TacheVue, "raccourci" | "donnees">): "Relire" | "Valider" | "Fait" {
  if (estSensible(tache)) return "Relire";
  return valideDansLaLigne(tache) ? "Valider" : "Fait";
}
