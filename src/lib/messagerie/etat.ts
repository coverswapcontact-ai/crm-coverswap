/**
 * Mission 25 — l'état d'un suivi, lu dans le CRM (dossier, lead, client, espace, devis, paiements, appels, messages) :
 * ce que le planificateur, la garde et « Où on en est » lisent, et l'histoire dont le journal tire ses lignes. Une
 * lecture par suivi, sans écriture.
 */
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { estMotifRepondre } from "@/lib/dossiers/main";
import { photosDuClient } from "@/lib/espace/service";
import { dossiersAvecSimulation } from "@/lib/espace/simulations-faites";
import { famillesDe, lireSelection } from "@/lib/prestations/prestations";
import { estMobileFrancais } from "@/lib/sms/texte";
import { definitionMessage, estCodeMessage, type CodeMessage, type EtapeRelance } from "./catalogue";
import { momentParis } from "./horaires";
import { pieceDe, prenomFiable } from "./texte";
import { lireFaits, type AppelLu, type EnvoiLu, type EtatSuivi, type MessageClientLu, type MessageConnu, type StatutMessage } from "./types";
import { zoneDe } from "./zone";

/** Un élément de l'histoire du suivi, prêt à devenir une ligne de journal (clé stable : rejouable sans doublon). */
export type ElementHistoire = { cle: string; le: Date; acteur: "CLIENT" | "TOI" | "IA" | "CRM"; texte: string; client: boolean };

export type SuiviLu = {
  id: string;
  leadId: string | null;
  dossierId: string | null;
  clientId: string | null;
  faits: string;
  pauseJusquau: Date | null;
  pauseMotif: string | null;
  stopLe: Date | null;
  demarrageDoux: boolean;
  validationForcee: boolean;
};

/** Types d'événement qui disent un geste du client (écrit, a répondu, a agi) — pas une simple visite ni une lecture. */
export const TYPES_GESTE_CLIENT = [
  "MAIL_RECU",
  "SMS_RECU",
  "WHATSAPP_RECU",
  "ESPACE_MESSAGE",
  "ESPACE_COMMENTAIRE",
  "ESPACE_NOUVELLE_PROPOSITION",
  "ESPACE_PHOTOS",
  "ESPACE_DEVIS_ACCEPTE",
  "ESPACE_SIMULATION_CHOISIE",
  "ESPACE_SIMULATIONS_DEMANDEES",
  "ESPACE_PROJET_VALIDE",
  "ESPACE_SOUHAITS",
  "ESPACE_AVIS",
];
const TYPES_MESSAGE_CLIENT: Record<string, "SMS" | "ESPACE" | "MAIL"> = {
  SMS_RECU: "SMS",
  ESPACE_MESSAGE: "ESPACE",
  ESPACE_COMMENTAIRE: "ESPACE",
  ESPACE_NOUVELLE_PROPOSITION: "ESPACE",
  MAIL_RECU: "MAIL",
  WHATSAPP_RECU: "SMS",
};

const ISSUES: Record<string, string> = { "Intéressé": "INTERESSE", "À rappeler": "A_RAPPELER", "Pas de réponse": "PAS_DE_REPONSE", "Pas intéressé": "PAS_INTERESSE" };
function issueDuContenu(contenu: string): string | null {
  for (const [libelle, issue] of Object.entries(ISSUES)) if (contenu.includes(libelle)) return issue;
  return null;
}

/** Le texte entre guillemets français d'un contenu d'événement, sinon le contenu après « … : ». */
export function texteCite(contenu: string): string {
  const cite = contenu.match(/«\s*([\s\S]*?)\s*»\s*$/);
  if (cite) return cite[1];
  const deuxPoints = contenu.indexOf(" : ");
  return deuxPoints > 0 && deuxPoints < 60 ? contenu.slice(deuxPoints + 3) : contenu;
}

