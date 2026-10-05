import type { Transaction } from "@/lib/prisma";
import { cleSousPartie, famille, famillesDe, lireSelection, lireTeintes, selectionDepuisZones, type SelectionPrestations } from "@/lib/prestations/prestations";
import { lireZones } from "@/lib/simulateur/types-surface";
import { lireProjet } from "./projet";

/**
 * Mission 18 (B11, écart 11) : les teintes du dossier (`Dossier.teintes`, « CUISINE.ilot » → « Chêne clair (NE31) »)
 * et le choix du client dans son espace (`EspaceClient.choix` : une simulation, ou un mélange zone par zone) disent la
 * même chose. Quand le client (ou Lucas à sa place) valide, les teintes des zones choisies sont reportées sur les
 * sous-parties de son projet qu'elles habillent (une même zone peut en couvrir plusieurs : façades basses, îlot,
 * électroménager) ; les autres sous-parties gardent leur teinte. Dévalider le choix ne touche pas aux teintes : ce qui
 * a été dit reste, le prochain choix le remplace.
 */

/** Le choix de l'espace, tel qu'il est rangé ; null s'il est illisible (la même lecture partout). */
export type ChoixEspace =
  | { mode: "UNE"; simulationId: string; commentaire?: string | null; le?: string }
  | { mode: "COMPOSITE"; zones: { zone: string; libelle: string; ref: string; nom: string; simulationId?: string }[]; commentaire?: string | null; le?: string };

export function lireChoixEspace(json: string | null | undefined): ChoixEspace | null {
  if (!json) return null;
  try {
    const choix = JSON.parse(json) as ChoixEspace | null;
    if (choix?.mode === "UNE") return typeof choix.simulationId === "string" ? choix : null;
    if (choix?.mode === "COMPOSITE") return Array.isArray(choix.zones) ? choix : null;
    return null;
  } catch {
    return null;
  }
}

/** Une zone choisie, pour les teintes : sa surface, sa référence et son nom. */
export type ZoneChoisie = { zone: string; ref: string | null; nom: string | null };

/** « Chêne clair (NE31) », le nom seul, ou la référence seule ; vide sans rien. */
export const teinteDe = (z: { ref: string | null; nom: string | null } | undefined) => (z && (z.nom || z.ref) ? `${z.nom || z.ref}${z.ref && z.nom ? ` (${z.ref})` : ""}` : "");

/**
 * Les teintes du choix par sous-partie du projet (clé `FAMILLE.sous-partie`, comme `Dossier.teintes`) : les
 * sous-parties cochées ; rien de coché, celles que les surfaces du choix laissent deviner (comme le devis proposé).
 * Une sous-partie qui couvre deux zones de teintes différentes les nomme toutes deux (« Chêne (D1) / Béton (AL23) »).
 */
export function teintesParSousPartie(selection: SelectionPrestations, zones: ZoneChoisie[]): Record<string, string> {
  if (zones.length === 0) return {};
  const parZone = new Map(zones.map((z) => [z.zone, z]));
  const rien = famillesDe(selection).every((f) => (selection[f] ?? []).length === 0);
  const retenue = rien ? selectionDepuisZones(zones.map((z) => z.zone)) : selection;
  const teintes: Record<string, string> = {};
  for (const familleId of famillesDe(retenue)) {
    const f = famille(familleId);
    for (const spId of retenue[familleId] ?? []) {
      const sp = f.sousParties.find((s) => s.id === spId);
      if (!sp) continue;
      const teinte = [...new Set(sp.zones.map((z) => teinteDe(parZone.get(z))).filter(Boolean))].join(" / ").slice(0, 80);
      if (teinte) teintes[cleSousPartie(familleId, spId)] = teinte;
    }
  }
  return teintes;
}

/** Les zones d'un choix rangé : celles du mélange, ou celles de la simulation validée. */
export function zonesDuChoix(choix: ChoixEspace | null, simulations: { id: string; zones: string | null }[]): ZoneChoisie[] {
  if (!choix) return [];
  const zones = choix.mode === "COMPOSITE" ? choix.zones : lireZones(simulations.find((s) => s.id === choix.simulationId)?.zones ?? null);
  return zones.map((z) => ({ zone: String(z.zone ?? ""), ref: z.ref || null, nom: z.nom || null }));
}

/**
 * Reporte les teintes du choix dans `Dossier.teintes`, dans la transaction de l'appelant (`choisir`). `remplacer` :
 * le choix qui vient d'être validé l'emporte sur ce qui était noté pour ses sous-parties ; sans (la reprise de
 * l'existant), seules les sous-parties sans teinte sont remplies. Rend les clés écrites.
 */
export async function reporterTeintesDuChoix(tx: Transaction, dossierId: string, zones: ZoneChoisie[], options: { remplacer: boolean }): Promise<string[]> {
  if (zones.length === 0) return [];
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { teintes: true, prestations: true, lead: { select: { typeProjet: true } }, espaces: { where: { archiveLe: null }, take: 1, select: { souhaits: true } } } });
  if (!dossier) return [];
  const projet = lireProjet(dossier.espaces[0]?.souhaits ?? null, lireSelection(dossier.prestations), dossier.lead?.typeProjet);
  const nouvelles = teintesParSousPartie(projet?.familles ?? {}, zones);
  const avant = lireTeintes(dossier.teintes);
  const ecrites = Object.keys(nouvelles).filter((cle) => avant[cle] !== nouvelles[cle] && (options.remplacer || !avant[cle]));
  if (ecrites.length === 0) return [];
  const apres = { ...avant };
  for (const cle of ecrites) apres[cle] = nouvelles[cle];
  await tx.dossier.update({ where: { id: dossierId }, data: { teintes: JSON.stringify(apres) } });
  return ecrites;
}
