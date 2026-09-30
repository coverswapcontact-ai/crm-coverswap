import type { TacheAFaire } from "@prisma/client";
import prisma from "@/lib/prisma";
import { lireObjet } from "../json";
import { CLE_SOURCES_VUES } from "../moteur";
import type { Detection, NiveauTache, Raccourci, SourceTache, SujetTache, TypeTache } from "../types";

/**
 * Mission 17 (partie A, lot 2) : ce que les détecteurs SYSTEME et COHERENCE lisent de leurs propres tâches encore
 * ouvertes (lecture seule). Leurs signaux n'ont pas toujours de date d'origine (une incohérence, un disque plein) : le
 * `depuis` d'une tâche déjà ouverte est repris tel quel — le moteur compare chaque colonne avant d'écrire, un `depuis`
 * qui bougerait à chaque passage réécrirait la ligne toutes les 15 minutes et fausserait le tri par ancienneté.
 */

/** Les tâches À faire ou Plus tard d'une source, par clé (les archivées sont écartées d'office par la couche Prisma). */
export async function tachesOuvertesDe(source: SourceTache): Promise<Map<string, TacheAFaire>> {
  const lignes = await prisma.tacheAFaire.findMany({ where: { source, statut: { in: ["A_FAIRE", "PLUS_TARD"] } } });
  return new Map(lignes.map((l) => [l.cle, l]));
}

/** Le `depuis` d'une tâche déjà ouverte, sinon la date donnée (l'origine connue du signal, ou l'instant du passage). */
export function depuisDe(ouvertes: ReadonlyMap<string, TacheAFaire>, cle: string, parDefaut: Date): Date {
  return ouvertes.get(cle)?.depuis ?? parDefaut;
}

/**
 * Une tâche ouverte rendue telle quelle : quand la lecture d'UN signal échoue (base occupée, module en panne), ses
 * tâches restent vues ce passage-ci — ni cochées à tort, ni réécrites — sans priver les autres signaux de la même source
 * de leur coche.
 */
export function reconduite(ligne: TacheAFaire): Detection {
  const donnees = lireObjet(ligne.donnees);
  delete donnees[CLE_SOURCES_VUES];
  return {
    cle: ligne.cle,
    type: ligne.type as TypeTache,
    source: ligne.source as SourceTache,
    sujet: { type: ligne.sujetType as SujetTache["type"], id: ligne.sujetId },
    leadId: ligne.leadId,
    dossierId: ligne.dossierId,
    clientId: ligne.clientId,
    titre: ligne.titre,
    raison: ligne.raison,
    niveau: ligne.niveau as NiveauTache,
    montant: ligne.montant,
    depuis: ligne.depuis,
    echeance: ligne.echeance,
    raccourci: lireObjet(ligne.raccourci) as Raccourci,
    donnees,
    lot: ligne.lot ? { cle: ligne.lot, libelle: ligne.lotLibelle ?? ligne.lot } : null,
    dureeMin: ligne.dureeMin,
  };
}

/** « … » : un texte coupé proprement (raison courte). */
export function court(texte: string, max = 140): string {
  const net = texte.replace(/\s+/g, " ").trim();
  return net.length <= max ? net : `${net.slice(0, max - 1).trimEnd()}…`;
}
