import prisma from "@/lib/prisma";
import { resoudreContexte } from "@/lib/journal/acteur";

export { LIBELLES_STATUT_TACHE, STATUTS_TACHE, type StatutTache } from "./statuts";

export type MiseEnFile = {
  type: string;
  /** Clé d'idempotence : la même clé ne produit jamais deux tâches. */
  cle: string;
  charge?: unknown;
  priorite?: number;
  /** Première exécution au plus tôt. */
  apres?: Date;
  /** Nombre de tentatives avant abandon (8 par défaut) : lu par l'écran des tâches. */
  tentativesMax?: number;
  /**
   * UNIQUE (défaut) : une tâche déjà connue sous cette clé n'est jamais rejouée
   *   (un envoi validé ne part qu'une fois).
   * RECONCILIATION : la tâche remet un état en ordre (miroir Drive) ; la remettre
   *   en file la rejoue, même terminée.
   */
  mode?: "UNIQUE" | "RECONCILIATION";
};

// Réveil de l'exécuteur dès qu'une tâche arrive (même processus).
const CLE_REVEIL = "__coverswapReveilTaches";
const globalReveil = globalThis as unknown as Record<string, (() => void) | undefined>;
export function surNouvelleTache(reveil: () => void): void {
  globalReveil[CLE_REVEIL] = reveil;
}

/**
 * Met une tâche en file et rend son identifiant. À appeler de préférence dans
 * la transaction de l'écriture qui la motive (passer `client: tx`) : la tâche
 * existe si et seulement si l'écriture a eu lieu.
 */
export async function mettreEnFile(
  demande: MiseEnFile,
  client: Pick<typeof prisma, "tache"> = prisma
): Promise<string> {
  const { acteur } = await resoudreContexte();
  const charge = JSON.stringify(demande.charge ?? {});
  let existante = await client.tache.findUnique({ where: { cle: demande.cle } });

  if (!existante) {
    try {
      const creee = await client.tache.create({
        data: {
          type: demande.type,
          cle: demande.cle,
          charge,
          priorite: demande.priorite ?? 0,
          ...(demande.tentativesMax ? { tentativesMax: demande.tentativesMax } : {}),
          prochainEssaiLe: demande.apres ?? new Date(),
          demandeePar: acteur,
        },
      });
      globalReveil[CLE_REVEIL]?.();
      return creee.id;
    } catch (erreur) {
      // Mise en file simultanée de la même clé : l'autre a gagné, on continue avec sa tâche.
      if ((erreur as { code?: string }).code !== "P2002") throw erreur;
      existante = await client.tache.findUnique({ where: { cle: demande.cle } });
      if (!existante) throw erreur;
    }
  }

  let id: string;
  if (demande.mode === "RECONCILIATION") {
    id = existante.id;
    if (existante.statut === "EN_COURS") {
      await client.tache.update({ where: { id }, data: { aRejouer: true, charge } });
    } else {
      await client.tache.update({
        where: { id },
        data: {
          statut: "EN_ATTENTE",
          charge,
          tentatives: 0,
          prochainEssaiLe: demande.apres ?? new Date(),
          derniereErreur: null,
          demandeePar: acteur,
        },
      });
    }
  } else {
    id = existante.id;
  }

  globalReveil[CLE_REVEIL]?.();
  return id;
}

/** Remet en file une tâche en échec (geste humain depuis l'écran des tâches). */
export async function relancerTache(id: string): Promise<void> {
  const { count } = await prisma.tache.updateMany({
    where: { id, statut: { in: ["ECHEC_DEFINITIF", "ANNULEE"] } },
    data: { statut: "EN_ATTENTE", tentatives: 0, prochainEssaiLe: new Date(), derniereErreur: null },
  });
  if (count !== 1) throw new Error("Seule une tâche en échec ou annulée peut être relancée.");
  globalReveil[CLE_REVEIL]?.();
}

/** Annule une tâche qui n'a pas encore abouti. */
export async function annulerTache(id: string): Promise<void> {
  const { count } = await prisma.tache.updateMany({
    where: { id, statut: { in: ["EN_ATTENTE", "ECHEC_DEFINITIF"] } },
    data: { statut: "ANNULEE", termineLe: new Date() },
  });
  if (count !== 1) throw new Error("Seule une tâche en attente ou en échec peut être annulée.");
}
