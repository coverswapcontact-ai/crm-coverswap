import prisma from "@/lib/prisma";
import { calculerMontants } from "@/lib/dossiers/montants";
import { lireLignes } from "@/lib/dossiers/stockage";
import { etapeEspace, LIBELLES_ETAPE_ESPACE, progression } from "./etapes";
import { jetonEspace, lienApercu, lienEspace } from "./liens";
import { lireProjet, projetPrecise, resumerProjet } from "./projet";
import { photosDuClient } from "./service";

/**
 * L'onglet Espaces clients : ce que fait chaque client DE SON CÔTÉ, sans
 * ouvrir les dossiers (Dossiers montre le tunnel de l'affaire ; ici, l'espace).
 * Qui a la main (moi ou le client), l'étape où il en est, ce qu'il a fait, sa
 * dernière visite, et les signaux qui demandent un geste : photos reçues sans
 * simulation, devis relu sans signature, lien jamais ouvert, lien qui expire.
 */

export type { CodeSignal, LigneEspace, Signal } from "./suivi-types";
import type { LigneEspace, Signal } from "./suivi-types";
import { simulationsGratuites } from "./service";

const JOUR = 86_400_000;
const date = (d: Date | null | undefined) => d?.toISOString() ?? null;

export async function listerEspaces(maintenant: Date = new Date()): Promise<LigneEspace[]> {
  const gratuites = await simulationsGratuites();
  const espaces = await prisma.espaceClient.findMany({
    include: {
      simulations: { where: { archiveLe: null }, select: { statut: true, source: true, publieeLe: true } },
      dossier: {
        select: {
          id: true,
          clientNom: true,
          clientVille: true,
          clientTelephone: true,
          etape: true,
          photos: true,
          dateChantier: true,
          archiveLe: true,
          lead: { select: { typeProjet: true } },
          documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, numero: true, lignes: true, acomptePct: true } },
          accords: { orderBy: { createdAt: "desc" }, take: 1, select: { documentId: true, createdAt: true, nomSignataire: true } },
          encaissements: { where: { statut: "VALIDE" }, select: { montant: true } },
        },
      },
    },
  });
  const vivants = espaces.filter((e) => !e.dossier.archiveLe);
  const dossierIds = vivants.map((e) => e.dossierId);
  const [activites, smsAvecLien] = await Promise.all([
    dossierIds.length
      ? prisma.dossierEvenement.groupBy({ by: ["dossierId"], where: { dossierId: { in: dossierIds }, direction: "ENTRANT", type: { startsWith: "ESPACE_" } }, _max: { createdAt: true } })
      : Promise.resolve([] as { dossierId: string; _max: { createdAt: Date | null } }[]),
    prisma.sms.findMany({ where: { sens: "SORTANT", texte: { contains: "/e/" }, statut: { not: "ECHEC" } }, orderBy: { createdAt: "asc" }, select: { texte: true, createdAt: true } }),
  ]);
  const activiteParDossier = new Map(activites.map((a) => [a.dossierId, a._max.createdAt]));

  const lignes: LigneEspace[] = [];
  for (const espace of vivants) {
    const d = espace.dossier;
    const jeton = jetonEspace(espace);
    const envoi = smsAvecLien.find((s) => s.texte.includes(`/e/${jeton}`)) ?? null;
    const ancienEnvoi = envoi ? null : (smsAvecLien.find((s) => s.texte.includes(`/e/${espace.code}-`)) ?? null);
    const photos = (await photosDuClient(d.id, d.photos)).length;
    const publiees = espace.simulations.filter((s) => s.statut === "PUBLIEE");
    const crm = publiees.filter((s) => s.source !== "SITE" && s.source !== "CLIENT").length;
    const duClient = publiees.filter((s) => s.source === "CLIENT").length;
    const restantes = Math.max(0, gratuites + (espace.simulationsAccordees ?? 0) - duClient);
    const brouillons = espace.simulations.filter((s) => s.statut === "BROUILLON").length;
    const devis = d.documents[0] ?? null;
    const accord = devis ? (d.accords.find((a) => a.documentId === devis.id) ?? null) : null;
    const montants = devis ? calculerMontants(lireLignes(devis.lignes), devis.acomptePct) : null;
    const recu = d.encaissements.reduce((s, e) => s + e.montant, 0);
    const acompte = montants && montants.acompteCentimes > 0 ? { montant: montants.acompteCentimes / 100, recu } : null;
    const projet = lireProjet(espace.souhaits);
    const faits = {
      photos,
      projet: projetPrecise(projet),
      simulationsCrm: crm,
      simulationsSite: publiees.filter((s) => s.source === "SITE").length,
      simulationsClient: duClient,
      choix: Boolean(espace.choixLe),
      devis: Boolean(devis),
      accord: Boolean(accord),
      acompteRecu: Boolean(accord && (!acompte || recu >= acompte.montant - 0.5)),
      etapeDossier: d.etape,
    };
    const etape = etapeEspace(faits);
    const derniereActivite = [espace.dernierAccesLe, activiteParDossier.get(d.id) ?? null].filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const dernierePublication = publiees.map((s) => s.publieeLe?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
    // Une demande d'autre proposition vaut jusqu'à la suivante publiée — ou jusqu'à ce que le client choisisse, ou signe.
    const propositionEnAttente = Boolean(
      espace.propositionDemandeeLe &&
        espace.propositionDemandeeLe.getTime() > dernierePublication &&
        !(espace.choixLe && espace.choixLe.getTime() > espace.propositionDemandeeLe.getTime()) &&
        !(accord && accord.createdAt.getTime() > espace.propositionDemandeeLe.getTime())
    );
    const consultations = devis && espace.devisConsulteId === devis.id ? espace.devisConsultations : 0;
    const expire = espace.expireLe.getTime() < maintenant.getTime();

    const signaux: Signal[] = [];
    if (propositionEnAttente) signaux.push({ code: "PROPOSITION_DEMANDEE", libelle: "Autre proposition demandée", ton: "rouge" });
    if (espace.simulationsDemandeesLe) signaux.push({ code: "SIMULATIONS_DEMANDEES", libelle: `Demande d'autres simulations (${duClient} faite${duClient > 1 ? "s" : ""})`, ton: "rouge" });
    // v3 : le client crée lui-même ses simulations. Le signal ne vaut que s'il n'en a aucune (ni du site, ni à lui, ni de moi).
    const aucuneSimulation = crm + faits.simulationsSite + duClient === 0;
    if (photos > 0 && aucuneSimulation && brouillons === 0 && !devis && !espace.revoqueLe) signaux.push({ code: "PHOTOS_SANS_SIMULATION", libelle: `${photos} photo${photos > 1 ? "s" : ""} reçue${photos > 1 ? "s" : ""}, aucune simulation encore`, ton: "ambre" });
    if (brouillons > 0) signaux.push({ code: "BROUILLONS", libelle: `${brouillons} brouillon${brouillons > 1 ? "s" : ""} à publier`, ton: "ambre" });
    if (devis && !accord && consultations >= 2) signaux.push({ code: "HESITE", libelle: `Devis relu ${consultations} fois sans signer`, ton: consultations >= 3 ? "rouge" : "ambre" });
    if (accord && !d.dateChantier) signaux.push({ code: "DATE_A_FIXER", libelle: "Accord donné : date du chantier à fixer", ton: "rouge" });
    if (envoi && !espace.premierAccesLe && maintenant.getTime() - envoi.createdAt.getTime() > 2 * JOUR) signaux.push({ code: "JAMAIS_OUVERT", libelle: `Lien jamais ouvert (envoyé il y a ${Math.floor((maintenant.getTime() - envoi.createdAt.getTime()) / JOUR)} j)`, ton: "ambre" });
    if (!envoi && !espace.premierAccesLe && !espace.revoqueLe) signaux.push({ code: "NON_ENVOYE", libelle: ancienEnvoi ? "Nouveau lien pas encore envoyé" : "Lien pas encore envoyé par SMS", ton: "gris" });
    if (expire && !espace.revoqueLe) signaux.push({ code: "EXPIRE", libelle: "Lien expiré", ton: "rouge" });
    else if (!espace.revoqueLe && espace.expireLe.getTime() - maintenant.getTime() < 10 * JOUR) signaux.push({ code: "EXPIRE_BIENTOT", libelle: `Lien valable jusqu'au ${espace.expireLe.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`, ton: "ambre" });

    let attente: LigneEspace["attente"];
    if (espace.revoqueLe) attente = { qui: "PERSONNE", libelle: "Lien désactivé" };
    else if (etape === "TERMINE") attente = { qui: "PERSONNE", libelle: "Chantier terminé" };
    else if (propositionEnAttente) attente = { qui: "MOI", libelle: "Préparer une autre proposition", geste: "SIMULATEUR" };
    else if (espace.simulationsDemandeesLe && !accord) attente = { qui: "MOI", libelle: "Accorder d'autres simulations", geste: "ACCORDER" };
    else if (brouillons > 0 && !accord) attente = { qui: "MOI", libelle: `Publier ${brouillons > 1 ? "les brouillons" : "le brouillon"}`, geste: "PUBLIER" };
    else if (photos > 0 && aucuneSimulation && !devis) attente = { qui: "MOI", libelle: "Préparer la simulation", geste: "SIMULATEUR" };
    else if (etape === "ATTENTE_DEVIS") attente = { qui: "MOI", libelle: "Faire le devis", geste: "DEVIS" };
    else if (accord && !d.dateChantier) attente = { qui: "MOI", libelle: "Appeler : fixer la date du chantier", geste: "APPELER" };
    else if (etape === "CHANTIER") attente = { qui: "MOI", libelle: d.dateChantier ? `Chantier le ${d.dateChantier.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : "Chantier à planifier" };
    else attente = { qui: "CLIENT", libelle: LIBELLES_ETAPE_ESPACE[etape] };

    lignes.push({
      espaceId: espace.id,
      dossierId: d.id,
      clientNom: d.clientNom,
      ville: d.clientVille,
      telephone: d.clientTelephone,
      typeProjet: d.lead?.typeProjet ?? "CUISINE",
      lien: espace.revoqueLe ? null : lienEspace(espace),
      apercu: espace.revoqueLe || expire ? null : lienApercu(espace, maintenant.getTime()),
      creeLe: espace.createdAt.toISOString(),
      lienEnvoyeLe: date(envoi?.createdAt),
      expireLe: espace.expireLe.toISOString(),
      revoque: Boolean(espace.revoqueLe),
      expire,
      premierAccesLe: date(espace.premierAccesLe),
      dernierAccesLe: date(espace.dernierAccesLe),
      nbAcces: espace.nbAcces,
      derniereActivite: date(derniereActivite),
      etape,
      etapeLibelle: LIBELLES_ETAPE_ESPACE[etape],
      etapes: progression(faits),
      faits: {
        photos,
        projet: projetPrecise(projet) ? resumerProjet(projet, d.lead?.typeProjet ?? "CUISINE") : null,
        // Publiées par Lucas (celles du site et celles du client ont leur propre compte).
        simulationsPubliees: crm,
        simulationsClient: duClient,
        simulationsRestantes: restantes,
        simulationsDemandeesLe: date(espace.simulationsDemandeesLe),
        brouillons,
        choix: espace.choixLe ? espace.choixLe.toISOString() : null,
        devis: devis ? { numero: devis.numero!, consultations, consulteLe: consultations > 0 ? date(espace.devisConsulteLe) : null } : null,
        accord: accord ? accord.createdAt.toISOString() : null,
        acompte,
      },
      attente,
      signaux,
    });
  }

  const poids = (l: LigneEspace) => (l.attente.qui === "MOI" ? 0 : l.attente.qui === "CLIENT" ? 1 : 2);
  return lignes.sort((a, b) => poids(a) - poids(b) || (b.derniereActivite ?? b.creeLe).localeCompare(a.derniereActivite ?? a.creeLe));
}
