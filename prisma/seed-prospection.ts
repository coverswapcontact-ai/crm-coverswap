// Seed du module Prospection — idempotent, ne touche à rien d'autre.
// Usage : npm run db:seed:prospection  (ou npx tsx prisma/seed-prospection.ts)
import { PrismaClient } from "@prisma/client";
import { FILTRES_DEFAUT, type AgentProfileConfig } from "../src/lib/prospection/constants";

const prisma = new PrismaClient();

const profils: { slug: string; nom: string; config: AgentProfileConfig }[] = [
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

async function main() {
  for (const p of profils) {
    const profil = await prisma.agentProfile.upsert({
      where: { slug: p.slug },
      // update vide : on ne réécrase pas une config ajustée à la main lors d'un re-run
      update: {},
      create: {
        slug: p.slug,
        nom: p.nom,
        actif: true,
        config: JSON.stringify(p.config),
      },
    });
    console.log(`✔ AgentProfile "${profil.slug}" (${profil.id})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
