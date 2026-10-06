import type { EntreeJournal, FiltreJournal } from "@/lib/chronologie/journal-types";

/**
 * Mission 22 (A1) — la logique pure de l'écran « Depuis ta dernière visite » (components/v2/journal), importable par
 * les essais : les entrées groupées par personne, les faits système à part, cinq groupes visibles puis « Voir les N
 * autres » (règle 2 de docs/CRM-V2.md), et le filtre Clients · Argent · Système (un seul actif, ou tous).
 */

export const GROUPES_VISIBLES = 5;
export const CLE_SYSTEME = "systeme";

export type GroupeJournal = {
  /** `client:<id>`, `lead:<id>`, `dossier:<id>` ou `systeme`. */
  cle: string;
  nom: string;
  /** Le chemin de la personne (fiche client, lead ou dossier) ; null pour le système. */
  lien: string | null;
  /** Les entrées du groupe, de la plus récente à la plus ancienne. */
  entrees: EntreeJournal[];
  /** La date de l'entrée la plus récente (tri des groupes). */
  le: string;
};

/** La clé de la personne d'une entrée : le client d'abord (il réunit ses leads et ses dossiers), sinon le lead, sinon le dossier. */
export function clePersonne(e: Pick<EntreeJournal, "clientId" | "leadId" | "dossierId" | "clientNom">): string {
  if (e.clientId) return `client:${e.clientId}`;
  if (e.leadId) return `lead:${e.leadId}`;
  if (e.dossierId) return `dossier:${e.dossierId}`;
  return CLE_SYSTEME;
}

function lienPersonne(cle: string): string | null {
  const [genre, id] = cle.split(":");
  if (genre === "client") return `/clients/${id}`;
  if (genre === "lead") return `/leads?lead=${id}`;
  if (genre === "dossier") return `/dossiers?dossier=${id}`;
  return null;
}

/** Les entrées groupées par personne, du groupe le plus récent au plus ancien ; les faits système en dernier. */
export function grouperParPersonne(entrees: readonly EntreeJournal[]): GroupeJournal[] {
  const groupes = new Map<string, GroupeJournal>();
  for (const e of entrees) {
    const cle = clePersonne(e);
    const groupe = groupes.get(cle);
    if (groupe) {
      groupe.entrees.push(e);
      if (e.le > groupe.le) groupe.le = e.le;
      if (!groupe.nom && e.clientNom) groupe.nom = e.clientNom;
    } else {
      groupes.set(cle, { cle, nom: cle === CLE_SYSTEME ? "Système" : (e.clientNom ?? ""), lien: lienPersonne(cle), entrees: [e], le: e.le });
    }
  }
  const liste = [...groupes.values()];
  for (const g of liste) {
    g.entrees.sort((a, b) => b.le.localeCompare(a.le));
    if (!g.nom) g.nom = "Sans nom";
  }
  return liste.sort((a, b) => (a.cle === CLE_SYSTEME ? 1 : b.cle === CLE_SYSTEME ? -1 : b.le.localeCompare(a.le)));
}

/** Le filtre de l'écran : un seul actif, ou aucun (tout). Cliquer le filtre actif le retire. */
export function basculerFiltre(actif: FiltreJournal | null, clique: FiltreJournal): FiltreJournal | null {
  return actif === clique ? null : clique;
}

export function filtrer(entrees: readonly EntreeJournal[], filtre: FiltreJournal | null): EntreeJournal[] {
  return filtre ? entrees.filter((e) => e.filtre === filtre) : [...entrees];
}

/** « 6 choses », « 1 chose », « rien » : le compte en mots de l'en-tête. */
export function compteEnMots(total: number): string {
  if (total <= 0) return "rien de nouveau";
  return total === 1 ? "1 chose" : `${total} choses`;
}
