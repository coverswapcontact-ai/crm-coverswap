import { rattacherDossier, rattacherLead, rattacherProspect } from "@/lib/clients/identification";
import { proposerFusions } from "@/lib/clients/doublons";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import type { MigrationDonnees } from "./index";

/**
 * Reprise de l'existant en clients pérennes :
 * - une fiche client par lead (y compris archivé : son historique compte),
 *   avec la campagne, la publicité et le formulaire extraits des notes ;
 * - chaque dossier rejoint le client de son lead ou de son prospect, sinon une
 *   fiche créée depuis ses coordonnées ;
 * - chaque prospect converti reçoit sa fiche.
 * Aucune fusion n'est imposée : deux fiches qui se ressemblent (même numéro,
 * même adresse, même nom dans la même ville) deviennent des propositions.
 * Rejouable : seuls les enregistrements sans client sont traités.
 */
export const migrationClients: MigrationDonnees = {
  nom: "2026-09-17-clients-perennes",
  description: "Une fiche client pour chaque lead, dossier et prospect converti ; doublons proposés, jamais fusionnés",
  async executer(client) {
    const sansRecherche = { rechercherExistant: false };
    const clientsAvant = await client.client.count({ where: AVEC_ARCHIVES });

    const leads = await client.lead.findMany({
      where: { ...AVEC_ARCHIVES, clientId: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    for (const lead of leads) {
      await client.$transaction((tx) => rattacherLead(tx, lead.id, null, sansRecherche));
    }

    const dossiers = await client.dossier.findMany({
      where: { ...AVEC_ARCHIVES, clientId: null },
      orderBy: { createdAt: "asc" },
    });
    for (const dossier of dossiers) {
      await client.$transaction((tx) => rattacherDossier(tx, dossier, sansRecherche));
    }

    const prospects = await client.prospect.findMany({ where: { ...AVEC_ARCHIVES, clientId: null, statut: "CLIENT" } });
    for (const prospect of prospects) {
      await client.$transaction((tx) => rattacherProspect(tx, prospect, sansRecherche));
    }

    const clientsCrees = (await client.client.count({ where: AVEC_ARCHIVES })) - clientsAvant;
    const fusionsProposees = await proposerFusions();
    return {
      leadsRattaches: leads.length,
      dossiersRattaches: dossiers.length,
      prospectsRattaches: prospects.length,
      clientsCrees,
      fusionsProposees,
    };
  },
};
