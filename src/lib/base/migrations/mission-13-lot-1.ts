import { completerCoordonnees } from "@/lib/clients/identification";
import { PROCHAINE_ACTION_APRES_DEVIS, PROCHAINE_ACTION_PREPARER_DEVIS } from "@/lib/dossiers/constants";
import { lireProjet } from "@/lib/espace/projet";
import { complementDuDossier } from "@/lib/espace/validations";
import { lireParametre, validerValeur } from "@/lib/parametres/service";
import { lireSelection } from "@/lib/prestations/prestations";
import { DELAI_RELANCE_DEFAUT_JOURS } from "@/lib/relances/service";
import type { MigrationDonnees } from "./index";

/**
 * Mission 13 (26/09/2026), lot 1 — les corrections de l'audit qui touchent des
 * données existantes, jouées une fois au démarrage (sauvegarde automatique
 * avant), idempotentes, journalisées :
 * 1. B1 : « Préparer le devis » remplacé par « Attendre l'accord … » sur les
 *    dossiers qui ont déjà un devis rattaché (Beites, Fares) ;
 * 2. B2 : la fiche de chaque client reçoit l'e-mail et le téléphone de ses dossiers ;
 * 3. B3 : objet et source d'un dossier d'après le projet validé dans l'espace ;
 * 4. B16 : DELAI_RELANCE_DEVIS posé à 5 jours s'il ne l'est pas.
 */

export const migrationProchaineActionDevis13: MigrationDonnees = {
  nom: "prochaine-action-devis-depose-13-1",
  description: "Les dossiers restés sur « Préparer le devis » alors qu'un devis est rattaché passent à « Attendre l'accord du client sur le devis »",
  executer: async (client) => {
    const dossiers = await client.dossier.findMany({
      where: { archiveLe: null, prochaineAction: { startsWith: PROCHAINE_ACTION_PREPARER_DEVIS }, documents: { some: { type: "DEVIS", numero: { not: null }, archiveLe: null, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } } } },
      select: { id: true, prochaineAction: true },
    });
    for (const d of dossiers) {
      await client.dossier.update({ where: { id: d.id }, data: { prochaineAction: PROCHAINE_ACTION_APRES_DEVIS, prochaineActionDate: null } });
      await client.dossierEvenement.create({
        data: {
          dossierId: d.id,
          type: "COHERENCE_CORRIGEE",
          direction: "INTERNE",
          contenu: `Prochaine action « ${d.prochaineAction} » remplacée par « ${PROCHAINE_ACTION_APRES_DEVIS} » : un devis est rattaché (mission 13, 26/09/2026)`,
          metadata: JSON.stringify({ code: "PROCHAINE_ACTION_PERIMEE", migration: "prochaine-action-devis-depose-13-1" }),
        },
      });
    }
    return { corriges: dossiers.length };
  },
};

export const migrationCoordonneesVersFiche13: MigrationDonnees = {
  nom: "coordonnees-dossier-vers-fiche-13-1",
  description: "La fiche de chaque client reçoit l'e-mail et le téléphone connus de ses dossiers en cours (rien n'est retiré)",
  executer: async (client) => {
    const dossiers = await client.dossier.findMany({
      where: { clientId: { not: null }, OR: [{ clientEmail: { not: null } }, { clientTelephone: { not: "" } }] },
      select: { clientId: true, clientEmail: true, clientTelephone: true },
    });
    const compter = async () => (await client.clientEmail.count()) + (await client.clientTelephone.count());
    const avant = await compter();
    for (const d of dossiers) await completerCoordonnees(client, d.clientId!, { emails: [d.clientEmail], telephones: [d.clientTelephone] });
    return { dossiersLus: dossiers.length, coordonneesAjoutees: (await compter()) - avant };
  },
};

export const migrationObjetDepuisProjet13: MigrationDonnees = {
  nom: "objet-et-source-depuis-projet-valide-13-1",
  description: "Les dossiers sans objet ou sans source dont le client a validé son projet dans l'espace reçoivent l'objet de la famille validée et la source « espace client »",
  executer: async (client) => {
    const espaces = await client.espaceClient.findMany({
      where: { projetValideLe: { not: null }, dossier: { OR: [{ objet: "" }, { source: "INCONNUE" }] } },
      select: { souhaits: true, dossier: { select: { id: true, objet: true, source: true, prestations: true, lead: { select: { typeProjet: true } } } } },
    });
    let objetsPoses = 0;
    let sourcesPosees = 0;
    for (const e of espaces) {
      const projet = lireProjet(e.souhaits, lireSelection(e.dossier.prestations), e.dossier.lead?.typeProjet);
      const complement = complementDuDossier(e.dossier, projet);
      if (!complement) continue;
      await client.dossier.update({ where: { id: e.dossier.id }, data: complement });
      if (complement.objet) objetsPoses++;
      if (complement.source) sourcesPosees++;
    }
    return { espacesLus: espaces.length, objetsPoses, sourcesPosees };
  },
};

export const migrationDelaiRelance13: MigrationDonnees = {
  nom: "delai-relance-5-jours-13-1",
  description: "Pose DELAI_RELANCE_DEVIS = 5 jours s'il n'est pas renseigné (la valeur par défaut du code)",
  executer: async (client) => {
    if ((await lireParametre("DELAI_RELANCE_DEVIS", new Date())) !== null) return { pose: 0, dejaPose: 1 };
    await client.parametre.create({
      data: {
        cle: "DELAI_RELANCE_DEVIS",
        valeur: JSON.stringify(validerValeur("DELAI_RELANCE_DEVIS", DELAI_RELANCE_DEFAUT_JOURS)),
        valableDu: new Date("2026-09-26T00:00:00.000Z"),
        source: "Mission 13 (26/09/2026) : 5 jours, la valeur par défaut du code",
      },
    });
    return { pose: 1, dejaPose: 0 };
  },
};
