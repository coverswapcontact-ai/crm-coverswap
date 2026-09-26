import { promises as fs } from "fs";
import path from "path";
import prisma from "@/lib/prisma";
import { canauxConfigures, pushDisponible } from "@/lib/alertes/configuration";
import { lireFichier, lirePhotos } from "@/lib/dossiers/stockage";
import { etatMiroir } from "@/lib/drive/synchronisation";
import { chargerLivre } from "@/lib/finances/livre";
import { listerLeads } from "@/lib/prospects/leads";
import { etatFournisseur } from "@/lib/sms/fournisseurs";
import { resolveUploadsDir } from "@/lib/uploads";
import { pluriel } from "@/lib/commun/format";

/**
 * Audit de connectivité : chaque maillon du CRM, vérifié sur les VRAIES données,
 * en lecture seule. Rien n'est créé, rien n'est envoyé : on regarde si ce qui
 * devait arriver est arrivé (le lead a sa pastille et son push, la simulation
 * a son dossier et ses photos, le document est dans Drive, l'accord a signé le
 * dossier, l'encaissement est dans le livre des recettes…).
 *
 * Visible dans Tâches de fond, et écrit dans les journaux du serveur au
 * démarrage : la production se vérifie sans rien y fabriquer.
 */
export type EtatMaillon = "OK" | "ALERTE" | "RIEN_A_VERIFIER";
export type Maillon = { cle: string; libelle: string; etat: EtatMaillon; constat: string; chiffres: Record<string, number>; aFaire?: string };
export type AuditConnexions = { le: string; dureeMs: number; maillons: Maillon[]; alertes: number };

type Resultat = Omit<Maillon, "cle" | "libelle">;

const JOUR_MS = 86_400_000;
const DEBUT_DU_PUSH = new Date("2026-09-21T00:00:00.000Z");
const ETAPES_AVANT_SIGNATURE = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE"];

async function maillon(cle: string, libelle: string, verifier: () => Promise<Resultat>): Promise<Maillon> {
  try {
    return { cle, libelle, ...(await verifier()) };
  } catch (erreur) {
    return { cle, libelle, etat: "ALERTE", constat: `Vérification impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`.slice(0, 300), chiffres: {} };
  }
}

/** Un lead Meta arrive : il a sa pastille, il est dans Leads (ou dans Dossiers), et le téléphone a sonné. */
function leadsMeta() {
  return maillon("lead-meta", "Lead Meta → Leads, pastille, push", async (): Promise<Resultat> => {
    // Seuls comptent les leads pour lesquels une notification a été TENTÉE (ou aurait dû l'être : reçus depuis le 21/09/2026).
    // Les leads historiques repris de Zapier n'ont jamais sonné : ce n'est pas une panne.
    const recents = await prisma.metaLead.findMany({ where: { leadId: { not: null }, OR: [{ notifications: { not: null } }, { createdAt: { gte: DEBUT_DU_PUSH } }] }, orderBy: { createdAt: "desc" }, take: 30, select: { leadId: true, pousseLe: true, notifieLe: true, createdAt: true } });
    if (recents.length === 0) return { etat: "RIEN_A_VERIFIER", constat: "Aucun lead Meta reçu depuis la mise en place du push (les leads historiques repris de Zapier ne comptent pas) : la chaîne se vérifiera au premier lead, elle est couverte par les essais automatiques.", chiffres: { leadsMeta: 0 } };
    const leads = await prisma.lead.findMany({ where: { id: { in: recents.map((r) => r.leadId as string) } }, select: { id: true, priorite: true, dossiers: { select: { id: true } } } });
    const dansLeads = new Set((await listerLeads({ limite: 500 })).lignes.map((l) => l.id));
    const sansPastille = leads.filter((l) => !l.priorite).length;
    const nullePart = leads.filter((l) => l.dossiers.length === 0 && !dansLeads.has(l.id)).length;
    const actifs = new Set(leads.map((l) => l.id));
    const sansPush = recents.filter((r) => actifs.has(r.leadId as string) && !r.pousseLe).length;
    const ok = sansPastille === 0 && sansPush === 0;
    return {
      etat: ok ? "OK" : "ALERTE",
      constat: ok ? `Les ${leads.length} derniers leads Meta actifs ont leur pastille et ont fait sonner le téléphone.` : `${pluriel(sansPastille, "lead")} sans pastille, ${pluriel(sansPush, "lead")} sans push abouti.`,
      chiffres: { leadsMeta: leads.length, sansPastille, sansPush, sansSuiteOuClasses: nullePart },
      aFaire: sansPush > 0 ? "Écran Publicité → « Tester la notification » : le canal en échec y est nommé." : undefined,
    };
  });
}

