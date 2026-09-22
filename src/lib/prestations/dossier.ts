import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { familleDuTypeProjet, famillesDe, lireSelection, memeSelection, normaliserSelection, resumerSelection, selectionDepuisZones, type IdFamille, type SelectionPrestations } from "./prestations";

/**
 * Les familles et sous-parties d'un dossier (`Dossier.prestations`) : la vérité
 * unique, écrite par le client dans son onglet Projet ou par Lucas dans le
 * dossier. Chaque changement laisse un événement lisible dans le dossier ; une
 * saisie à la volée (le client coche case après case) n'en laisse qu'un par
 * heure, mis à jour.
 */

export type AuteurPrestations = "CLIENT" | "LUCAS" | "REPRISE";

export async function lirePrestationsDossier(dossierId: string, client: Transaction | typeof prisma = prisma): Promise<SelectionPrestations> {
  const dossier = await client.dossier.findUnique({ where: { id: dossierId }, select: { prestations: true } });
  return lireSelection(dossier?.prestations);
}

export async function enregistrerPrestations(dossierId: string, brut: unknown, auteur: AuteurPrestations, client: Transaction | typeof prisma = prisma): Promise<{ change: boolean; selection: SelectionPrestations }> {
  const selection = normaliserSelection(brut);
  const dossier = await client.dossier.findUnique({ where: { id: dossierId }, select: { prestations: true, etape: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const avant = lireSelection(dossier.prestations);
  if (memeSelection(avant, selection) && dossier.prestations !== null) return { change: false, selection };
  const maintenant = new Date();
  await client.dossier.update({ where: { id: dossierId }, data: { prestations: JSON.stringify(selection), prestationsLe: maintenant, prestationsPar: auteur } });
  const resume = resumerSelection(selection) || "aucune";
  const contenu = `${auteur === "CLIENT" ? "Familles du projet (par le client)" : auteur === "LUCAS" ? "Familles du projet modifiées par Lucas" : "Familles du projet reprises"} : ${resume}`;
  const recent =
    auteur === "CLIENT"
      ? await client.dossierEvenement.findFirst({ where: { dossierId, type: "PRESTATIONS", createdAt: { gte: new Date(maintenant.getTime() - 3_600_000) }, metadata: { contains: '"auteur":"CLIENT"' } }, orderBy: { createdAt: "desc" } })
      : null;
  const metadata = JSON.stringify({ auteur, avant, apres: selection });
  if (recent) await client.dossierEvenement.update({ where: { id: recent.id }, data: { contenu, metadata } });
  else await client.dossierEvenement.create({ data: { dossierId, type: "PRESTATIONS", direction: auteur === "CLIENT" ? "ENTRANT" : "INTERNE", contenu, metadata } });
  return { change: true, selection };
}

/**
 * Ce que le client a laissé entendre sans cocher : les surfaces de ses
 * simulations du site, la pièce choisie sur le formulaire du site. Proposé à
 * l'écran (« d'après votre demande »), jamais écrit dans le dossier. Le type de
 * projet d'un lead Meta n'en fait pas partie : c'est une valeur par défaut, pas
 * un choix.
 */
export function famillesSuggerees(entree: { zonesSite: string[]; typeProjet?: string | null; sourceLead?: string | null }): IdFamille[] {
  const depuisZones = famillesDe(selectionDepuisZones(entree.zonesSite));
  if (depuisZones.length) return depuisZones;
  const choisiSurLeSite = /^SITE/.test(entree.sourceLead ?? "");
  const f = choisiSurLeSite ? familleDuTypeProjet(entree.typeProjet) : null;
  return f ? [f] : [];
}
