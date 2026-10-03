import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { chargerFiche } from "@/lib/clients/fiches";
import { notesDuLead } from "@/lib/commercial/notes-appel";
import { controlerCoherence } from "@/lib/coherence/controle";
import { depensesDuDossier } from "@/lib/depenses/service";
import { ETAPES, LIBELLES_ETAPE, LIBELLES_STATUT_DOCUMENT, type EtapeDossier } from "@/lib/dossiers/constants";
import { resumerSelection, sousPartieDeCle } from "@/lib/prestations/prestations";
import { chargerDetail, listerDossiers } from "@/lib/dossiers/dossiers";
import { mainDe } from "@/lib/dossiers/pilotage";
import { messagesEspace } from "@/lib/espace/messages";
import { espaceDuClient } from "@/lib/espace/gestion";
import { vueEspaceCrm } from "@/lib/espace/vue-crm";
import { chronologieDuContact } from "@/lib/chronologie/chronologie";
import { FAMILLES_CHRONOLOGIE } from "@/lib/chronologie/familles";
import { listerClientsEspaces } from "@/lib/espace/suivi";
import { ADRESSE_ESPACES } from "@/lib/espace/suivi-types";
import { etatConnexionGoogle, rappelConnexionGoogle } from "@/lib/google/connexion";
import { etatIa } from "@/lib/ia/modele";
import { resumeChaineMeta } from "@/lib/meta/sante";
import { chargerEntrant } from "@/lib/prospects/entrants";
import { relancesPhotosProposables } from "@/lib/relances/photos";
import { listerSimulationsDossier } from "@/lib/simulations/dossier";
import { calculerAlertes } from "@/lib/synthese/alertes";
import { etatAvisGoogle } from "@/lib/site/avis-google";
import { etatDesTaches } from "@/lib/taches/lecture";
import { etatsDesSources } from "@/lib/analytique/appuis";
import { chiffresDisponibles, etatDe } from "@/lib/analytique/ecrans/commun";
import { calculerPublicite, campagneAnalytique, verdictsDeLaCampagne } from "@/lib/analytique/ecrans/publicite";
import { coutPar } from "@/lib/analytique/calculs";
import { nombreDeJours, resoudrePeriode as resoudrePeriodeAnalytique } from "@/lib/analytique/periode";
import { LIBELLES_VERDICT } from "@/lib/analytique/types";
import { definirOutil, format, lien, type LienOutil } from "../definition";
import { ADRESSE_SYSTEME } from "@/lib/parametres/sections";
import { chercherContacts, trouverUnSeul, type Candidat } from "../recherche";
import { titreDossier } from "@/lib/commun/format";
import { pluriel } from "@/lib/commun/format";

/**
 * Les outils de lecture (mission 8) : trouver, lire, lister ce qui attend,
 * l'état du système. Tout est rendu en phrases courtes que Claude peut lire
 * à voix haute, avec les données à côté et un lien vers l'élément du CRM.
 */

const ligneCandidat = (c: Candidat) => `${c.type === "DOSSIER" ? "Dossier" : c.type === "CLIENT" ? "Client" : "Lead"} : ${c.nom}${c.ville ? ` (${c.ville})` : ""} — ${c.etat} [${c.type.toLowerCase()}:${c.id}]`;

export const outilChercher = definirOutil({
  nom: "chercher",
  titre: "Chercher un client, un lead ou un dossier",
  description:
    "Cherche par nom (même mal orthographié), téléphone, e-mail, ville, adresse (« 30 boulevard Joliot-Curie ») ou numéro de devis / facture (« 2026-037 »). Rend les candidats avec leur type et leur identifiant (client, lead ou dossier) : c'est le point de départ de tout — lire une fiche, noter un appel, envoyer un lien. S'il y a plusieurs candidats pour un nom, demande à Lucas lequel avant d'agir. « archives: true » cherche aussi les fiches, leads et dossiers archivés (marqués ARCHIVÉ) : c'est ainsi que « restaurer » trouve ce qu'il restaure ; sans lui, un nom qui ne désigne qu'un archivé le rend quand même.",
  niveau: "LECTURE",
  schema: z.object({ texte: z.string().min(1).max(120).describe("Ce que Lucas a dit : « Rousse », « le dossier Forestier », « 06 12 34 56 78 », « Montpellier »."), limite: z.number().int().min(1).max(20).optional(), archives: z.boolean().optional().describe("Vrai : les archivés aussi (leads, dossiers, fiches client).") }),
  executer: async ({ texte, limite, archives }) => {
    let candidats = await chercherContacts(texte, { limite: limite ?? 8, archives });
    // Rien parmi les vivants : les archivés (mission 17, partie C : `restaurer` doit pouvoir les trouver).
    if (candidats.length === 0 && !archives) candidats = await chercherContacts(texte, { limite: limite ?? 8, archives: true });
    if (candidats.length === 0) return { texte: `Rien trouvé pour « ${texte} » : ni client, ni lead, ni dossier${archives ? ", même archivé" : ""}. Vérifie l'orthographe, ou cherche par téléphone.` };
    return {
      texte: `${candidats.length} candidat${candidats.length > 1 ? "s" : ""} pour « ${texte} » :\n${candidats.map(ligneCandidat).join("\n")}`,
      donnees: candidats,
      liens: candidats.slice(0, 5).map((c) => lien(c.nom, c.chemin)),
    };
  },
});

/** Une cible désignée par un identifiant, ou par un nom (cherché, avec refus si ambigu). */
export const schemaCible = z.object({
  dossierId: z.string().max(40).optional().describe("Identifiant du dossier, si connu (rendu par « chercher »)."),
  clientId: z.string().max(40).optional().describe("Identifiant du client, si connu."),
  leadId: z.string().max(40).optional().describe("Identifiant du lead, si connu."),
  nom: z.string().max(120).optional().describe("À défaut d'identifiant : le nom tel que Lucas l'a dit."),
});
export type Cible = z.output<typeof schemaCible>;

export class CibleAmbigue extends Error {
  constructor(readonly candidats: Candidat[]) {
    super("Plusieurs contacts correspondent : demande à Lucas lequel.");
  }
}

/** Résout une cible en identifiants ; lève CibleAmbigue (texte lisible) si le nom désigne plusieurs personnes. */
export async function resoudreCible(cible: Cible, type?: "CLIENT" | "LEAD" | "DOSSIER"): Promise<{ dossierId: string | null; clientId: string | null; leadId: string | null; nom: string }> {
  if (cible.dossierId || cible.clientId || cible.leadId) {
    if (cible.dossierId) {
      const d = await prisma.dossier.findUnique({ where: { id: cible.dossierId }, select: { id: true, clientId: true, leadId: true, clientNom: true } });
      if (!d) throw new Error(`Dossier introuvable : ${cible.dossierId}.`);
      return { dossierId: d.id, clientId: d.clientId, leadId: d.leadId, nom: d.clientNom };
    }
    if (cible.clientId) {
      const c = await prisma.client.findUnique({ where: { id: cible.clientId }, select: { id: true, nom: true, dossiers: { where: { archiveLe: null }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 }, leads: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 } } });
      if (!c) throw new Error(`Client introuvable : ${cible.clientId}.`);
      return { dossierId: c.dossiers[0]?.id ?? null, clientId: c.id, leadId: c.leads[0]?.id ?? null, nom: c.nom };
    }
    const l = await prisma.lead.findUnique({ where: { id: cible.leadId! }, select: { id: true, prenom: true, nom: true, clientId: true, dossiers: { where: { archiveLe: null }, select: { id: true }, take: 1 } } });
    if (!l) throw new Error(`Lead introuvable : ${cible.leadId}.`);
    return { dossierId: l.dossiers[0]?.id ?? null, clientId: l.clientId, leadId: l.id, nom: `${l.prenom} ${l.nom}`.trim() };
  }
  if (!cible.nom) throw new Error("Indique le nom, ou un identifiant (rendu par « chercher »).");
  let resultat = await trouverUnSeul(cible.nom, type);
  // Mission 17 (partie C) : un nom qui ne désigne aucun vivant peut désigner un archivé (restaurer, lire sa fiche).
  if ("aucun" in resultat) resultat = await trouverUnSeul(cible.nom, type, { archives: true });
  if ("aucun" in resultat) throw new Error(`Aucun contact ne correspond à « ${cible.nom} ».`);
  if ("ambigu" in resultat) throw new CibleAmbigue(resultat.ambigu);
  const t = resultat.trouve;
  return { dossierId: t.dossierId, clientId: t.clientId, leadId: t.leadId, nom: t.nom };
}

