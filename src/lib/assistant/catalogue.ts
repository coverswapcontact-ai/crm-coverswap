import { outilManagerClients } from "./analyses/clients";
import { outilManagerCommercial } from "./analyses/commercial";
import { outilManagerFinances } from "./analyses/finances";
import { outilManagerMarketing } from "./analyses/marketing";
import { outilManagerOperations } from "./analyses/operations";
import { LIBELLES_NIVEAU, type DefinitionOutil, type NiveauOutil } from "./definition";
import { OUTILS_ACTIONS } from "./outils/actions";
import { OUTILS_CATALOGUE } from "./outils/catalogue-outils";
import { OUTILS_CONTACTS } from "./outils/contacts";
import { OUTILS_DOCUMENTS } from "./outils/documents";
import { OUTILS_PARAMETRES_ECRITURE, OUTILS_PARAMETRES_LECTURE } from "./outils/parametres";
import { OUTILS_PUBLICITE } from "./outils/publicite";
import { OUTILS_RELANCES_ECRITURE, OUTILS_RELANCES_LECTURE } from "./outils/relances";
import { OUTILS_SITE } from "./outils/site";
import { OUTILS_DEPENSES } from "./outils/depenses";
import { OUTILS_ECRITURE } from "./outils/ecriture";
import { OUTILS_ESPACE_ECRITURE, OUTILS_ESPACE_LECTURE } from "./outils/espace";
import { OUTILS_IMAGES } from "./outils/images";
import { OUTILS_LECTURE } from "./outils/lecture";
import { OUTILS_MAIL } from "./outils/mail";
import { OUTILS_REGLAGES_ECRITURE, OUTILS_REGLAGES_LECTURE } from "./outils/reglages";
import { OUTILS_SIMULATION } from "./outils/simulation";
import { outilPointDuJour } from "./outils/point-du-jour";

/**
 * Le catalogue des outils de l'assistant (mission 8) : lecture, point du
 * jour, écriture, et les cinq « managers » d'analyse. C'est cette liste que
 * le serveur MCP expose, et que l'écran Paramètres montre avec le niveau de
 * chacun. Un outil s'ajoute ici et nulle part ailleurs.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OutilQuelconque = DefinitionOutil<any>;

export const OUTILS_ANALYSE: OutilQuelconque[] = [outilManagerCommercial, outilManagerFinances, outilManagerMarketing, outilManagerClients, outilManagerOperations];

export const CATALOGUE: OutilQuelconque[] = [
  ...OUTILS_LECTURE,
  ...OUTILS_IMAGES,
  ...OUTILS_SITE,
  ...OUTILS_ESPACE_LECTURE,
  ...OUTILS_DEPENSES,
  ...OUTILS_REGLAGES_LECTURE,
  ...OUTILS_PARAMETRES_LECTURE,
  ...OUTILS_RELANCES_LECTURE,
  ...OUTILS_PUBLICITE,
  ...OUTILS_CATALOGUE,
  outilPointDuJour,
  ...OUTILS_ANALYSE,
  ...OUTILS_MAIL,
  ...OUTILS_ECRITURE,
  ...OUTILS_DOCUMENTS,
  ...OUTILS_CONTACTS,
  ...OUTILS_ACTIONS,
  ...OUTILS_ESPACE_ECRITURE,
  ...OUTILS_SIMULATION,
  ...OUTILS_REGLAGES_ECRITURE,
  ...OUTILS_PARAMETRES_ECRITURE,
  ...OUTILS_RELANCES_ECRITURE,
];

const doublons = CATALOGUE.map((o) => o.nom).filter((nom, i, liste) => liste.indexOf(nom) !== i);
if (doublons.length) throw new Error(`Catalogue de l'assistant : noms d'outils en double (${doublons.join(", ")}).`);

export function outilParNom(nom: string): OutilQuelconque | null {
  return CATALOGUE.find((o) => o.nom === nom) ?? null;
}

export type OutilVue = { nom: string; titre: string; description: string; niveau: NiveauOutil; libelleNiveau: string; famille: "LECTURE" | "ANALYSE" | "MAIL" | "ECRITURE" };

/** La liste lisible, pour l'écran Paramètres et le rapport. */
export function catalogueVue(): OutilVue[] {
  const famille = (o: OutilQuelconque): OutilVue["famille"] => (OUTILS_ANALYSE.includes(o) ? "ANALYSE" : OUTILS_MAIL.includes(o) ? "MAIL" : o.niveau === "LECTURE" ? "LECTURE" : "ECRITURE");
  return CATALOGUE.map((o) => ({ nom: o.nom, titre: o.titre, description: o.description, niveau: o.niveau, libelleNiveau: LIBELLES_NIVEAU[o.niveau], famille: famille(o) }));
}