const extrait = (texte: string, n = 60) => {
  const t = texte.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function lireJson(json: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Les anciens codes du catalogue SMS (mission 14) ramenés à une étape de relance, pour compter les relances déjà faites. */
function etapeAncienCode(code: string, metadata: Record<string, unknown>): EtapeRelance | null {
  const relance = metadata.relance as { type?: string; documentId?: string } | undefined;
  if (relance?.documentId || code.startsWith("RELANCE_DEVIS")) return "DEVIS";
  if (relance?.type === "PHOTOS") return "PHOTOS";
  if (relance?.type === "AVIS" || code === "DEMANDE_AVIS") return "AVIS";
  if (relance?.type === "REACTIVATION" || code === "REACTIVATION") return "REACTIVATION";
  return null;
}

/** Une ligne de journal pour un événement du dossier (null : bruit, ou déjà dit par la messagerie). */
function ligneDeLEvenement(e: { id: string; type: string; direction: string; contenu: string; metadata: string; le: Date }): ElementHistoire | null {
  const m = lireJson(e.metadata);
  const cle = `ev:${e.id}`;
  const client = (texte: string) => ({ cle, le: e.le, acteur: "CLIENT" as const, texte, client: true });
  const toi = (texte: string) => ({ cle, le: e.le, acteur: "TOI" as const, texte, client: false });
  const crm = (texte: string) => ({ cle, le: e.le, acteur: "CRM" as const, texte, client: false });
  switch (e.type) {
    case "SMS_RECU":
    case "WHATSAPP_RECU":
      return client(`« ${extrait(texteCite(e.contenu))} »`);
    case "ESPACE_MESSAGE":
    case "ESPACE_COMMENTAIRE":
      return client(`« ${extrait(texteCite(e.contenu))} » (espace)`);
    case "ESPACE_NOUVELLE_PROPOSITION":
      return client("Demande une autre proposition (espace)");
    case "MAIL_RECU":
      return client(`Mail : « ${extrait(texteCite(e.contenu))} »`);
    case "ESPACE_PHOTOS":
      return client(`${typeof m.nombre === "number" ? `${m.nombre} photo${m.nombre > 1 ? "s" : ""}` : "Photos"} déposée${m.nombre === 1 ? "" : "s"} dans l'espace`);
    case "ESPACE_DEVIS_CONSULTE":
      return client(`Devis ouvert${typeof m.consultations === "number" && m.consultations > 1 ? ` (${m.consultations} fois)` : ""}`);
    case "ESPACE_DEVIS_ACCEPTE":
      return client("Accord donné sur le devis");
    case "ESPACE_SIMULATION_CHOISIE":
      return client("Simulation choisie");
    case "ESPACE_PROJET_VALIDE":
      return client("Projet validé dans l'espace");
    case "ESPACE_AVIS":
      return client("Avis donné");
    case "SMS_COPIE":
      if (m.messageId) return null; // la messagerie a déjà écrit « … envoyé »
      return toi(`SMS envoyé : « ${extrait(typeof m.texte === "string" ? m.texte : texteCite(e.contenu))} »`);
    case "SMS_ENVOYE":
      return toi(`SMS envoyé : « ${extrait(texteCite(e.contenu))} »`);
    case "ESPACE_REPONSE":
      return toi(`Réponse dans l'espace : « ${extrait(texteCite(e.contenu))} »`);
    case "MAIL_ENVOYE":
      return toi(`Mail envoyé : « ${extrait(texteCite(e.contenu))} »`);
    case "APPEL":
      return toi(extrait(e.contenu.replace(/^Appel — /, "Appel : "), 90));
    case "NOTE_APPEL":
      return toi(`Note après appel : ${extrait(e.contenu.replace(/^Note d'appel\s*:?\s*/i, ""), 80)}`);
    case "NOTE_AJOUTEE":
      if (m.documentId) return null;
      return toi(`Note : ${extrait(e.contenu, 80)}`);
    case "DEVIS_ENVOYE":
      return toi("Devis mis en ligne");
    case "ESPACE_SIMULATION_DEPOSEE":
      return toi("Simulation publiée");
    case "CHANGEMENT_ETAPE": {
      if (m.nature === "OUVERTURE") return crm("Dossier ouvert");
      const vers = typeof m.vers === "string" ? m.vers : null;
      return vers ? crm(`Étape : ${vers.toLowerCase().replace(/_/g, " ")}`) : null;
    }
    case "ENCAISSEMENT_ENREGISTRE":
      return crm(`Paiement reçu${typeof m.montant === "number" ? ` (${Math.round(m.montant)} €)` : ""}`);
    case "SIMULATION_SITE":
      return client("Simulation faite sur le site");
    case "ESPACE_DEMANDE_SITE":
      return client("Demande envoyée depuis le site");
    default:
      return null;
  }
}

export async function chargerEtat(suivi: SuiviLu, lancement: Date, maintenant: Date): Promise<{ etat: EtatSuivi; histoire: ElementHistoire[] }> {
  const [lead, dossier] = await Promise.all([
    suivi.leadId ? prisma.lead.findUnique({ where: { id: suivi.leadId } }) : null,
    suivi.dossierId ? prisma.dossier.findUnique({ where: { id: suivi.dossierId } }) : null,
  ]);
  const clientId = dossier?.clientId ?? lead?.clientId ?? suivi.clientId ?? null;
  const client = clientId
    ? await prisma.client.findUnique({
        where: { id: clientId },
        select: {
          prenom: true,
          nomFamille: true,
          telephones: { where: { archiveLe: null }, orderBy: { principal: "desc" }, select: { numero: true } },
          emails: { where: { archiveLe: null }, orderBy: { principale: "desc" }, select: { adresse: true } },
          consentements: { orderBy: { recueilliLe: "desc" }, take: 1, select: { statut: true } },
        },
      })
    : null;

  const telephone = normaliserTelephone(dossier?.clientTelephone || lead?.telephone || client?.telephones[0]?.numero || null);
  const email = dossier?.clientEmail || lead?.email || client?.emails[0]?.adresse || null;
  const numeros = [telephone, normaliserTelephone(lead?.telephone), normaliserTelephone(dossier?.clientTelephone)].filter((n): n is string => Boolean(n));
  const conversations = numeros.length ? await prisma.conversationSms.findMany({ where: { ...AVEC_ARCHIVES, numero: { in: [...new Set(numeros)] } }, select: { id: true, numero: true, stopLe: true, premierEnvoiLe: true } }) : [];

  const evenements = dossier
    ? (await prisma.dossierEvenement.findMany({ where: { dossierId: dossier.id }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, direction: true, contenu: true, metadata: true, createdAt: true, survenuLe: true } })).map((e) => ({ ...e, le: e.survenuLe ?? e.createdAt }))
    : [];
  const interactions = lead ? await prisma.interaction.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, contenu: true, createdAt: true } }) : [];
  const notesAppel = lead && !dossier ? await prisma.noteAppel.findMany({ where: { leadId: lead.id }, orderBy: { appelLe: "asc" }, select: { id: true, texte: true, appelLe: true, issue: true } }) : [];
  const smsLus = conversations.length
    ? await prisma.sms.findMany({ where: { conversationId: { in: conversations.map((c) => c.id) } }, orderBy: { createdAt: "asc" }, select: { id: true, sens: true, texte: true, statut: true, createdAt: true, recuLe: true, envoyeLe: true, dossierId: true } })
    : [];
  const messages = await prisma.messagePrepare.findMany({ where: { ...AVEC_ARCHIVES, suiviId: suivi.id }, orderBy: { createdAt: "asc" } });

  // ── Espace, photos, simulations, devis, accord, paiements ────────────────
  const espace = dossier ? await prisma.espaceClient.findUnique({ where: { dossierId: dossier.id }, include: { permanent: true } }) : null;
  const photos = dossier ? await photosDuClient(dossier.id, dossier.photos) : [];
  const evenementsPhotos = evenements.filter((e) => e.type === "ESPACE_PHOTOS");
  const simulations = dossier
    ? await prisma.simulationEspace.findMany({ where: { dossierId: dossier.id, statut: "PUBLIEE" }, orderBy: { createdAt: "asc" }, select: { id: true, publieeLe: true, createdAt: true, vueLe: true, source: true } })
    : [];
  const avecSimulation = dossier ? await dossiersAvecSimulation([{ id: dossier.id, clientId: dossier.clientId, leadId: dossier.leadId }]) : new Set<string>();
  const documents = dossier
    ? await prisma.document.findMany({ where: { dossierId: dossier.id, type: "DEVIS", visibleEspace: true, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, select: { id: true, numero: true, totalHt: true, dateEmission: true, statut: true, consultations: true, consulteLe: true } })
    : [];
  const misEnLigne = evenements.filter((e) => e.type === "DEVIS_ENVOYE");
  const consultes = evenements.filter((e) => e.type === "ESPACE_DEVIS_CONSULTE");
  const devis = documents
    .map((d) => {
      const enLigne = misEnLigne.find((e) => e.metadata.includes(d.id));
      const enLigneLe = enLigne?.le ?? (d.statut === "ENVOYE" || d.statut === "ACCEPTE" ? d.dateEmission : null);
      if (!enLigneLe) return null;
      const premiere = consultes.find((e) => e.metadata.includes(d.id));
      return { id: d.id, numero: d.numero, totalHt: d.totalHt, enLigneLe, premiereOuvertureLe: d.consultations > 0 ? premiere?.le ?? d.consulteLe : null, consultations: d.consultations, consulteLe: d.consulteLe };
    })
    .filter((d): d is NonNullable<typeof d> => Boolean(d));
  const accord = dossier ? await prisma.accordDevis.findFirst({ where: { dossierId: dossier.id, retireLe: null }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, documentId: true } }) : null;
  const paiements = dossier ? await prisma.encaissement.findMany({ where: { dossierId: dossier.id, statut: "VALIDE" }, orderBy: { recuLe: "asc" }, select: { id: true, recuLe: true, createdAt: true } }) : [];
  const acompte = paiements.find((p) => !accord || p.createdAt.getTime() >= accord.createdAt.getTime() - 86_400_000) ?? null;
  const finChantier = evenements.find((e) => e.type === "CHANGEMENT_ETAPE" && /"vers":"(FACTURE|ENCAISSE)"/.test(e.metadata) && !/"de":"(FACTURE|ENCAISSE)"/.test(e.metadata));
  const chantierFiniLe = finChantier?.le ?? (dossier?.dateFinChantier && dossier.dateFinChantier.getTime() < maintenant.getTime() && ["FACTURE", "ENCAISSE"].includes(dossier.etape) ? dossier.dateFinChantier : null);

  // ── Appels ───────────────────────────────────────────────────────────────
  const appels: AppelLu[] = [
    ...evenements.filter((e) => e.type === "APPEL").map((e) => {
      const issue = (lireJson(e.metadata).issue as string | undefined) ?? issueDuContenu(e.contenu);
      return { le: e.le, issue: issue ?? null, repondu: Boolean(issue && issue !== "PAS_DE_REPONSE") };
    }),
    ...(!dossier
      ? interactions.filter((i) => i.type === "APPEL").map((i) => {
          const issue = issueDuContenu(i.contenu);
          return { le: i.createdAt, issue, repondu: Boolean(issue && issue !== "PAS_DE_REPONSE") };
        })
      : []),
  ].sort((a, b) => a.le.getTime() - b.le.getTime());
  let tentativesSansReponse = 0;
  for (const appel of appels) tentativesSansReponse = appel.repondu ? 0 : tentativesSansReponse + 1;

  // ── Messages du client et gestes ─────────────────────────────────────────
  const messagesClient: MessageClientLu[] = [
    ...evenements.filter((e) => e.direction === "ENTRANT" && TYPES_MESSAGE_CLIENT[e.type]).map((e) => {
      const photos = Number(lireJson(e.metadata).photos ?? 0);
      return { id: `ev:${e.id}`, le: e.le, texte: texteCite(e.contenu), canal: TYPES_MESSAGE_CLIENT[e.type], ...(photos > 0 ? { photos } : {}) };
    }),
    ...(!dossier ? smsLus.filter((s) => s.sens === "ENTRANT").map((s) => ({ id: `sms:${s.id}`, le: s.recuLe ?? s.createdAt, texte: s.texte, canal: "SMS" as const })) : []),
  ].sort((a, b) => a.le.getTime() - b.le.getTime());
  const gestes = [
    ...evenements.filter((e) => e.direction === "ENTRANT" && TYPES_GESTE_CLIENT.includes(e.type)).map((e) => e.le),
    ...messagesClient.map((m) => m.le),
    ...appels.filter((a) => a.repondu).map((a) => a.le),
  ];
  const dernierGesteClientLe = gestes.length ? new Date(Math.max(...gestes.map((d) => d.getTime()))) : null;

  // ── Envois (tout ce qui est parti vers le client) ────────────────────────
  const idsMessagerie = new Set(messages.map((m) => m.id));
  const envois: EnvoiLu[] = [
    ...messages
      .filter((m) => m.statut === "ENVOYE" && m.envoyeLe)
      .map((m) => {
        const definition = estCodeMessage(m.code) ? definitionMessage(m.code as CodeMessage) : null;
        return { le: m.envoyeLe!, code: m.code, canal: m.canal as EnvoiLu["canal"], relance: definition?.nature === "RELANCE", etape: definition?.etape ?? null, texte: m.texteEnvoye ?? m.texte };
      }),
    ...messages
      .filter((m) => m.statut === "NON_ENVOYE" && m.envoyeLe && (m.motif ?? "").startsWith("DEJA_FAIT_TELEPHONE"))
      .map((m) => {
        const definition = estCodeMessage(m.code) ? definitionMessage(m.code as CodeMessage) : null;
        return { le: m.envoyeLe!, code: m.code, canal: "TELEPHONE" as const, relance: definition?.nature === "RELANCE", etape: definition?.etape ?? null, texte: null };
      }),
    ...evenements
      .filter((e) => e.type === "SMS_COPIE" || e.type === "SMS_ENVOYE" || e.type === "MAIL_ENVOYE" || e.type === "ESPACE_REPONSE")
      .filter((e) => !idsMessagerie.has(String(lireJson(e.metadata).messageId ?? "")))
      // Un message de l'espace envoyé depuis la messagerie a aussi sa trace ESPACE_REPONSE : la même, pas un second envoi.
      .filter((e) => !(e.type === "ESPACE_REPONSE" && messages.some((m) => m.statut === "ENVOYE" && m.canal === "ESPACE" && m.envoyeLe && Math.abs(m.envoyeLe.getTime() - e.le.getTime()) < 10 * 60_000)))
      .map((e) => {
        const m = lireJson(e.metadata);
        const code = typeof m.code === "string" ? m.code : typeof m.modele === "string" ? m.modele : null;
        const relanceMail = e.type === "MAIL_ENVOYE" && e.metadata.includes("RELANCE_DEVIS");
        const etape = relanceMail ? "DEVIS" : code ? etapeAncienCode(code, m) : null;
        return { le: e.le, code: null, canal: e.type === "MAIL_ENVOYE" ? "MAIL" : e.type === "ESPACE_REPONSE" ? "ESPACE" : "SMS", relance: Boolean(etape), etape, texte: texteCite(e.contenu) } as EnvoiLu;
      }),
    ...(!dossier
      ? [
          ...interactions.filter((i) => i.type === "SMS" && !/^SMS reçu/.test(i.contenu) && !/^Messagerie — /.test(i.contenu)).map((i) => ({ le: i.createdAt, code: null, canal: "SMS" as const, relance: /RELANCE|REACTIVATION/.test(i.contenu), etape: /REACTIVATION/.test(i.contenu) ? ("REACTIVATION" as const) : null, texte: texteCite(i.contenu) })),
          ...smsLus.filter((s) => s.sens === "SORTANT" && s.statut !== "ECHEC").map((s) => ({ le: s.envoyeLe ?? s.createdAt, code: null, canal: "SMS" as const, relance: false, etape: null, texte: s.texte })),
        ]
      : []),
  ].sort((a, b) => a.le.getTime() - b.le.getTime());
  const premierSms = !envois.some((e) => e.canal === "SMS") && !conversations.some((c) => c.premierEnvoiLe);

  // ── Main, rappel, pause ──────────────────────────────────────────────────
  const dernierMessageClient = messagesClient.at(-1) ?? null;
  const dernierEnvoi = envois.at(-1) ?? null;
  const attendReponse = dossier
    ? dossier.main === "MOI" && estMotifRepondre(dossier.mainMotif)
    : Boolean(dernierMessageClient && (!dernierEnvoi || dernierEnvoi.le.getTime() < dernierMessageClient.le.getTime()) && !appels.some((a) => a.repondu && a.le.getTime() > dernierMessageClient.le.getTime()));
  const rappelDossier = dossier?.prochaineAction && /^rappeler/i.test(dossier.prochaineAction) && (dossier.prochaineActionInstant ?? dossier.prochaineActionDate) ? { le: (dossier.prochaineActionInstant ?? dossier.prochaineActionDate)!, motif: dossier.prochaineAction.replace(/^Rappeler\s*/i, "").replace(/^\((.*)\)$/, "$1") } : null;
  const rappel = rappelDossier ?? (lead?.rappelLe ? { le: lead.rappelLe, motif: "" } : null);

  const faits = lireFaits(suivi.faits);
  const familles = dossier ? famillesDe(lireSelection(dossier.prestations)) : [];
  const piece = pieceDe(familles, lead?.typeProjet);
  if (faits.canalPrefere === "INCONNU" && (espace?.premierAccesLe || espace?.permanent?.premierAccesLe)) faits.canalPrefere = "LIEN";
  const lienCommunique = Boolean(espace && (espace.premierAccesLe || espace.permanent?.premierAccesLe || envois.some((e) => (e.texte ?? "").includes("/e/"))));
  const heure = dossier?.dateChantier ? momentParis(dossier.dateChantier).minutes : null;
  const heureChantier = dossier?.dateChantier && !(dossier.dateChantier.getUTCHours() === 12 && dossier.dateChantier.getUTCMinutes() === 0) ? heure : null;

  const etat: EtatSuivi = {
    suiviId: suivi.id,
    lancement,
    cible: { leadId: lead?.id ?? suivi.leadId, dossierId: dossier?.id ?? null, clientId },
    nom: dossier?.clientNom || [lead?.prenom, lead?.nom].filter((x) => x && !/^inconnu$/i.test(x)).join(" ") || "Contact sans nom",
    prenom: prenomFiable([{ prenom: client?.prenom, nom: client?.nomFamille }, { prenom: lead?.prenom, nom: lead?.nom }]),
    telephone,
    mobile: estMobileFrancais(telephone),
    email,
    stop: Boolean(suivi.stopLe || conversations.some((c) => c.stopLe)),
    piece,
    familles,
    zone: zoneDe(dossier?.clientVille || lead?.ville, dossier?.clientCp || lead?.codePostal).zone,
    ville: dossier?.clientVille || lead?.ville || null,
    lead: lead
      ? { id: lead.id, creeLe: lead.createdAt, source: lead.source, statut: lead.statut, tentatives: lead.tentatives, dernierAppelLe: lead.dernierAppelLe, rappelLe: lead.rappelLe, perteLe: lead.perteLe, motifPerte: lead.motifPerte, archive: Boolean(lead.archiveLe), priorite: lead.priorite }
      : null,
    dossier: dossier
      ? {
          id: dossier.id,
          ouvertLe: dossier.ouvertLe ?? dossier.createdAt,
          etape: dossier.etape,
          perteLe: dossier.perteLe,
          motifPerte: dossier.motifPerte,
          dateChantier: dossier.dateChantier,
          heureChantier,
          archive: Boolean(dossier.archiveLe),
          main: dossier.main,
          mainMotif: dossier.mainMotif,
          prochaineAction: dossier.prochaineAction,
          prochaineActionDate: dossier.prochaineActionInstant ?? dossier.prochaineActionDate,
          montantEstime: dossier.montantEstime,
        }
      : null,
    espace: espace
      ? {
          ouvertLe: espace.createdAt,
          premierAccesLe: espace.premierAccesLe ?? espace.permanent?.premierAccesLe ?? null,
          dernierAccesLe: espace.dernierAccesLe ?? espace.permanent?.dernierAccesLe ?? null,
          lienEmisLe: espace.permanent?.lienEmisLe ?? espace.createdAt,
          lienCommunique,
        }
      : null,
    photos: {
      nombre: photos.length,
      premiereLe: evenementsPhotos[0]?.le ?? null,
      derniereLe: evenementsPhotos.at(-1)?.le ?? null,
    },
    simulations: simulations.map((s) => ({ id: s.id, publieeLe: s.publieeLe ?? s.createdAt, vueLe: s.vueLe, source: s.source })),
    simulationsVuesLe: espace?.simulationsVuesLe ?? null,
    simulationFaiteSurLeSite: Boolean(dossier && avecSimulation.has(dossier.id) && !simulations.length),
    devis,
    accord: accord ? { id: accord.id, le: accord.createdAt, documentId: accord.documentId } : null,
    acompte: acompte ? { id: acompte.id, le: acompte.createdAt } : null,
    chantierFiniLe,
    avisLe: espace?.avisLe ?? null,
    consentementCommercial: client?.consentements[0]?.statut === "ACCORDE",
    appels,
    tentativesSansReponse,
    dernierGesteClientLe,
    messagesClient,
    attendReponse,
    rappel,
    pause: suivi.pauseJusquau ? { jusquau: suivi.pauseJusquau, motif: suivi.pauseMotif } : null,
    envois,
    premierSms,
    faits,
    messages: messages.map(
      (m): MessageConnu => ({
        id: m.id,
        code: m.code,
        cle: m.cle,
        statut: m.statut as StatutMessage,
        prevuLe: m.prevuLe,
        envoyeLe: m.envoyeLe,
        createdAt: m.createdAt,
        ouvertLe: m.ouvertLe,
        nonConfirmeLe: m.nonConfirmeLe,
        reponse: m.reponse,
        douceur: m.douceur,
      })
    ),
    demarrageDoux: suivi.demarrageDoux,
    validationForcee: suivi.validationForcee,
  };

  // ── Histoire (lignes de journal possibles) ───────────────────────────────
  const histoire: ElementHistoire[] = [];
  if (lead) histoire.push({ cle: `lead:${lead.id}`, le: lead.createdAt, acteur: "CRM", texte: `Lead reçu${lead.source === "META_ADS" ? " (Meta)" : lead.source.startsWith("SITE") ? " (site)" : ""}`, client: false });
  for (const e of evenements) {
    const ligne = ligneDeLEvenement(e);
    if (ligne) histoire.push(ligne);
  }
  if (!dossier) {
    for (const i of interactions) {
      if (i.type === "APPEL") histoire.push({ cle: `in:${i.id}`, le: i.createdAt, acteur: "TOI", texte: extrait(i.contenu.replace(/^Appel — /, "Appel : "), 90), client: false });
      else if (i.type === "NOTE" && !/^Lead (Meta|reçu)/i.test(i.contenu)) histoire.push({ cle: `in:${i.id}`, le: i.createdAt, acteur: "TOI", texte: `Note : ${extrait(i.contenu, 80)}`, client: false });
      else if (i.type === "SMS" && /^(SMS envoyé|SMS \w+ copié)/.test(i.contenu)) histoire.push({ cle: `in:${i.id}`, le: i.createdAt, acteur: "TOI", texte: `SMS envoyé : « ${extrait(texteCite(i.contenu))} »`, client: false });
    }
    for (const n of notesAppel) if (n.texte.trim()) histoire.push({ cle: `na:${n.id}`, le: n.appelLe, acteur: "TOI", texte: `Note après appel : ${extrait(n.texte, 80)}`, client: false });
    for (const s of smsLus) if (s.sens === "ENTRANT") histoire.push({ cle: `sms:${s.id}`, le: s.recuLe ?? s.createdAt, acteur: "CLIENT", texte: `« ${extrait(s.texte)} »`, client: true });
  }
  histoire.sort((a, b) => a.le.getTime() - b.le.getTime() || a.cle.localeCompare(b.cle));
  return { etat, histoire };
}
