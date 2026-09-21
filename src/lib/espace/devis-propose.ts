import type { Unite } from "@/lib/dossiers/constants";
import { listerPresets } from "@/lib/dossiers/presets";
import type { PresetVue } from "@/lib/dossiers/types";
import prisma from "@/lib/prisma";
import { lireZones, ZONES, ZONES_PROJET_CLIENT, estZone, type ZoneTeinte } from "@/lib/simulateur/types-surface";
import { lireProjet } from "./projet";

/**
 * Le devis qui part du choix du client : ce qu'il a validé dans son espace (une
 * teinte par zone) et ses mètres, posés sur les tarifs de Lucas. Un point de
 * départ, jamais un devis : rien n'est émis sans lui. Aucun prix n'est inventé —
 * une zone sans tarif enregistré garde son prix à saisir, un métré inconnu sa
 * quantité à saisir : le générateur refuse de produire le document tant qu'ils
 * manquent.
 */

export type LigneProposee = { designation: string; sousDesignation: string; quantite: number | null; unite: Unite; prixUnitaire: number | null };
export type DevisPropose = { lignes: LigneProposee[]; resume: string };

/** Une zone à chiffrer : sa teinte si le client l'a choisie. */
export type ZoneAChiffrer = { zone: string; libelle: string; ref: string | null; nom: string | null };

const normaliser = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/**
 * Zones chiffrées sur une même ligne, et les mots qui désignent leur tarif dans
 * la liste de Lucas (essayés dans l'ordre : tous les mots d'une alternative
 * doivent y être). Un tarif de « nouvelle crédence » (Dibond, dépose) n'est pas
 * celui d'une crédence recouverte : seul « revêtement … crédence » compte.
 */
const GROUPES: { zones: string[]; tarif: string[][]; designation: string; auMetre: boolean }[] = [
  { zones: ["meubles-hauts", "meubles-bas"], tarif: [["revetement", "facade"], ["revetement", "cuisine"]], designation: "Revêtement adhésif — façades de cuisine", auMetre: true },
  { zones: ["plan-de-travail"], tarif: [["revetement", "plan de travail"]], designation: "Revêtement adhésif — plan de travail", auMetre: false },
  { zones: ["credence"], tarif: [["revetement", "credence"]], designation: "Revêtement adhésif — crédence", auMetre: false },
  { zones: ["meuble-vasque"], tarif: [["revetement", "vasque"], ["revetement", "salle de bain"]], designation: "Revêtement adhésif — meuble vasque", auMetre: true },
  { zones: ["plan-vasque"], tarif: [["revetement", "plan vasque"]], designation: "Revêtement adhésif — plan vasque", auMetre: false },
  { zones: ["portes-dressing"], tarif: [["revetement", "dressing"]], designation: "Revêtement adhésif — portes de dressing", auMetre: true },
  { zones: ["meuble-tv"], tarif: [["revetement", "meuble tv"]], designation: "Revêtement adhésif — meuble TV", auMetre: true },
  { zones: ["comptoir-habillage", "comptoir-plateau"], tarif: [["revetement", "bar"], ["revetement", "comptoir"]], designation: "Revêtement adhésif — bar / comptoir", auMetre: true },
  { zones: ["mobilier-pro", "rangements-pro"], tarif: [["revetement", "mobilier"]], designation: "Revêtement adhésif — mobilier", auMetre: true },
];

function tarifDe(motsPossibles: string[][], presets: PresetVue[]): PresetVue | null {
  for (const mots of motsPossibles) {
    const trouve = presets.find((p) => {
      const designation = normaliser(p.designation);
      return mots.every((mot) => designation.includes(mot));
    });
    if (trouve) return trouve;
  }
  return null;
}

const teinte = (z: ZoneAChiffrer) => (z.nom || z.ref ? `${z.nom || z.ref}${z.ref && z.nom ? ` (${z.ref})` : ""}` : "");

/**
 * Les lignes : une par groupe de zones (les façades hautes et basses ensemble),
 * dans l'ordre des groupes. Le métré du client (des meubles mis bout à bout) va
 * à la première ligne de meubles — les façades d'une cuisine, le meuble seul —
 * si son tarif est au mètre ; jamais à un plan de travail ni à une crédence,
 * qu'il ne mesure pas.
 */
