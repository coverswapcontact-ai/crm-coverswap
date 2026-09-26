import { enregistrerConsignes, lireConsignes } from "@/lib/assistant/consignes";
import { cleNumero, lireNumero, prochainNumero } from "@/lib/dossiers/numerotation";
import { jourParis } from "@/lib/dossiers/dates";
import type { CleParametre } from "@/lib/parametres/definitions";
import { lireParametre, validerValeur } from "@/lib/parametres/service";
import type { MigrationDonnees } from "./index";

/**
 * Mission 12 (26/09/2026), phase 1 — corrections demandées par Lucas, jouées
 * une fois au démarrage, idempotentes, journalisées :
 * 1. numérotation : les trois devis faits hors CRM cette semaine sont au
 *    registre, et le compteur des devis 2026 repart à 2026-043 ;
 * 2. valeurs : réserve de trésorerie 3 000 €, 15 chantiers par mois, campagne
 *    Meta du 22/09/2026 (18 €/jour × 21 jours), consignes alignées ;
 * 3. ménage : les archives sans motif reçoivent « motif à renseigner », les
 *    tâches en échec définitif depuis plus de 7 jours sont abandonnées.
 */

const DEVIS_EXTERNES = [
  { numero: "2026-040", destinataire: "Beites Marie", montant: 440, note: "Devis fait hors CRM le 25/09/2026 (salle de bain)" },
  { numero: "2026-041", destinataire: "Fawzi FARES", montant: 1725, note: "Devis fait hors CRM le 25/09/2026 (façades cuisine)" },
  { numero: "2026-042", destinataire: "Fawzi FARES", montant: 2415, note: "Devis fait hors CRM le 25/09/2026 (façades + plan de travail)" },
] as const;
const COMPTEUR_DEVIS_CIBLE = 42; // le prochain devis est 2026-043
const EMIS_LE = new Date("2026-09-25T12:00:00.000Z");

export const migrationNumerotation2609: MigrationDonnees = {
  nom: "numerotation-devis-externes-26-09",
  description: "Inscrit au registre les devis 2026-040, 2026-041 et 2026-042 faits hors CRM s'ils n'y sont pas, et fait repartir le compteur des devis 2026 à 2026-043",
  executer: async (client) => {
    let inscrits = 0;
    let dejaInscrits = 0;
    for (const externe of DEVIS_EXTERNES) {
      const lu = lireNumero(externe.numero)!;
      const cle = cleNumero(lu.famille, lu.annee, lu.rang);
      if (await client.numeroDocument.findUnique({ where: { cle }, select: { id: true } })) {
        dejaInscrits++;
        continue;
      }
      await client.numeroDocument.create({ data: { cle, numero: externe.numero, famille: lu.famille, annee: lu.annee, rang: lu.rang, type: "DEVIS", origine: "MANUEL", emisLe: EMIS_LE, destinataire: externe.destinataire, montant: externe.montant, note: externe.note } });
      inscrits++;
    }
    const plusHaut = await client.numeroDocument.aggregate({ where: { annee: 2026, famille: "" }, _max: { rang: true } });
    const cible = Math.max(COMPTEUR_DEVIS_CIBLE, plusHaut._max.rang ?? 0);
    const ligne = await client.compteurNumerotation.findUnique({ where: { serie_annee: { serie: "DEVIS", annee: 2026 } } });
    const compteurAvant = ligne?.valeur ?? 0;
    if (!ligne) await client.compteurNumerotation.create({ data: { serie: "DEVIS", annee: 2026, valeur: cible } });
    else if (ligne.valeur < cible) await client.compteurNumerotation.update({ where: { serie_annee: { serie: "DEVIS", annee: 2026 } }, data: { valeur: cible } });
    const prochain = await prochainNumero("DEVIS", new Date("2026-09-26T12:00:00.000Z"));
    // Résumé en nombres (journal des migrations) : le prochain devis est 2026-<prochainRang>.
    return { inscrits, dejaInscrits, compteurAvant, compteurApres: Math.max(compteurAvant, cible), prochainRang: Number(prochain.split("-")[1]) };
  },
};

