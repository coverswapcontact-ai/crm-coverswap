import type { MigrationDonnees } from "./index";

/**
 * Depuis le 22/09/2026, le mot qu'un client écrit avec sa demande d'autre
 * proposition est gardé sur son espace (il s'affiche dans le dossier et dans
 * Espaces clients). Les demandes faites AVANT n'avaient ce mot que dans
 * l'historique du dossier (« … : « son mot » ») : il est recopié sur l'espace,
 * pour les demandes encore en attente. Rien d'autre n'est touché ; rejouable.
 */
export const migrationMotsDesDemandes: MigrationDonnees = {
  nom: "mots-des-demandes-de-proposition-22-09",
  description: "Recopie sur l'espace client le mot des demandes d'autre proposition encore en attente (il n'était que dans l'historique)",
  executer: async (client) => {
    let recopies = 0;
    let sansMot = 0;
    const espaces = await client.espaceClient.findMany({ where: { propositionDemandeeLe: { not: null }, propositionMessage: null }, select: { id: true, dossierId: true } });
    for (const espace of espaces) {
      const evenement = await client.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_NOUVELLE_PROPOSITION" }, orderBy: { createdAt: "desc" }, select: { contenu: true } });
      const mot = /: « ([\s\S]+) »\s*$/.exec(evenement?.contenu ?? "")?.[1]?.trim();
      if (!mot) {
        sansMot++;
        continue;
      }
      await client.espaceClient.update({ where: { id: espace.id }, data: { propositionMessage: mot.slice(0, 1000) } });
      recopies++;
    }
    return { recopies, sansMot };
  },
};
