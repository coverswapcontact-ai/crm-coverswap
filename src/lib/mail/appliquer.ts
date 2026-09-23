import prisma from "@/lib/prisma";
import { TENTATIVES_EXECUTION, executerPropositionValidee, validerProposition, vueProposition } from "@/lib/validation/service";
import type { PropositionVue } from "@/lib/validation/types";

/**
 * Valider une carte née d'un mail (mission 9) et l'appliquer TOUT DE SUITE,
 * par le code de la fiche : la validation la met en file (le code de la fiche
 * ouvre ses propres transactions, hors de celle de la validation), puis
 * l'exécution de la file est lancée ici même, sans attendre le passage du
 * moteur de tâches. Rejouée plus tard par la file, elle ne fait rien de plus
 * (« déjà exécutée »). Une exécution qui échoue laisse la carte en échec avec
 * son erreur, visible dans le mail et dans À valider.
 */
export async function appliquerProposition(id: string, corrections?: Record<string, unknown>): Promise<PropositionVue> {
  const validee = await validerProposition(id, corrections);
  if (validee.statut !== "VALIDEE") return validee;
  await executerPropositionValidee({ propositionId: id }, { tacheId: `immediat:${id}`, tentative: TENTATIVES_EXECUTION, signal: new AbortController().signal });
  return vueProposition(await prisma.proposition.findUniqueOrThrow({ where: { id } }));
}