export function proposerLignes(zones: ZoneAChiffrer[], metres: number | null, presets: PresetVue[]): LigneProposee[] {
  const lignes: LigneProposee[] = [];
  const vues = new Set<string>();
  let metreUtilise = false;
  for (const groupe of GROUPES) {
    const presentes = zones.filter((z) => groupe.zones.includes(z.zone) && !vues.has(z.zone));
    if (presentes.length === 0) continue;
    presentes.forEach((z) => vues.add(z.zone));
    const tarif = tarifDe(groupe.tarif, presets);
    const unite: Unite = tarif?.unite ?? "ml";
    const avecTeinte = presentes.filter((z) => teinte(z));
    const sousDesignation = presentes.length > 1 ? avecTeinte.map((z) => `${z.libelle} : ${teinte(z)}`).join(" · ") : avecTeinte.map(teinte).join("");
    const avecMetre = groupe.auMetre && !metreUtilise && unite === "ml" && metres !== null && metres > 0;
    if (avecMetre) metreUtilise = true;
    lignes.push({
      designation: tarif?.designation ?? groupe.designation,
      sousDesignation,
      quantite: avecMetre ? metres : null,
      unite,
      prixUnitaire: tarif?.prixUnitaire ?? null,
    });
  }
  // Une zone qu'aucun groupe ne connaît (ancienne simulation, zone libre) : une ligne à elle, à chiffrer.
  for (const z of zones.filter((z) => !vues.has(z.zone))) {
    lignes.push({ designation: `Revêtement adhésif — ${(z.libelle || z.zone).toLowerCase()}`, sousDesignation: teinte(z), quantite: null, unite: "ml", prixUnitaire: null });
  }
  return lignes;
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

/** Libellé d'une zone : celui de la simulation, sinon celui du simulateur, sinon celui de l'espace (« Murs carrelés »). */
const libelleZone = (zone: string, libelle?: string) =>
  libelle || (estZone(zone) ? ZONES[zone].libelle : (Object.values(ZONES_PROJET_CLIENT).flat().find((z) => z.id === zone)?.libelle ?? zone));

/** La proposition pour un dossier : son choix d'abord, sinon ce qu'il veut traiter ; null s'il n'a rien dit. */
export async function devisProposeDuDossier(dossierId: string): Promise<DevisPropose | null> {
  const espace = await prisma.espaceClient.findUnique({
    where: { dossierId },
    select: { souhaits: true, choix: true, simulations: { where: { archiveLe: null }, select: { id: true, zones: true } } },
  });
  if (!espace) return null;
  const projet = lireProjet(espace.souhaits);
  const choix = lireChoix(espace.choix);
  let zones: ZoneAChiffrer[] = [];
  if (choix?.mode === "COMPOSITE") zones = choix.zones.map((z) => ({ zone: z.zone, libelle: libelleZone(z.zone, z.libelle), ref: z.ref || null, nom: z.nom || null }));
  else if (choix?.mode === "UNE") {
    const simulation = espace.simulations.find((s) => s.id === choix.simulationId);
    zones = lireZones(simulation?.zones).map((z) => ({ zone: z.zone, libelle: libelleZone(z.zone, z.libelle), ref: z.ref || null, nom: z.nom || null }));
  }
  const depuisChoix = zones.length > 0;
  if (!depuisChoix && projet) zones = projet.zones.map((zone) => ({ zone, libelle: libelleZone(zone), ref: null, nom: null }));
  if (zones.length === 0) return null;

  const [presets, dossier] = await Promise.all([listerPresets(), prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true } })]);
  const metres = projet?.metres ?? null;
  const lignes = proposerLignes(zones, metres, presets);
  const qui = dossier?.clientNom.trim().split(/\s+/)[0] || "le client";
  const quoi = depuisChoix ? `son choix (${zones.map((z) => `${z.libelle} : ${teinte(z) || "?"}`).join(" · ")})` : `ce qu'il veut traiter (${zones.map((z) => z.libelle).join(", ")}), teintes à préciser`;
  const combien = metres ? ` et ≈ ${String(metres).replace(".", ",")} m de meubles, son estimation` : ", métré inconnu";
  return { lignes, resume: `D'après l'espace de ${qui} : ${quoi}${combien}.` };
}
