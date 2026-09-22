import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireZones } from "@/lib/simulateur/types-surface";
import { etapeEspace, LIBELLES_ETAPE_ESPACE, progression } from "./etapes";
import { composerFaits, dateSignature, lireDevisEtPaiements, restantes as simulationsRestantes } from "./faits";
import { confirmationRequise, jetonEspace, lienApercu, lienEspace } from "./liens";
import { figeDuProjet, LIMITE_PROJETS_EN_COURS } from "./projets";
import { famille, famillesDe, lireSelection } from "@/lib/prestations/prestations";
import { lireProjet, projetPrecise, resumerProjet } from "./projet";
import { nomDuProjetClient, photosDuClient } from "./service";

/**
 * L'onglet Espaces clients : ce que fait chaque client DE SON CÔTÉ, sans
 * ouvrir les dossiers (Dossiers montre le tunnel de l'affaire ; ici, l'espace).
 * Qui a la main (moi ou le client), l'étape où il en est, ce qu'il a fait, sa
 * dernière visite, et les signaux qui demandent un geste : photos reçues sans
 * simulation, devis relu sans signature, lien jamais ouvert, lien qui expire.
 */

export type { ClientEspace, CodeSignal, LigneEspace, Signal } from "./suivi-types";
import type { ClientEspace, LigneEspace, Signal } from "./suivi-types";
import { simulationsGratuites } from "./service";

const JOUR = 86_400_000;
const date = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** « Façades hautes : Chêne clair (NE31) · … » : les teintes de la simulation validée (ou du mélange). */
function teintesDuChoix(choixJson: string | null, simulations: { id: string; zones: string | null }[]): string | null {
  try {
    const choix = choixJson ? (JSON.parse(choixJson) as { mode?: string; simulationId?: string; zones?: { libelle?: string; zone?: string; nom?: string; ref?: string }[] }) : null;
    if (!choix) return null;
    const zones = choix.mode === "COMPOSITE" ? (choix.zones ?? []) : lireZones(simulations.find((s) => s.id === choix.simulationId)?.zones ?? null);
    return zones.map((z) => `${z.libelle || z.zone} : ${z.nom || z.ref}${z.nom && z.ref ? ` (${z.ref})` : ""}`).join(" · ") || null;
  } catch {
    return null;
  }
}

