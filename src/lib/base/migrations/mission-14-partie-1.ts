import { PROCHAINE_ACTION_APRES_DEVIS, PROCHAINE_ACTION_PREPARER_DEVIS } from "@/lib/dossiers/constants";
import { passerEnDevisEnvoye, STATUTS_DEVIS_ENVOYE } from "@/lib/dossiers/devis-envoye";
import { recalculerMain } from "@/lib/dossiers/main";
import { objetDepuisProjet } from "@/lib/dossiers/objet";
import { effetsDuChangementEtape } from "@/lib/dossiers/transitions";
import { lireProjet } from "@/lib/espace/projet";
import { lireSelection } from "@/lib/prestations/prestations";
import type { MigrationDonnees } from "./index";

/**
 * Mission 14 (29/09/2026), partie 1 — qui a la main : le rattrapage des dossiers
 * existants, joué une fois au démarrage (sauvegarde automatique avant),
 * idempotent :
 * a) un dossier resté en Qualification ou Simulation alors qu'un devis visible
 *    est émis ou déposé passe en « Devis envoyé » (la règle R1 : même fonction
 *    que le dépôt) ; « Préparer le devis » devient « Attendre l'accord … ».
 *    Sauf si Lucas l'y a ramené (retour en arrière) après ce devis ;
 * b) l'objet écrit à la main (journal HUMAIN/ASSISTANT, modifications de
 *    l'assistant) est marqué `objetManuelLe` — pas l'objet de la famille posé
 *    sur un objet vide par une validation faite depuis le CRM ; les autres
 *    dossiers dont le projet est validé dans l'espace prennent l'objet de ce
 *    projet (R3) ;
 * c) la main est recalculée partout (R2 : un message du client sans réponse
 *    me l'épingle).
 * Une ligne par dossier corrigé dans les journaux (id et nom : les journaux de
 * Railway sont privés, le dépôt ne nomme personne).
 */

const RAISON = "Devis déjà envoyé : rattrapage (mission 14)";

/** Un objet tel que le système l'écrit (objetDepuisFamilles, objetDepuisProjet) : « Recouvrement de … », « Recouvrement : … ». */
const OBJET_DU_SYSTEME = /^Recouvrement( de | : )/;

