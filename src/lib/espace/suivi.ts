import prisma from "@/lib/prisma";
import { tranche } from "@/lib/commun/pagination";
import { estMotifDeLien, estMotifRepondre } from "@/lib/dossiers/main";
import { mainDe } from "@/lib/dossiers/pilotage";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireZones } from "@/lib/simulateur/types-surface";
import { attenteDuClient, etapeEspace, LIBELLES_ETAPE_ESPACE, progression } from "./etapes";
import { dossiersAvecSimulation } from "./simulations-faites";
import { composerFaits, dateSignature, lectureDesDevis, lireDevisEtPaiements, restantes as simulationsRestantes } from "./faits";
import { confirmationRequise, jetonEspace, lienApercu, lienEspace } from "./liens";
import { figeDuProjet, LIMITE_PROJETS_EN_COURS } from "./projets";
import { famille, famillesDe, lireSelection } from "@/lib/prestations/prestations";
import { lireProjet, projetPrecise, resumerProjet } from "./projet";
import { nomDuProjetClient, photosDuClient, rendusDesDossiers } from "./service";
import { appliquerAuProjet, clesDesProjets, lireVueDesTaches, signalDuClientVisible } from "@/lib/a-faire/vue-espaces";
import { cleDuSignal } from "@/lib/a-faire/detecteurs/signaux-cles";

/**
 * Le suivi des espaces clients : ce que fait chaque client DE SON CÔTÉ (Dossiers
 * montre le tunnel de l'affaire ; ici, l'espace). Qui a la main (moi ou le
 * client), l'étape où il en est, ce qu'il a fait, sa dernière visite, et les
 * signaux qui demandent un geste : photos reçues sans simulation, devis relu
 * sans signature, lien jamais ouvert, lien qui expire. Mission 18 (A1) : l'onglet
 * Espaces clients n'existe plus ; c'est la colonne et le filtre « Espaces » de
 * Dossiers (`espacesDesDossiers`), le détecteur des tâches (SIGNAUX), la fiche
 * client et l'outil « lister » ESPACES (par client) qui lisent ce module.
 */

export type { ClientEspace, CodeSignal, LigneEspace, Signal } from "./suivi-types";
import { CODES_SIGNAL_CLIENT, type ClientEspace, type EspaceResume, type LigneEspace, type Signal, type PageEspaces } from "./suivi-types";
import { simulationsGratuites } from "./creation";
import { lireChoixEspace } from "./teintes-choix";

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

export type FiltreEspaces = { permanentId?: string; permanentIds?: string[]; espaceIds?: string[] };

/**
 * Mission 17 (partie A) : par défaut, les signaux sont une vue des tâches de Lucas (a-faire/vue-espaces.ts) — un
 * signal dont la tâche a été écartée est masqué, un dossier dont la prochaine action posée à la main est en vigueur
 * n'a plus de signal rouge ni ambre et attend le client. `signauxBruts` rend les signaux tels que calculés : le
 * détecteur SIGNAUX en a besoin (sinon il cocherait les tâches écartées).
 */
export type OptionsEspaces = { signauxBruts?: boolean };

/** Au-delà de ce nombre de motifs (deux par espace), `listerEspaces` lit tous les envois du lien (`/e/`) d'une traite. */
const MOTIFS_LIEN_MAX = 120;

/** Les événements du dossier qui disent « lien communiqué » : un SMS copié par Lucas, ou le texte rendu par l'assistant (« lien_espace »). */
const TYPES_LIEN_COMMUNIQUE = ["SMS_COPIE", "ESPACE_LIEN_COMMUNIQUE"];

/**
 * Le lien de l'espace est « envoyé » quand un texte qui le contient est parti : un SMS (fournisseur, pas en échec),
 * un mail (mission 7), ou — mission 14, partie 5 — un SMS copié par Lucas (`SMS_COPIE`) ou rendu à copier par
 * l'assistant (`ESPACE_LIEN_COMMUNIQUE`). Du plus ancien au plus récent ; `contient` restreint au jeton d'un espace.
 * La même règle pour le signal « Lien pas encore envoyé », « Lien jamais ouvert » et le choix du SMS avec le lien ;
 * c'est aussi le texte, pas le code, qui passe la main au client après un SMS copié (`sms/catalogue › porteLienEspace`).
 */
