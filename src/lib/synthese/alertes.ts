import prisma from "@/lib/prisma";
import { lireDelaiRelance } from "@/lib/relances/service";
import { jourParis } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import type { Alerte } from "./types";

/**
 * Alertes calculées à la demande, jamais stockées : ce qui mérite un coup d'œil
 * aujourd'hui. Les seuils d'alerte (80 %, 30 jours…) sont des choix de lecture,
 * pas des règles fiscales : ils sont nommés ici.
 */

const JOUR_MS = 24 * 60 * 60_000;
export const SEUILS_ALERTE = {
  /** Un devis sans réponse au-delà de ce multiple du délai de relance. */
  multipleDelaiRelance: 2,
  retardFactureJours: 30,
  retardFactureUrgentJours: 60,
  seuilApprochePct: 80,
  /** Nouveaux dossiers des 30 derniers jours sous cette part de la moyenne des 180 précédents. */
  baisseActivitePct: 50,
  baisseAcceptationPoints: 20,
  decisionsMinimum: 5,
  /** Mission 10 : part du volume de la base utilisée. */
  disqueAttentionPct: 70,
  disqueUrgentPct: 85,
} as const;

export async function calculerAlertes(maintenant: Date = new Date(), options: { anonyme?: boolean } = {}): Promise<Alerte[]> {
  const alertes: Alerte[] = [];

  // Devis sans réponse
  // Mission 13 (B16) : le délai a une valeur par défaut (5 jours) ; plus d'alerte « non renseigné ».
  const { jours: delai } = await lireDelaiRelance(maintenant);
  {
    const limite = new Date(maintenant.getTime() - delai * SEUILS_ALERTE.multipleDelaiRelance * JOUR_MS);
    const enAttente = await prisma.dossier.findMany({
      where: { etape: { in: ["DEVIS_ENVOYE", "RELANCE"] }, documents: { some: { type: "DEVIS", statut: { in: ["GENERE", "ENVOYE"] }, dateEmission: { lt: limite } } } },
      select: { clientNom: true },
    });
    if (enAttente.length > 0) {
      alertes.push({
        code: "DEVIS_SANS_REPONSE",
        gravite: "ATTENTION",
        titre: `${enAttente.length} devis sans réponse depuis plus de ${Number(delai) * SEUILS_ALERTE.multipleDelaiRelance} jours`,
        // Mode anonymisé : aucun nom de client, même dans une alerte.
        detail: options.anonyme ? "Dossiers à relancer ou à clore." : enAttente.slice(0, 5).map((dossier) => dossier.clientNom).join(", ") + (enAttente.length > 5 ? "…" : ""),
        lien: "/dossiers",
      });
    }
  }

  // Factures impayées qui vieillissent, seuils approchés
  const tableau = await chargerTableauFinances(Number(jourParis(maintenant).slice(0, 4)), maintenant);
  const enRetard = tableau.encours.lignes.filter((ligne) => (ligne.joursRetard ?? 0) > SEUILS_ALERTE.retardFactureJours);
  if (enRetard.length > 0) {
    const reste = enRetard.reduce((total, ligne) => total + ligne.reste, 0);
    alertes.push({
      code: "FACTURES_IMPAYEES",
      gravite: enRetard.some((ligne) => (ligne.joursRetard ?? 0) > SEUILS_ALERTE.retardFactureUrgentJours) ? "URGENT" : "ATTENTION",
      titre: `${enRetard.length} facture${enRetard.length > 1 ? "s" : ""} impayée${enRetard.length > 1 ? "s" : ""} depuis plus de ${SEUILS_ALERTE.retardFactureJours} jours`,
      detail: `${formatMontant(reste)} : ${enRetard.slice(0, 4).map((ligne) => `${ligne.numero} (${ligne.joursRetard} j)`).join(", ")}`,
      lien: "/finances",
    });
  }
  if (tableau.seuils.etat === "OK") {
    for (const seuil of tableau.seuils.donnees.seuils) {
      const depasseProjection = seuil.projection !== null && seuil.projection > seuil.seuil;
      if (seuil.pourcentage >= SEUILS_ALERTE.seuilApprochePct || depasseProjection) {
        alertes.push({
          code: `SEUIL_${seuil.cle}`,
          gravite: seuil.pourcentage >= 100 ? "URGENT" : "ATTENTION",
          titre: `${seuil.libelle} : ${String(seuil.pourcentage).replace(".", ",")} % atteint`,
          detail: depasseProjection ? `Au rythme actuel, ${formatMontant(seuil.projection!)} au 31 décembre pour un seuil de ${formatMontant(seuil.seuil)}. À voir avec le comptable.` : `Seuil : ${formatMontant(seuil.seuil)}.`,
          lien: "/finances",
        });
      }
    }
  } else if (tableau.seuils.etat === "PARAMETRES") {
    alertes.push({ code: "PARAMETRES_SEUILS", gravite: "INFO", titre: "Seuils fiscaux non renseignés", detail: "La progression vers les seuils de TVA et du régime micro n'est pas suivie.", lien: "/finances" });
  }

  // Activité qui s'arrête
  const il30 = new Date(maintenant.getTime() - 30 * JOUR_MS);
  const il210 = new Date(maintenant.getTime() - 210 * JOUR_MS);
  const [recents, anterieurs] = await Promise.all([
    // À la date réelle d'ouverture : un dossier repris d'avant le CRM ne gonfle pas le mois de sa saisie.
    prisma.dossier.count({ where: { OR: [{ ouvertLe: { gte: il30 } }, { ouvertLe: null, createdAt: { gte: il30 } }] } }),
    prisma.dossier.count({ where: { OR: [{ ouvertLe: { gte: il210, lt: il30 } }, { ouvertLe: null, createdAt: { gte: il210, lt: il30 } }] } }),
  ]);
  const moyenne = anterieurs / 6;
  if (moyenne >= 2 && recents < (moyenne * SEUILS_ALERTE.baisseActivitePct) / 100) {
    alertes.push({
      code: "ACTIVITE_EN_BAISSE",
      gravite: "ATTENTION",
      titre: "Moins de nouveaux dossiers",
      detail: `${recents} ouvert${recents > 1 ? "s" : ""} ces 30 derniers jours, contre ${String(Math.round(moyenne * 10) / 10).replace(".", ",")} par mois en moyenne les six mois précédents.`,
      lien: "/dossiers",
    });
  }

  // Agent qui se dégrade, tâches en échec
  const decisions = await prisma.proposition.findMany({
    where: { auteur: { startsWith: "AGENT" }, decideLe: { gte: new Date(maintenant.getTime() - 120 * JOUR_MS) }, statut: { in: ["VALIDEE", "EXECUTEE", "ECHEC", "REJETEE"] } },
    select: { statut: true, decideLe: true },
  });
  const taux = (liste: typeof decisions) => (liste.length ? (liste.filter((decision) => decision.statut !== "REJETEE").length / liste.length) * 100 : null);
  const derniers = decisions.filter((decision) => decision.decideLe! >= il30);
  const avant = decisions.filter((decision) => decision.decideLe! < il30);
  const tauxRecent = taux(derniers);
  const tauxAvant = taux(avant);
  if (
    tauxRecent !== null &&
    tauxAvant !== null &&
    derniers.length >= SEUILS_ALERTE.decisionsMinimum &&
    avant.length >= SEUILS_ALERTE.decisionsMinimum &&
    tauxAvant - tauxRecent >= SEUILS_ALERTE.baisseAcceptationPoints
  ) {
    alertes.push({
      code: "AGENT_DEGRADE",
      gravite: "ATTENTION",
      titre: "Les propositions de l'agent sont moins souvent acceptées",
      detail: `${Math.round(tauxRecent)} % acceptées ces 30 derniers jours, contre ${Math.round(tauxAvant)} % avant. Motifs de rejet à regarder dans la synthèse.`,
      lien: "/synthese",
    });
  }
  const echecs = await prisma.tache.count({ where: { statut: "ECHEC_DEFINITIF" } });
  if (echecs > 0) {
    alertes.push({ code: "TACHES_EN_ECHEC", gravite: "ATTENTION", titre: `${echecs} tâche${echecs > 1 ? "s" : ""} de fond en échec`, detail: "Un envoi, une synchronisation ou une reprise n'a pas abouti.", lien: "/taches" });
  }

  // Disque du volume de la base (mission 10) : 70 % avertit, 85 % alerte.
  try {
    const { fichierDeLaBase, capaciteVolume } = await import("@/lib/base/sauvegarde.mjs");
    const fichier = fichierDeLaBase();
    if (fichier) {
      const c = capaciteVolume(fichier.replace(/[\\/][^\\/]+$/, ""));
      if (c.pourcentUtilise >= SEUILS_ALERTE.disqueUrgentPct) alertes.push({ code: "DISQUE_PLEIN", gravite: "URGENT", titre: `Volume rempli à ${c.pourcentUtilise} %`, detail: `${Math.round(c.libre / 1_048_576)} Mo libres sur ${Math.round(c.total / 1_048_576)} : agrandir le volume ou faire de la place (photos, sauvegardes).`, lien: "/taches" });
      else if (c.pourcentUtilise >= SEUILS_ALERTE.disqueAttentionPct) alertes.push({ code: "DISQUE_70", gravite: "ATTENTION", titre: `Volume rempli à ${c.pourcentUtilise} %`, detail: `${Math.round(c.libre / 1_048_576)} Mo libres sur ${Math.round(c.total / 1_048_576)} : à surveiller.`, lien: "/taches" });
    }
  } catch {
    // volume illisible (base distante) : pas d'alerte disque
  }

  const ordre = { URGENT: 0, ATTENTION: 1, INFO: 2 };
  return alertes.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
}