const lireJson = (json: string | null): Record<string, unknown> => {
  try {
    const valeur: unknown = JSON.parse(json ?? "{}");
    return valeur && typeof valeur === "object" ? (valeur as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const migrationQuiALaMain14: MigrationDonnees = {
  nom: "qui-a-la-main-14-1",
  description: "Dossiers restés avant « Devis envoyé » malgré un devis visible, objet suivant la famille validée (sauf écrit à la main), main recalculée (message du client sans réponse)",
  executer: async (client) => {
    // a) Étape : un devis visible, émis ou déposé, veut dire « Devis envoyé ».
    const enRetard = await client.dossier.findMany({
      where: {
        archiveLe: null,
        etape: { in: ["QUALIFICATION", "SIMULATION"] },
        documents: { some: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: [...STATUTS_DEVIS_ENVOYE] }, visibleEspace: true } },
      },
      select: {
        id: true,
        clientNom: true,
        documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: [...STATUTS_DEVIS_ENVOYE] }, visibleEspace: true }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { metadata: true, createdAt: true } },
      },
    });
    let etapesCorrigees = 0;
    let actionsCorrigees = 0;
    let retoursGardes = 0;
    for (const d of enRetard) {
      // Lucas l'a ramené là exprès (retour en arrière) alors que le devis existait déjà : son choix est gardé.
      const dernier = d.evenements[0];
      if (dernier && lireJson(dernier.metadata).nature === "RETOUR" && d.documents[0] && dernier.createdAt.getTime() >= d.documents[0].createdAt.getTime()) {
        retoursGardes++;
        continue;
      }
      const changement = await client.$transaction((tx) => passerEnDevisEnvoye(tx, d.id, { depuis: ["QUALIFICATION", "SIMULATION"], raison: RAISON }));
      if (!changement) continue;
      etapesCorrigees++;
      const { count } = await client.dossier.updateMany({ where: { id: d.id, prochaineAction: { startsWith: PROCHAINE_ACTION_PREPARER_DEVIS } }, data: { prochaineAction: PROCHAINE_ACTION_APRES_DEVIS, prochaineActionDate: null } });
      actionsCorrigees += count;
      // Le lead d'origine suit l'étape ; un rattrapage n'envoie rien à Meta (nature « reprise » pour les effets seulement).
      await effetsDuChangementEtape({ ...changement, nature: "REPRISE" });
      console.info(`[migration qui-a-la-main-14-1] étape ${changement.de} → ${changement.vers} : dossier ${d.id} (${d.clientNom})`);
    }

    // b) Objet écrit à la main : d'après le journal (écran, cartes d'un mail) et les modifications de l'assistant.
    const manuels = new Map<string, Date>();
    const noter = (dossierId: string, le: Date) => {
      const deja = manuels.get(dossierId);
      if (!deja || deja.getTime() < le.getTime()) manuels.set(dossierId, le);
    };
    const journal = await client.journalModification.findMany({
      where: { modele: "Dossier", operation: "MODIFICATION", OR: [{ acteur: { startsWith: "HUMAIN:" } }, { acteur: { startsWith: "ASSISTANT:" } }] },
      select: { enregistrementId: true, horodatage: true, avant: true, apres: true },
    });
    for (const ligne of journal) {
      const avant = lireJson(ligne.avant).objet;
      const apres = lireJson(ligne.apres).objet;
      if (typeof apres !== "string" || avant === apres) continue;
      // Écrit par le système dans la session de Lucas : un projet validé par lui depuis le CRM remplissait un objet vide
      // (mission 13, B3) avec l'objet de la famille. Ce n'est pas une écriture à la main.
      if ((typeof avant !== "string" || !avant.trim()) && OBJET_DU_SYSTEME.test(apres)) continue;
      noter(ligne.enregistrementId, ligne.horodatage);
    }
    const modifications = await client.modificationDossier.findMany({ where: { champs: { contains: '"champ":"objet"' } }, select: { dossierId: true, createdAt: true } });
    for (const m of modifications) noter(m.dossierId, m.createdAt);
    let objetsManuels = 0;
    for (const [dossierId, le] of manuels) {
      const { count } = await client.dossier.updateMany({ where: { id: dossierId, objetManuelLe: null }, data: { objetManuelLe: le } });
      objetsManuels += count;
    }

    // … puis l'objet suit le projet validé dans l'espace, pour les dossiers dont personne n'a écrit l'objet.
    const espaces = await client.espaceClient.findMany({
      where: { projetValideLe: { not: null }, dossier: { archiveLe: null, objetManuelLe: null } },
      select: { souhaits: true, dossier: { select: { id: true, clientNom: true, objet: true, prestations: true, lead: { select: { typeProjet: true } } } } },
    });
    let objetsCorriges = 0;
    for (const e of espaces) {
      const objet = objetDepuisProjet(lireProjet(e.souhaits, lireSelection(e.dossier.prestations), e.dossier.lead?.typeProjet));
      if (!objet || objet === e.dossier.objet) continue;
      await client.dossier.update({ where: { id: e.dossier.id }, data: { objet } });
      objetsCorriges++;
      console.info(`[migration qui-a-la-main-14-1] objet « ${e.dossier.objet} » → « ${objet} » : dossier ${e.dossier.id} (${e.dossier.clientNom})`);
    }

    // c) La main, recalculée partout où quelqu'un a la main.
    const vivants = await client.dossier.findMany({ where: { archiveLe: null, etape: { notIn: ["PERDU", "ENCAISSE"] } }, select: { id: true, clientNom: true, main: true, mainMotif: true } });
    let mainsChangees = 0;
    for (const d of vivants) {
      const calcul = await recalculerMain(d.id);
      if (!calcul || (calcul.qui === d.main && calcul.motif === d.mainMotif)) continue;
      mainsChangees++;
      console.info(`[migration qui-a-la-main-14-1] main ${d.main ?? "—"} (${d.mainMotif ?? "—"}) → ${calcul.qui ?? "—"} (${calcul.motif}) : dossier ${d.id} (${d.clientNom})`);
    }

    return { etapesCorrigees, actionsCorrigees, retoursGardes, objetsManuels, objetsCorriges, dossiersRelus: vivants.length, mainsChangees };
  },
};