export async function liensEnvoyes(contient: string | readonly string[] = "/e/"): Promise<{ texte: string; createdAt: Date }[]> {
  // Relecture de la partie A : plusieurs motifs (les codes des espaces lus) bornent la lecture à ces espaces.
  const motifs = typeof contient === "string" ? [contient] : [...new Set(contient)];
  if (motifs.length === 0) return [];
  const texte = motifs.length === 1 ? { texte: { contains: motifs[0] } } : { OR: motifs.map((m) => ({ texte: { contains: m } })) };
  const contenu = motifs.length === 1 ? { contenu: { contains: motifs[0] } } : { OR: motifs.map((m) => ({ contenu: { contains: m } })) };
  const [sms, mails, evenements] = await Promise.all([
    prisma.sms.findMany({ where: { sens: "SORTANT", ...texte, statut: { not: "ECHEC" } }, select: { texte: true, createdAt: true } }),
    prisma.envoiMail.findMany({ where: { ...texte, statut: { in: ["A_ENVOYER", "ENVOYE"] } }, select: { texte: true, createdAt: true } }),
    prisma.dossierEvenement.findMany({ where: { type: { in: TYPES_LIEN_COMMUNIQUE }, ...contenu }, select: { contenu: true, createdAt: true, survenuLe: true } }),
  ]);
  const communiques = evenements.map((e) => ({ texte: e.contenu, createdAt: e.survenuLe ?? e.createdAt }));
  return [...sms, ...mails, ...communiques].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function listerEspaces(maintenant: Date = new Date(), filtre: FiltreEspaces = {}, options: OptionsEspaces = {}): Promise<LigneEspace[]> {
  const gratuites = await simulationsGratuites();
  const espaces = await prisma.espaceClient.findMany({
    where: filtre.permanentId
      ? { permanentId: filtre.permanentId }
      : filtre.permanentIds || filtre.espaceIds
        ? { OR: [{ permanentId: { in: filtre.permanentIds ?? [] } }, { id: { in: filtre.espaceIds ?? [] } }] }
        : {},
    include: {
      // Archives comprises : une simulation retirée par Lucas a coûté, elle reste comptée dans le quota.
      simulations: { where: { ...AVEC_ARCHIVES }, select: { id: true, statut: true, source: true, publieeLe: true, archiveLe: true, zones: true, choisieLe: true } },
      permanent: true,
      dossier: {
        select: {
          id: true,
          clientId: true,
          leadId: true,
          clientNom: true,
          clientVille: true,
          clientTelephone: true,
          clientEmail: true,
          etape: true,
          photos: true,
          dateChantier: true,
          archiveLe: true,
          main: true,
          mainMotif: true,
          prochaineAction: true,
          prochaineActionDate: true,
          objet: true,
          source: true,
          prestations: true,
          lead: { select: { typeProjet: true } },
          // Mission 14 (R4) : les mêmes colonnes que l'espace du client (faits.ts).
          documents: lectureDesDevis(),
          accords: { orderBy: { createdAt: "desc" } },
          encaissements: { select: { montant: true, moyen: true, recuLe: true, statut: true } },
          evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, createdAt: true, survenuLe: true } },
        },
      },
    },
  });
  const vivants = espaces.filter((e) => !e.dossier.archiveLe);
  const dossierIds = vivants.map((e) => e.dossierId);
  // Relecture de la partie A : les envois du lien ne se lisent que pour ces espaces (`/e/<code>-` : le code du client et
  // celui du projet, toutes versions), sauf pour une longue liste, où le motif commun coûte moins qu'une longue suite de OU.
  const motifs = [...new Set(vivants.flatMap((e) => [`/e/${(e.permanent ?? e).code}-`, `/e/${e.code}-`]))];
  const [activites, envoisDuLien, avecSimulation, rendus] = await Promise.all([
    dossierIds.length
      ? prisma.dossierEvenement.groupBy({ by: ["dossierId"], where: { dossierId: { in: dossierIds }, direction: "ENTRANT", type: { startsWith: "ESPACE_" } }, _max: { createdAt: true } })
      : Promise.resolve([] as { dossierId: string; _max: { createdAt: Date | null } }[]),
    motifs.length > MOTIFS_LIEN_MAX ? liensEnvoyes() : liensEnvoyes(motifs),
    // La règle de la relance photos : un client qui a fait une simulation n'est jamais « en attente de ses photos ».
    dossiersAvecSimulation(vivants.map((e) => e.dossier)),
    // Les rendus du site rangés dans les photos, d'une requête pour toute la liste (une par dossier auparavant).
    rendusDesDossiers(dossierIds),
  ]);
  const activiteParDossier = new Map(activites.map((a) => [a.dossierId, a._max.createdAt]));

  const lignes: LigneEspace[] = [];
  for (const espace of vivants) {
    const d = espace.dossier;
    // Le lien envoyé est celui du client (son espace permanent) ; un lien d'avant le 22/09 portait le code du projet.
    const signable = espace.permanent ?? espace;
    const jeton = jetonEspace(signable);
    const envoi = envoisDuLien.find((s) => s.texte.includes(`/e/${jeton}`)) ?? null;
    const ancienEnvoi = envoi ? null : (envoisDuLien.find((s) => s.texte.includes(`/e/${espace.code}-`)) ?? null);
    const photos = (await photosDuClient(d.id, d.photos, rendus.get(d.id))).length;
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
      // Mission 18 (B11) : la même lecture que l'espace du client (service.ts) : un choix daté mais illisible n'en est pas un.
      choix: Boolean(espace.choixLe && lireChoixEspace(espace.choix)),
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
    // Mission 13 (lot 5, B6) : les lectures sont comptées sur le devis lui-même.
    const consultations = devis?.consultations ?? 0;
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
    if (!envoi && !espace.premierAccesLe && !revoque) signaux.push({ code: "NON_ENVOYE", libelle: ancienEnvoi ? "Nouveau lien pas encore envoyé" : "Lien pas encore envoyé", ton: "gris" });
    if (expire && !revoque) signaux.push({ code: "EXPIRE", libelle: "Lien expiré", ton: "rouge" });
    else if (!espace.permanent && !revoque && espace.expireLe.getTime() - maintenant.getTime() < 10 * JOUR) signaux.push({ code: "EXPIRE_BIENTOT", libelle: `Lien valable jusqu'au ${espace.expireLe.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`, ton: "ambre" });

    // Le geste qui fera avancer, d'après les faits de l'espace : il nomme l'action quand c'est à moi.
    let geste: { libelle: string; geste?: LigneEspace["attente"]["geste"] } | null = null;
    if (propositionEnAttente) geste = { libelle: "Préparer une autre proposition", geste: "SIMULATEUR" };
    else if (espace.simulationsDemandeesLe && !accord) geste = { libelle: "Accorder d'autres simulations", geste: "ACCORDER" };
    else if (brouillons > 0 && !accord) geste = { libelle: `Publier ${brouillons > 1 ? "les brouillons" : "le brouillon"}`, geste: "PUBLIER" };
    else if (photos > 0 && aucuneSimulation && !devis) geste = { libelle: "Préparer la simulation", geste: "SIMULATEUR" };
    else if (etape === "ATTENTE_DEVIS") geste = { libelle: "Faire le devis", geste: "DEVIS" };
    else if (accord && !d.dateChantier) geste = { libelle: "Appeler : fixer la date du chantier", geste: "APPELER" };
    else if (etape === "CHANTIER") geste = { libelle: d.dateChantier ? `Chantier le ${d.dateChantier.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : "Chantier à planifier" };

    // QUI a la main : la règle unique du dossier (dossiers/main.ts), la même que le kanban et la fiche dossier.
    const main = mainDe({ etape: d.etape as EtapeDossier, prochaineActionDate: d.prochaineActionDate?.toISOString() ?? null, main: d.main === "MOI" || d.main === "CLIENT" ? d.main : null }, maintenant);
    // Mission 14 (partie 6) : un motif de lien (espace ouvert, lien envoyé) ne suppose pas ce qui manque ; ce que le
    // client a vraiment à faire se lit sur l'étape de son espace (photos, projet, choix de simulation, devis…).
    const motifLisible = d.mainMotif && !d.mainMotif.startsWith("Étape «") ? (estMotifDeLien(d.mainMotif) ? attenteDuClient(etape, { simulation: avecSimulation.has(d.id) }) : d.mainMotif) : null;
    let attente: LigneEspace["attente"];
    if (revoque) attente = { qui: "PERSONNE", libelle: "Lien désactivé" };
    else if (figeDuProjet(d.etape) === "NON_REALISE") attente = { qui: "PERSONNE", libelle: "Non réalisé" };
    else if (etape === "TERMINE" || main === "AUCUNE") attente = { qui: "PERSONNE", libelle: "Chantier terminé" };
    else if (main === "A_RELANCER") attente = { qui: "MOI", libelle: `Relancer : ${d.prochaineAction ?? motifLisible ?? LIBELLES_ETAPE_ESPACE[etape]}`, geste: "APPELER" };
    // Mission 14 (R2) : un message du client sans réponse passe avant le geste déduit de l'espace.
    else if (main === "MOI" && motifLisible && estMotifRepondre(motifLisible)) attente = { qui: "MOI", libelle: motifLisible };
    else if (main === "MOI") attente = geste ? { qui: "MOI", ...geste } : { qui: "MOI", libelle: motifLisible ?? "À toi de jouer" };
    else attente = { qui: "CLIENT", libelle: motifLisible ?? LIBELLES_ETAPE_ESPACE[etape] };

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
      email: d.clientEmail || null,
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
        devis: devis ? { numero: devis.numero!, consultations, consulteLe: consultations > 0 ? date(devis.consulteLe ?? null) : null } : null,
        devisProposes: lecture.proposes.filter((d) => d.visibleEspace !== false || d.statut === "ACCEPTE").length,
        accord: accord ? accord.createdAt.toISOString() : null,
        accordSource: accord?.source ?? null,
        acompte,
        paiement: accord && lecture.paiement ? { total: lecture.paiement.total, recu: lecture.paiement.recu, reste: lecture.paiement.reste, regle: lecture.paiement.regle } : null,
      },
      attente,
      signaux,
    });
  }

  // Mission 17 (partie A) : la vue des tâches (une lecture groupée pour toute la liste), avant le tri (l'attente peut changer).
  const vues = options.signauxBruts ? lignes : await appliquerLesTaches(lignes, maintenant);
  const poids = (l: LigneEspace) => (l.attente.qui === "MOI" ? 0 : l.attente.qui === "CLIENT" ? 1 : 2);
  return vues.sort((a, b) => poids(a) - poids(b) || (b.derniereActivite ?? b.creeLe).localeCompare(a.derniereActivite ?? a.creeLe));
}

/** Mission 17 (partie A) : les projets tels que l'écran les montre (a-faire/vue-espaces.ts). */
async function appliquerLesTaches(lignes: LigneEspace[], maintenant: Date): Promise<LigneEspace[]> {
  if (lignes.length === 0) return lignes;
  const vue = await lireVueDesTaches(maintenant, clesDesProjets(lignes), lignes.map((l) => l.dossierId));
  return lignes.map((l) => appliquerAuProjet(l, vue));
}

/**
 * Les espaces clients, PAR CLIENT (mission 5) : un client, son lien, ses
 * visites, ses projets et où il en est dans chacun. Le plus pressé de ses projets
 * donne la main ; ses signaux (nouveau projet ouvert par le client, projet de plus
 * demandé, téléphone à confirmer) s'ajoutent à ceux de ses projets.
 */
export async function listerClientsEspaces(maintenant: Date = new Date(), filtre: FiltreEspaces = {}, options: OptionsEspaces = {}): Promise<ClientEspace[]> {
  const bruts = await listerEspaces(maintenant, filtre, { signauxBruts: true });
  const permanents = await prisma.espacePermanent.findMany({ where: { id: { in: [...new Set(bruts.map((l) => l.permanentId).filter((id): id is string => Boolean(id)))] } } });
  const parId = new Map(permanents.map((p) => [p.id, p]));
  // Mission 17 (partie A) : la vue des tâches, lue une fois pour les projets ET les signaux des clients.
  const vue = options.signauxBruts
    ? null
    : await lireVueDesTaches(
        maintenant,
        [...clesDesProjets(bruts), ...permanents.map((p) => cleDuSignal("PROJET_DEMANDE", { clientId: p.clientId })).filter((c): c is string => Boolean(c))],
        bruts.map((l) => l.dossierId)
      );
  const lignes = vue ? bruts.map((l) => appliquerAuProjet(l, vue)) : bruts;
  const visible = (clientId: string | null, signal: Signal) => !vue || signalDuClientVisible(vue, clientId, signal);
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
    const signauxDuClient: Signal[] = [];
    const nouveaux = projets.filter((p) => p.creeParLeClient && !p.fige && p.etape === "PHOTOS");
    if (nouveaux.length) signauxDuClient.push({ code: "NOUVEAU_PROJET", libelle: `Nouveau projet ouvert par le client : ${nouveaux.map((p) => p.nomProjet).join(", ")}`, ton: "rouge" });
    if (permanent?.projetDemandeLe) signauxDuClient.push({ code: "PROJET_DEMANDE", libelle: "Demande à ouvrir un projet de plus", ton: "rouge" });
    if (permanent && confirmationRequise(permanent, maintenant)) signauxDuClient.push({ code: "CONFIRMATION_DEMANDEE", libelle: "Plus de 90 jours sans visite : il confirmera son téléphone", ton: "gris" });
    const signaux = signauxDuClient.filter((signal) => visible(permanent?.clientId ?? null, signal));
    const projetDemande = signaux.some((signal) => signal.code === "PROJET_DEMANDE");
    const activites = projets.map((p) => p.derniereActivite).filter((x): x is string => Boolean(x)).sort();
    clients.push({
      permanentId: permanent?.id ?? cle,
      clientId: permanent?.clientId ?? "",
      clientNom: tete.clientNom,
      ville: tete.ville,
      telephone: tete.telephone,
      email: tete.email,
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
      attente: projetDemande ? { qui: "MOI", libelle: "Accorder un projet de plus, ou l'appeler" } : tete.attente,
      signaux: [...signaux, ...projets.flatMap((p) => p.signaux.map((sig) => (projets.length > 1 ? { ...sig, libelle: `${p.nomProjet} : ${sig.libelle}` } : sig)))],
      // Les projets en cours d'abord, les plus pressés en tête ; les projets passés ensuite.
      projets: [...projets].sort((a, b) => Number(Boolean(a.fige)) - Number(Boolean(b.fige)) || poids(a.attente.qui) - poids(b.attente.qui) || b.creeLe.localeCompare(a.creeLe)),
    });
  }
  return clients.sort((a, b) => poids(a.attente.qui) - poids(b.attente.qui) || (b.derniereActivite ?? b.lienEmisLe).localeCompare(a.derniereActivite ?? a.lienEmisLe));
}

/**
 * Mission 13 (lot 6) — une page de clients (50) : les clés des clients (espace
 * permanent, ou projet isolé) se lisent d'une requête légère, rangées par
 * dernière activité ; les faits ne se calculent que pour la page demandée.
 */
export async function pageClientsEspaces(maintenant: Date = new Date(), options: { page?: number; parPage?: number } = {}): Promise<PageEspaces> {
  const { page, parPage, skip, take } = tranche(options.page, options.parPage);
  const legers = await prisma.espaceClient.findMany({ select: { id: true, permanentId: true, dernierAccesLe: true, createdAt: true } });
  const activite = new Map<string, number>();
  for (const espace of legers) {
    const cle = espace.permanentId ?? `projet:${espace.id}`;
    const derniere = Math.max(espace.dernierAccesLe?.getTime() ?? 0, espace.createdAt.getTime());
    activite.set(cle, Math.max(activite.get(cle) ?? 0, derniere));
  }
  const cles = [...activite.entries()].sort((a, b) => b[1] - a[1]).map(([cle]) => cle);
  const total = cles.length;
  const tranchee = cles.slice(skip, skip + take);
  const permanentIds = tranchee.filter((cle) => !cle.startsWith("projet:"));
  const espaceIds = tranchee.filter((cle) => cle.startsWith("projet:")).map((cle) => cle.slice("projet:".length));
  const clients = tranchee.length > 0 ? await listerClientsEspaces(maintenant, { permanentIds, espaceIds }) : [];
  return { clients, total, page, parPage };
}

/** Le résumé d'un projet pour la colonne « Espace » de Dossiers. */
function resumeDuProjet(projet: LigneEspace, signauxDuClient: Signal[], attente: LigneEspace["attente"]): EspaceResume {
  const f = projet.faits;
  return {
    espaceId: projet.espaceId,
    etape: projet.etape,
    etapeLibelle: projet.etapeLibelle,
    fige: projet.fige,
    revoque: projet.revoque,
    lienEnvoyeLe: projet.lienEnvoyeLe,
    premierAccesLe: projet.premierAccesLe,
    dernierAccesLe: projet.dernierAccesLe,
    nbAcces: projet.nbAcces,
    creeLe: projet.creeLe,
    derniereActivite: projet.derniereActivite,
    photos: f.photos,
    simulations: f.simulationsPubliees + f.simulationsClient + f.simulationsSite,
    devis: f.devis ? { numero: f.devis.numero, consultations: f.devis.consultations } : null,
    accord: Boolean(f.accord),
    attente,
    signaux: [...signauxDuClient, ...projet.signaux],
  };
}

/**
 * Mission 18 (A1) — l'état de l'espace de ces dossiers (la colonne et le filtre « Espaces » de Dossiers), par la même
 * lecture que l'ancien onglet (`listerClientsEspaces` : vue des tâches comprise). Les projets de leurs clients sont lus
 * en entier : les signaux du client (projet de plus demandé, nouveau projet, téléphone à confirmer) et sa demande
 * d'un projet de plus (« à moi ») vont à son projet le plus récent. Un dossier sans espace n'est pas dans la table.
 */
export async function espacesDesDossiers(maintenant: Date, dossierIds: readonly string[]): Promise<Map<string, EspaceResume>> {
  const resultat = new Map<string, EspaceResume>();
  if (dossierIds.length === 0) return resultat;
  const projets = await prisma.espaceClient.findMany({ where: { dossierId: { in: [...dossierIds] } }, select: { id: true, permanentId: true } });
  if (projets.length === 0) return resultat;
  const permanentIds = [...new Set(projets.map((p) => p.permanentId).filter((id): id is string => Boolean(id)))];
  const espaceIds = projets.filter((p) => !p.permanentId).map((p) => p.id);
  const voulus = new Set(dossierIds);
  for (const client of await listerClientsEspaces(maintenant, { permanentIds, espaceIds })) {
    const recent = [...client.projets].sort((a, b) => b.creeLe.localeCompare(a.creeLe))[0];
    const signauxDuClient = client.signaux.filter((s) => CODES_SIGNAL_CLIENT.includes(s.code));
    const projetDemande = signauxDuClient.some((s) => s.code === "PROJET_DEMANDE");
    for (const projet of client.projets) {
      if (!voulus.has(projet.dossierId)) continue;
      const deTete = projet.espaceId === recent?.espaceId;
      resultat.set(projet.dossierId, resumeDuProjet(projet, deTete ? signauxDuClient : [], deTete && projetDemande ? client.attente : projet.attente));
    }
  }
  return resultat;
}
