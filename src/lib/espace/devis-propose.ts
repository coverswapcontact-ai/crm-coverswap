import type { Unite } from "@/lib/dossiers/constants";
import { listerPresets } from "@/lib/dossiers/presets";
import type { PresetVue } from "@/lib/dossiers/types";
import prisma from "@/lib/prisma";
import { cleSousPartie, famille, famillesDe, lireSelection, resumerSelection, selectionDepuisZones, type IdFamille, type SelectionPrestations, type TaillesProjet } from "@/lib/prestations/prestations";
import { tarifDeLaSousPartie } from "@/lib/prestations/tarifs";
import { lireZones, type ZoneTeinte } from "@/lib/simulateur/types-surface";
import { lireProjet } from "./projet";

/**
 * Le devis qui part du projet du client : les SOUS-PARTIES cochées (fichier des
 * prestations, quelle que soit la famille), chacune à SON tarif (celui que
 * Lucas lui attribue, sinon trouvé par mots-clés), les teintes de la
 * simulation validée, la taille qu'il a donnée. Un point de départ, jamais un
 * devis : rien n'est émis sans Lucas. Aucun prix n'est inventé — une
 * sous-partie sans tarif garde son prix à saisir, une quantité inconnue reste
 * à saisir : le générateur refuse de produire le document tant qu'ils manquent.
 */

export type LigneProposee = { designation: string; sousDesignation: string; quantite: number | null; unite: Unite; prixUnitaire: number | null };
export type DevisPropose = { lignes: LigneProposee[]; resume: string };

/** Une zone à chiffrer : sa teinte si le client l'a choisie (ancien appel, par zones). */
export type ZoneAChiffrer = { zone: string; libelle: string; ref: string | null; nom: string | null };

const teinteDe = (z: { ref: string | null; nom: string | null } | undefined) => (z && (z.nom || z.ref) ? `${z.nom || z.ref}${z.ref && z.nom ? ` (${z.ref})` : ""}` : "");

/**
 * Les lignes : les sous-parties cochées, dans l'ordre du fichier ; celles qui
 * partagent un tarif (façades hautes et basses au même prix du mètre) tiennent
 * sur une ligne, qui les nomme. La taille d'une famille (mètres de meubles) va
 * à sa première ligne « au mètre » de meubles — jamais à un plan de travail ni
 * à une crédence ; un nombre de portes s'écrit dans le détail (le tarif est au
 * mètre : la quantité reste à mesurer).
 */
export function proposerLignesPrestations(selection: SelectionPrestations, teintes: Map<string, ZoneAChiffrer>, tailles: TaillesProjet, presets: PresetVue[]): LigneProposee[] {
  type Groupe = { cle: string; famille: IdFamille; designation: string; unite: Unite; prixUnitaire: number | null; parties: { libelle: string; teinte: string; metrage: boolean }[] };
  const groupes: Groupe[] = [];
  for (const familleId of famillesDe(selection)) {
    const f = famille(familleId);
    for (const spId of selection[familleId] ?? []) {
      const sp = f.sousParties.find((s) => s.id === spId);
      if (!sp) continue;
      const { preset } = tarifDeLaSousPartie(cleSousPartie(familleId, spId), presets);
      const cle = preset ? `${familleId}:${preset.id}` : `${familleId}.${spId}`;
      const teinte = [...new Set(sp.zones.map((z) => teinteDe(teintes.get(z))).filter(Boolean))].join(" / ");
      let groupe = groupes.find((g) => g.cle === cle);
      if (!groupe) {
        groupe = { cle, famille: familleId, designation: preset?.designation ?? sp.tarif.designation, unite: preset?.unite ?? sp.tarif.unite, prixUnitaire: preset?.prixUnitaire ?? null, parties: [] };
        groupes.push(groupe);
      }
      groupe.parties.push({ libelle: sp.libelle, teinte, metrage: Boolean(sp.metrage) });
    }
  }
  const metreUtilise = new Set<IdFamille>();
  return groupes.map((g) => {
    const t = tailles[g.famille];
    const q = famille(g.famille).taille;
    const avecMetre = q.unite === "m" && Boolean(t?.valeur) && !metreUtilise.has(g.famille) && g.unite === "ml" && g.parties.some((p) => p.metrage);
    if (avecMetre) metreUtilise.add(g.famille);
    const nommees = g.parties;
    const detail =
      nommees.length > 1
        ? nommees.map((p) => (p.teinte ? `${p.libelle} : ${p.teinte}` : p.libelle)).join(" · ")
        : // Une seule sous-partie : sa teinte ; son nom aussi quand la désignation du tarif ne le dit pas (« cuisine / façades »).
          [g.designation.toLowerCase().includes(nommees[0].libelle.toLowerCase()) ? "" : nommees[0].libelle, nommees[0].teinte].filter(Boolean).join(" : ");
    const portes = q.unite === "portes" && t?.valeur && !metreUtilise.has(g.famille) ? `≈ ${t.valeur} porte${t.valeur > 1 ? "s" : ""} (estimation du client)` : "";
    if (portes) metreUtilise.add(g.famille);
    return {
      designation: g.designation,
      sousDesignation: [detail, portes].filter(Boolean).join(" — "),
      quantite: avecMetre ? (t?.valeur ?? null) : null,
      unite: g.unite,
      prixUnitaire: g.prixUnitaire,
    };
  });
}

