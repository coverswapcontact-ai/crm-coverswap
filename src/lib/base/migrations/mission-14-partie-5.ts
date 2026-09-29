import { pluriel } from "@/lib/commun/format";
import type { BaseDonnees } from "@/lib/prisma";
import { CATALOGUE_SMS, aUnInterrupteur, definitionSms } from "@/lib/sms/catalogue";
import { poserModelesParDefaut } from "@/lib/sms/modeles";
import type { MigrationDonnees } from "./index";

/**
 * Mission 14 (29/09/2026), partie 5 — un seul catalogue SMS (`sms/catalogue.ts`).
 *  - Les codes nouveaux (après un appel, relances de devis, nouveau lien) sont posés avec leur texte de départ.
 *  - Les textes de l'espace client sont réécrits selon les règles d'écriture (parler du projet, jamais promettre de
 *    simulation, le lien en dernier) : l'ancien texte reste dans le journal des modifications. Un texte déjà égal au
 *    nouveau n'est pas réécrit (rejouable) ; la migration ne tournant qu'une fois, un texte que Lucas modifie ensuite
 *    n'est jamais écrasé.
 *  - Les codes sans interrupteur (tout sauf les accusés et l'ancien circuit) sont remis actifs : leur texte est
 *    toujours lu (`texteDuCatalogue`), et l'écran n'a plus de bouton pour lever une ancienne coupure.
 *  - DEVIS_PRET et MERCI_ACCORD, lus par aucun code, sont archivés (rien ne se supprime).
 * Les accusés de réception et les modèles de l'ancien circuit de relances ne changent pas.
 */

const NOM = "catalogue-sms-14-5";
const REECRITS = ["LIEN_ESPACE", "LIEN_ESPACE_SIMULATION", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL", "SIMULATION_PRETE"] as const;
const ARCHIVES = ["DEVIS_PRET", "MERCI_ACCORD"] as const;
export const MOTIF_ARCHIVE_SMS = "Mission 14 : plus utilisé";

export async function unifierCatalogueSms(client: BaseDonnees, maintenant: Date = new Date()): Promise<Record<string, number>> {
  const crees = await poserModelesParDefaut(client);

  let reecrits = 0;
  for (const code of REECRITS) {
    const defaut = definitionSms(code)?.defaut;
    const ligne = await client.modeleSms.findUnique({ where: { code }, select: { id: true, texte: true } });
    if (!defaut || !ligne || ligne.texte === defaut) continue;
    await client.modeleSms.update({ where: { id: ligne.id }, data: { texte: defaut } });
    reecrits++;
  }

  // Les codes sans interrupteur (après un appel, espace client, relances) : une ancienne coupure (l'écran d'avant
  // proposait « Ne plus proposer » partout) n'a plus de bouton pour être levée ; on la lève ici.
  const sansInterrupteur = CATALOGUE_SMS.filter((d) => !aUnInterrupteur(d)).map((d) => d.code);
  const { count: reactives } = await client.modeleSms.updateMany({ where: { code: { in: sansInterrupteur }, actif: false }, data: { actif: true } });

  // `archiveLe` nommé dans le where : l'extension du journal ne cache rien, on ne touche que ce qui vit encore.
  const { count: archives } = await client.modeleSms.updateMany({ where: { code: { in: [...ARCHIVES] }, archiveLe: null }, data: { archiveLe: maintenant, archiveMotif: MOTIF_ARCHIVE_SMS } });

  console.info(
    `[migration ${NOM}] ${pluriel(crees, "code posé", "codes posés")}, ${pluriel(reecrits, "texte réécrit", "textes réécrits")}, ${pluriel(reactives, "coupure levée", "coupures levées")}, ${pluriel(archives, "modèle archivé", "modèles archivés")}`
  );
  return { crees, reecrits, reactives, archives };
}

export const migrationCatalogueSms14: MigrationDonnees = {
  nom: NOM,
  description:
    "Catalogue SMS unique : codes après un appel, relances de devis et nouveau lien posés ; textes de l'espace client réécrits (lien en dernier, sans promesse de simulation) ; codes sans interrupteur remis actifs ; DEVIS_PRET et MERCI_ACCORD archivés",
  executer: (client) => unifierCatalogueSms(client),
};
