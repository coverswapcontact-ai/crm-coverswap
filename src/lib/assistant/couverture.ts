import { createHash } from "node:crypto";
import { CATALOGUE, OUTILS_ANALYSE, type OutilQuelconque } from "./catalogue";
import { LIBELLES_NIVEAU, type NiveauOutil } from "./definition";
import { OUTILS_MAIL } from "./outils/mail";

/**
 * Le registre des outils (mission 11) : dérivé du catalogue, jamais tenu à la
 * main. Il dit combien d'outils le serveur expose, lesquels, avec quels
 * paramètres, et porte une empreinte stable : la sonde /api/health la rend,
 * l'outil « lister_outils » aussi, et le test d'intégration compare ce que
 * « tools/list » expose à cette liste. Un outil ajouté au catalogue y est.
 */

export type FamilleOutil = "LECTURE" | "ANALYSE" | "MAIL" | "ECRITURE";
export type OutilRegistre = { nom: string; titre: string; niveau: NiveauOutil; libelleNiveau: string; famille: FamilleOutil; parametres: string[] };
export type Registre = { nombre: number; empreinte: string; outils: OutilRegistre[] };

function parametresDe(outil: OutilQuelconque): string[] {
  const forme = (outil.schema as unknown as { shape?: Record<string, unknown> }).shape;
  return forme ? Object.keys(forme).sort() : [];
}

export function familleDe(outil: OutilQuelconque): FamilleOutil {
  if (OUTILS_ANALYSE.includes(outil)) return "ANALYSE";
  if (OUTILS_MAIL.includes(outil)) return "MAIL";
  return outil.niveau === "LECTURE" ? "LECTURE" : "ECRITURE";
}

export function registreOutils(): Registre {
  const outils = CATALOGUE.map((o) => ({ nom: o.nom, titre: o.titre, niveau: o.niveau, libelleNiveau: LIBELLES_NIVEAU[o.niveau], famille: familleDe(o), parametres: parametresDe(o) })).sort((a, b) => a.nom.localeCompare(b.nom));
  const empreinte = createHash("sha256").update(JSON.stringify(outils.map((o) => [o.nom, o.niveau, o.parametres]))).digest("hex").slice(0, 12);
  return { nombre: outils.length, empreinte, outils };
}

/** Les noms exposés par « tools/list » comparés au catalogue : ce qui manque, ce qui est en trop. */
export function ecartAvecLeServeur(nomsExposes: string[]): { manquants: string[]; enTrop: string[] } {
  const attendus = new Set(CATALOGUE.map((o) => o.nom));
  const exposes = new Set(nomsExposes);
  return { manquants: [...attendus].filter((n) => !exposes.has(n)).sort(), enTrop: [...exposes].filter((n) => !attendus.has(n)).sort() };
}