/** Section Leads : aucun doublon avec Dossiers, et chaque ligne a sa pastille. */
function sectionLeads() {
  return maillon("leads", "Leads : sans dossier, sans doublon, pastille lisible", async (): Promise<Resultat> => {
    const { lignes, compteurs } = await listerLeads({ limite: 500 });
    // Seul un lead du simulateur pas encore appelé a le droit d'être ici avec son dossier (même contact, même dossier, deux vues).
    const permis = new Set(lignes.filter((l) => l.simulation && l.dossierId && l.attendDepuis).map((l) => l.id));
    const avecDossier = await prisma.lead.count({ where: { id: { in: lignes.filter((l) => !permis.has(l.id)).map((l) => l.id) }, dossiers: { some: { archiveLe: null } } } });
    const sansPastille = lignes.filter((l) => !l.priorite).length;
    const sansNumero = lignes.filter((l) => !l.telephoneLien).length;
    const plusieursDossiers = (await prisma.dossier.groupBy({ by: ["leadId"], where: { leadId: { not: null }, etape: { notIn: ["PERDU", "ENCAISSE"] } }, _count: { _all: true } })).filter((g) => g._count._all > 1).length;
    const ok = avecDossier === 0 && plusieursDossiers === 0;
    return {
      etat: ok ? (lignes.length === 0 ? "RIEN_A_VERIFIER" : "OK") : "ALERTE",
      constat: ok
        ? `${pluriel(compteurs.actifs, "lead")} en cours, dont ${compteurs.aAppeler} à appeler (${permis.size} du simulateur, dossier déjà ouvert, pas encore appelés) ; aucun autre n'a de dossier.${sansPastille ? ` ${pluriel(sansPastille, "lead")} pas encore classé${sansPastille > 1 ? "s" : ""}.` : ""}`
        : `${pluriel(avecDossier, "lead")} affiché${avecDossier > 1 ? "s" : ""} alors qu'un dossier existe ; ${pluriel(plusieursDossiers, "contact")} avec plusieurs dossiers vivants.`,
      chiffres: { enCours: compteurs.actifs, aAppeler: compteurs.aAppeler, simulationsAAppeler: permis.size, sansSuite: compteurs.sansSuite, sansPastille, sansNumeroLisible: sansNumero, doublonsAvecDossiers: avecDossier, contactsAPlusieursDossiers: plusieursDossiers },
    };
  });
}

/** Dossier ouvert depuis un lead : tout a suivi (client, coordonnées, note de reprise). */
function dossiersDepuisLeads() {
  return maillon("lead-dossier", "Dossier ouvert depuis un lead : informations reprises", async (): Promise<Resultat> => {
    const dossiers = await prisma.dossier.findMany({ where: { leadId: { not: null } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, clientId: true, clientTelephone: true, clientNom: true, lead: { select: { clientId: true, telephone: true } } } });
    if (dossiers.length === 0) return { etat: "RIEN_A_VERIFIER", constat: "Aucun dossier ouvert depuis un lead pour l'instant.", chiffres: { dossiers: 0 } };
    const sansClient = dossiers.filter((d) => !d.clientId).length;
    const autreClient = dossiers.filter((d) => d.clientId && d.lead?.clientId && d.clientId !== d.lead.clientId).length;
    const sansTelephone = dossiers.filter((d) => d.lead?.telephone?.trim() && !d.clientTelephone.trim()).length;
    const ok = sansClient + autreClient + sansTelephone === 0;
    return {
      etat: ok ? "OK" : "ALERTE",
      constat: ok ? `${pluriel(dossiers.length, "dossier issu", "dossiers issus")} d'un lead : fiche client commune, coordonnées reprises.` : `${sansClient} sans fiche client, ${autreClient} rattachés à une autre fiche que leur lead, ${sansTelephone} sans le téléphone du lead.`,
      chiffres: { dossiers: dossiers.length, sansClient, autreClient, sansTelephone },
    };
  });
}