const VALEURS: { cle: CleParametre; valeur: number | string; valableDu: string; source: string }[] = [
  { cle: "TRESORERIE_RESERVE", valeur: 3000, valableDu: "2026-09-01", source: "Lucas, mission du 26/09/2026 (réserve de 3 000 €)" },
  { cle: "CAPACITE_CHANTIERS_MOIS", valeur: "15", valableDu: "2026-09-01", source: "Lucas, mission du 26/09/2026 (15 chantiers par mois)" },
  { cle: "CAMPAGNE_DEBUT", valeur: "2026-09-22", valableDu: "2026-09-22", source: "Lucas, mission du 26/09/2026 : campagne Meta lancée le 22/09/2026" },
  { cle: "CAMPAGNE_BUDGET", valeur: 378, valableDu: "2026-09-22", source: "Lucas, mission du 26/09/2026 : 18 €/jour × 21 jours" },
  { cle: "CAMPAGNE_DUREE_JOURS", valeur: 21, valableDu: "2026-09-22", source: "Lucas, mission du 26/09/2026" },
];
const CONSIGNE_CAPACITE = "- Capacité : 15 chantiers par mois au maximum (valeur tenue dans Paramètres → Pilotage de l'activité, CAPACITE_CHANTIERS_MOIS : c'est là que l'assistant la lit, pas ici).";
const CONSIGNE_RESERVE = "- Plancher de réserve : garder 3 000 € de trésorerie après provision URSSAF et charges à venir ; en dessous, aucune dépense non indispensable (valeur tenue dans Paramètres → Pilotage de l'activité, TRESORERIE_RESERVE).";

export const migrationValeursLucas2609: MigrationDonnees = {
  nom: "valeurs-lucas-26-09",
  description: "Pose les valeurs données par Lucas (réserve 3 000 €, 15 chantiers/mois, campagne Meta du 22/09/2026 : 18 €/jour × 21 jours) et aligne les deux lignes des consignes",
  executer: async (client) => {
    const reference = new Date("2026-09-26T12:00:00.000Z");
    let poses = 0;
    let dejaPoses = 0;
    for (const v of VALEURS) {
      const valeur = validerValeur(v.cle, v.valeur);
      const courante = await lireParametre(v.cle, reference);
      if (courante !== null && String(courante) === String(valeur)) {
        dejaPoses++;
        continue;
      }
      await client.parametre.create({ data: { cle: v.cle, valeur: JSON.stringify(valeur), valableDu: new Date(`${v.valableDu}T00:00:00.000Z`), source: v.source } });
      poses++;
    }
    const consignes = await lireConsignes();
    const texte = consignes.texte
      .replace(/^- Capacité : environ 8 chantiers par mois[^\n]*$/m, CONSIGNE_CAPACITE)
      .replace(/^- Plancher de réserve : garder 2 000 € de trésorerie[^\n]*$/m, CONSIGNE_RESERVE);
    const consignesModifiees = texte !== consignes.texte;
    if (consignesModifiees) await enregistrerConsignes(texte, "MIGRATION:valeurs-lucas-26-09", "Valeurs données par Lucas (26/09/2026) : capacité 15 chantiers, réserve 3 000 €");
    return { poses, dejaPoses, consignesModifiees: consignesModifiees ? 1 : 0 };
  },
};

export const MOTIF_A_RENSEIGNER = "motif à renseigner";
const JOUR_MS = 24 * 60 * 60_000;

export const migrationMenage2609: MigrationDonnees = {
  nom: "menage-archives-et-taches-26-09",
  description: "« motif à renseigner » sur les dossiers et leads archivés sans motif ; tâches en échec définitif depuis plus de 7 jours abandonnées, avec la raison",
  executer: async (client) => {
    const dossiers = await client.dossier.updateMany({ where: { archiveLe: { not: null }, OR: [{ archiveMotif: null }, { archiveMotif: "" }] }, data: { archiveMotif: MOTIF_A_RENSEIGNER } });
    const leads = await client.lead.updateMany({ where: { archiveLe: { not: null }, OR: [{ archiveMotif: null }, { archiveMotif: "" }] }, data: { archiveMotif: MOTIF_A_RENSEIGNER } });
    const maintenant = new Date();
    const limite = new Date(maintenant.getTime() - 7 * JOUR_MS);
    const taches = await client.tache.findMany({ where: { statut: "ECHEC_DEFINITIF", updatedAt: { lt: limite } }, select: { id: true, type: true, tentatives: true, tentativesMax: true, updatedAt: true, derniereErreur: true } });
    const parType: Record<string, number> = {};
    for (const tache of taches) {
      const raison = tache.tentatives >= tache.tentativesMax ? `${tache.tentatives} tentative(s) sur ${tache.tentativesMax}, toutes en échec` : `${tache.tentatives} tentative(s), erreur définitive`;
      await client.tache.update({
        where: { id: tache.id },
        data: {
          statut: "ANNULEE",
          termineLe: maintenant,
          derniereErreur: `Abandonnée le ${jourParis(maintenant)} (ménage du 26/09/2026) : en échec depuis le ${jourParis(tache.updatedAt)}, ${raison} ; elle ne se relancera pas seule. Dernière erreur : ${tache.derniereErreur ?? "—"}`.slice(0, 2000),
        },
      });
      parType[tache.type] = (parType[tache.type] ?? 0) + 1;
    }
    return { dossiersSansMotif: dossiers.count, leadsSansMotif: leads.count, tachesAbandonnees: taches.length, ...Object.fromEntries(Object.entries(parType).map(([type, n]) => [`abandonnees_${type}`, n])) };
  },
};
