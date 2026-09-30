/**
 * Mission 17 (partie B) — le jeu d'essai de l'Analytique, partagé par src/lib/analytique/analytique-base.test.ts et
 * src/lib/mcp/mcp-analytique.test.ts. Noms fictifs, instants fixes autour du mercredi 30/09/2026 10 h (Paris).
 * À appeler après `preparerBaseEssai()` et l'import de @/lib/prisma.
 *
 * Ce qu'il pose (et ce que les définitions doivent en dire, 30 derniers jours = 01/09 → 30/09) :
 * - 8 leads : 3 Meta (formulaires sur deux publicités A1 « Carrousel » et A2 « Vidéo » ; le premier a DEUX formulaires
 *   sur A1 : compté une fois), 1 du site (canal google : SEO), 1 archivé à la corbeille (compté), 1 doublon fusionné
 *   (exclu), 1 créé le 01/09 à 0 h 30 heure de Paris (dans la période) et 1 le 31/08 à 23 h 30 (hors période) ;
 *   → 6 leads, 2 appelés (Meta 1 intéressé, Meta 2 « pas de réponse »), 2 joints (Meta 1, et le lead du site par un
 *   mail reçu), 2 avec devis, 1 signé ;
 * - devis émis dans la période (dossiers) : A (deux variantes, compté une fois), B (site), C (sans lead) = 3 ; le
 *   devis masqué du dossier D ne compte pas ;
 * - signés : A (accord 2 000 €, 27/09) et C (passage à Signé le 29/09, devis accepté 1 500 €) ; D a un accord retiré ;
 * - encaissé : 600 € le 28/09 (un encaissement annulé de 400 € ne compte pas) ; 3 000 € le 15/08 ;
 * - dépenses : 100 € de matière rattachée au dossier A, 50 € d'outillage, 80 € de « Publicité » saisie le 20/09 (ne
 *   s'ajoute jamais au prorata ni à la synchronisation) ;
 * - campagne : début 22/09, budget 378 €, 21 jours → jour 9, prorata 151,50 € au 30/09 10 h ;
 * - carnet : le devis B (900 €, une relance par SMS) ;
 * - site : 3 visites (SEO, Meta, direct), 2 simulations lancées, 1 terminée rattachée au lead du site.
 */
import type { PrismaClient } from "@prisma/client";

export const MERCREDI = new Date("2026-09-30T08:00:00.000Z");
const le = (iso: string) => new Date(iso);

export type IdsEssai = Record<"lMeta1" | "lMeta2" | "lMeta3" | "lSite" | "dA" | "dB" | "dC" | "dD" | "docA1" | "docB", string>;

