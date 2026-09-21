import type { MigrationDonnees } from "./index";
import { classerLead, zoneIntervention } from "@/lib/prospects/qualification";

/**
 * Règle du 21/09/2026 : un lead qui a fait une simulation est Prioritaire par
 * défaut, sauf hors zone. Reclasse les leads du simulateur déjà en base ; une
 * priorité posée à la main n'est pas touchée (classerLead l'ignore).
 */
export const migrationPrioriteLeadsSimulation: MigrationDonnees = {
  nom: "priorite-des-leads-du-simulateur",
  description: "Reclasse en Prioritaire (sauf hors zone) les leads qui ont fait une simulation sur le site",
  executer: async (client) => {
    const zone = await zoneIntervention();
    const leads = await client.lead.findMany({
      where: { prioriteManuelle: false, OR: [{ source: "SITE_SIMULATEUR" }, { simulations: { some: { archiveLe: null } } }] },
      select: { id: true, priorite: true },
    });
    let reclasses = 0;
    for (const lead of leads) {
      const qualification = await classerLead(lead.id, client, zone);
      if (qualification && qualification.priorite !== lead.priorite) reclasses++;
    }
    return { leadsDuSimulateur: leads.length, reclasses };
  },
};