/** Ancien appel (par zones du moteur) : les zones deviennent des sous-parties, les mètres la taille de leur famille. */
export function proposerLignes(zones: ZoneAChiffrer[], metres: number | null, presets: PresetVue[]): LigneProposee[] {
  const selection = selectionDepuisZones(zones.map((z) => z.zone));
  const teintes = new Map(zones.map((z) => [z.zone, z]));
  const tailles: TaillesProjet = {};
  if (metres) for (const f of famillesDe(selection)) tailles[f] = { repere: null, valeur: metres };
  return proposerLignesPrestations(selection, teintes, tailles, presets);
}

type Choix = { mode: "UNE"; simulationId: string } | { mode: "COMPOSITE"; zones: ZoneTeinte[] };

function lireChoix(json: string | null): Choix | null {
  if (!json) return null;
  try {
    const choix = JSON.parse(json) as Choix;
    return choix?.mode === "UNE" || choix?.mode === "COMPOSITE" ? choix : null;
  } catch {
    return null;
  }
}

/**
 * La proposition pour un dossier : ses familles et sous-parties (le dossier),
 * les teintes de la simulation validée, la taille qu'il a donnée ; null s'il
 * n'a rien dit. Sans sous-partie cochée, les surfaces de la simulation validée
 * disent ce qu'il y a à chiffrer.
 */
export async function devisProposeDuDossier(dossierId: string): Promise<DevisPropose | null> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { clientNom: true, prestations: true, lead: { select: { typeProjet: true } }, espaces: { select: { souhaits: true, choix: true, simulations: { where: { archiveLe: null }, select: { id: true, zones: true } } } } },
  });
  if (!dossier) return null;
  const espace = dossier.espaces[0] ?? null;
  const projet = lireProjet(espace?.souhaits, lireSelection(dossier.prestations), dossier.lead?.typeProjet);
  const choix = lireChoix(espace?.choix ?? null);
  let zonesChoisies: ZoneTeinte[] = [];
  if (choix?.mode === "COMPOSITE") zonesChoisies = choix.zones;
  else if (choix?.mode === "UNE") zonesChoisies = lireZones(espace?.simulations.find((s) => s.id === choix.simulationId)?.zones ?? null);
  const teintes = new Map(zonesChoisies.map((z) => [z.zone, { zone: z.zone, libelle: z.libelle, ref: z.ref || null, nom: z.nom || null }]));
  let selection = projet?.familles ?? {};
  // Rien de coché mais une simulation validée : ses surfaces disent ce qu'il y a à chiffrer.
  if (famillesDe(selection).every((f) => (selection[f] ?? []).length === 0) && zonesChoisies.length > 0) selection = selectionDepuisZones(zonesChoisies.map((z) => z.zone));
  const lignes = proposerLignesPrestations(selection, teintes, projet?.tailles ?? {}, await listerPresets());
  if (lignes.length === 0) return null;
  const qui = dossier.clientNom.trim().split(/\s+/)[0] || "le client";
  const avecTeintes = zonesChoisies.length > 0 ? `, teintes de sa simulation validée (${zonesChoisies.map((z) => `${z.libelle || z.zone} : ${teinteDe({ ref: z.ref || null, nom: z.nom || null }) || "?"}`).join(" · ")})` : ", teintes à préciser";
  const tailles = famillesDe(selection)
    .map((f) => {
      const t = projet?.tailles[f];
      if (!t?.valeur) return null;
      return famille(f).taille.unite === "portes" ? `≈ ${t.valeur} portes (${famille(f).libelle.toLowerCase()})` : `≈ ${String(t.valeur).replace(".", ",")} m (${famille(f).libelle.toLowerCase()})`;
    })
    .filter(Boolean);
  return { lignes, resume: `D'après l'espace de ${qui} : ${resumerSelection(selection)}${avecTeintes}${tailles.length ? ` ; ${tailles.join(", ")}, son estimation` : ", métré inconnu"}.` };
}
