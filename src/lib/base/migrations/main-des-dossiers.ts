import type { EtapeDossier } from "@/lib/dossiers/constants";
import { mainSelonFaits, TYPES_MAIN } from "@/lib/dossiers/main";
import type { MigrationDonnees } from "./index";

/**
 * Mission 6 (22/09/2026) : « qui a la main » devient UNE règle, rangée sur le
 * dossier (dossiers/main.ts) et recalculée après chaque geste. Les dossiers
 * existants la reçoivent ici, calculée sur leurs événements déjà écrits
 * (publication, devis, lien, gestes du client, changements d'étape). Rien
 * d'autre n'est touché ; rejouable (le calcul redonne la même valeur).
 */
export const migrationMainDesDossiers: MigrationDonnees = {
  nom: "main-des-dossiers-22-09",
  description: "Range sur chaque dossier qui a la main (moi ou le client), d'après ses derniers gestes et son étape",
  executer: async (client) => {
    const compteurs = { moi: 0, client: 0, personne: 0 };
    const dossiers = await client.dossier.findMany({ select: { id: true, etape: true } });
    for (const d of dossiers) {
      const evenements = await client.dossierEvenement.findMany({
        where: { dossierId: d.id, archiveLe: null, type: { in: TYPES_MAIN } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 60,
        select: { type: true, direction: true, metadata: true, contenu: true, createdAt: true, survenuLe: true },
      });
      const calcul = mainSelonFaits({ etape: d.etape as EtapeDossier, evenements: evenements.map((e) => ({ ...e, le: e.survenuLe ?? e.createdAt })) });
      await client.dossier.update({ where: { id: d.id }, data: { main: calcul.qui, mainLe: calcul.le, mainMotif: calcul.motif } });
      if (calcul.qui === "MOI") compteurs.moi++;
      else if (calcul.qui === "CLIENT") compteurs.client++;
      else compteurs.personne++;
    }
    return compteurs;
  },
};
