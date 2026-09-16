import { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { PRESETS_DEPART, UNITES, type Unite } from "./constants";
import { ErreurMetier } from "./erreurs";
import { versCentimes } from "./montants";
import type { PresetVue } from "./types";

// Presets de tarifs du générateur. Les valeurs de départ (PRESETS_DEPART)
// sont écrites au premier affichage, avec des identifiants fixes : deux
// premiers chargements simultanés ne peuvent pas les doubler. Un preset retiré
// est archivé (actif = false), jamais effacé : la table n'est donc plus jamais
// vide et les valeurs de départ ne reviennent pas.

export const schemaPreset = z.object({
  designation: z
    .string("Désignation invalide.")
    .trim()
    .min(1, "La désignation est obligatoire.")
    .max(200, "Désignation trop longue : 200 caractères maximum."),
  unite: z.enum(UNITES, "Unité invalide."),
  prixUnitaire: z
    .number("Prix unitaire invalide.")
    .min(0, "Un prix unitaire ne peut pas être négatif.")
    .max(1_000_000, "Prix unitaire invalide.")
    .nullable()
    .transform((valeur) => (valeur === null ? null : versCentimes(valeur) / 100)),
});
export type EntreePreset = z.output<typeof schemaPreset>;

function versVue(preset: { id: string; designation: string; unite: string; prixUnitaire: number | null }): PresetVue {
  return {
    id: preset.id,
    designation: preset.designation,
    unite: preset.unite as Unite,
    prixUnitaire: preset.prixUnitaire,
  };
}

async function amorcerPresets(): Promise<void> {
  if ((await prisma.presetTarif.count()) > 0) return;
  try {
    await prisma.presetTarif.createMany({
      data: PRESETS_DEPART.map((preset, index) => ({
        id: `preset-depart-${String(index + 1).padStart(2, "0")}`,
        designation: preset.designation,
        unite: preset.unite,
        prixUnitaire: preset.prixUnitaire,
        ordre: index,
      })),
    });
  } catch (erreur) {
    // Un chargement simultané vient d'écrire les mêmes presets.
    if (!(erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002")) throw erreur;
  }
}

export async function listerPresets(): Promise<PresetVue[]> {
  await amorcerPresets();
  const presets = await prisma.presetTarif.findMany({
    where: { actif: true },
    orderBy: [{ ordre: "asc" }, { createdAt: "asc" }],
  });
  return presets.map(versVue);
}

export async function creerPreset(entree: EntreePreset): Promise<PresetVue> {
  const dernier = await prisma.presetTarif.findFirst({ orderBy: { ordre: "desc" }, select: { ordre: true } });
  const preset = await prisma.presetTarif.create({ data: { ...entree, ordre: (dernier?.ordre ?? -1) + 1 } });
  return versVue(preset);
}

async function presetActif(presetId: string) {
  const preset = await prisma.presetTarif.findUnique({ where: { id: presetId } });
  if (!preset || !preset.actif) throw new ErreurMetier("Tarif introuvable.", 404);
  return preset;
}

export async function modifierPreset(presetId: string, entree: Partial<EntreePreset>): Promise<PresetVue> {
  await presetActif(presetId);
  return versVue(await prisma.presetTarif.update({ where: { id: presetId }, data: entree }));
}

export async function archiverPreset(presetId: string): Promise<void> {
  await presetActif(presetId);
  await prisma.presetTarif.update({ where: { id: presetId }, data: { actif: false } });
}
