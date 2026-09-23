import type { z } from "zod/v4";
import type { ResultatOutil } from "../definition";
import { CibleAmbigue, resoudreCible, schemaCible, texteAmbigu } from "./lecture";

/**
 * Le ciblage partagé par les outils d'écriture (missions 8 à 10) : une cible
 * désignée par un identifiant ou par un nom, résolue ou rendue ambiguë —
 * jamais un choix fait à la place de Lucas.
 */

export type Ids = Awaited<ReturnType<typeof resoudreCible>>;
export type Ciblage = { ids: Ids; ambigu?: undefined } | { ids?: undefined; ambigu: ResultatOutil };

export async function cibler(cible: z.output<typeof schemaCible>, type?: "CLIENT" | "LEAD" | "DOSSIER"): Promise<Ciblage> {
  try {
    return { ids: await resoudreCible(cible, type) };
  } catch (e) {
    if (e instanceof CibleAmbigue) return { ambigu: { texte: texteAmbigu(e), donnees: e.candidats } };
    throw e;
  }
}