/** Simulation du site : le dossier existe, la photo avant et le rendu sont dans ses photos (donc dans Drive). */
function simulations() {
  // Règle du 22/09/2026 : une simulation seule n'ouvre plus de dossier (elle reste sur la fiche du lead).
  // Ce qui est vérifié : celles d'un contact qui A un dossier vivant y sont bien rangées, photos comprises.
  return maillon("simulation-dossier", "Simulation du site → fiche du lead, ou dossier du contact s'il en a un", async (): Promise<Resultat> => {
    const avecImage = { OR: [{ imageBeforePath: { not: null } }, { imageAfterPath: { not: null } }, { imageOriginalPath: { not: null } }] };
    const [total, sansDossier, surLeurLead, rangees] = await Promise.all([
      prisma.simulation.count({ where: { ...avecImage, lead: { archiveLe: null } } }),
      prisma.simulation.count({ where: { ...avecImage, dossierId: null, lead: { archiveLe: null, dossiers: { some: { archiveLe: null, etape: { notIn: ["PERDU", "ENCAISSE"] } } } } } }),
      prisma.simulation.count({ where: { ...avecImage, dossierId: null, lead: { archiveLe: null, dossiers: { none: { archiveLe: null, etape: { notIn: ["PERDU", "ENCAISSE"] } } } } } }),
      prisma.simulation.findMany({ where: { ...avecImage, dossierId: { not: null } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, dossierId: true, imageAfterPath: true } }),
    ]);
    if (total === 0) return { etat: "RIEN_A_VERIFIER", constat: "Aucune simulation avec image en base.", chiffres: { simulations: 0 } };
    // Le rendu est-il réellement dans les photos de son dossier ? (présent sur le disque des téléversements ⇒ attendu dans le dossier)
    const evenements = await prisma.dossierEvenement.findMany({ where: { type: "SIMULATION_SITE", dossierId: { in: rangees.map((s) => s.dossierId as string) } }, select: { dossierId: true, metadata: true } });
    const imagesAttendues = new Map<string, number>();
    for (const evenement of evenements) imagesAttendues.set(evenement.dossierId, (imagesAttendues.get(evenement.dossierId) ?? 0) + (Number((JSON.parse(evenement.metadata || "{}") as { images?: number }).images) || 0));
    const dossiers = await prisma.dossier.findMany({ where: { id: { in: [...imagesAttendues.keys()] } }, select: { id: true, photos: true } });
    let photosManquantes = 0;
    let fichiersAbsents = 0;
    for (const dossier of dossiers) {
      const chemins = lirePhotos(dossier.photos);
      if (chemins.length < (imagesAttendues.get(dossier.id) ?? 0)) photosManquantes++;
      for (const chemin of chemins.slice(0, 6)) if (!(await lireFichier(chemin))) fichiersAbsents++;
    }
    const imagesPerdues = (await Promise.all(rangees.slice(0, 30).map(async (s) => (s.imageAfterPath ? fs.stat(path.join(resolveUploadsDir(), s.imageAfterPath)).then(() => 0, () => 1) : 0)))).reduce((a: number, b) => a + b, 0);
    const ok = sansDossier === 0 && photosManquantes === 0 && fichiersAbsents === 0;
    return {
      etat: ok ? "OK" : "ALERTE",
      constat: ok
        ? `${pluriel(total, "simulation")} avec image : ${surLeurLead} sur la fiche de leur lead (pas de dossier : normal), les autres rangées dans le dossier du contact, photos comprises.${imagesPerdues ? ` (${pluriel(imagesPerdues, "rendu")} d'origine absents des téléversements : dit sur le dossier.)` : ""}`
        : `${pluriel(sansDossier, "simulation")} hors du dossier que leur contact a pourtant (reprises au prochain passage, toutes les 15 min) ; ${pluriel(photosManquantes, "dossier")} avec moins de photos qu'attendu ; ${pluriel(fichiersAbsents, "fichier absent", "fichiers absents")} du disque.`,
      chiffres: { simulations: total, surLaFicheDuLead: surLeurLead, sansDossier, dossiersVerifies: dossiers.length, photosManquantes, fichiersAbsents, rendusDOrigineAbsents: imagesPerdues },
    };
  });
}

/** Drive : le miroir tourne, documents et photos y sont. */
function drive() {
  return maillon("drive", "Documents et photos → Google Drive", async (): Promise<Resultat> => {
    const etat = await etatMiroir();
    if (!etat.actif) return { etat: "ALERTE", constat: "Le miroir Drive est inactif : aucun compte Google connecté. Rien n'est perdu (le CRM reste la référence), mais rien n'arrive dans Drive.", chiffres: { elements: 0 }, aFaire: "Paramètres → Connexions → connecter le compte Google." };
    const [documents, documentsAJour, photosAJour, dossiersAvecPhotos] = await Promise.all([
      prisma.document.count({ where: { pdfPath: { not: null } } }),
      prisma.miroirDrive.count({ where: { cle: { startsWith: "document:" }, etat: "A_JOUR" } }),
      prisma.miroirDrive.count({ where: { cle: { startsWith: "photo:" }, etat: "A_JOUR" } }),
      prisma.dossier.findMany({ where: { photos: { not: "[]" } }, select: { photos: true } }),
    ]);
    const photos = dossiersAvecPhotos.reduce((n, d) => n + lirePhotos(d.photos).length, 0);
    const ageHeures = etat.dernierPassage ? Math.round((Date.now() - new Date(etat.dernierPassage).getTime()) / 3_600_000) : null;
    const retard = documents - documentsAJour + (photos - photosAJour);
    const ok = etat.enErreur.length === 0 && (ageHeures === null || ageHeures <= 26);
    return {
      etat: ok ? "OK" : "ALERTE",
      constat: ok
        ? `${pluriel(documentsAJour, "document")} sur ${documents} et ${pluriel(photosAJour, "photo")} sur ${photos} dans Drive${retard > 0 ? ` ; ${retard} en attente du prochain passage` : ""}. Dernier passage il y a ${ageHeures ?? "?"} h.`
        : `${pluriel(etat.enErreur.length, "élément")} en erreur${ageHeures !== null && ageHeures > 26 ? `, dernier passage il y a ${ageHeures} h` : ""}. ${etat.enErreur[0] ? `Exemple : ${etat.enErreur[0].nom} — ${etat.enErreur[0].erreur}` : ""}`.slice(0, 400),
      chiffres: { documents, documentsDansDrive: documentsAJour, photos, photosDansDrive: photosAJour, enErreur: etat.enErreur.length, heuresDepuisDernierPassage: ageHeures ?? -1 },
      aFaire: ok ? undefined : "Paramètres → Connexions → « Synchroniser maintenant », puis relire ce maillon.",
    };
  });
}

/** Espace client : photos rangées dans le dossier, bon pour accord = dossier signé, gestes notifiés. */
function espaceClient() {
  return maillon("espace-client", "Espace client → dossier, Drive, Signé, notification", async (): Promise<Resultat> => {
    const [espaces, depots, accords] = await Promise.all([
      prisma.espaceClient.count(),
      prisma.dossierEvenement.findMany({ where: { type: "ESPACE_PHOTOS" }, select: { dossierId: true, metadata: true } }),
      prisma.accordDevis.findMany({ where: { retireLe: null }, select: { dossierId: true, dossier: { select: { etape: true } } } }),
    ]);
    if (espaces === 0) return { etat: "RIEN_A_VERIFIER", constat: "Aucun espace client ouvert pour l'instant : la chaîne est couverte par les essais automatiques, elle se vérifiera ici au premier client.", chiffres: { espaces: 0 } };
    const attendues = new Map<string, number>();
    for (const depot of depots) attendues.set(depot.dossierId, (attendues.get(depot.dossierId) ?? 0) + (Number((JSON.parse(depot.metadata || "{}") as { nombre?: number }).nombre) || 0));
    const dossiers = await prisma.dossier.findMany({ where: { id: { in: [...attendues.keys()] } }, select: { id: true, photos: true } });
    const photosManquantes = dossiers.filter((d) => lirePhotos(d.photos).length < (attendues.get(d.id) ?? 0)).length;
    const accordsNonSignes = accords.filter((a) => ETAPES_AVANT_SIGNATURE.includes(a.dossier.etape)).length;
    const alertes = await prisma.alerteEnvoi.findMany({ where: { origine: { in: ["espace-client", "espace-accord"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { pousse: true } });
    const gestes = depots.length + accords.length;
    const pushRates = alertes.filter((a) => !a.pousse).length;
    const ok = photosManquantes === 0 && accordsNonSignes === 0 && pushRates === 0 && (gestes === 0 || alertes.length > 0);
    return {
      etat: ok ? "OK" : "ALERTE",
      constat: ok
        ? `${pluriel(espaces, "espace ouvert", "espaces ouverts")}, ${pluriel(depots.length, "dépôt de photos rangé", "dépôts de photos rangés")} dans leur dossier, ${pluriel(accords.length, "bon")} pour accord : tous les dossiers concernés sont signés. ${pluriel(alertes.length, "notification partie", "notifications parties")}, toutes abouties.`
        : `${pluriel(photosManquantes, "dossier")} avec moins de photos que déposé ; ${pluriel(accordsNonSignes, "accord")} sans passage en Signé ; ${pluriel(pushRates, "notification")} sans push abouti${gestes > 0 && alertes.length === 0 ? " ; aucun envoi de notification enregistré" : ""}.`,
      chiffres: { espaces, depotsDePhotos: depots.length, photosManquantes, accords: accords.length, accordsNonSignes, notifications: alertes.length, notificationsSansPush: pushRates },
    };
  });
}

/** Un encaissement alimente les finances : chaque paiement valide de l'année est dans le livre des recettes. */
function encaissements() {
  return maillon("encaissement-finances", "Encaissement → livre des recettes", async (): Promise<Resultat> => {
    const annee = new Date().getFullYear();
    const debut = new Date(`${annee}-01-01T00:00:00.000Z`);
    const recus = await prisma.encaissement.findMany({ where: { statut: "VALIDE", recuLe: { gte: debut }, NOT: { moyen: "CHEQUE", crediteLe: null } }, select: { id: true, montant: true } });
    if (recus.length === 0) return { etat: "RIEN_A_VERIFIER", constat: `Aucun encaissement validé en ${annee}.`, chiffres: { encaissements: 0 } };
    const livre = await chargerLivre(`${annee}-01-01`, `${annee}-12-31`);
    const dansLeLivre = new Set(livre.lignes.map((ligne) => ligne.encaissementId));
    const absents = recus.filter((e) => !dansLeLivre.has(e.id)).length;
    const total = Math.round(recus.reduce((somme, e) => somme + e.montant, 0));
    return {
      etat: absents === 0 ? "OK" : "ALERTE",
      constat: absents === 0 ? `${pluriel(recus.length, "encaissement")} validé${recus.length > 1 ? "s" : ""} en ${annee} (${total.toLocaleString("fr-FR")} €) : tous figurent au livre des recettes, donc dans Finances.` : `${pluriel(absents, "encaissement")} absent${absents > 1 ? "s" : ""} du livre des recettes.`,
      chiffres: { encaissements: recus.length, totalEuros: total, absentsDuLivre: absents, reglesManquantes: livre.manquants.length },
    };
  });
}

/** Le téléphone sonne : canaux posés, derniers envois aboutis. */
function notifications() {
  return maillon("notifications", "Notifications : canaux et derniers envois", async (): Promise<Resultat> => {
    const canaux = canauxConfigures();
    const depuis = new Date(Date.now() - 14 * JOUR_MS);
    const envois = await prisma.alerteEnvoi.findMany({ where: { createdAt: { gte: depuis }, origine: { notIn: ["demarrage", "essai"] } }, select: { pousse: true } });
    const sansPush = envois.filter((e) => !e.pousse).length;
    const dernierPush = await prisma.alerteEnvoi.findFirst({ where: { pousse: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true, origine: true } });
    const pousses = canaux.filter((c) => c !== "mail");
    const ok = pushDisponible() && sansPush === 0;
    return {
      etat: ok ? "OK" : "ALERTE",
      constat: `Canaux poussés actifs : ${pousses.join(", ") || "aucun"}. ${pluriel(envois.length, "alerte")} en 14 jours, ${sansPush} sans push abouti.${dernierPush ? ` Dernier push : ${dernierPush.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (${dernierPush.origine}).` : " Aucun push abouti enregistré."}`,
      chiffres: { canauxPousses: pousses.length, alertes14Jours: envois.length, sansPush },
      aFaire: pousses.length < 2 ? "Un seul canal poussé : poser Telegram (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) et activer les notifications de l'application installée." : undefined,
    };
  });
}

/** SMS : sans fournisseur, l'accusé de réception et les relances ne partent pas. */
function sms() {
  return maillon("sms", "SMS : fournisseur branché", async (): Promise<Resultat> => {
    const fournisseur = etatFournisseur();
    const enAttente = await prisma.sms.count({ where: { sens: "SORTANT", statut: "A_ENVOYER" } });
    const reel = fournisseur.nom && fournisseur.nom !== "simulateur";
    return {
      etat: reel && fournisseur.bidirectionnel ? "OK" : "ALERTE",
      constat: reel ? `Fournisseur : ${fournisseur.nom}${fournisseur.bidirectionnel ? " (envoi et réponses)" : " (envoi seul : le client ne peut pas répondre)"}. ${enAttente} SMS en attente d'envoi.` : `Aucun fournisseur réel : ${fournisseur.remarque ?? ""} ${enAttente} SMS en attente.`,
      chiffres: { smsEnAttente: enAttente, variablesAPoser: fournisseur.aPoser.length },
      aFaire: reel && fournisseur.bidirectionnel ? undefined : `Poser sur Railway : ${fournisseur.aPoser.join(", ") || "les variables OVH"} (Paramètres → Messagerie SMS).`,
    };
  });
}

export async function auditerConnexions(): Promise<AuditConnexions> {
  const debut = Date.now();
  const maillons = await Promise.all([leadsMeta(), sectionLeads(), dossiersDepuisLeads(), simulations(), drive(), espaceClient(), encaissements(), notifications(), sms()]);
  return { le: new Date().toISOString(), dureeMs: Date.now() - debut, maillons, alertes: maillons.filter((m) => m.etat === "ALERTE").length };
}

/** Une ligne par maillon dans les journaux du serveur : la production se relit sans session. */
export async function journaliserAudit(): Promise<void> {
  try {
    const audit = await auditerConnexions();
    console.log(`[audit] connectivité — ${audit.maillons.length - audit.alertes}/${audit.maillons.length} maillons sans alerte (${audit.dureeMs} ms)`);
    for (const m of audit.maillons) console.log(`[audit] ${m.etat === "OK" ? "OK    " : m.etat === "ALERTE" ? "ALERTE" : "—     "} ${m.libelle} : ${m.constat} ${JSON.stringify(m.chiffres)}`);
  } catch (erreur) {
    console.error("[audit] audit de connectivité impossible :", erreur);
  }
}
