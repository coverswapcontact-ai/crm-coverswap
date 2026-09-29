import type { BaseDonnees, Transaction } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Les agents de prospection existent partout où le pilotage tourne (la production n'avait jamais lancé le seed).
 *
 * Mission 13 (lot 7, 29/09/2026) : le démarchage B2B (sourcing, scoring, écran /prospects) est retiré du CRM ;
 * les profils sont recopiés ici tels quels pour que cette migration, déjà livrée, reste rejouable à l'identique
 * (« on ne retire ni ne réordonne jamais une migration »). Les lignes AgentProfile restent en base.
 */

type FiltresQualification = { minAvis: number; maxAvis: number | null; minNote: number; maxNote: number };
type AgentProfileConfig = {
  typesGooglePlaces: string[];
  motsClesSignaux: string[];
  blacklistMarques: string[];
  angleVente: string;
  quotaJournalier: number;
  zone: string;
  filtres: FiltresQualification;
};

const PROFILS_AGENTS: readonly { slug: "hotels" | "restaurants"; nom: string; config: AgentProfileConfig }[] = [
  {
    slug: "hotels",
    nom: "Agent Hôtels",
    config: {
      typesGooglePlaces: ["lodging"],
      motsClesSignaux: ["vieillot", "défraîchi", "daté", "vétuste", "fatigué", "à rafraîchir", "rénovation", "mobilier ancien", "salle de bain vieille", "années 80"],
      blacklistMarques: ["Ibis", "Mercure", "Novotel", "Kyriad", "Campanile", "B&B Hotels", "Première Classe", "hotelF1", "Best Western", "Holiday Inn"],
      angleVente:
        "Rénovation des chambres et salles de bain par covering adhésif : jusqu'à 70 % moins cher qu'une rénovation classique, sans fermer l'établissement, chambre par chambre.",
      quotaJournalier: 20,
      zone: "Hérault (34)",
      filtres: { minAvis: 15, maxAvis: 400, minNote: 3.0, maxNote: 4.5 },
    },
  },
  {
    slug: "restaurants",
    nom: "Agent Restaurants",
    config: {
      typesGooglePlaces: ["restaurant"],
      motsClesSignaux: ["décoration datée", "cadre vieillissant", "vieillot", "défraîchi", "tables abîmées", "comptoir usé", "déco à revoir", "rénovation"],
      blacklistMarques: ["McDonald's", "Burger King", "KFC", "Subway", "Domino's", "Pizza Hut", "Buffalo Grill", "Hippopotamus", "La Boucherie", "O'Tacos"],
      angleVente:
        "Relooking de la salle (tables, comptoir, bar, murs) par covering adhésif : intervention de nuit ou jour de fermeture, zéro perte d'exploitation.",
      quotaJournalier: 20,
      zone: "Hérault (34)",
      filtres: { minAvis: 20, maxAvis: 800, minNote: 3.2, maxNote: 4.4 },
    },
  },
];

/** Crée les agents manquants ; rend le nombre créé. Une configuration ajustée à la main reste telle quelle. */
async function assurerAgentsProspection(client: BaseDonnees | Transaction): Promise<number> {
  let crees = 0;
  for (const profil of PROFILS_AGENTS) {
    const existant = await client.agentProfile.findFirst({ where: { slug: profil.slug, archiveLe: undefined }, select: { id: true } });
    if (existant) continue;
    await client.agentProfile.create({ data: { slug: profil.slug, nom: profil.nom, actif: true, config: JSON.stringify(profil.config) } });
    crees++;
  }
  return crees;
}

export const migrationAgentsProspection: MigrationDonnees = {
  nom: "2026-09-17-agents-prospection",
  description: "Crée les agents de prospection hôtels et restaurants s'ils manquent, sans toucher à une configuration existante",
  async executer(client) {
    return { agentsCrees: await assurerAgentsProspection(client) };
  },
};
