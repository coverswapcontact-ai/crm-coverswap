// Agents de prospection par défaut (hôtels, restaurants) : leur configuration
// de sourcing. Créés au démarrage s'ils manquent (migration de données), jamais
// réécrasés : une configuration ajustée à la main reste telle quelle.

import type { BaseDonnees, Transaction } from "@/lib/prisma";
import { FILTRES_DEFAUT, type AgentProfileConfig, type AgentSlug } from "./constants";

export const PROFILS_AGENTS: readonly { slug: AgentSlug; nom: string; config: AgentProfileConfig }[] = [
  {
    slug: "hotels",
    nom: "Agent Hôtels",
    config: {
      typesGooglePlaces: ["lodging"],
      motsClesSignaux: [
        "vieillot",
        "défraîchi",
        "daté",
        "vétuste",
        "fatigué",
        "à rafraîchir",
        "rénovation",
        "mobilier ancien",
        "salle de bain vieille",
        "années 80",
      ],
      blacklistMarques: [
        "Ibis",
        "Mercure",
        "Novotel",
        "Kyriad",
        "Campanile",
        "B&B Hotels",
        "Première Classe",
        "hotelF1",
        "Best Western",
        "Holiday Inn",
      ],
      angleVente:
        "Rénovation des chambres et salles de bain par covering adhésif : jusqu'à 70 % moins cher qu'une rénovation classique, sans fermer l'établissement, chambre par chambre.",
      quotaJournalier: 20,
      zone: "Hérault (34)",
      filtres: FILTRES_DEFAUT.hotels,
    },
  },
  {
    slug: "restaurants",
    nom: "Agent Restaurants",
    config: {
      typesGooglePlaces: ["restaurant"],
      motsClesSignaux: [
        "décoration datée",
        "cadre vieillissant",
        "vieillot",
        "défraîchi",
        "tables abîmées",
        "comptoir usé",
        "déco à revoir",
        "rénovation",
      ],
      blacklistMarques: [
        "McDonald's",
        "Burger King",
        "KFC",
        "Subway",
        "Domino's",
        "Pizza Hut",
        "Buffalo Grill",
        "Hippopotamus",
        "La Boucherie",
        "O'Tacos",
      ],
      angleVente:
        "Relooking de la salle (tables, comptoir, bar, murs) par covering adhésif : intervention de nuit ou jour de fermeture, zéro perte d'exploitation.",
      quotaJournalier: 20,
      zone: "Hérault (34)",
      filtres: FILTRES_DEFAUT.restaurants,
    },
  },
];

/** Crée les agents manquants ; rend le nombre créé. */
export async function assurerAgentsProspection(client: BaseDonnees | Transaction): Promise<number> {
  let crees = 0;
  for (const profil of PROFILS_AGENTS) {
    const existant = await client.agentProfile.findFirst({ where: { slug: profil.slug, archiveLe: undefined }, select: { id: true } });
    if (existant) continue;
    await client.agentProfile.create({ data: { slug: profil.slug, nom: profil.nom, actif: true, config: JSON.stringify(profil.config) } });
    crees++;
  }
  return crees;
}
