import prisma from "@/lib/prisma";
import type { ActionManuelle } from "./detecteurs/types";
import { dernierEvenementClientDossiers } from "./evenements-client";

export type { ActionManuelle } from "./detecteurs/types";

/**
 * Mission 17 (partie A) : les prochaines actions manuelles EN VIGUEUR (docs/TACHES.md § 2, cas « j'attends sa
 * modification visuelle »). Une action posée à la main (Lucas ou Claude : `dossiers/prochaine-action-manuelle.ts`) l'est
 * tant que :
 * - le dossier n'est pas archivé ;
 * - `prochaineActionManuelleLe` est posé et `prochaineAction` est toujours le texte retenu (`prochaineActionManuelle`) :
 *   une écriture automatique qui la remplace (photos reçues, accord, appel noté) la lève ;
 * - aucun événement du client (evenements-client.ts) n'est arrivé après qu'elle a été posée, et au plus tard `maintenant`
 *   (un événement daté après l'instant du passage — horloge d'un essai, date corrigée — ne compte pas encore).
 * Deux requêtes : les dossiers candidats, puis leurs derniers gestes du client, groupés.
 */
export async function actionsManuellesEnVigueur(maintenant: Date, dossierIds?: readonly string[]): Promise<Map<string, ActionManuelle>> {
  const vigueur = new Map<string, ActionManuelle>();
  if (dossierIds && dossierIds.length === 0) return vigueur;
  const candidats = await prisma.dossier.findMany({
    where: { prochaineActionManuelleLe: { not: null }, prochaineActionManuelle: { not: null }, ...(dossierIds ? { id: { in: [...new Set(dossierIds)] } } : {}) },
    select: { id: true, prochaineAction: true, prochaineActionDate: true, prochaineActionManuelle: true, prochaineActionManuelleLe: true, prochaineActionPar: true },
  });
  const retenus = candidats.filter((d) => d.prochaineActionManuelle?.trim() && d.prochaineAction === d.prochaineActionManuelle && d.prochaineActionManuelleLe);
  if (retenus.length === 0) return vigueur;
  const gestes = await dernierEvenementClientDossiers(retenus.map((d) => d.id));
  for (const d of retenus) {
    const le = d.prochaineActionManuelleLe!;
    const geste = gestes.get(d.id);
    if (geste && geste.getTime() > le.getTime() && geste.getTime() <= maintenant.getTime()) continue;
    vigueur.set(d.id, { dossierId: d.id, action: d.prochaineActionManuelle!, date: d.prochaineActionDate, le, par: d.prochaineActionPar });
  }
  return vigueur;
}
