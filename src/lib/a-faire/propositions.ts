import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { definirProposition } from "@/lib/validation/definitions";
import { RAISONS_PAS_A_FAIRE, TYPES_TACHE, type TypeTache } from "./types";

/**
 * Mission 17 (partie A) : le « Pas à faire » qui apprend (docs/TACHES.md § 4). Trois « Pas à faire » de même type et
 * même raison en 30 jours → une proposition REGLE_TACHE (reponses.ts), validée comme les autres (écran À valider, outil
 * `valider_proposition`) ; validée, elle écrit une ligne `RegleTache` que le moteur applique (moteur.ts, étape 2).
 * Ce fichier n'importe pas le service de validation (règle du catalogue : pas de cycle).
 */

export const TYPE_REGLE_TACHE = "REGLE_TACHE";
export const EFFETS_REGLE = ["ATTENDRE", "NE_PLUS_PROPOSER"] as const;
export type EffetRegle = (typeof EFFETS_REGLE)[number];
export const DELAI_REGLE_DEFAUT = 3;

/** Ce que fait une tâche de ce type, pour le libellé de la règle (« Préparer la simulation : … »). */
export const ACTIONS_TYPE: Record<TypeTache, string> = {
  REPONDRE: "Répondre",
  LIRE_MAIL: "Lire un mail administratif",
  DATE_CHANTIER: "Fixer la date du chantier",
  ENCAISSER: "Encaisser l'acompte",
  DEMANDE_CLIENT: "Répondre à une demande du client",
  RELANCER_DEVIS: "Relancer le devis",
  HESITE: "Appeler un client qui hésite",
  RAPPELER: "Rappeler",
  APPELER: "Appeler un nouveau contact",
  PROCHAINE_ACTION: "Faire la prochaine action",
  VALIDER: "Valider une proposition",
  SIMULATION: "Préparer la simulation",
  PUBLIER: "Publier la simulation",
  DEVIS: "Faire le devis",
  ENVOYER_LIEN: "Envoyer le lien",
  RELANCER_PHOTOS: "Relancer pour les photos",
  RELANCER_AVIS: "Demander un avis",
  REACTIVER: "Reprendre contact avec un ancien contact",
  DECIDER: "Décider d'un contact",
  MANUELLE: "Une tâche à moi",
  SYSTEME: "Un réglage du CRM",
  COHERENCE: "Corriger une incohérence",
  ECARTER: "Classer un contact hors zone",
  CLASSER_LEAD: "Classer un ancien contact",
};

/** Pourquoi la règle, dit de la tâche (« le client la fait souvent lui-même »). */
const RAISONS_EN_CLAIR: Record<string, string> = {
  CLIENT_LE_FAIT: "le client la fait souvent lui-même",
  DEJA_FAIT: "elle est souvent déjà faite hors du CRM",
  CLIENT_PERDU: "le client est souvent déjà perdu",
  PAS_PERTINENT: "elle est souvent sans objet",
  PAS_DE_REPONSE_A_FAIRE: "ces messages ne demandent souvent pas de réponse",
  AUTRE: "écartée trois fois pour une autre raison",
};

/** « Préparer la simulation : attendre 3 jours avant de la proposer (raison : le client la fait souvent lui-même) ». */
export function libelleRegle(type: TypeTache, raison: string, effet: EffetRegle = "ATTENDRE", delaiJours: number = DELAI_REGLE_DEFAUT): string {
  const quoi = effet === "ATTENDRE" ? `attendre ${delaiJours} jour${delaiJours > 1 ? "s" : ""} avant de la proposer` : "ne plus la proposer";
  return `${ACTIONS_TYPE[type]} : ${quoi} (raison : ${RAISONS_EN_CLAIR[raison] ?? raison.toLowerCase()})`;
}

export const schemaRegleTache = z.object({
  type: z.enum(TYPES_TACHE),
  raison: z.enum(RAISONS_PAS_A_FAIRE),
  effet: z.enum(EFFETS_REGLE).default("ATTENDRE"),
  delaiJours: z.coerce.number().int().min(1).max(60).default(DELAI_REGLE_DEFAUT),
  /** Les trois réponses qui l'ont fait proposer (lecture). */
  reponses: z.number().int().min(0).max(1000).optional(),
});

export const propositionRegleTache = definirProposition({
  type: TYPE_REGLE_TACHE,
  libelle: "Règle des tâches",
  schema: schemaRegleTache,
  sensible: false,
  validationGroupee: true,
  champs: [
    { cle: "effet", libelle: "Règle", nature: "choix", options: [{ valeur: "ATTENDRE", libelle: "Attendre avant de la proposer" }, { valeur: "NE_PLUS_PROPOSER", libelle: "Ne plus la proposer" }] },
    { cle: "delaiJours", libelle: "Attendre (jours)", nature: "choix", options: [1, 3, 7, 14].map((n) => ({ valeur: String(n), libelle: `${n} jour${n > 1 ? "s" : ""}` })) },
  ],
  motifsRejet: [{ code: "PAS_DE_REGLE", libelle: "Pas de règle : je veux continuer à les voir" }],
  execution: "IMMEDIATE",
  liens: () => [{ libelle: "Tâches", href: "/taches" }],
  async pertinente(contenu) {
    const deja = await prisma.regleTache.findFirst({ where: { type: contenu.type, raison: contenu.raison, archiveLe: null }, select: { id: true } });
    return deja ? "cette règle existe déjà" : null;
  },
  async executer(contenu, { tx, decidePar }) {
    const client = tx ?? prisma;
    const regle = await client.regleTache.create({
      data: {
        type: contenu.type,
        raison: contenu.raison,
        effet: contenu.effet,
        delaiJours: contenu.effet === "ATTENDRE" ? contenu.delaiJours : null,
        libelle: libelleRegle(contenu.type, contenu.raison, contenu.effet, contenu.delaiJours),
        par: decidePar,
      },
    });
    return { resultat: { regleId: regle.id } };
  },
});
