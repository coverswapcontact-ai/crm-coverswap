// Données mockées de l'étape 1 — remplacées par la DB à l'étape 2.
// Les formes imitent les futurs modèles Prisma (Prospect, AgentProfile).
import type { AgentSlug } from "@/lib/prospection/constants";

export type AgentMock = {
  slug: AgentSlug;
  label: string;
  actif: boolean;
};

export type KpiSet = {
  sources: { value: number; sub: string };
  qualifies: { value: number; sub: string };
  envoyes: { value: number; sub: string };
  reponses: { value: number; sub: string };
};

export type ProspectMock = {
  id: string;
  agent: AgentSlug;
  nom: string;
  ville: string;
  noteGoogle: number;
  nbAvis: number;
  score: number; // 0–100
  signalPrincipal: string; // citation d'avis ou fait détecté
  signalSource: string;
  angleSuggere: string; // angle retenu pour le brouillon d'email
};

export const AGENTS: AgentMock[] = [
  { slug: "hotels", label: "Hôtels", actif: true },
  { slug: "restaurants", label: "Restaurants", actif: true },
];

export const KPIS: Record<AgentSlug, KpiSet> = {
  hotels: {
    sources: { value: 128, sub: "+18 cette semaine" },
    qualifies: { value: 34, sub: "27 % des sourcés" },
    envoyes: { value: 21, sub: "+9 cette semaine" },
    reponses: { value: 6, sub: "29 % de taux de réponse" },
  },
  restaurants: {
    sources: { value: 94, sub: "+12 cette semaine" },
    qualifies: { value: 22, sub: "23 % des sourcés" },
    envoyes: { value: 13, sub: "+5 cette semaine" },
    reponses: { value: 4, sub: "31 % de taux de réponse" },
  },
};

export const PROSPECTS: ProspectMock[] = [
  {
    id: "h1",
    agent: "hotels",
    nom: "Hôtel du Parc",
    ville: "Montpellier",
    noteGoogle: 4.1,
    nbAvis: 286,
    score: 87,
    signalPrincipal:
      "Bel accueil, mais les salles de bain accusent leur âge — carrelage et baignoire d'époque.",
    signalSource: "Avis Google · avr. 2026",
    angleSuggere:
      "Rénover les salles de bain en covering, chambre par chambre, sans fermer l'hôtel.",
  },
  {
    id: "h2",
    agent: "hotels",
    nom: "Le Grand Large",
    ville: "Sète",
    noteGoogle: 4.3,
    nbAvis: 412,
    score: 81,
    signalPrincipal:
      "Vue magnifique sur le port, dommage que le mobilier des chambres fasse vieillot.",
    signalSource: "Avis Google · mai 2026",
    angleSuggere:
      "Covering du mobilier des 24 chambres avant la haute saison.",
  },
  {
    id: "h3",
    agent: "hotels",
    nom: "Auberge du Pic Saint-Loup",
    ville: "Saint-Mathieu-de-Tréviers",
    noteGoogle: 3.9,
    nbAvis: 158,
    score: 64,
    signalPrincipal:
      "Étape agréable, mais la décoration des chambres mériterait un bon coup de frais.",
    signalSource: "Avis Google · janv. 2026",
    angleSuggere:
      "Rafraîchir la réception et les têtes de lit hors saison, budget maîtrisé.",
  },
  {
    id: "r1",
    agent: "restaurants",
    nom: "La Table d'Oc",
    ville: "Béziers",
    noteGoogle: 4.4,
    nbAvis: 327,
    score: 78,
    signalPrincipal:
      "On y mange très bien, mais la salle fait datée — on se croirait dans les années 90.",
    signalSource: "Avis Google · mars 2026",
    angleSuggere:
      "Relooker la salle en une nuit d'intervention, zéro jour de fermeture.",
  },
  {
    id: "r2",
    agent: "restaurants",
    nom: "Chez Marius",
    ville: "Palavas-les-Flots",
    noteGoogle: 4.0,
    nbAvis: 214,
    score: 59,
    signalPrincipal:
      "Belles assiettes de poisson, mais le comptoir et les tables sont bien fatigués.",
    signalSource: "Avis Google · févr. 2026",
    angleSuggere:
      "Covering du comptoir et des plateaux de table avant l'été.",
  },
];
