import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lirePrestationsDuTarif, listerPresets } from "@/lib/dossiers/presets";
import type { PresetVue } from "@/lib/dossiers/types";
import { cleSousPartie, FAMILLES, sousPartieDeCle, type IdFamille } from "./prestations";

/**
 * Le tarif de chaque sous-partie : celui que Lucas lui a attribué dans ses tarifs
 * (Dossiers → Tarifs → « Tarif de chaque prestation »), sinon le premier de ses
 * tarifs dont la désignation contient les mots de la sous-partie (fichier des
 * prestations), sinon aucun : le prix reste à saisir, rien n'est inventé.
 */

const normaliser = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export type TarifTrouve = { preset: PresetVue | null; explicite: boolean };

export function tarifDeLaSousPartie(cle: string, presets: PresetVue[]): TarifTrouve {
  const explicite = presets.find((p) => (p.prestations ?? []).includes(cle));
  if (explicite) return { preset: explicite, explicite: true };
  const trouve = sousPartieDeCle(cle);
  if (!trouve) return { preset: null, explicite: false };
  for (const mots of trouve.sousPartie.tarif.mots) {
    const preset = presets.find((p) => {
      const designation = normaliser(p.designation);
      return mots.every((mot) => designation.includes(mot));
    });
    if (preset) return { preset, explicite: false };
  }
  return { preset: null, explicite: false };
}

export type LigneTarifPrestation = {
  cle: string;
  famille: IdFamille;
  familleLibelle: string;
  sousPartie: string;
  libelle: string;
  presetId: string | null;
  designation: string | null;
  prixUnitaire: number | null;
  unite: string | null;
  explicite: boolean;
};

/** Toutes les sous-parties avec leur tarif (écran des tarifs). */
export async function tarifsDesPrestations(): Promise<LigneTarifPrestation[]> {
  const presets = await listerPresets();
  return FAMILLES.flatMap((f) =>
    f.sousParties.map((sp) => {
      const cle = cleSousPartie(f.id, sp.id);
      const { preset, explicite } = tarifDeLaSousPartie(cle, presets);
      return { cle, famille: f.id, familleLibelle: f.libelle, sousPartie: sp.id, libelle: sp.libelle, presetId: preset?.id ?? null, designation: preset?.designation ?? null, prixUnitaire: preset?.prixUnitaire ?? null, unite: preset?.unite ?? null, explicite };
    })
  );
}

/**
 * Lucas attribue un tarif à une sous-partie (`presetId`), ou la rend au choix
 * automatique (null). La clé quitte les autres tarifs : une sous-partie n'a
 * qu'un tarif.
 */
export async function attribuerTarif(cle: string, presetId: string | null): Promise<void> {
  if (!sousPartieDeCle(cle)) throw new ErreurMetier("Prestation inconnue.", 400);
  const tous = await prisma.presetTarif.findMany({ where: { actif: true }, select: { id: true, prestations: true } });
  if (presetId && !tous.some((p) => p.id === presetId)) throw new ErreurMetier("Tarif introuvable.", 404);
  await prisma.$transaction(
    tous
      .map((p) => {
        const avant = lirePrestationsDuTarif(p.prestations);
        const sans = avant.filter((c) => c !== cle);
        const apres = p.id === presetId ? [...sans, cle] : sans;
        return JSON.stringify(apres) === JSON.stringify(avant) ? null : prisma.presetTarif.update({ where: { id: p.id }, data: { prestations: JSON.stringify(apres) } });
      })
      .filter((op): op is NonNullable<typeof op> => op !== null)
  );
}
