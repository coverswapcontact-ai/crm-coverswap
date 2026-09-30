import prisma from "@/lib/prisma";
import { resoudreContexte } from "@/lib/journal/acteur";
import type { Changement, Entite } from "./entites/socle";

/**
 * La trace commune des modifications de l'assistant (mission 17, partie C) : table `ModificationAssistant`, une ligne
 * par appel de « modifier » qui a changé quelque chose, avec les valeurs d'avant et d'après. Le cœur du dossier
 * (objet, budget, dates, adresse, familles, teintes…) garde sa table `ModificationDossier`
 * (`dossiers/modification-assistant.ts`) ; « annuler_modification » lit les deux.
 */

export type ModificationTracee = { id: string; entite: Entite; enregistrementId: string; nom: string | null; le: string; par: string; commande: string | null; changements: Changement[]; annuleeLe: string | null; annuleePar: string | null };

type Ligne = { id: string; entite: string; enregistrementId: string; nom: string | null; createdAt: Date; par: string; commande: string | null; champs: string; annuleeLe: Date | null; annuleePar: string | null };

function lireChangements(json: string): Changement[] {
  try {
    const valeur: unknown = JSON.parse(json);
    return Array.isArray(valeur) ? (valeur as Changement[]) : [];
  } catch {
    return [];
  }
}

export const versVue = (m: Ligne): ModificationTracee => ({ id: m.id, entite: m.entite as Entite, enregistrementId: m.enregistrementId, nom: m.nom, le: m.createdAt.toISOString(), par: m.par, commande: m.commande, changements: lireChangements(m.champs), annuleeLe: m.annuleeLe?.toISOString() ?? null, annuleePar: m.annuleePar });

export async function tracerModification(entree: { entite: Entite; enregistrementId: string; nom: string; changements: Changement[]; commande: string | null }): Promise<ModificationTracee> {
  const { acteur } = await resoudreContexte();
  const ligne = await prisma.modificationAssistant.create({ data: { entite: entree.entite, enregistrementId: entree.enregistrementId, nom: entree.nom.slice(0, 200), champs: JSON.stringify(entree.changements), par: acteur, commande: entree.commande?.slice(0, 500) ?? null } });
  return versVue(ligne);
}

export async function lireModification(id: string): Promise<ModificationTracee | null> {
  const ligne = await prisma.modificationAssistant.findUnique({ where: { id } });
  return ligne ? versVue(ligne) : null;
}

/** La dernière modification non annulée : d'un enregistrement, d'une entité, ou de toutes. */
export async function derniereModificationTracee(filtre: { entite?: Entite; enregistrementId?: string } = {}): Promise<ModificationTracee | null> {
  const ligne = await prisma.modificationAssistant.findFirst({ where: { annuleeLe: null, ...(filtre.entite ? { entite: filtre.entite } : {}), ...(filtre.enregistrementId ? { enregistrementId: filtre.enregistrementId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return ligne ? versVue(ligne) : null;
}

export async function marquerAnnulee(id: string): Promise<ModificationTracee> {
  const { acteur } = await resoudreContexte();
  return versVue(await prisma.modificationAssistant.update({ where: { id }, data: { annuleeLe: new Date(), annuleePar: acteur } }));
}
