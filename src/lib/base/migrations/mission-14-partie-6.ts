import { pluriel } from "@/lib/commun/format";
import { recalculerMain } from "@/lib/dossiers/main";
import { validerValeur } from "@/lib/parametres/service";
import type { BaseDonnees } from "@/lib/prisma";
import { DELAI_RELANCE_PHOTOS_DEFAUT_JOURS } from "@/lib/relances/photos";
import type { MigrationDonnees } from "./index";

/**
 * Mission 14 (29/09/2026), partie 6 — un seul circuit de relances.
 *  - Les modèles de l'ancien circuit (SMS proposés par le CRM puis envoyés par le fournisseur après validation) sont
 *    archivés : les relances sont désormais des SMS à copier (relance de devis, relance photos, SMS D après un appel).
 *    Les propositions « Envoyer un SMS » déjà en base ne sont pas touchées : elles restent validables jusqu'à leur
 *    expiration (leur texte est sur la proposition).
 *  - DELAI_RELANCE_PHOTOS est posé à 3 jours s'il n'a jamais été renseigné (la valeur par défaut du code).
 *  - Les dossiers dont la main porte un ancien motif de lien (« … en attente de ses photos et de son projet »,
 *    « … communiqué : en attente de ses photos ») sont relus : le motif devient générique, l'espace dit ce qui manque.
 * Rejouable : ce qui est déjà archivé, posé ou relu n'est plus compté.
 */

const NOM = "relances-un-circuit-14-6";
export const CODES_ANCIEN_CIRCUIT = ["INJOIGNABLE_J3", "RELANCE_PHOTOS", "RELANCE_SIMULATION", "RELANCE_DEVIS", "RELANCE_DEVIS_QUESTIONS", "RELANCE_DERNIERE"] as const;
export const MOTIF_ANCIEN_CIRCUIT = "Mission 14 : remplacé par les SMS à copier";
const MOTIFS_DE_LIEN_D_AVANT = ["Espace ouvert : en attente de ses photos et de son projet", "Lien de son espace communiqué : en attente de ses photos"];

export async function unSeulCircuit(client: BaseDonnees, maintenant: Date = new Date()): Promise<Record<string, number>> {
  // `archiveLe` nommé dans le where : l'extension du journal ne cache rien, on ne touche que ce qui vit encore.
  const { count: modelesArchives } = await client.modeleSms.updateMany({ where: { code: { in: [...CODES_ANCIEN_CIRCUIT] }, archiveLe: null }, data: { archiveLe: maintenant, archiveMotif: MOTIF_ANCIEN_CIRCUIT } });

  // Une valeur déjà saisie (à n'importe quelle date) n'est jamais doublée : le paramètre est immuable, Lucas le change par une nouvelle date.
  let delaiPose = 0;
  if ((await client.parametre.count({ where: { cle: "DELAI_RELANCE_PHOTOS" } })) === 0) {
    await client.parametre.create({
      data: {
        cle: "DELAI_RELANCE_PHOTOS",
        valeur: JSON.stringify(validerValeur("DELAI_RELANCE_PHOTOS", DELAI_RELANCE_PHOTOS_DEFAUT_JOURS)),
        valableDu: new Date("2026-09-29T00:00:00.000Z"),
        source: "Mission 14 : valeur de départ",
      },
    });
    delaiPose = 1;
  }

  const dossiers = await client.dossier.findMany({ where: { mainMotif: { in: MOTIFS_DE_LIEN_D_AVANT } }, select: { id: true } });
  let mainsRelues = 0;
  for (const dossier of dossiers) if (await recalculerMain(dossier.id)) mainsRelues++;

  console.info(
    `[migration ${NOM}] ${pluriel(modelesArchives, "modèle de l'ancien circuit archivé", "modèles de l'ancien circuit archivés")}, DELAI_RELANCE_PHOTOS ${delaiPose ? "posé à 3 jours" : "déjà renseigné"}, ${pluriel(mainsRelues, "main relue", "mains relues")}`
  );
  return { modelesArchives, delaiPose, mainsRelues };
}

export const migrationRelancesUnCircuit14: MigrationDonnees = {
  nom: NOM,
  description:
    "Un seul circuit de relances : modèles SMS de l'ancien circuit archivés (remplacés par les SMS à copier), DELAI_RELANCE_PHOTOS posé à 3 jours, mains des dossiers au motif de lien d'avant relues",
  executer: (client) => unSeulCircuit(client),
};
