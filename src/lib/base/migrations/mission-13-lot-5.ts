import type { MigrationDonnees } from "./index";

/**
 * Mission 13 (26/09/2026), lot 5 — B6 : le compteur de lectures du devis
 * vivait sur l'espace (`EspaceClient.devisConsulteId`, un seul devis suivi à
 * la fois) ; il vit désormais sur chaque devis (`Document.consultations`).
 * Les valeurs existantes sont recopiées une fois, jamais écrasées.
 */
export const migrationConsultationsParDevis13: MigrationDonnees = {
  nom: "consultations-par-devis-13-5",
  description: "Le compteur de lectures du devis (par espace) est recopié sur le devis lui-même : un compteur par devis",
  executer: async (client) => {
    const espaces = await client.espaceClient.findMany({
      where: { devisConsulteId: { not: null }, devisConsultations: { gt: 0 } },
      select: { devisConsulteId: true, devisConsultations: true, devisConsulteLe: true },
    });
    let recopies = 0;
    for (const espace of espaces) {
      const resultat = await client.document.updateMany({
        where: { id: espace.devisConsulteId!, consultations: 0 },
        data: { consultations: espace.devisConsultations, consulteLe: espace.devisConsulteLe },
      });
      recopies += resultat.count;
    }
    return { espaces: espaces.length, recopies };
  },
};