export async function listerEspaces(maintenant: Date = new Date(), filtre: { permanentId?: string } = {}): Promise<LigneEspace[]> {
  const gratuites = await simulationsGratuites();
  const espaces = await prisma.espaceClient.findMany({
    where: filtre.permanentId ? { permanentId: filtre.permanentId } : {},
    include: {
      // Archives comprises : une simulation retirée par Lucas a coûté, elle reste comptée dans le quota.
      simulations: { where: { ...AVEC_ARCHIVES }, select: { id: true, statut: true, source: true, publieeLe: true, archiveLe: true, zones: true, choisieLe: true } },
      permanent: true,
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
          objet: true,
          source: true,
          prestations: true,
          lead: { select: { typeProjet: true } },
          documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" } },
          accords: { orderBy: { createdAt: "desc" } },
          encaissements: { select: { montant: true, moyen: true, recuLe: true, statut: true } },
          evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, createdAt: true, survenuLe: true } },
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
    // Le lien envoyé est celui du client (son espace permanent) ; un lien d'avant le 22/09 portait le code du projet.
    const signable = espace.permanent ?? espace;
    const jeton = jetonEspace(signable);
    const envoi = smsAvecLien.find((s) => s.texte.includes(`/e/${jeton}`)) ?? null;
    const ancienEnvoi = envoi ? null : (smsAvecLien.find((s) => s.texte.includes(`/e/${espace.code}-`)) ?? null);
    const photos = (await photosDuClient(d.id, d.photos)).length;
    const vivantes = espace.simulations.filter((s) => !s.archiveLe);
    const publiees = vivantes.filter((s) => s.statut === "PUBLIEE");
    const crm = publiees.filter((s) => s.source !== "SITE" && s.source !== "CLIENT").length;
    const duClient = publiees.filter((s) => s.source === "CLIENT").length;
    // Le quota compte tout ce qui a été fait, sur le site comme dans l'espace (même retiré ensuite).
    const faitesEspace = espace.simulations.filter((s) => s.source === "CLIENT").length;
    const faitesSite = espace.simulations.filter((s) => s.source === "SITE").length;
    const restantes = simulationsRestantes({ gratuites, accordees: espace.simulationsAccordees ?? 0, faitesEspace, faitesSite, enCours: 0 });
    const brouillons = vivantes.filter((s) => s.statut === "BROUILLON").length;
    // Devis, accord, paiements : la même lecture que l'espace du client (faits.ts).
    const lecture = lireDevisEtPaiements({ devis: d.documents, accords: d.accords, encaissements: d.encaissements, clientNom: d.clientNom, signeLe: dateSignature(d.evenements) });
    const devis = lecture.devis;
    const accord = lecture.accord ? { createdAt: lecture.accord.le, source: lecture.accord.source } : null;
    const recu = lecture.paiement?.recu ?? 0;
    const acompte = lecture.paiement?.acompte ? { montant: lecture.paiement.acompte.montant, recu } : null;
    const selection = lireSelection(d.prestations);
    const projet = lireProjet(espace.souhaits, selection, d.lead?.typeProjet);
    const faits = composerFaits({
      photos,
      projetPrecise: projetPrecise(projet),
      projetValide: Boolean(espace.projetValideLe),
      simulationsCrm: crm,
      simulationsSite: publiees.filter((s) => s.source === "SITE").length,
      simulationsClient: duClient,
      choix: Boolean(espace.choixLe),
      lecture,
      etapeDossier: d.etape,
    });
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
    // Un projet d'un espace permanent n'expire plus (le lien du client ne meurt pas).
    const expire = !espace.permanent && espace.expireLe.getTime() < maintenant.getTime();
    const revoque = Boolean(espace.permanent?.revoqueLe ?? espace.revoqueLe);

    const signaux: Signal[] = [];
    if (propositionEnAttente) signaux.push({ code: "PROPOSITION_DEMANDEE", libelle: "Autre proposition demandée", ton: "rouge" });
    if (espace.simulationsDemandeesLe) signaux.push({ code: "SIMULATIONS_DEMANDEES", libelle: `Demande d'autres simulations (${duClient} faite${duClient > 1 ? "s" : ""})`, ton: "rouge" });
    // v3 : le client crée lui-même ses simulations. Le signal ne vaut que s'il n'en a aucune (ni du site, ni à lui, ni de moi).
    const aucuneSimulation = crm + faits.simulationsSite + duClient === 0;
    if (photos > 0 && aucuneSimulation && brouillons === 0 && !devis && !revoque) signaux.push({ code: "PHOTOS_SANS_SIMULATION", libelle: `${photos} photo${photos > 1 ? "s" : ""} reçue${photos > 1 ? "s" : ""}, aucune simulation encore`, ton: "ambre" });
    if (brouillons > 0) signaux.push({ code: "BROUILLONS", libelle: `${brouillons} brouillon${brouillons > 1 ? "s" : ""} à publier`, ton: "ambre" });
    if (devis && !accord && consultations >= 2) signaux.push({ code: "HESITE", libelle: `Devis relu ${consultations} fois sans signer`, ton: consultations >= 3 ? "rouge" : "ambre" });
    if (accord && !d.dateChantier) signaux.push({ code: "DATE_A_FIXER", libelle: "Accord donné : date du chantier à fixer", ton: "rouge" });
    if (envoi && !espace.premierAccesLe && maintenant.getTime() - envoi.createdAt.getTime() > 2 * JOUR) signaux.push({ code: "JAMAIS_OUVERT", libelle: `Lien jamais ouvert (envoyé il y a ${Math.floor((maintenant.getTime() - envoi.createdAt.getTime()) / JOUR)} j)`, ton: "ambre" });
    if (!envoi && !espace.premierAccesLe && !revoque) signaux.push({ code: "NON_ENVOYE", libelle: ancienEnvoi ? "Nouveau lien pas encore envoyé" : "Lien pas encore envoyé par SMS", ton: "gris" });
    if (expire && !revoque) signaux.push({ code: "EXPIRE", libelle: "Lien expiré", ton: "rouge" });
    else if (!espace.permanent && !revoque && espace.expireLe.getTime() - maintenant.getTime() < 10 * JOUR) signaux.push({ code: "EXPIRE_BIENTOT", libelle: `Lien valable jusqu'au ${espace.expireLe.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`, ton: "ambre" });

    let attente: LigneEspace["attente"];
    if (revoque) attente = { qui: "PERSONNE", libelle: "Lien désactivé" };
    else if (figeDuProjet(d.etape) === "NON_REALISE") attente = { qui: "PERSONNE", libelle: "Non réalisé" };
    else if (etape === "TERMINE") attente = { qui: "PERSONNE", libelle: "Chantier terminé" };
    else if (propositionEnAttente) attente = { qui: "MOI", libelle: "Préparer une autre proposition", geste: "SIMULATEUR" };
    else if (espace.simulationsDemandeesLe && !accord) attente = { qui: "MOI", libelle: "Accorder d'autres simulations", geste: "ACCORDER" };
    else if (brouillons > 0 && !accord) attente = { qui: "MOI", libelle: `Publier ${brouillons > 1 ? "les brouillons" : "le brouillon"}`, geste: "PUBLIER" };
    else if (photos > 0 && aucuneSimulation && !devis) attente = { qui: "MOI", libelle: "Préparer la simulation", geste: "SIMULATEUR" };
    else if (etape === "ATTENTE_DEVIS") attente = { qui: "MOI", libelle: "Faire le devis", geste: "DEVIS" };
    else if (accord && !d.dateChantier) attente = { qui: "MOI", libelle: "Appeler : fixer la date du chantier", geste: "APPELER" };
    else if (etape === "CHANTIER") attente = { qui: "MOI", libelle: d.dateChantier ? `Chantier le ${d.dateChantier.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : "Chantier à planifier" };
    else attente = { qui: "CLIENT", libelle: LIBELLES_ETAPE_ESPACE[etape] };

    const familles = famillesDe(selection);
    lignes.push({
      espaceId: espace.id,
      dossierId: d.id,
      permanentId: espace.permanentId,
      nomProjet: nomDuProjetClient(espace.nomProjet, d.objet, familles),
      familles: familles.map((id) => ({ id, libelle: famille(id).libelle })),
      fige: figeDuProjet(d.etape),
      creeParLeClient: d.source === "ESPACE_CLIENT",
      clientNom: d.clientNom,
      ville: d.clientVille,
      telephone: d.clientTelephone,
      typeProjet: familles[0] ?? d.lead?.typeProjet ?? "AUTRE",
      lien: revoque ? null : lienEspace(signable),
      apercu: revoque || expire ? null : lienApercu(signable, maintenant.getTime(), espace.permanent ? espace : null),
      creeLe: espace.createdAt.toISOString(),
      lienEnvoyeLe: date(envoi?.createdAt),
      expireLe: espace.expireLe.toISOString(),
      revoque,
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
        projet: projetPrecise(projet) ? resumerProjet(projet) : null,
        projetValideLe: date(espace.projetValideLe),
        simulationsSite: faitesSite,
        // Publiées par Lucas (celles du site et celles du client ont leur propre compte).
        simulationsPubliees: crm,
        simulationsClient: duClient,
        simulationsRestantes: restantes,
        simulationsDemandeesLe: date(espace.simulationsDemandeesLe),
        brouillons,
        choix: espace.choixLe ? espace.choixLe.toISOString() : null,
        choixTeintes: espace.choixLe ? teintesDuChoix(espace.choix, vivantes) : null,
        proposition: propositionEnAttente ? { le: espace.propositionDemandeeLe!.toISOString(), message: espace.propositionMessage ?? null } : null,
        devis: devis ? { numero: devis.numero!, consultations, consulteLe: consultations > 0 ? date(espace.devisConsulteLe) : null } : null,
        accord: accord ? accord.createdAt.toISOString() : null,
        accordSource: accord?.source ?? null,
        acompte,
        paiement: accord && lecture.paiement ? { total: lecture.paiement.total, recu: lecture.paiement.recu, reste: lecture.paiement.reste, regle: lecture.paiement.regle } : null,
      },
      attente,
      signaux,
    });
  }

  const poids = (l: LigneEspace) => (l.attente.qui === "MOI" ? 0 : l.attente.qui === "CLIENT" ? 1 : 2);
  return lignes.sort((a, b) => poids(a) - poids(b) || (b.derniereActivite ?? b.creeLe).localeCompare(a.derniereActivite ?? a.creeLe));
}

/**
 * L'onglet Espaces clients, PAR CLIENT (mission 5) : un client, son lien, ses
 * visites, ses projets et où il en est dans chacun. Le plus pressé de ses projets
 * donne la main ; ses signaux (nouveau projet ouvert par lui, projet de plus
 * demandé, téléphone à confirmer) s'ajoutent à ceux de ses projets.
 */
export async function listerClientsEspaces(maintenant: Date = new Date(), filtre: { permanentId?: string } = {}): Promise<ClientEspace[]> {
  const lignes = await listerEspaces(maintenant, filtre);
  const permanents = await prisma.espacePermanent.findMany({ where: { id: { in: [...new Set(lignes.map((l) => l.permanentId).filter((id): id is string => Boolean(id)))] } } });
  const parId = new Map(permanents.map((p) => [p.id, p]));
  const groupes = new Map<string, LigneEspace[]>();
  for (const ligne of lignes) {
    const cle = ligne.permanentId ?? `projet:${ligne.espaceId}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), ligne]);
  }
  const poids = (qui: LigneEspace["attente"]["qui"]) => (qui === "MOI" ? 0 : qui === "CLIENT" ? 1 : 2);
  const clients: ClientEspace[] = [];
  for (const [cle, projets] of groupes) {
    const permanent = parId.get(cle) ?? null;
    const tete = [...projets].sort((a, b) => poids(a.attente.qui) - poids(b.attente.qui) || (b.derniereActivite ?? b.creeLe).localeCompare(a.derniereActivite ?? a.creeLe))[0];
    const enCours = projets.filter((p) => !p.fige).length;
    const signaux: Signal[] = [];
    const nouveaux = projets.filter((p) => p.creeParLeClient && !p.fige && p.etape === "PHOTOS");
    if (nouveaux.length) signaux.push({ code: "NOUVEAU_PROJET", libelle: `Nouveau projet ouvert par lui : ${nouveaux.map((p) => p.nomProjet).join(", ")}`, ton: "rouge" });
    if (permanent?.projetDemandeLe) signaux.push({ code: "PROJET_DEMANDE", libelle: "Demande à ouvrir un projet de plus", ton: "rouge" });
    if (permanent && confirmationRequise(permanent, maintenant)) signaux.push({ code: "CONFIRMATION_DEMANDEE", libelle: "Plus de 90 jours sans visite : il confirmera son téléphone", ton: "gris" });
    const activites = projets.map((p) => p.derniereActivite).filter((x): x is string => Boolean(x)).sort();
    clients.push({
      permanentId: permanent?.id ?? cle,
      clientId: permanent?.clientId ?? "",
      clientNom: tete.clientNom,
      ville: tete.ville,
      telephone: tete.telephone,
      lien: tete.lien,
      apercu: tete.apercu,
      lienEmisLe: (permanent?.lienEmisLe ?? new Date(tete.creeLe)).toISOString(),
      revoque: Boolean(permanent?.revoqueLe ?? tete.revoque),
      premierAccesLe: date(permanent?.premierAccesLe) ?? tete.premierAccesLe,
      dernierAccesLe: date(permanent?.dernierAccesLe) ?? tete.dernierAccesLe,
      nbAcces: permanent?.nbAcces ?? tete.nbAcces,
      confirmationRequise: permanent ? confirmationRequise(permanent, maintenant) : false,
      projetsEnCours: enCours,
      limite: LIMITE_PROJETS_EN_COURS + (permanent?.projetsAccordes ?? 0),
      projetDemandeLe: date(permanent?.projetDemandeLe),
      derniereActivite: activites.at(-1) ?? null,
      attente: permanent?.projetDemandeLe ? { qui: "MOI", libelle: "Accorder un projet de plus, ou l'appeler" } : tete.attente,
      signaux: [...signaux, ...projets.flatMap((p) => p.signaux.map((sig) => (projets.length > 1 ? { ...sig, libelle: `${p.nomProjet} : ${sig.libelle}` } : sig)))],
      // Les projets en cours d'abord, les plus pressés en tête ; les projets passés ensuite.
      projets: [...projets].sort((a, b) => Number(Boolean(a.fige)) - Number(Boolean(b.fige)) || poids(a.attente.qui) - poids(b.attente.qui) || b.creeLe.localeCompare(a.creeLe)),
    });
  }
  return clients.sort((a, b) => poids(a.attente.qui) - poids(b.attente.qui) || (b.derniereActivite ?? b.lienEmisLe).localeCompare(a.derniereActivite ?? a.lienEmisLe));
}