export async function peuplerAnalytique(prisma: PrismaClient): Promise<IdsEssai> {
  const param = (cle: string, valeur: unknown) => prisma.parametre.create({ data: { cle, valeur: JSON.stringify(valeur), valableDu: le("2026-01-01T00:00:00Z"), source: "essai" } });
  await param("CAMPAGNE_DEBUT", "2026-09-22");
  await param("CAMPAGNE_BUDGET", 378);
  await param("CAMPAGNE_DUREE_JOURS", 21);

  const lead = (data: Record<string, unknown>) => prisma.lead.create({ data: { nom: "Essai", prenom: "Analytique", telephone: `06${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, ville: "Montpellier", ...data } as never });
  const lMeta1 = await lead({ source: "META_ADS", createdAt: le("2026-09-24T10:00:00Z") });
  const lMeta2 = await lead({ source: "META_ADS", createdAt: le("2026-09-25T10:00:00Z") });
  const lMeta3 = await lead({ source: "META_ADS", createdAt: le("2026-09-26T10:00:00Z") });
  const lSite = await lead({ source: "SITE_SIMULATEUR", canal: "google", parcoursId: "parcours-essai-1", pageEntree: "/", createdAt: le("2026-09-27T10:05:00Z") });
  await lead({ source: "SITE_DEVIS", createdAt: le("2026-09-20T10:00:00Z"), archiveLe: le("2026-09-21T10:00:00Z"), archiveMotif: "Doublon de Essai : fusionné le 21/09/2026", doublonDe: lMeta1.id, doublonTraiteLe: le("2026-09-21T10:00:00Z") });
  await lead({ source: "MAIL", createdAt: le("2026-09-21T10:00:00Z"), archiveLe: le("2026-09-22T10:00:00Z"), archiveMotif: "Corbeille — essai" });
  await lead({ source: "AUTRE", createdAt: le("2026-08-31T22:30:00Z") });
  await lead({ source: "AUTRE", createdAt: le("2026-08-31T21:30:00Z") });

  await prisma.noteAppel.create({ data: { leadId: lMeta1.id, appelLe: le("2026-09-24T12:00:00Z"), texte: "Projet cuisine", issue: "INTERESSE" } });
  await prisma.interaction.create({ data: { leadId: lMeta2.id, type: "APPEL", contenu: "Appel — Pas de réponse", createdAt: le("2026-09-25T12:00:00Z") } });
  await prisma.message.create({ data: { canal: "EMAIL", compte: "contact@essai.fr", identifiantCanal: "essai-1", sens: "ENTRANT", de: "visiteur@essai.fr", objet: "Ma cuisine", recuLe: le("2026-09-28T09:00:00Z"), leadId: lSite.id } });

  const meta = (leadgenId: string, leadId: string, adId: string, adNom: string, soumisLe: string) => prisma.metaLead.create({ data: { leadgenId, leadId, adId, adNom, adsetId: "S1", adsetNom: "Montpellier 30 km", campagneId: "C1", campagneNom: "Cuisine septembre", soumisLe: le(soumisLe), statut: "TRAITE" } });
  await meta("9001", lMeta1.id, "A1", "Carrousel", "2026-09-24T10:00:00Z");
  await meta("9002", lMeta1.id, "A1", "Carrousel", "2026-09-25T09:00:00Z");
  await meta("9003", lMeta2.id, "A1", "Carrousel", "2026-09-25T10:00:00Z");
  await meta("9004", lMeta3.id, "A2", "Vidéo", "2026-09-26T10:00:00Z");

  const dossier = (data: Record<string, unknown>) => prisma.dossier.create({ data: { clientNom: "Essai Analytique", clientAdresse: "1 rue de l'Essai", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000000", objet: "Cuisine", source: "ENTRANT", ...data } as never });
  const dA = await dossier({ leadId: lMeta1.id, etape: "SIGNE" });
  const dB = await dossier({ leadId: lSite.id, etape: "DEVIS_ENVOYE" });
  const dC = await dossier({ etape: "SIGNE", source: "RECOMMANDATION" });
  const dD = await dossier({ etape: "DEVIS_ENVOYE" });
  const doc = (dossierId: string, numero: string, dateEmission: string, totalHt: number, statut: string, visibleEspace = true) => prisma.document.create({ data: { dossierId, type: "DEVIS", numero, dateEmission: le(dateEmission), objet: "Cuisine", lignes: "[]", totalHt, statut, visibleEspace, origine: "REPRISE" } });
  const docA1 = await doc(dA.id, "2026-901", "2026-09-25T10:00:00Z", 2000, "ACCEPTE");
  await doc(dA.id, "2026-902", "2026-09-26T10:00:00Z", 2500, "NON_RETENU");
  const docB = await doc(dB.id, "2026-903", "2026-09-28T10:00:00Z", 900, "GENERE");
  const docC = await doc(dC.id, "2026-904", "2026-09-20T10:00:00Z", 1500, "ACCEPTE");
  const docD = await doc(dD.id, "2026-905", "2026-09-22T10:00:00Z", 1200, "GENERE", false);
  await prisma.accordDevis.create({ data: { dossierId: dA.id, documentId: docA1.id, numeroDevis: "2026-901", totalHt: 2000, nomSignataire: "Essai", mention: "Bon pour accord", createdAt: le("2026-09-27T10:00:00Z") } });
  await prisma.accordDevis.create({ data: { dossierId: dD.id, documentId: docD.id, numeroDevis: "2026-905", totalHt: 1200, nomSignataire: "Essai", mention: "Bon pour accord", createdAt: le("2026-09-23T10:00:00Z"), retireLe: le("2026-09-24T10:00:00Z"), retirePar: "CLIENT" } });
  await prisma.dossierEvenement.create({ data: { dossierId: dC.id, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Signé", metadata: JSON.stringify({ de: "DEVIS_ENVOYE", vers: "SIGNE", nature: "SUIVANTE", documentId: docC.id }), survenuLe: le("2026-09-29T10:00:00Z") } });
  await prisma.dossierEvenement.create({ data: { dossierId: dB.id, type: "SMS_COPIE", direction: "SORTANT", contenu: "Relance", metadata: JSON.stringify({ relance: { documentId: docB.id, rang: 1 } }), createdAt: le("2026-09-29T15:00:00Z") } });

  await prisma.encaissement.create({ data: { dossierId: dA.id, payeur: "Essai", montant: 600, recuLe: le("2026-09-28T10:00:00Z"), statut: "VALIDE" } });
  await prisma.encaissement.create({ data: { dossierId: dA.id, payeur: "Essai", montant: 400, recuLe: le("2026-09-28T11:00:00Z"), statut: "ANNULE", finLe: le("2026-09-29T10:00:00Z") } });
  await prisma.encaissement.create({ data: { payeur: "Ancien client", montant: 3000, recuLe: le("2026-08-15T10:00:00Z"), statut: "VALIDE" } });

  await prisma.depense.create({ data: { payeeLe: le("2026-09-28T10:00:00Z"), montant: 100, fournisseur: "Fournisseur films", categorie: "MATIERE", dossierId: dA.id } });
  await prisma.depense.create({ data: { payeeLe: le("2026-09-28T10:00:00Z"), montant: 50, fournisseur: "Outils", categorie: "OUTILLAGE", horsChantier: true } });
  await prisma.depense.create({ data: { payeeLe: le("2026-09-20T10:00:00Z"), montant: 80, fournisseur: "Meta", categorie: "PUBLICITE", horsChantier: true } });

  const evenement = (parcoursId: string, visiteur: string, createdAt: string, page: string, famille: string, source: string | null, type = "PAGE_VUE") => prisma.evenementSite.create({ data: { parcoursId, visiteur, type, page, famille, source, appareil: "TELEPHONE", pays: "FR", createdAt: le(createdAt) } });
  await evenement("parcours-essai-1", "v1", "2026-09-27T09:50:00Z", "/", "seo", "google");
  await evenement("parcours-essai-1", "v1", "2026-09-27T09:55:00Z", "/simulateur", "seo", "google", "GENERATION_LANCEE");
  await evenement("parcours-essai-2", "v2", "2026-09-27T11:00:00Z", "/simulateur", "meta", "meta/paid");
  await evenement("parcours-essai-3", "v3", "2026-09-28T11:00:00Z", "/realisations", "direct", null);
  await prisma.travailSimulation.create({ data: { parcoursId: "parcours-essai-1", projet: "cuisine", source: "google", statut: "PRETE", createdAt: le("2026-09-27T09:56:00Z") } });
  await prisma.travailSimulation.create({ data: { parcoursId: "parcours-essai-2", projet: "cuisine", source: "meta/paid", statut: "ECHEC", createdAt: le("2026-09-27T11:05:00Z") } });
  await prisma.simulationSite.create({ data: { parcoursId: "parcours-essai-1", projet: "cuisine", source: "google", leadId: lSite.id, rattacheeLe: le("2026-09-27T10:05:00Z"), createdAt: le("2026-09-27T09:58:00Z") } });

  return { lMeta1: lMeta1.id, lMeta2: lMeta2.id, lMeta3: lMeta3.id, lSite: lSite.id, dA: dA.id, dB: dB.id, dC: dC.id, dD: dD.id, docA1: docA1.id, docB: docB.id };
}

/** Branche la synchronisation Meta (variables + une réussite) et pose la dépense réelle de deux publicités. */
export async function brancherMeta(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  env.META_AD_ACCOUNT_ID = "123456";
  env.META_ADS_TOKEN = "jeton-essai";
  await prisma.sourceAnalytique.upsert({ where: { source: "META" }, create: { source: "META", dernierEssaiLe: le("2026-09-30T05:00:00Z"), derniereReussiteLe: le("2026-09-30T05:00:00Z"), detail: JSON.stringify({ etat: "A_JOUR" }) }, update: { dernierEssaiLe: le("2026-09-30T05:00:00Z"), derniereReussiteLe: le("2026-09-30T05:00:00Z"), derniereErreur: null, detail: JSON.stringify({ etat: "A_JOUR" }) } });
  const ligne = (jour: string, publiciteId: string, publiciteNom: string, depense: number, impressions: number, clics: number, leadsPlateforme: number) =>
    prisma.depensePubJour.create({ data: { plateforme: "META", jour, compteId: "123456", campagneId: "C1", campagneNom: "Cuisine septembre", ensembleId: "S1", ensembleNom: "Montpellier 30 km", publiciteId, publiciteNom, depense, impressions, clics, leadsPlateforme, synchroniseLe: le("2026-09-30T05:00:00Z") } });
  await ligne("2026-09-24", "A1", "Carrousel", 20, 1000, 20, 1);
  await ligne("2026-09-25", "A1", "Carrousel", 20, 1000, 15, 2);
  await ligne("2026-09-25", "A2", "Vidéo", 90, 3000, 30, 1);
}

export function debrancherMeta(env: NodeJS.ProcessEnv = process.env): void {
  env.META_AD_ACCOUNT_ID = "";
  env.META_ADS_TOKEN = "";
}