export const texteAmbigu = (e: CibleAmbigue) => `Plusieurs contacts correspondent, je ne choisis pas à ta place :\n${e.candidats.map(ligneCandidat).join("\n")}\nDis-moi lequel (ou rappelle l'outil avec son identifiant).`;

function ligneEtape(etape: string) {
  return LIBELLES_ETAPE[etape as EtapeDossier] ?? etape;
}

/**
 * Mission 14 (partie 8) : qui a la main, par la règle unique (`dossiers/pilotage.ts › mainDe` : étape, main rangée,
 * retard) — « à toi », « à toi : à relancer » (l'étape attend le client mais la prochaine action est dépassée),
 * « chez le client », « personne » (dossier perdu ou encaissé). Les mêmes mots dans « lire_fiche » et « dossiers_par_etape ».
 */
function quiALaMain(d: { etape: string; prochaineActionDate: string | null; main: "MOI" | "CLIENT" | null }, maintenant: Date): string {
  const main = mainDe({ etape: d.etape as EtapeDossier, prochaineActionDate: d.prochaineActionDate, main: d.main }, maintenant);
  return main === "AUCUNE" ? "personne" : main === "MOI" ? "à toi" : main === "A_RELANCER" ? "à toi : à relancer" : "chez le client";
}

const court = (texte: string | null | undefined, n: number) => (!texte ? "" : texte.length > n ? `${texte.slice(0, n)}…` : texte);
const OUVERTES = ["A_FAIRE", "PLUS_TARD"];

/** Les tâches de Lucas qui portent sur ce contact (dossier, lead ou client) : ouvertes d'abord, puis les dernières réglées. */
async function tachesDuSujet(ids: { dossierId: string | null; clientId: string | null; leadId: string | null }) {
  const ou = [...(ids.dossierId ? [{ dossierId: ids.dossierId }] : []), ...(ids.leadId ? [{ leadId: ids.leadId }] : []), ...(ids.clientId ? [{ clientId: ids.clientId }] : [])];
  if (!ou.length) return [];
  const lignes = await prisma.tacheAFaire.findMany({ where: { OR: ou }, orderBy: [{ updatedAt: "desc" }], take: 40, select: { id: true, titre: true, raison: true, statut: true, type: true, plusTardJusqua: true, reponduLe: true, reponse: true, reponseRaison: true } });
  return [...lignes.filter((t) => OUVERTES.includes(t.statut)), ...lignes.filter((t) => !OUVERTES.includes(t.statut)).slice(0, 5)];
}

