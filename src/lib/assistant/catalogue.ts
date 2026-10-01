import { outilManagerClients } from "./analyses/clients";
import { outilManagerCommercial } from "./analyses/commercial";
import { outilManagerFinances } from "./analyses/finances";
import { outilManagerMarketing } from "./analyses/marketing";
import { outilManagerOperations } from "./analyses/operations";
import { LIBELLES_NIVEAU, type DefinitionOutil, type NiveauOutil } from "./definition";
import { OUTILS_ANALYTIQUE } from "./outils/analytique";
import { OUTILS_DOCUMENTS } from "./outils/documents";
import { OUTILS_ECRITURE } from "./outils/ecriture";
import { OUTILS_ESPACE_ECRITURE } from "./outils/espace";
import { OUTILS_ETAT } from "./outils/etat";
import { OUTILS_FICHIERS } from "./outils/fichiers";
import { OUTILS_GENERIQUES } from "./outils/generiques";
import { OUTILS_GESTES } from "./outils/gestes";
import { OUTILS_LECTURE } from "./outils/lecture";
import { OUTILS_LISTER } from "./outils/lister";
import { OUTILS_MAIL } from "./outils/mail";
import { OUTILS_RELANCES_ECRITURE } from "./outils/relances";
import { OUTILS_SIMULATION } from "./outils/simulation";
import { OUTILS_SMS } from "./outils/sms";
import { OUTILS_TACHES_ECRITURE, OUTILS_TACHES_LECTURE } from "./outils/taches";
import { outilPointDuJour } from "./outils/point-du-jour";
import { OUTILS_RETIRES } from "./retraits";

/**
 * Le catalogue des outils de l'assistant (mission 8) : lecture, point du
 * jour, écriture, et les cinq « managers » d'analyse. Mission 17 (partie C) :
 * les outils génériques (creer, modifier, archiver, restaurer, lister,
 * etat_crm, fichiers, gestes) remplacent 45 outils d'un seul geste
 * (correspondance : docs/MCP-COUVERTURE.md § 4.14 et `OUTILS_RETIRES`). C'est cette liste que
 * le serveur MCP expose, et que l'écran Paramètres montre avec le niveau de
 * chacun. Un outil s'ajoute ici et nulle part ailleurs.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OutilQuelconque = DefinitionOutil<any>;

export const OUTILS_ANALYSE: OutilQuelconque[] = [outilManagerCommercial, outilManagerFinances, outilManagerMarketing, outilManagerClients, outilManagerOperations];

export const CATALOGUE: OutilQuelconque[] = [
  // Lecture
  ...OUTILS_LECTURE, // chercher, lire_fiche
  ...OUTILS_LISTER, // lister
  ...OUTILS_FICHIERS.filter((o) => o.niveau === "LECTURE"), // voir_fichiers
  ...OUTILS_ETAT, // etat_crm
  ...OUTILS_TACHES_LECTURE, // taches
  ...OUTILS_ANALYTIQUE, // analytique
  outilPointDuJour,
  ...OUTILS_ANALYSE,
  ...OUTILS_MAIL,
  // Écriture
  ...OUTILS_GENERIQUES, // creer, modifier, annuler_modification, archiver, restaurer
  ...OUTILS_FICHIERS.filter((o) => o.niveau !== "LECTURE"), // lien_depot, ajouter_fichier, ranger_fichier
  ...OUTILS_ECRITURE,
  ...OUTILS_SMS,
  ...OUTILS_DOCUMENTS,
  ...OUTILS_RELANCES_ECRITURE,
  ...OUTILS_ESPACE_ECRITURE,
  ...OUTILS_SIMULATION,
  ...OUTILS_GESTES, // publier, traiter_mail, geste_espace, doublon, anonymiser_client, agir_systeme
  ...OUTILS_TACHES_ECRITURE, // repondre_tache
];

// Mission 17 (partie C) : un outil retiré ne revient jamais sous le même nom (les consignes en base le traduisent).
const revenus = CATALOGUE.map((o) => o.nom).filter((nom) => nom in OUTILS_RETIRES);
if (revenus.length) throw new Error(`Catalogue de l'assistant : outils retirés encore exposés (${revenus.join(", ")}).`);

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
