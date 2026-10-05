import { reporterTeintesDuChoix, lireChoixEspace, zonesDuChoix } from "@/lib/espace/teintes-choix";
import type { MigrationDonnees } from "./index";

/**
 * Mission 18 (B11, écart 11) — les états en double, repris une fois :
 * - lectures du devis : `Document.consultations` devient la seule source ; la copie de l'espace
 *   (`EspaceClient.devisConsultations`, dernier devis lu) n'est plus écrite. Si elle en sait plus que le devis, le devis
 *   prend la plus grande des deux valeurs (et la date de l'espace s'il n'en a pas) ; jamais rien d'abaissé ;
 * - teintes : le choix validé dans l'espace (une simulation, ou un mélange) remplit `Dossier.teintes` pour les
 *   sous-parties de son projet qui n'ont pas encore de teinte ; ce que Lucas a noté n'est jamais remplacé.
 * Idempotente : rejouée, elle ne trouve plus rien à écrire.
 */
export const migrationEtatsEnDouble18: MigrationDonnees = {
  nom: "etats-en-double-18",
  description: "Lectures du devis : le devis seul (max avec la copie de l'espace) ; teintes du choix de l'espace reportées sur le dossier",
  executer: async (client) => {
    let consultations = 0;
    const espaces = await client.espaceClient.findMany({
      where: { devisConsulteId: { not: null }, devisConsultations: { gt: 0 } },
      select: { devisConsulteId: true, devisConsultations: true, devisConsulteLe: true },
    });
    for (const espace of espaces) {
      const devis = await client.document.findUnique({ where: { id: espace.devisConsulteId! }, select: { id: true, consultations: true, consulteLe: true } });
      if (!devis || devis.consultations >= espace.devisConsultations) continue;
      await client.document.update({ where: { id: devis.id }, data: { consultations: espace.devisConsultations, consulteLe: devis.consulteLe ?? espace.devisConsulteLe } });
      consultations++;
    }

    let teintes = 0;
    const choix = await client.espaceClient.findMany({
      where: { choix: { not: null }, choixLe: { not: null }, archiveLe: null },
      select: { dossierId: true, choix: true, simulations: { select: { id: true, zones: true } } },
    });
    for (const espace of choix) {
      const zones = zonesDuChoix(lireChoixEspace(espace.choix), espace.simulations);
      if ((await reporterTeintesDuChoix(client, espace.dossierId, zones, { remplacer: false })).length > 0) teintes++;
    }
    return { espacesLus: espaces.length, consultations, choixLus: choix.length, teintes };
  },
};