/** Mails, messages d'espace et SMS échangés avec ce contact (les plus récents). */
async function messagesDuSujet(ids: { dossierId: string | null; clientId: string | null; leadId: string | null }, limite: number) {
  const ou = [...(ids.dossierId ? [{ dossierId: ids.dossierId }] : []), ...(ids.clientId ? [{ clientId: ids.clientId }] : []), ...(ids.leadId ? [{ leadId: ids.leadId }] : [])];
  const ouSms = [...(ids.clientId ? [{ clientId: ids.clientId }] : []), ...(ids.leadId ? [{ leadId: ids.leadId }] : [])];
  const [mails, espace, sms] = await Promise.all([
    ou.length ? prisma.message.findMany({ where: { OR: ou }, orderBy: { recuLe: "desc" }, take: limite, select: { id: true, canal: true, sens: true, de: true, deNom: true, objet: true, extrait: true, recuLe: true, lu: true } }) : Promise.resolve([]),
    ids.dossierId ? messagesEspace({ dossierId: ids.dossierId, limite }) : Promise.resolve([]),
    ouSms.length ? prisma.sms.findMany({ where: { conversation: { OR: ouSms } }, orderBy: { createdAt: "desc" }, take: limite, select: { id: true, sens: true, texte: true, statut: true, modele: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  return { mails, espace, sms };
}

const schemaLireFiche = schemaCible.extend({
  nombre: z.number().int().min(1).max(200).optional().describe("Dossier : événements d'historique rendus (20 par défaut)."),
  decalage: z.number().int().min(0).max(5000).optional().describe("Dossier : événements à sauter (« voir les plus anciens »)."),
  chronologie: z.number().int().min(0).max(100).optional().describe("Entrées de la chronologie du contact (mails, appels, espace, dossier, documents, paiements, notes, propositions) ; 0 ou absent : pas de chronologie."),
  familles: z.array(z.enum(FAMILLES_CHRONOLOGIE)).max(8).optional().describe("Chronologie : filtrer par famille (MAIL, APPEL, ESPACE, DOSSIER, DOCUMENT, PAIEMENT, NOTE, PROPOSITION)."),
  messages: z.number().int().min(0).max(50).optional().describe("Mails, messages d'espace et SMS rendus par canal (10 par défaut ; 0 : aucun)."),
});

export const outilLireFiche = definirOutil({
  nom: "lire_fiche",
  titre: "Lire une fiche complète",
  description:
    "Rend TOUT ce que le CRM sait d'un dossier, d'un client ou d'un lead (archivés compris). Dossier : étape, qui a la main (depuis quand, pourquoi), source, ouverture, prochaine action, dates, projet, perte détaillée, points à compléter et masqués, délais, devis et factures (identifiants, PDF), paiements (chacun avec son identifiant), simulations, photos, dépenses, notes, l'espace client (étape du client, reste à faire, projet, choix, favoris, avis, paiement vu, derniers gestes, photos retirées, lien et aperçu « comme le client »), l'historique complet paginé (« nombre », « decalage »). Client : catégorie, SIRET, adresse, provenance, recommandations, passif, consentements, coordonnées avec leur identifiant, état (archivé, fusionné, anonymisé), historique de la fiche, espace permanent. Lead : tous les champs de la fiche (code postal, notes, campagne, publicité, formulaire, prix simulé, style, doublon, tentatives, dernier appel et contact, archivage, ancien CRM), échanges, notes d'appel. Et pour tous : les tâches de Lucas qui le concernent, les mails, messages d'espace et SMS (« messages »), la chronologie filtrable (« chronologie », « familles »). Réponse à « où en est le dossier X ? ». Donne un identifiant ou un nom.",
  niveau: "LECTURE",
  schema: schemaLireFiche,
  executer: async (entree, contexte) => {
    const cible = { dossierId: entree.dossierId, clientId: entree.clientId, leadId: entree.leadId, nom: entree.nom };
    let ids;
    try {
      ids = await resoudreCible(cible);
    } catch (e) {
      if (e instanceof CibleAmbigue) return { texte: texteAmbigu(e), donnees: e.candidats };
      throw e;
    }
    const liens: LienOutil[] = [];
    const parties: string[] = [];
    const donnees: Record<string, unknown> = {};
    const nbMessages = entree.messages ?? 10;
    if (ids.dossierId) {
      const d = await chargerDetail(ids.dossierId);
      const simulations = await listerSimulationsDossier(d.id).catch(() => ({ simulations: [] }));
      const depenses = await depensesDuDossier(d.id).catch(() => ({ depenses: [], total: 0 }));
      const brut = await prisma.dossier.findUnique({ where: { id: d.id }, select: { archiveLe: true, archiveMotif: true, completudeMasquee: true } });
      const decalage = entree.decalage ?? 0;
      const nombre = entree.nombre ?? 20;
      const [evenements, totalEvenements, espace] = await Promise.all([
        prisma.dossierEvenement.findMany({ where: { dossierId: d.id }, orderBy: { createdAt: "desc" }, skip: decalage, take: nombre, select: { id: true, type: true, direction: true, contenu: true, createdAt: true, survenuLe: true, metadata: true } }),
        prisma.dossierEvenement.count({ where: { dossierId: d.id } }),
        vueEspaceCrm(d.id).catch(() => null),
      ]);
      const devis = d.documents.filter((x) => x.type === "DEVIS");
      const factures = d.documents.filter((x) => x.type === "FACTURE");
      const avoirs = d.documents.filter((x) => x.type === "AVOIR");
      const main = quiALaMain(d, contexte.maintenant);
      const masques = (() => {
        try {
          return brut?.completudeMasquee ? (JSON.parse(brut.completudeMasquee) as string[]) : [];
        } catch {
          return [];
        }
      })();
      parties.push(
        `Dossier ${titreDossier(d)} (${d.clientVille}) : étape « ${ligneEtape(d.etape)} », la main est ${main === "personne" ? "à personne" : main}${d.mainMotif ? ` (${d.mainMotif})` : ""}.`,
        brut?.archiveLe ? `ARCHIVÉ le ${format.jourCourt(brut.archiveLe)}${brut.archiveMotif ? ` (${brut.archiveMotif})` : ""} : « restaurer » le ramène.` : "",
        d.prochaineAction ? `Prochaine action : ${d.prochaineAction}${d.prochaineActionDate ? ` le ${format.jour(d.prochaineActionDate)}` : ""}.` : "Pas de prochaine action notée.",
        d.dateChantier ? `Chantier prévu le ${format.jour(d.dateChantier)}${d.dateFinChantier ? `, fin le ${format.jour(d.dateFinChantier)}` : ""}.` : "",
        d.dateSouhaitee ? `Date souhaitée par le client : ${format.jour(d.dateSouhaitee)}.` : "",
        `Source ${d.source}, ouvert le ${format.jourCourt(d.ouvertLe)}${d.mainLe ? `, main rangée le ${format.jourCourt(d.mainLe)}` : ""}${d.origine ? `, né du ${d.origine.type === "LEAD" ? "lead" : "prospect"} ${d.origine.nom} [${d.origine.type.toLowerCase()}:${d.origine.id}]` : ""}${d.client ? `, fiche client ${d.client.nom} [client:${d.client.id}]` : ""}. Coordonnées : ${[d.clientAdresse, d.clientCp, d.clientVille].filter(Boolean).join(" ")}, ${d.clientTelephone || "sans téléphone"}, ${d.clientEmail ?? "sans e-mail"}${d.montantEstime !== null ? ` ; montant estimé ${format.euros(d.montantEstime)}` : ""}.`,
        Object.keys(d.prestations).length ? `Projet : ${resumerSelection(d.prestations)}${Object.keys(d.teintes).length ? ` ; teintes : ${Object.entries(d.teintes).map(([cle, t]) => `${sousPartieDeCle(cle)?.sousPartie.libelle ?? cle} ${t}`).join(", ")}` : ""}.` : "",
        d.perte ? `Perdu${d.motifPerte ? ` (${d.motifPerte})` : ""}${d.perte.le ? ` le ${format.jourCourt(d.perte.le)}` : ""}${d.perte.etape ? ` à l'étape ${ligneEtape(d.perte.etape)}` : ""}${d.perte.concurrent ? `, remporté par ${d.perte.concurrent}${d.perte.montantConcurrent !== null ? ` à ${format.euros(d.perte.montantConcurrent)}` : ""}` : ""}${d.perte.montantPropose !== null ? `, notre prix ${format.euros(d.perte.montantPropose)}` : ""}${d.perte.commentaire ? ` — ${d.perte.commentaire}` : ""}.` : "",
        devis.length ? `Devis (${devis.length}) : ${devis.map((x) => `${x.numero ?? "brouillon"}${x.libelleVariante ? ` « ${x.libelleVariante} »` : ""} ${format.euros(x.totalHt)} (${(LIBELLES_STATUT_DOCUMENT[x.statut] ?? x.statut).toLowerCase()}${x.visibleEspace === false ? ", masqué dans l'espace" : ""})${x.dateEmission ? ` émis le ${format.jourCourt(x.dateEmission)}` : ""}${x.origine === "REPRISE" ? ", repris" : ""}${x.pdfUrl ? ", PDF" : ""} [document:${x.id}]`).join(", ")}.` : "Aucun devis.",
        factures.length ? `Factures : ${factures.map((x) => `${x.numero ?? "brouillon"} ${format.euros(x.totalHt)} (${x.statut.toLowerCase()})${x.dateEmission ? ` émise le ${format.jourCourt(x.dateEmission)}` : ""}${x.echeanceLe ? `, échéance ${format.jourCourt(x.echeanceLe)}` : ""} [document:${x.id}]`).join(", ")}.` : "",
        avoirs.length ? `Avoirs : ${avoirs.map((x) => `${x.numero ?? "brouillon"} ${format.euros(x.totalHt)} [document:${x.id}]`).join(", ")}.` : "",
        `Paiements : ${pluriel(d.paiements.encaissements.filter((e) => e.statut === "VALIDE").length, "encaissement")}, reste dû ${format.euros(d.paiements.resteDu)}${d.paiements.acompteEnregistre ? ", acompte reçu" : ", acompte pas encore reçu"}${d.paiements.encaissements.length ? ` : ${d.paiements.encaissements.map((e) => `${format.euros(e.montant)} ${e.moyen?.toLowerCase() ?? ""} le ${format.jourCourt(e.recuLe)}${e.statut !== "VALIDE" ? ` (${e.statut.toLowerCase()}${e.motifFin ? ` : ${e.motifFin}` : ""})` : ""}${e.moyen === "CHEQUE" ? (e.crediteLe ? `, crédité le ${format.jourCourt(e.crediteLe)}` : ", pas encore crédité") : ""}${e.reference ? ` réf. ${e.reference}` : ""} [encaissement:${e.id}]`).join(" · ")}` : ""}.`,
        simulations.simulations.length ? `Simulations : ${simulations.simulations.map((s) => `${s.titre ?? "sans titre"} (${s.statut.toLowerCase()}${s.choisie ? ", choisie par le client" : ""}${s.publieeLe ? `, publiée le ${format.jourCourt(s.publieeLe)}` : ""}) [simulation:${s.id}]`).join(" · ")}.` : "Aucune simulation.",
        d.photos.length ? `Photos : ${pluriel(d.photos.filter((p) => !p.apres).length, "avant", "avant")}, ${pluriel(d.photos.filter((p) => p.apres).length, "après", "après")} (« voir_fichiers »).` : "Aucune photo.",
        depenses.total ? `Dépenses rattachées : ${format.euros(depenses.total)} — ${depenses.depenses.map((x) => `${x.fournisseur} ${format.euros(x.montant)}${x.justificatif ? " (justificatif)" : " (sans justificatif)"} [depense:${x.id}]`).join(" · ")}.` : "",
        d.completude.length ? `À compléter : ${d.completude.map((p) => p.libelle).join(", ")}.` : "",
        masques.length ? `Points masqués : ${masques.join(", ")}.` : "",
        d.delais && Object.values(d.delais).some((v) => v !== null) ? `Délais : ${[d.delais.ouvertureASignature !== null ? `ouverture → signature ${d.delais.ouvertureASignature} j` : null, d.delais.signatureAChantier !== null ? `signature → chantier ${d.delais.signatureAChantier} j` : null, d.delais.facturationAEncaissement !== null ? `facturation → encaissement ${d.delais.facturationAEncaissement} j` : null, d.delais.boutEnBout !== null ? `bout en bout ${d.delais.boutEnBout} j` : null].filter(Boolean).join(", ")}.` : "",
        d.notes.length ? `Notes (${d.notes.length}) : ${d.notes.map((n) => `${format.jourCourt(n.createdAt)} [${ligneEtape(n.etape)}] ${court(n.contenu, 200)}`).join(" · ")}` : "",
        espace ? `Espace client : étape du client « ${espace.etapeLibelle} » ; reste à faire : ${espace.resteAFaire} ; ${espace.revoqueLe ? "lien DÉSACTIVÉ" : espace.premierAccesLe ? `vu ${espace.nbAcces} fois, dernière visite ${format.jourCourt(espace.dernierAccesLe)}` : "jamais ouvert"}${espace.projet ? ` ; projet : ${espace.projet.resume}${espace.projetValide ? ` (validé le ${format.jourCourt(espace.projetValide.le)} par ${espace.projetValide.par.toLowerCase()})` : ""}` : ""}${espace.choix ? ` ; choix : ${espace.choix.mode}${espace.choix.commentaire ? ` « ${court(espace.choix.commentaire, 120)} »` : ""}` : ""}${espace.favoris.length ? ` ; favoris : ${espace.favoris.join(", ")}` : ""}${espace.proposition ? ` ; demande d'autre proposition le ${format.jourCourt(espace.proposition.le)}${espace.proposition.message ? ` « ${court(espace.proposition.message, 120)} »` : ""}` : ""}${espace.accord ? ` ; bon pour accord le ${format.jourCourt(espace.accord.le)} (${espace.accord.nom})` : ""}${espace.paiement ? ` ; paiement vu : ${court(JSON.stringify(espace.paiement), 160)}` : ""}${espace.avis ? ` ; avis ${espace.avis.note}/5 « ${court(espace.avis.texte, 160)} »` : ""} ; simulations : ${espace.creation.faites} faites, ${espace.creation.restantes} restantes${espace.photosRetirees.length ? ` ; ${pluriel(espace.photosRetirees.length, "photo retirée", "photos retirées")} par le client (${espace.photosRetirees.map((p) => p.id).join(", ")})` : ""}${espace.messagesNonLus ? ` ; ${pluriel(espace.messagesNonLus, "message non lu", "messages non lus")}` : ""}.${espace.gestes.length ? ` Derniers gestes : ${espace.gestes.slice(0, 6).map((g) => `${format.jourCourt(g.le)} ${g.auteur === "LUCAS" ? "(Lucas) " : ""}${court(g.contenu, 90)}`).join(" · ")}.` : ""}${espace.lien ? ` Lien : ${espace.lien}` : ""}${espace.apercu ? ` ; voir comme le client : ${espace.apercu}` : ""}` : "Pas d'espace client.",
        `Historique (${Math.min(decalage + 1, totalEvenements)}–${Math.min(decalage + evenements.length, totalEvenements)} sur ${totalEvenements}${decalage + evenements.length < totalEvenements ? ` ; « decalage: ${decalage + evenements.length} » pour les plus anciens` : ""}) :\n${evenements.map((e) => `- ${format.jourCourt(e.survenuLe ?? e.createdAt)} ${e.type.toLowerCase()} : ${court(e.contenu.replace(/\s+/g, " "), 220)}`).join("\n")}`
      );
      donnees.dossier = { id: d.id, etape: d.etape, source: d.source, ouvertLe: d.ouvertLe, main: d.main, mainLe: d.mainLe, mainMotif: d.mainMotif, archiveLe: brut?.archiveLe ?? null, archiveMotif: brut?.archiveMotif ?? null, prochaineAction: d.prochaineAction, prochaineActionDate: d.prochaineActionDate, dateChantier: d.dateChantier, dateSouhaitee: d.dateSouhaitee, dateFinChantier: d.dateFinChantier, montantEstime: d.montantEstime, prestations: d.prestations, teintes: d.teintes, perte: d.perte, motifPerte: d.motifPerte, completude: d.completude, pointsMasques: masques, delais: d.delais, parcours: d.parcours, ecarts: d.ecarts, origine: d.origine, client: d.client, documents: d.documents.map((x) => ({ id: x.id, type: x.type, numero: x.numero, libelle: x.libelleVariante, visibleEspace: x.visibleEspace, totalHt: x.totalHt, statut: x.statut, dateEmission: x.dateEmission, origine: x.origine, pdfUrl: x.pdfUrl, echeanceLe: x.echeanceLe })), paiements: d.paiements, simulations: simulations.simulations.map((s) => ({ id: s.id, statut: s.statut, titre: s.titre, choisie: s.choisie, publieeLe: s.publieeLe })), photos: d.photos, depenses: depenses.depenses.map((x) => ({ id: x.id, montant: x.montant, fournisseur: x.fournisseur, categorie: x.categorie, payeeLe: x.payeeLe, justificatif: x.justificatif })), notes: d.notes, evenements: evenements.map((e) => ({ id: e.id, type: e.type, direction: e.direction, contenu: e.contenu, le: (e.survenuLe ?? e.createdAt).toISOString(), saisiLe: e.createdAt.toISOString() })), totalEvenements, espace, coordonnees: { adresse: d.clientAdresse, cp: d.clientCp, ville: d.clientVille, email: d.clientEmail, telephone: d.clientTelephone } };
      liens.push(lien("Ouvrir le dossier", `/dossiers?dossier=${d.id}`));
    }
    if (ids.clientId) {
      const c = await chargerFiche(ids.clientId).catch(() => null);
      if (c) {
        const coord = (l: typeof c.emails) => l.map((x) => `${x.valeur}${x.libelle ? ` (${x.libelle})` : ""}${x.principale ? " ★" : ""}${x.archiveLe ? " (archivée)" : ""} [coordonnee:${x.id}]`).join(", ");
        const espacePermanent = await espaceDuClient(c.id).catch(() => null);
        parties.push(
          `Client ${c.nom}${c.ville ? ` (${c.ville})` : ""} : ${c.emails.map((e) => e.valeur).join(", ") || "sans e-mail"}, ${c.telephones.map((t) => t.valeur).join(", ") || "sans téléphone"} ; ${pluriel(c.nbDossiers, "dossier")}, ${format.euros(c.montantSigne)} signés ; source ${c.source}.`,
          `Fiche : ${c.categorie.toLowerCase()}${c.raisonSociale ? `, raison sociale ${c.raisonSociale}` : ""}${c.siret ? `, SIRET ${c.siret}` : ""}${c.adresse || c.codePostal ? `, ${[c.adresse, c.codePostal, c.ville].filter(Boolean).join(" ")}` : ""} ; provenance ${c.source}${c.sourceDetail ? ` (${c.sourceDetail})` : ""}${c.campagne ? `, campagne ${c.campagne}` : ""}${c.publicite ? `, publicité ${c.publicite}` : ""}${c.formulaire ? `, formulaire ${c.formulaire}` : ""}, premier contact le ${format.jourCourt(c.premierContactLe)}${c.recommandePar ? ` ; recommandé par ${c.recommandePar.nom} [client:${c.recommandePar.id}]` : c.recommandeParTexte ? ` ; recommandé par ${c.recommandeParTexte}` : ""}${c.recommandations.length ? ` ; a recommandé ${c.recommandations.map((r) => r.nom).join(", ")}` : ""}.`,
          c.archiveLe || c.fusionneDans || c.anonymiseLe ? `État : ${[c.archiveLe ? `ARCHIVÉE le ${format.jourCourt(c.archiveLe)}${c.archiveMotif ? ` (${c.archiveMotif})` : ""}` : null, c.fusionneDans ? `fusionnée dans ${c.fusionneDans.nom} [client:${c.fusionneDans.id}]` : null, c.anonymiseLe ? `anonymisée le ${format.jourCourt(c.anonymiseLe)}` : null].filter(Boolean).join(", ")}.` : "",
          `Coordonnées : e-mails ${coord(c.emails) || "aucun"} ; téléphones ${coord(c.telephones) || "aucun"}.`,
          c.notes ? `Passif : ${court(c.notes, 600)}` : "",
          c.consentements.length ? `Mails commerciaux : ${c.consentements.map((x) => `${x.statut.toLowerCase()} (${x.moyen}, le ${format.jourCourt(x.recueilliLe)})`).join(" → ")}.` : "Mails commerciaux : aucune réponse enregistrée.",
          c.dossiers.length ? `Dossiers : ${c.dossiers.map((x) => `${x.objet} (${ligneEtape(x.etape)}${x.archiveLe ? ", archivé" : ""}) [dossier:${x.id}]`).join(" · ")}.` : "",
          c.leads.length ? `Leads : ${c.leads.map((l) => `${l.source} ${format.jourCourt(l.createdAt)} (${l.statut.toLowerCase()}) [lead:${l.id}]`).join(" · ")}.` : "",
          c.propositionsEnAttente.length ? `Propositions en attente : ${c.propositionsEnAttente.map((p) => `${p.titre} [proposition:${p.id}]`).join(" · ")}.` : "",
          espacePermanent?.espace ? `Espace permanent : ${espacePermanent.espace.revoque ? "lien DÉSACTIVÉ" : `vu ${espacePermanent.espace.nbAcces} fois`}, ${pluriel(espacePermanent.espace.projetsEnCours, "projet")} en cours sur ${espacePermanent.espace.limite} [espace:${espacePermanent.espace.permanentId}]${espacePermanent.espace.lien ? ` ; lien ${espacePermanent.espace.lien}` : ""}.` : "",
          c.historique.length ? `Historique de la fiche : ${c.historique.slice(0, 10).map((h) => `${format.jourCourt(h.horodatage)} ${h.operation.toLowerCase()} par ${h.acteur} : ${court(h.resume, 100)}`).join(" · ")}` : ""
        );
        donnees.client = { ...c, espace: espacePermanent };
        liens.push(lien("Fiche client", `/clients/${c.id}`));
      }
    }
    if (ids.leadId) {
      const l = await chargerEntrant(ids.leadId).catch(() => null);
      if (l) {
        const notes = await notesDuLead(l.id).catch(() => []);
        const brut = await prisma.lead.findUnique({ where: { id: l.id }, select: { doublonDe: true, doublonMotif: true, doublonTraiteLe: true } });
        parties.push(
          `Lead ${l.nom}${l.ville ? ` (${l.ville})` : ""} reçu le ${format.jourCourt(l.recuLe)} par ${l.source} : ${l.typeProjet.toLowerCase()}, statut ${l.statut.toLowerCase()}${l.priorite ? `, priorité ${l.priorite.toLowerCase()}` : ""}${l.rappelLe ? `, rappel prévu le ${format.jour(l.rappelLe)}` : ""}.`,
          l.message ? `Son message : « ${l.message.slice(0, 300)} »` : "",
          [l.occupation ? `Occupation : ${l.occupation.toLowerCase()}` : null, l.delaiProjet ? `Délai du projet : ${l.delaiProjet.toLowerCase()}` : null].filter(Boolean).join(" · "),
          `Fiche : ${l.telephone ?? "sans téléphone"}, ${l.email ?? "sans e-mail"}${l.codePostal ? `, ${l.codePostal}` : ""}${l.campagne ? ` ; campagne ${l.campagne}` : ""}${l.publicite ? `, publicité ${l.publicite}` : ""}${l.formulaire ? `, formulaire ${l.formulaire}` : ""}${l.prixSimule !== null ? ` ; prix simulé ${format.euros(l.prixSimule)}` : ""}${l.styleSouhaite ? ` ; style ${l.styleSouhaite}` : ""}${l.tailleCuisine ? ` ; taille ${l.tailleCuisine}` : ""} ; ${pluriel(l.tentatives, "tentative")}${l.dernierAppelLe ? `, dernier appel ${format.jourCourt(l.dernierAppelLe)}` : ", jamais appelé"}${l.dernierContactLe ? `, dernier contact écrit ${format.jourCourt(l.dernierContactLe)}` : ""}${l.client ? ` ; fiche client ${l.client.nom} [client:${l.client.id}]` : ""}.`,
          l.notes ? `Notes : ${court(l.notes, 600)}` : "",
          l.archiveLe ? `ARCHIVÉ le ${format.jourCourt(l.archiveLe)}${l.archiveMotif ? ` (${l.archiveMotif})` : ""} : « restaurer » le ramène.` : "",
          brut?.doublonDe && !brut.doublonTraiteLe ? `Doublon probable de [lead:${brut.doublonDe}]${brut.doublonMotif ? ` (${brut.doublonMotif})` : ""} : « doublon » FUSIONNER ou ECARTER.` : "",
          notes.length ? `Notes d'appel : ${notes.map((n) => `${format.jourCourt(n.appelLe)}${n.issue ? ` (${n.issue.toLowerCase()})` : ""}${n.etiquettes.length ? ` [${n.etiquettes.join(", ")}]` : ""} ${n.texte.slice(0, 160)}`).join(" · ")}` : "Aucune note d'appel.",
          l.echanges.length ? `Échanges (${l.echanges.length}) : ${l.echanges.map((x) => `${format.jourCourt(x.le)} ${x.type.toLowerCase()} ${court(x.contenu, 120)}`).join(" · ")}` : "",
          l.photos.length ? `Photos jointes : ${l.photos.length} (« voir_fichiers »).` : "",
          l.simulations.length ? `Simulations du site : ${l.simulations.map((s) => `${format.jourCourt(s.le)}${s.reference ? ` ${s.reference}` : ""}${s.prix !== null ? ` ${format.euros(s.prix)}` : ""}`).join(" · ")}.` : "",
          l.anciensDevis.length || l.ancienChantier ? `Ancien CRM : ${l.anciensDevis.map((d) => `devis ${d.numero} ${format.euros(d.montant)} (${d.statut.toLowerCase()})${d.facture ? `, facture ${d.facture.numero}` : ""}`).join(" · ")}${l.ancienChantier ? ` ; chantier du ${format.jourCourt(l.ancienChantier.dateIntervention)} (${l.ancienChantier.statut.toLowerCase()})` : ""}.` : ""
        );
        donnees.lead = { ...l, doublon: brut?.doublonDe ? { de: brut.doublonDe, motif: brut.doublonMotif, traiteLe: brut.doublonTraiteLe } : null, notesAppel: notes };
        liens.push(lien("Fiche du lead", `/leads?lead=${l.id}`));
      }
    }
    // Pour tous : les tâches de Lucas, les messages (mails, espace, SMS) et la chronologie.
    const [taches, messages] = await Promise.all([tachesDuSujet(ids), nbMessages ? messagesDuSujet(ids, nbMessages) : Promise.resolve(null)]);
    if (taches.length) parties.push(`Tâches de Lucas : ${taches.map((t) => `${t.titre} — ${t.statut === "A_FAIRE" ? "à faire" : t.statut === "PLUS_TARD" ? `plus tard${t.plusTardJusqua ? ` (${format.jourCourt(t.plusTardJusqua)})` : ""}` : `${t.statut.toLowerCase()}${t.reponduLe ? ` le ${format.jourCourt(t.reponduLe)}` : ""}`} [tache:${t.id}]`).join(" · ")}`);
    if (messages) {
      if (messages.mails.length) parties.push(`Mails (${messages.mails.length}) : ${messages.mails.map((m) => `${format.jourCourt(m.recuLe)} ${m.sens === "SORTANT" ? "→" : "←"} « ${m.objet ?? "(sans objet)"} »${m.sens === "ENTRANT" && !m.lu ? " (non lu)" : ""} [mail:${m.id}]`).join(" · ")}`);
      if (messages.espace.length) parties.push(`Messages d'espace (${messages.espace.length}) : ${messages.espace.map((m) => `${format.jourCourt(m.le)} ${m.auteur === "LUCAS" ? "CoverSwap" : m.clientNom}${m.auteur === "CLIENT" && !m.luLe ? " (NON LU)" : ""} : « ${court(m.texte, 140)} »`).join(" · ")}`);
      if (messages.sms.length) parties.push(`SMS (${messages.sms.length}) : ${messages.sms.map((m) => `${format.jourCourt(m.createdAt)} ${m.sens === "SORTANT" ? "→" : "←"} « ${court(m.texte, 140)} » (${m.statut.toLowerCase()})`).join(" · ")}`);
    }
    donnees.taches = taches;
    donnees.messages = messages;
    if (entree.chronologie) {
      const chrono = await chronologieDuContact({ clientId: ids.clientId, leadId: ids.leadId, dossierId: ids.dossierId }, { limite: entree.chronologie, familles: entree.familles });
      parties.push(`Chronologie (${chrono.entrees.length}/${chrono.total}${entree.familles?.length ? `, ${entree.familles.join(", ")}` : ""}) :\n${chrono.entrees.map((c) => `- ${format.jourCourt(c.le)} [${c.famille}] ${c.titre}${c.texte ? ` — ${court(c.texte.replace(/\s+/g, " "), 160)}` : ""}`).join("\n")}`);
      donnees.chronologie = chrono;
    }
    return { texte: parties.filter(Boolean).join("\n"), donnees, liens };
  },
});

export const outilDossiersParEtape = definirOutil({
  nom: "dossiers_par_etape",
  titre: "Les dossiers, par étape",
  description: "Tous les dossiers en cours, groupés par étape (qualification, simulation, devis envoyé, relance, signé, planifié, chantier, facturé, encaissé), avec qui a la main et la prochaine action. Filtre possible sur une étape.",
  niveau: "LECTURE",
  schema: z.object({ etape: z.enum(ETAPES).optional().describe("Une seule étape, sinon toutes.") }),
  executer: async ({ etape }, contexte) => {
    const dossiers = (await listerDossiers()).filter((d) => !etape || d.etape === etape);
    const groupes = new Map<string, typeof dossiers>();
    for (const d of dossiers) groupes.set(d.etape, [...(groupes.get(d.etape) ?? []), d]);
    // Mission 14 (partie 8) : la règle unique de la main — un dossier perdu ou encaissé n'est à personne, un retard chez le client est à relancer.
    const texte = [...groupes.entries()]
      .sort((a, b) => ETAPES.indexOf(a[0] as EtapeDossier) - ETAPES.indexOf(b[0] as EtapeDossier))
      .map(([e, liste]) => `${ligneEtape(e)} (${liste.length}) : ${liste.map((d) => `${titreDossier(d)} (${quiALaMain(d, contexte.maintenant)})${d.prochaineAction ? ` → ${d.prochaineAction}` : ""} [dossier:${d.id}]`).join(" · ")}`)
      .join("\n");
    return { texte: texte || "Aucun dossier.", donnees: dossiers.map((d) => ({ id: d.id, clientNom: d.clientNom, objet: d.objet, ville: d.clientVille, etape: d.etape, main: d.main, mainMotif: d.mainMotif, prochaineAction: d.prochaineAction, prochaineActionDate: d.prochaineActionDate, montant: d.montantDernierDevis ?? d.montantEstime })), liens: [lien("Dossiers", "/dossiers")] };
  },
});

export const outilEspacesClients = definirOutil({
  nom: "espaces_clients",
  titre: "Les espaces clients et leur état",
  description:
    "Chaque client qui a un espace : lien actif ou non, jamais ouvert ou vu récemment, projets en cours, ce qu'il attend (de lui ou de Lucas), signaux (lien jamais ouvert, photos sans simulation, demande d'un projet de plus…). Avec « sans_photo_ni_simulation_depuis_jours » (N) : seulement les projets d'espace ouverts depuis N jours sans aucune photo ni simulation (la règle de la relance photos, N à la place de DELAI_RELANCE_PHOTOS), avec le téléphone et le SMS du lien à copier (LIEN_ESPACE_RAPPEL, ou LIEN_ESPACE si le lien ne lui a jamais été communiqué) ; une fois envoyé : « noter_sms ».",
  niveau: "LECTURE",
  schema: z.object({
    limite: z.number().int().min(1).max(50).optional(),
    sans_photo_ni_simulation_depuis_jours: z.number().int().min(1).max(60).optional().describe("N : ne rend que les projets d'espace sans photo ni simulation depuis N jours, avec téléphone et SMS."),
  }),
  executer: async ({ limite, sans_photo_ni_simulation_depuis_jours: jours }, contexte) => {
    if (jours) {
      // Mission 14 (partie 8) : la règle de la relance photos (relances/photos.ts), avec N à la place du paramètre.
      const projets = (await relancesPhotosProposables(contexte.maintenant, { delai: jours })).slice(0, limite ?? 30);
      const ligne = (p: (typeof projets)[number]) =>
        `- ${p.clientNom} : espace ouvert il y a ${pluriel(p.joursDepuisOuverture, "jour")}, ni photo ni simulation${p.lienCommunique ? "" : " (lien jamais envoyé)"}, ${p.sms?.telephone ?? "numéro inconnu"} — ${p.sms ? `SMS (${p.sms.code}) : « ${p.sms.texte} »` : "SMS indisponible (voir la fiche du dossier)"} [dossier:${p.dossierId}]`;
      const texte = projets.length ? `${pluriel(projets.length, "projet d'espace", "projets d'espace")} sans photo ni simulation depuis ${pluriel(jours, "jour")} (rien n'est envoyé : Lucas copie le SMS, puis « noter_sms ») :\n${projets.map(ligne).join("\n")}` : `Aucun projet d'espace sans photo ni simulation depuis ${pluriel(jours, "jour")}.`;
      return { texte, donnees: projets, liens: [lien("Dossiers › Espaces", ADRESSE_ESPACES)] };
    }
    const clients = (await listerClientsEspaces(contexte.maintenant)).slice(0, limite ?? 30);
    const texte = clients.length
      ? clients.map((c) => `${c.clientNom}${c.ville ? ` (${c.ville})` : ""} : ${c.revoque ? "lien désactivé" : c.premierAccesLe ? `vu ${c.nbAcces} fois, dernière visite ${format.jourCourt(c.dernierAccesLe)}` : "jamais ouvert"} ; ${pluriel(c.projetsEnCours, "projet")} en cours ; ${c.attente.qui === "MOI" ? "attend Lucas" : c.attente.qui === "CLIENT" ? "attend le client" : "rien en attente"} — ${c.attente.libelle}${c.signaux.length ? ` ; signaux : ${c.signaux.map((s) => s.libelle).join(", ")}` : ""} [client:${c.clientId}]`).join("\n")
      : "Aucun espace client ouvert.";
    return { texte, donnees: clients.map((c) => ({ clientId: c.clientId, nom: c.clientNom, ville: c.ville, lien: c.lien, revoque: c.revoque, nbAcces: c.nbAcces, dernierAccesLe: c.dernierAccesLe, attente: c.attente, signaux: c.signaux, projets: c.projets.map((p) => ({ dossierId: p.dossierId, nom: p.nomProjet, etape: p.etape, fige: p.fige })) })), liens: [lien("Dossiers › Espaces", ADRESSE_ESPACES)] };
  },
});

/** Le bloc « Entonnoir du site par source » de la synthèse : vide s'il n'y a eu aucune visite. */
export function ligneEntonnoirSite(lignes: string[]): string {
  return lignes.length ? `Entonnoir du site par source (parcours ; entre parenthèses, l'étape facultative) :\n${lignes.join("\n")}` : "";
}

/**
 * L'état de la campagne (mission 17, partie B : mêmes calculs que l'onglet Publicité de l'Analytique) : jour en jours
 * de Paris, dépense réelle Meta quand la synchronisation a réussi (sinon prorata du budget jour par jour, le jour en
 * cours au prorata des heures, marqué estimation), leads Meta du CRM (attribution par identifiants, dédoublonnés),
 * coût par lead, résultats par campagne et par publicité avec leur propre dépense et le verdict du protocole, règle du
 * jour. Sans synchronisation, la dépense d'une publicité n'est pas connue : pas de coût par lead par publicité (plus
 * de prorata qui donnait le même coût à toutes).
 */
export async function etatCampagne(maintenant: Date = new Date()) {
  const [campagne, etats] = await Promise.all([campagneAnalytique(maintenant), etatsDesSources(maintenant)]);
  const synchro = chiffresDisponibles(etatDe(etats, "META"));
  const fenetre = campagne.fenetre ?? resoudrePeriodeAnalytique({ p: "7j" }, maintenant);
  const calcul = await calculerPublicite(fenetre, maintenant, synchro);
  const { verdicts } = await verdictsDeLaCampagne(campagne, maintenant, synchro, calcul, fenetre);
  const depense = calcul.depense.total;
  // Une seule définition des leads Meta et du coût par lead (relecture B, point 5 : calculs.ts, comme l'écran Analytique).
  const leads = calcul.leadsMeta.length;
  const coutParLead = coutPar(depense, leads);
  const axe = (niveau: "CAMPAGNE" | "PUBLICITE") =>
    calcul.lignes
      .filter((l) => l.niveau === niveau && l.plateforme === "META")
      .map((l) => ({ id: l.id, nom: l.nom, leads: l.leadsCrm, leadsMeta: synchro ? l.leadsPlateforme : null, contactes: l.appeles, joints: l.joints, devis: l.devis, signes: l.signes, encaisse: l.encaisse, depense: synchro ? l.depense : null, coutParLead: l.coutParLead, coutParDevis: l.coutParDevis, coutParSigne: l.coutParSigne, verdict: niveau === "PUBLICITE" ? verdicts.get(l.id)?.verdict ?? null : null, raisonVerdict: niveau === "PUBLICITE" ? verdicts.get(l.id)?.raison ?? null : null }))
      .sort((a, b) => b.leads - a.leads || a.nom.localeCompare(b.nom));
  return {
    debut: campagne.debut,
    budget: campagne.budget,
    duree: campagne.duree,
    jour: campagne.jour,
    enCours: campagne.enCours,
    depense,
    origineDepense: calcul.depense.origine,
    estimation: calcul.depense.estimation,
    /** Compatibilité : la dépense quand elle est estimée (prorata), sinon null. */
    depenseEstimee: calcul.depense.estimation ? depense : null,
    leads,
    coutParLead,
    parCampagne: axe("CAMPAGNE"),
    parPublicite: axe("PUBLICITE"),
    regle: campagne.regleDuJour,
    protocole: campagne.protocole,
    fenetreJours: nombreDeJours(fenetre.du, fenetre.au),
    fenetre: { du: fenetre.du, au: fenetre.au },
  };
}

/** « dépense 162 € (estimation : prorata du budget) » / « dépense 158,40 € (réel Meta) ». */
export function texteDepenseCampagne(e: { depense: number | null; estimation: boolean; origineDepense: string }): string {
  if (e.depense === null) return "dépense inconnue";
  return `dépense ${format.euros(e.depense)} (${e.origineDepense === "MIXTE" ? `réel Meta sur les jours synchronisés${e.estimation ? ", estimation (prorata du budget) ailleurs" : ", dépenses saisies ailleurs"}` : e.estimation ? "estimation : prorata du budget, la synchronisation Meta n'est pas branchée" : e.origineDepense === "SYNCHRO" ? "réel Meta" : "dépenses « Publicité » saisies"})`;
}

/** Une ligne par publicité : leads, devis, signés, coût par lead (réel) et verdict du protocole. */
export function textePublicites(parPublicite: Awaited<ReturnType<typeof etatCampagne>>["parPublicite"]): string {
  return parPublicite.map((p) => `${p.nom} ${pluriel(p.leads, "lead")}, ${p.devis} devis, ${pluriel(p.signes, "signé")}${p.coutParLead !== null ? `, ${format.euros(p.coutParLead)} par lead` : ""}${p.verdict ? ` — ${LIBELLES_VERDICT[p.verdict]}${p.raisonVerdict ? ` (${p.raisonVerdict})` : ""}` : ""}`).join(" · ");
}

/** L'état de la campagne en une phrase (ex-outil « campagne », repris par « analytique » onglet publicite). */
export function texteEtatCampagne(e: Awaited<ReturnType<typeof etatCampagne>>): string {
  return e.debut
    ? `Campagne commencée le ${format.jourCourt(e.debut)} : ${e.enCours ? `jour ${e.jour} sur ${e.duree}` : e.jour !== null && e.jour > e.duree ? `terminée (jour ${e.jour}, durée ${e.duree})` : "pas encore commencée"}. Budget ${e.budget !== null ? format.euros(e.budget) : "non renseigné"}, ${texteDepenseCampagne(e)}. ${pluriel(e.leads, "lead")} Meta sur ${pluriel(e.fenetreJours, "jour")}${e.coutParLead !== null ? `, soit ${e.estimation ? "≈ " : ""}${format.euros(e.coutParLead)} par lead` : ""}. ${e.parPublicite.length ? `Par publicité : ${textePublicites(e.parPublicite)}.` : ""} ${e.regle ? `Règle du jour : ${e.regle}` : "Aucune règle trouvée pour ce jour dans le protocole des consignes."}`
    : `Aucune campagne renseignée (Paramètres → Campagne publicitaire : début, budget, durée). Sur 7 jours : ${pluriel(e.leads, "lead")} Meta${e.parPublicite.length ? ` (${e.parPublicite.map((p) => `${p.nom} ${p.leads}`).join(", ")})` : ""}.`;
}

/** Seuils du disque (mission 10) : avertir à 70 %, alerter à 85 %. */
export const SEUILS_DISQUE = { attention: 70, urgent: 85 } as const;
export const niveauDisque = (pourcent: number): "OK" | "ATTENTION" | "URGENT" => (pourcent >= SEUILS_DISQUE.urgent ? "URGENT" : pourcent >= SEUILS_DISQUE.attention ? "ATTENTION" : "OK");

/**
 * La ligne « Avis Google » de `sante_systeme` (mission 16, partie 3) : sans clé ni lieu, le dire avec le NOM des
 * variables à poser ; connectés, la dernière lecture (note, nombre, date) et sa dernière erreur.
 */
export function texteAvisGoogle(e: { connectes: boolean; note: number | null; nombre: number | null; luLe: string | null; erreur: string | null }): string {
  if (!e.connectes) return "Avis Google : non connectés (GOOGLE_PLACES_API_KEY / GOOGLE_PLACE_ID).";
  const lecture = e.note !== null && e.nombre !== null && e.luLe ? ` — ${e.note.toLocaleString("fr-FR")} sur 5, ${pluriel(e.nombre, "avis", "avis")} (lus le ${format.jourCourt(e.luLe)})` : e.luLe ? ", mais Google ne donne ni note ni nombre d'avis pour ce lieu : l'accueil n'en montre pas" : ", pas encore lus (première lecture à la prochaine visite de l'accueil)";
  return `Avis Google : connectés${lecture}${e.erreur ? ` ; dernière lecture en échec : ${e.erreur}` : ""}.`;
}

/** L'état de santé du système : tâches, connexions, jetons, crédits, disque, cohérence, alertes. */
const LIBELLES_ETAT_SOURCE: Record<string, string> = { A_JOUR: "à jour", EN_ECHEC: "EN ÉCHEC", NON_BRANCHEE: "non branchée", EN_ATTENTE_ACCES: "en attente d'accès" };
const LIBELLES_SOURCE_ANALYTIQUE: Record<string, string> = { META: "dépense Meta", GOOGLE_ADS: "Google Ads", SEARCH_CONSOLE: "Search Console", FICHE_GOOGLE: "fiche Google" };

/** Mission 17 (partie B) : une ligne par source de l'Analytique (état, dernière réussite, ce qu'il faut faire). */
function texteAnalytique(sources: { source: string; etat: string; derniereReussite: string | null; erreur: string | null; aFaire: string | null }[]): string {
  const morceaux = sources.map((e) => {
    const reussite = e.derniereReussite ? ` (dernière synchronisation réussie le ${format.jourCourt(new Date(e.derniereReussite))})` : "";
    const detail = e.etat === "EN_ECHEC" ? `${reussite}${e.erreur ? ` : ${e.erreur.slice(0, 120)}` : ""}` : e.etat === "A_JOUR" ? reussite : "";
    return `${LIBELLES_SOURCE_ANALYTIQUE[e.source] ?? e.source} ${LIBELLES_ETAT_SOURCE[e.etat] ?? e.etat}${detail}${e.aFaire && e.etat !== "A_JOUR" ? ` — ${e.aFaire}` : ""}`;
  });
  return `Analytique : ${morceaux.join(" · ")}.`;
}

export async function santeSysteme(maintenant: Date = new Date()) {
  const [taches, google, etatGoogle, meta, ia, alertes, coherence, avisGoogle, analytique, alertesAnalytique] = await Promise.all([
    etatDesTaches(),
    rappelConnexionGoogle(maintenant).catch(() => null),
    etatConnexionGoogle().catch(() => null),
    resumeChaineMeta(maintenant).catch(() => null),
    etatIa(maintenant, "IA_REDACTION").catch(() => null),
    calculerAlertes(maintenant).catch(() => []),
    controlerCoherence().catch(() => null),
    // Mission 16 (partie 3) : les avis Google de l'accueil du site (sans appeler Google : la dernière lecture gardée).
    etatAvisGoogle().catch(() => null),
    // Mission 17 (partie B) : l'état des sources de l'Analytique (variables et suivi en base, sans appel réseau).
    import("@/lib/analytique/etat").then((m) => m.etatDesSources(maintenant)).catch(() => null),
    // Les alertes de l'Analytique (coût par lead, chute de trafic, requête qui décolle, www en double) : les mêmes que l'écran.
    import("@/lib/analytique/cache").then((m) => m.alertesPourSante(maintenant)).catch(() => []),
  ]);
  let disqueLibreMo: number | null = null;
  let disque: { libreMo: number; totalMo: number; pourcentUtilise: number; niveau: "OK" | "ATTENTION" | "URGENT" } | null = null;
  try {
    const { fichierDeLaBase, capaciteVolume } = await import("@/lib/base/sauvegarde.mjs");
    const fichier = fichierDeLaBase();
    if (fichier) {
      const c = capaciteVolume(fichier.replace(/[\\/][^\\/]+$/, ""));
      disqueLibreMo = Math.round(c.libre / 1_048_576);
      disque = { libreMo: disqueLibreMo, totalMo: Math.round(c.total / 1_048_576), pourcentUtilise: c.pourcentUtilise, niveau: niveauDisque(c.pourcentUtilise) };
    }
  } catch {
    disqueLibreMo = null;
  }
  const echecs = taches.taches.filter((t) => t.statut === "ECHEC_DEFINITIF");
  const travauxEnEchec = taches.planifications.filter((p) => p.dernierStatut === "ECHEC");
  return {
    taches: { enEchec: echecs.map((t) => ({ type: t.type, libelle: t.libelle, erreur: t.derniereErreur })), enAttente: taches.compteurs.EN_ATTENTE, travauxEnEchec: travauxEnEchec.map((p) => ({ nom: p.nom, erreur: p.derniereErreur })) },
    google: google ? { niveau: google.niveau, coupee: google.coupee, compte: google.compte } : null,
    // Mission 14 (partie 9) : l'API Google Calendar non activée dans le projet Google Cloud — les rappels attendent, ce n'est pas une tâche en échec.
    agendaApi: { activee: etatGoogle?.agendaApiActivee ?? true, message: etatGoogle?.agendaApiMessage ?? null },
    // Même chose pour Gmail ou Drive (les tâches attendent de la même façon, rien ne les listerait sinon).
    autresApisNonActivees: etatGoogle?.autresApisNonActivees ?? [],
    meta: meta ? { etat: meta.chaine.code, message: meta.chaine.libelle, jeton: meta.jeton.message, echeance: meta.jeton.echeance } : null,
    avisGoogle,
    alertesAnalytique: alertesAnalytique.map((a) => ({ gravite: a.gravite, texte: a.texte, lien: a.lien ?? null })),
    analytique: analytique ? { sources: analytique.filter((e) => e.source !== "CRM" && e.source !== "SITE").map((e) => ({ source: e.source, etat: e.etat, derniereReussite: e.derniereReussite, erreur: e.erreur, aFaire: e.aFaire })) } : null,
    ia: ia ? { active: ia.active, raison: ia.raison, cleApi: ia.cleApi, depenseMois: ia.depenseMois, budget: ia.budget } : null,
    disqueLibreMo,
    disque,
    coherence: coherence ? { dossiersControles: coherence.dossiersControles, incoherences: coherence.incoherences.map((i) => ({ code: i.code, gravite: i.gravite, client: i.client, message: i.constat })) } : null,
    alertes: alertes.map((a) => ({ gravite: a.gravite, titre: a.titre, detail: a.detail, lien: a.lien })),
  };
}

export const outilSanteSysteme = definirOutil({
  nom: "sante_systeme",
  titre: "Santé du système et alertes",
  description: "Tâches de fond en échec, connexion Google (jeton qui expire, API Google Calendar à activer dans le projet Google Cloud), avis Google du site (connectés ou non), chaîne Meta (leads reçus, lecture des formulaires, conversions, jeton), IA (clé, budget du mois), sources de l'Analytique (dépense Meta, Search Console, fiche Google : à jour, en échec, non branchée, en attente d'accès), place disque, incohérences du contrôle quotidien, alertes du CRM (devis sans réponse, dossiers en retard…). Réponse à « tout va bien ? ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const s = await santeSysteme(contexte.maintenant);
    const texte = [
      s.taches.enEchec.length ? `${pluriel(s.taches.enEchec.length, "tâche")} de fond en échec : ${s.taches.enEchec.map((t) => `${t.libelle}${t.erreur ? ` (${t.erreur.slice(0, 80)})` : ""}`).join(" · ")}.` : "Aucune tâche en échec.",
      s.taches.travauxEnEchec.length ? `Travaux périodiques en échec : ${s.taches.travauxEnEchec.map((p) => p.nom).join(", ")}.` : "",
      s.google ? `Google : ${s.google.coupee ? "COUPÉ, reconnecter dans Paramètres" : `jeton ${s.google.niveau.toLowerCase()}`}${s.google.compte ? ` (${s.google.compte})` : ""}.` : s.agendaApi.activee && !s.autresApisNonActivees.length ? "Google : rien à signaler." : "",
      s.agendaApi.activee ? "" : `Google Calendar : l'API n'est pas activée dans le projet Google Cloud (console Google Cloud → API et services → Google Calendar API) ; les rappels attendent et s'inscriront seuls une fois l'API activée.${s.agendaApi.message ? ` Réponse de Google : ${s.agendaApi.message}` : ""}`,
      ...s.autresApisNonActivees.map((a) => `${a.api} : l'API n'est pas activée dans le projet Google Cloud (console Google Cloud → API et services → ${a.api} API) ; les tâches attendent et repartiront seules une fois l'API activée.${a.message ? ` Réponse de Google : ${a.message}` : ""}`),
      s.meta ? `Meta : ${s.meta.message}` : "",
      s.avisGoogle ? texteAvisGoogle(s.avisGoogle) : "",
      s.analytique ? texteAnalytique(s.analytique.sources) : "",
      s.alertesAnalytique.length ? `Analytique : ${s.alertesAnalytique.map((a) => a.texte).join(" · ")}` : "",
      s.ia ? `IA : ${s.ia.active ? `active, ${format.euros(s.ia.depenseMois)} dépensés ce mois${s.ia.budget !== null ? ` sur ${format.euros(s.ia.budget)}` : ""}` : `inactive (${s.ia.raison ?? "réglages manquants"})`}${s.ia.cleApi ? "" : " ; clé Anthropic absente du serveur"}.` : "",
      s.disque ? `Disque : ${s.disque.pourcentUtilise} % utilisé (${s.disque.libreMo} Mo libres sur ${s.disque.totalMo})${s.disque.niveau === "URGENT" ? " — ALERTE, volume presque plein (≥ 85 %)" : s.disque.niveau === "ATTENTION" ? " — attention, plus de 70 %" : ""}.` : s.disqueLibreMo !== null ? `Disque : ${s.disqueLibreMo} Mo libres.` : "",
      s.coherence ? (s.coherence.incoherences.length ? `Cohérence : ${pluriel(s.coherence.incoherences.length, "incohérence")} sur ${s.coherence.dossiersControles} dossiers : ${s.coherence.incoherences.map((i) => i.message).join(" · ")}` : `Cohérence : rien à signaler (${s.coherence.dossiersControles} dossiers contrôlés).`) : "",
      s.alertes.length ? `Alertes : ${s.alertes.map((a) => `[${a.gravite}] ${a.titre} — ${a.detail}`).join(" · ")}` : "Aucune alerte.",
    ].filter(Boolean).join("\n");
    return { texte, donnees: s, liens: [lien("Paramètres › Système", ADRESSE_SYSTEME), lien("Paramètres", "/parametres")] };
  },
});

export const OUTILS_LECTURE = [outilChercher, outilLireFiche];
