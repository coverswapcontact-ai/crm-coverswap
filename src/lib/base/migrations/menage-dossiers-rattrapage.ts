import { archiverDossierAvec } from "@/lib/dossiers/archivage";
import type { MigrationDonnees } from "./index";

/**
 * Ménage demandé par Lucas le 21/09/2026 (nuit) : le rattrapage des simulations
 * du 21/09 avait ouvert d'office un dossier « Qualification » à chaque lead du
 * simulateur jamais traité. Ils encombrent Dossiers : ils sont archivés, et
 * leurs leads reviennent dans Leads avec leurs simulations et leurs photos
 * (voir dossiers/archivage.ts). Rien n'est supprimé ; chaque dossier se restaure.
 *
 * Liste EXPLICITE, relevée en production le 21/09/2026 au soir (lecture seule)
 * puis relue : 26 dossiers, tous en Qualification, prochaine action « Appeler :
 * simulation faite sur le site », une seule note (celle d'ouverture), aucun
 * document, aucun appel, aucun espace client. Aucun motif de recherche ne
 * s'applique à l'aveugle au démarrage, et un dossier de la liste qui aurait
 * bougé depuis (étape, document, paiement, appel, espace ouvert par le client)
 * est laissé tel quel. Gardés à la demande de Lucas : le dossier arrivé le
 * 21/09 qu'il a ouvert lui-même (S. E.), et l'autre lead Meta ouvert ce jour-là.
 */
const DOSSIERS_DU_RATTRAPAGE: readonly string[] = [
  "cmuavitqa00cur8pjhnn0n3km",
  "cmuavit8400byr8pjrhyiidj9",
  "cmuavit3g00bjr8pj8hp8nqw5",
  "cmuavisya00b2r8pj78nbwr90",
  "cmuavissi00anr8pj2elp6oj3",
  "cmuavisn000a8r8pjr2jvdw4q",
  "cmuavisha009vr8pjat4ens4b",
  "cmuavisco009ir8pjgp27l37y",
  "cmuavis7w0095r8pjvez2xbo3",
  "cmuavis2f008sr8pj2b6b6sba",
  "cmuavirqy0089r8pj3asmh6ei",
  "cmuavirkf007ur8pjfxl3d296",
  "cmuavirav007dr8pju85m5h5g",
  "cmuavir2i006yr8pjden9h2h8",
  "cmuaviqlb006jr8pjhe9wg7hu",
  "cmuaviqe30066r8pj0sg6s7mn",
  "cmuavipmj0050r8pj84jwlbfq",
  "cmuavipdz004lr8pjsf74g13e",
  "cmuavip5w0048r8pj7lqb4ics",
  "cmuavio0d002zr8pj0ufbr6jk",
  "cmuavin7f002ar8pjdbjdezom",
  "cmuavin1o001xr8pjws18wbtd",
  "cmuavimms001ir8pjz4mv42bw",
  "cmuavimcm0013r8pjswah5zz3",
  "cmuavim52000qr8pjmxjn3hvj",
  "cmuavilrq0002r8pjlsmqpcje",
];

const MOTIF = "Ouvert d'office par le rattrapage des simulations du 21/09/2026, jamais traité : le lead revient dans Leads";

export const migrationMenageDossiersRattrapage: MigrationDonnees = {
  nom: "menage-des-dossiers-du-rattrapage-22-09",
  description: "Archive les 26 dossiers ouverts d'office par le rattrapage des simulations ; leurs leads reviennent dans Leads avec simulations et photos",
  executer: async (client) => {
    let archives = 0;
    let dejaArchives = 0;
    let gardes = 0;
    let absents = 0;
    for (const id of DOSSIERS_DU_RATTRAPAGE) {
      const dossier = await client.dossier.findFirst({
        where: { id, archiveLe: undefined },
        select: {
          id: true, clientNom: true, etape: true, prochaineAction: true, archiveLe: true,
          espaces: { select: { premierAccesLe: true } },
          _count: { select: { documents: true, encaissements: true, depenses: true, accords: true, notes: true, evenements: { where: { type: { in: ["APPEL", "SMS_ENVOYE", "SMS_RECU", "MAIL_ENVOYE", "MAIL_RECU"] } } } } },
        },
      });
      if (!dossier) {
        absents++;
        continue;
      }
      if (dossier.archiveLe) {
        dejaArchives++;
        continue;
      }
      // Garde-fou : le dossier est toujours celui du relevé — intact, jamais travaillé.
      const intact =
        dossier.etape === "QUALIFICATION" &&
        /simulation faite sur le site/i.test(dossier.prochaineAction ?? "") &&
        dossier._count.documents + dossier._count.encaissements + dossier._count.depenses + dossier._count.accords + dossier._count.evenements === 0 &&
        dossier._count.notes <= 1 &&
        dossier.espaces.every((e) => !e.premierAccesLe);
      if (!intact) {
        gardes++;
        console.warn(`[menage] dossier ${id} (${dossier.clientNom}) a bougé depuis le relevé : laissé tel quel`);
        continue;
      }
      await archiverDossierAvec(client, id, MOTIF);
      archives++;
      console.log(`[menage] dossier du rattrapage archivé : ${id} — ${dossier.clientNom}`);
    }
    return { archives, dejaArchives, gardes, absents };
  },
};
