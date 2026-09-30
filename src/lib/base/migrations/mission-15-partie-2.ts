import { pluriel } from "@/lib/commun/format";
import type { BaseDonnees } from "@/lib/prisma";
import { promptsParDefautGeneres } from "@/lib/simulateur/moteur/generer-prompts";
import type { MigrationDonnees } from "./index";

/**
 * Mission 15 (30/09/2026), partie 2 — la bibliothèque de prompts ChatGPT est désormais GÉNÉRÉE par le moteur de
 * prompt (« studio »). Les prompts déjà en base gardent leur histoire : sur chaque prompt que Lucas n'a JAMAIS
 * modifié (toutes les versions signées CoverSwap), une version de plus est posée avec le texte du moteur et mise en
 * service ; un prompt modifié par Lucas n'est pas touché (il pourra restaurer ou copier le nouveau texte depuis
 * Simulateur → Prompts). Un prompt absent sera posé par `poserPromptsParDefaut` avec le nouveau texte. Rejouable : un
 * prompt dont la version en service est déjà le texte du moteur n'est pas touché.
 */

const NOM = "prompts-studio-15-2";
const AUTEUR = "CoverSwap (moteur studio, mission 15)";

export async function poserVersionsStudio(client: BaseDonnees): Promise<Record<string, number>> {
  const generes = promptsParDefautGeneres();
  const prompts = await client.promptSimulation.findMany({ include: { versions: { orderBy: { numero: "desc" } } } });
  let posees = 0;
  let laissees = 0;
  for (const prompt of prompts) {
    const genere = generes[prompt.typeSurface];
    if (!genere) continue;
    const courante = prompt.versions.find((v) => v.numero === prompt.versionCourante) ?? prompt.versions[0];
    if (courante?.texte === genere.texte) continue;
    const modifieParLucas = prompt.versions.some((v) => !/^CoverSwap/.test(v.auteur ?? ""));
    if (modifieParLucas) {
      laissees++;
      continue;
    }
    const numero = (prompt.versions[0]?.numero ?? 0) + 1;
    await client.$transaction([
      client.promptSimulationVersion.create({ data: { promptId: prompt.id, numero, texte: genere.texte, note: genere.note, auteur: AUTEUR } }),
      client.promptSimulation.update({ where: { id: prompt.id }, data: { versionCourante: numero } }),
    ]);
    posees++;
  }
  console.info(`[migration ${NOM}] ${pluriel(posees, "prompt passé au moteur studio", "prompts passés au moteur studio")}, ${pluriel(laissees, "prompt modifié par Lucas laissé tel quel", "prompts modifiés par Lucas laissés tels quels")}`);
  return { posees, laissees };
}

export const migrationPromptsStudio15: MigrationDonnees = {
  nom: NOM,
  description: "Bibliothèque ChatGPT : une version « Moteur studio » mise en service sur chaque prompt jamais modifié (mission 15, partie 2)",
  executer: (client) => poserVersionsStudio(client),
};
