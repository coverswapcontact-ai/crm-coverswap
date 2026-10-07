import prisma from "@/lib/prisma";
import { enregistrerParametre, lireParametre } from "@/lib/parametres/service";
import { estRecent, lireValeurServeur, valeurServeur, type ContexteReprendre } from "./reprendre";

/**
 * Mission 22 (A2) — la mémoire serveur de « Reprendre » : le paramètre `DERNIER_DOSSIER_OUVERT` (« <dossierId>|<ISO> »,
 * une ligne par écriture comme tout paramètre, l'historique reste). Écrit par `POST /api/reprendre` quand la coque v2
 * voit un dossier s'ouvrir ; lu par Aujourd'hui, qui donne au dossier son nom. Un dossier archivé ne se reprend pas.
 */
export const CLE_DERNIER_DOSSIER = "DERNIER_DOSSIER_OUVERT";
/** Le même dossier rouvert dans le quart d'heure n'écrit pas une ligne de plus. */
export const DEDOUBLONNAGE_MS = 15 * 60_000;

/** Note le dossier ouvert ; rend false si la mémoire le disait déjà il y a moins d'un quart d'heure (rien n'est écrit). */
export async function noterDossierOuvert(dossierId: string, maintenant: Date = new Date()): Promise<boolean> {
  const actuel = lireValeurServeur(await lireParametre(CLE_DERNIER_DOSSIER, maintenant));
  if (actuel && actuel.dossierId === dossierId && maintenant.getTime() - Date.parse(actuel.le) < DEDOUBLONNAGE_MS) return false;
  await enregistrerParametre({ cle: CLE_DERNIER_DOSSIER, valeur: valeurServeur(dossierId, maintenant), valableDu: maintenant, source: "Reprendre (Aujourd'hui)" });
  return true;
}

/** Le dernier dossier ouvert, nommé, s'il date de moins de 48 h et n'est pas archivé ; null sinon. */
export async function lireReprendre(maintenant: Date = new Date()): Promise<ContexteReprendre | null> {
  const memoire = lireValeurServeur(await lireParametre(CLE_DERNIER_DOSSIER, maintenant));
  if (!memoire || !estRecent(memoire.le, maintenant)) return null;
  const dossier = await prisma.dossier.findFirst({ where: { id: memoire.dossierId }, select: { id: true, clientNom: true, objet: true } });
  if (!dossier) return null;
  const objet = dossier.objet.trim();
  return { chemin: `/dossiers?dossier=${encodeURIComponent(dossier.id)}`, titre: objet ? `dossier ${dossier.clientNom}, ${objet.charAt(0).toLowerCase()}${objet.slice(1)}` : `dossier ${dossier.clientNom}`, le: memoire.le, dossierId: dossier.id };
}
