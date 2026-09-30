import prisma from "@/lib/prisma";
import { resoudreContexte } from "@/lib/journal/acteur";
import { typeActeur } from "@/lib/journal/contexte";
import { recalculerMain } from "./main";

/**
 * Mission 17 (partie A) : la prochaine action posée à la main (cas « j'attends sa modification visuelle »,
 * docs/TACHES.md § 1 et § 2). Quand Lucas (HUMAIN) ou Claude (ASSISTANT) change le texte de la prochaine action d'un
 * dossier (`modifierDossier`, donc aussi `modifierDossierAssistant` ; `planifierAction`), le texte retenu, l'instant et
 * l'auteur sont rangés sur le dossier, un événement PROCHAINE_ACTION_MANUELLE (INTERNE) est écrit — il compte comme
 * une réponse pour la règle de la main (ce qui est plus ancien est traité) et passe la main au client si le texte dit
 * d'attendre, sinon à Lucas (dossiers/main.ts) —, puis la main est recalculée. Tant qu'elle est en vigueur
 * (a-faire/vigueur.ts), aucune tâche n'est créée sur ce dossier sauf PROCHAINE_ACTION le jour de sa date.
 * Les écritures automatiques (espace, appel, simulation publiée) ne passent pas par ici : elles la remplacent, et la
 * vigueur tombe (le texte n'est plus celui retenu).
 */

export const TYPE_PROCHAINE_ACTION_MANUELLE = "PROCHAINE_ACTION_MANUELLE";

/** Seules une personne (Lucas) et l'assistant (Claude, sur sa phrase) posent une action « à la main ». */
export const estActeurManuel = (acteur: string): boolean => {
  const type = typeActeur(acteur);
  return type === "HUMAIN" || type === "ASSISTANT";
};

/**
 * Après l'écriture de la prochaine action : si son texte a changé et que l'auteur est Lucas ou Claude, la retient comme
 * manuelle. Un texte effacé efface aussi l'action retenue (sans événement). Jamais bloquant : rend vrai si l'action a
 * été retenue.
 */
export async function noterProchaineActionManuelle(dossierId: string, entree: { action: string | null | undefined; avant: string | null | undefined; date: Date | null }, maintenant: Date = new Date()): Promise<boolean> {
  const action = entree.action?.trim() || null;
  if (action === (entree.avant?.trim() || null)) return false;
  try {
    const { acteur } = await resoudreContexte();
    if (!estActeurManuel(acteur)) return false;
    if (!action) {
      await prisma.dossier.update({ where: { id: dossierId }, data: { prochaineActionManuelleLe: null, prochaineActionManuelle: null, prochaineActionPar: null } });
      return false;
    }
    // Le texte rangé tel qu'écrit dans prochaineAction : la vigueur compare les deux à l'identique.
    const retenu = entree.action!;
    await prisma.dossier.update({ where: { id: dossierId }, data: { prochaineActionManuelleLe: maintenant, prochaineActionManuelle: retenu, prochaineActionPar: acteur } });
    await prisma.dossierEvenement.create({
      data: {
        dossierId,
        type: TYPE_PROCHAINE_ACTION_MANUELLE,
        direction: "INTERNE",
        contenu: `Prochaine action posée à la main : « ${action} »`.slice(0, 1500),
        metadata: JSON.stringify({ action: retenu, date: entree.date?.toISOString() ?? null }),
        createdAt: maintenant,
      },
    });
    await recalculerMain(dossierId);
    return true;
  } catch (erreur) {
    console.error("[dossiers] prochaine action manuelle non retenue :", erreur);
    return false;
  }
}
