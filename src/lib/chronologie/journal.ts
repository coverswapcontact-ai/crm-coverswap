import prisma from "@/lib/prisma";
import { LIBELLES_ISSUE, type IssueAppel } from "@/lib/commercial/constantes";
import { euros } from "@/lib/commun/format";
import { LIBELLES_ETAPE, LIBELLES_TYPE_EVENEMENT, type EtapeDossier, type TypeEvenement } from "@/lib/dossiers/constants";
import { LIBELLES_MOYEN, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { enregistrerParametre, lireParametre } from "@/lib/parametres/service";
import { ADRESSE_SYSTEME } from "@/lib/parametres/sections";
import { traitementDe, travauxPeriodiques } from "@/lib/taches/registre";
import { familleDeLEvenement } from "./chronologie";
import type { EntreeChronologie } from "./familles";

/**
 * Mission 22 (A1) — le journal global « Depuis ta dernière visite » : un fil unique, en lecture seule, de tout ce qui
 * s'est passé dans le CRM entre deux instants, toutes personnes confondues. Il complète `chronologie.ts` (le fil d'un
 * contact) sans le toucher : mêmes libellés, mêmes liens, une lecture par date au lieu d'une lecture par cible.
 *
 * Ce qu'il réunit (docs/CRM-V2.md § Journal) : mails entrants hors bruit, messages du client dans son espace, SMS
 * reçus, gestes du client dans son espace (dont « devis relu N fois »), devis et factures, paiements, appels, étape,
 * main et prochaine action, relances et notifications parties, propositions (à valider, avec les gestes ; ignorées,
 * en échec, exécutées), ce que Claude a modifié par le connecteur, et les faits système utiles (tâche de fond en échec
 * définitif, travail périodique en échec, alerte non remise, la sauvegarde du jour en une ligne).
 *
 * Trois filtres : CLIENTS (ce que les personnes ont fait ou reçu), ARGENT (documents et paiements), SYSTEME (Claude,
 * tâches de fond, alertes). Le bruit est groupé (même type, même dossier, même document → `occurrences`) ; les
 * battements (visites répétées, travaux périodiques réussis, alertes remises) n'y sont pas. Aucune ligne brute :
 * chaque entrée est une phrase. `depuis` est borné à 30 jours (`JOURS_MAX_JOURNAL`) : chaque source est lue par
 * date, avec une prise bornée, puis triée en mémoire.
 */

export { FILTRES_JOURNAL, LIBELLES_FILTRE_JOURNAL, type EntreeJournal, type FiltreJournal, type ResultatJournal } from "./journal-types";
import { FILTRES_JOURNAL, type EntreeJournal, type FiltreJournal, type ResultatJournal } from "./journal-types";

/** Au-delà, la lecture serait trop large pour une liste lue sur un téléphone (et pour les index de la base). */
export const JOURS_MAX_JOURNAL = 30;
/** Sans « Tout vu » encore posé : les deux derniers jours. */
export const HEURES_PAR_DEFAUT = 48;
export const PAR_PAGE_DEFAUT = 50;
const PAR_PAGE_MAX = 200;
/** Prise par source : au-delà, la période est trop large pour être lue d'un coup (on garde les plus récents). */
const PRISE = 500;
const JOUR_MS = 86_400_000;

export const CLE_JOURNAL_VU = "JOURNAL_VU_LE";

type Brute = EntreeJournal & { cleGroupe?: string };
type Periode = { depuis: Date; jusqua: Date };

const court = (texte: string | null | undefined, n = 240): string | null => {
  const t = (texte ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : null;
};
const lireJson = (texte: string | null | undefined): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(texte || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const chaine = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const lienDe = (ids: { dossierId?: string | null; leadId?: string | null; clientId?: string | null }, sinon: string | null = null): string | null =>
  ids.dossierId ? `/dossiers?dossier=${ids.dossierId}` : ids.leadId ? `/leads?lead=${ids.leadId}` : ids.clientId ? `/clients/${ids.clientId}` : sinon;

/** `depuis` jamais plus de 30 jours avant `jusqua`, et jamais après. */
export function bornerPeriode(depuis: Date, jusqua: Date = new Date()): Periode {
  const plancher = new Date(jusqua.getTime() - JOURS_MAX_JOURNAL * JOUR_MS);
  const d = depuis.getTime() < plancher.getTime() ? plancher : depuis.getTime() > jusqua.getTime() ? jusqua : depuis;
  return { depuis: d, jusqua };
}

function base(e: Partial<Brute> & Pick<Brute, "id" | "le" | "type" | "titre" | "filtre">): Brute {
  return {
    famille: "DOSSIER",
    texte: null,
    direction: "INTERNE",
    lien: null,
    messageId: null,
    dossierId: null,
    clientNom: null,
    clientId: null,
    leadId: null,
    occurrences: 1,
    acteur: null,
    ...e,
  };
}

/* ── Les sources, une fonction chacune ─────────────────────────────────────── */

async function mailsEntrants({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const mails = await prisma.message.findMany({
    where: { canal: "EMAIL", sens: "ENTRANT", recuLe: { gte: depuis, lte: jusqua }, OR: [{ classe: null }, { classe: { not: "BRUIT" } }] },
    orderBy: { recuLe: "desc" },
    take: PRISE,
    select: { id: true, de: true, deNom: true, objet: true, extrait: true, intentionAttendu: true, recuLe: true, clientId: true, leadId: true, dossierId: true },
  });
  return mails.map((m) =>
    base({
      id: `mail:${m.id}`,
      le: m.recuLe.toISOString(),
      famille: "MAIL",
      type: "MAIL_RECU",
      titre: `Mail reçu de ${m.deNom ?? m.de} — ${m.objet ?? "(sans objet)"}`,
      texte: court([m.extrait, m.intentionAttendu ? `Attendu : ${m.intentionAttendu}` : null].filter(Boolean).join(" · ")),
      direction: "ENTRANT",
      lien: `/mail?mail=${m.id}`,
      messageId: m.id,
      dossierId: m.dossierId,
      clientId: m.clientId,
      leadId: m.leadId,
      clientNom: m.deNom,
      filtre: "CLIENTS",
    })
  );
}

const TITRES_MESSAGE_ESPACE: Record<string, { type: string; titre: string }> = {
  MESSAGE: { type: "ESPACE_MESSAGE", titre: "Message du client depuis son espace" },
  COMMENTAIRE: { type: "ESPACE_COMMENTAIRE", titre: "Commentaire du client sur une simulation" },
  PROPOSITION: { type: "ESPACE_NOUVELLE_PROPOSITION", titre: "Autre proposition demandée par le client" },
};

/** Les messages du client dans son espace ; l'événement jumeau du dossier (`evenementId`) est exclu par l'appelant. */
async function messagesDuClient({ depuis, jusqua }: Periode): Promise<{ entrees: Brute[]; evenementsJumeaux: Set<string> }> {
  const messages = await prisma.messageEspace.findMany({
    where: { auteur: "CLIENT", createdAt: { gte: depuis, lte: jusqua } },
    orderBy: { createdAt: "desc" },
    take: PRISE,
    select: { id: true, dossierId: true, source: true, texte: true, createdAt: true, evenementId: true },
  });
  const evenementsJumeaux = new Set(messages.map((m) => m.evenementId).filter((id): id is string => Boolean(id)));
  const entrees = messages.map((m) => {
    const t = TITRES_MESSAGE_ESPACE[m.source] ?? TITRES_MESSAGE_ESPACE.MESSAGE;
    return base({ id: `message-espace:${m.id}`, le: m.createdAt.toISOString(), famille: "ESPACE", type: t.type, titre: t.titre, texte: court(`« ${m.texte} »`), direction: "ENTRANT", lien: `/dossiers?dossier=${m.dossierId}`, dossierId: m.dossierId, filtre: "CLIENTS" });
  });
  return { entrees, evenementsJumeaux };
}

const TITRES_SMS_AUTOMATIQUE: Record<string, string> = { RELANCE: "Relance envoyée par SMS", ACCUSE_AUTO: "Accusé de réception envoyé par SMS", LIEN_ESPACE: "Lien de l'espace envoyé par SMS" };

/** Les SMS reçus, et les SMS partis sans geste (relance, accusé automatique, lien de l'espace). */
async function sms({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const lignes = await prisma.sms.findMany({
    where: { createdAt: { gte: depuis, lte: jusqua }, OR: [{ sens: "ENTRANT" }, { sens: "SORTANT", origine: { in: Object.keys(TITRES_SMS_AUTOMATIQUE) } }] },
    orderBy: { createdAt: "desc" },
    take: PRISE,
    select: { id: true, sens: true, texte: true, statut: true, origine: true, createdAt: true, recuLe: true, dossierId: true, leadId: true, clientId: true, conversation: { select: { nomAffiche: true, numero: true } } },
  });
  return lignes.map((s) => {
    const entrant = s.sens === "ENTRANT";
    const echec = s.statut === "ECHEC";
    return base({
      id: `sms:${s.id}`,
      le: (entrant ? (s.recuLe ?? s.createdAt) : s.createdAt).toISOString(),
      famille: "MAIL",
      type: entrant ? "SMS_RECU" : "SMS_ENVOYE",
      titre: entrant ? "SMS reçu" : `${TITRES_SMS_AUTOMATIQUE[s.origine] ?? "SMS envoyé"}${echec ? " : échec, rien n'est parti" : ""}`,
      texte: court(`« ${s.texte} »`),
      direction: entrant ? "ENTRANT" : "SORTANT",
      lien: lienDe(s),
      dossierId: s.dossierId,
      leadId: s.leadId,
      clientId: s.clientId,
      clientNom: s.conversation.nomAffiche ?? s.conversation.numero,
      filtre: echec ? "SYSTEME" : "CLIENTS",
    });
  });
}

/**
 * Types d'événements du dossier que le journal ne lit pas ici : ils ont leur propre source (mails, appels, SMS,
 * paiements, modifications de Claude, lectures du devis) — un seul fait, une seule ligne.
 */
const TYPES_EVENEMENT_EXCLUS = ["MAIL_RECU", "WHATSAPP_RECU", "WHATSAPP_ENVOYE", "NOTE_APPEL", "APPEL", "SMS_RECU", "SMS_ENVOYE", "ENCAISSEMENT_ENREGISTRE", "DOSSIER_MODIFIE", "ESPACE_DEVIS_CONSULTE"] as const;
const TYPES_ARGENT = new Set(["ESPACE_DEVIS_ACCEPTE", "ESPACE_ACCORD_RETIRE"]);
const TYPES_SYSTEME = new Set(["COHERENCE_CORRIGEE"]);

function filtreDeLEvenement(type: string): FiltreJournal {
  if (TYPES_SYSTEME.has(type)) return "SYSTEME";
  if (TYPES_ARGENT.has(type)) return "ARGENT";
  const famille = familleDeLEvenement(type);
  return famille === "DOCUMENT" || famille === "PAIEMENT" ? "ARGENT" : "CLIENTS";
}

async function evenementsDesDossiers({ depuis, jusqua }: Periode, jumeaux: Set<string>): Promise<Brute[]> {
  const evenements = await prisma.dossierEvenement.findMany({
    where: { createdAt: { gte: depuis, lte: jusqua }, type: { notIn: [...TYPES_EVENEMENT_EXCLUS] } },
    orderBy: { createdAt: "desc" },
    take: PRISE,
    select: { id: true, type: true, direction: true, contenu: true, metadata: true, createdAt: true, survenuLe: true, dossierId: true },
  });
  const sortie: Brute[] = [];
  for (const e of evenements) {
    if (jumeaux.has(e.id)) continue;
    // Un mail envoyé n'entre ici que s'il est une relance de devis ; un SMS copié, que s'il porte une relance.
    if (e.type === "MAIL_ENVOYE" && !e.metadata.includes("RELANCE_DEVIS")) continue;
    if (e.type === "SMS_COPIE" && !e.metadata.includes('"relance"')) continue;
    const meta = lireJson(e.metadata);
    const vers = chaine(meta.vers);
    const titre =
      e.type === "MAIL_ENVOYE"
        ? "Relance du devis envoyée par mail"
        : e.type === "SMS_COPIE"
          ? "Relance du devis envoyée par SMS"
          : e.type === "CHANGEMENT_ETAPE" && vers
            ? `Passé en ${LIBELLES_ETAPE[vers as EtapeDossier] ?? vers}`
            : (LIBELLES_TYPE_EVENEMENT[e.type as TypeEvenement] ?? e.type);
    const famille = familleDeLEvenement(e.type) ?? "DOSSIER";
    const documentId = chaine(meta.documentId) ?? chaine(meta.devisId) ?? "";
    sortie.push(
      base({
        id: `evenement:${e.id}`,
        le: (e.survenuLe ?? e.createdAt).toISOString(),
        famille,
        type: e.type,
        titre,
        texte: court(e.contenu),
        direction: e.direction as EntreeChronologie["direction"],
        lien: `/dossiers?dossier=${e.dossierId}`,
        dossierId: e.dossierId,
        filtre: filtreDeLEvenement(e.type),
        cleGroupe: `${e.type}:${e.dossierId}:${documentId}`,
      })
    );
  }
  return sortie;
}

/** « Devis 2026-041 relu 3 fois » : le compteur vit sur le devis (espace/service.ts › noterConsultationDevis). */
async function devisRelus({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const devis = await prisma.document.findMany({
    where: { type: "DEVIS", consulteLe: { gte: depuis, lte: jusqua } },
    orderBy: { consulteLe: "desc" },
    take: PRISE,
    select: { id: true, numero: true, libelleVariante: true, consultations: true, consulteLe: true, dossierId: true },
  });
  return devis.map((d) => {
    const nom = `Devis ${d.numero ?? "sans numéro"}${d.libelleVariante ? ` (${d.libelleVariante})` : ""}`;
    return base({
      id: `devis-relu:${d.id}`,
      le: (d.consulteLe ?? new Date(0)).toISOString(),
      famille: "ESPACE",
      type: "ESPACE_DEVIS_CONSULTE",
      titre: d.consultations <= 1 ? `${nom} ouvert par le client` : `${nom} relu ${d.consultations} fois`,
      direction: "ENTRANT",
      lien: `/dossiers?dossier=${d.dossierId}`,
      dossierId: d.dossierId,
      filtre: "CLIENTS",
    });
  });
}

async function appels({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const notes = await prisma.noteAppel.findMany({ where: { appelLe: { gte: depuis, lte: jusqua } }, orderBy: { appelLe: "desc" }, take: PRISE, select: { id: true, appelLe: true, texte: true, issue: true, leadId: true } });
  return notes.map((n) =>
    base({ id: `appel:${n.id}`, le: n.appelLe.toISOString(), famille: "APPEL", type: "APPEL", titre: `Appel${n.issue ? ` — ${LIBELLES_ISSUE[n.issue as IssueAppel] ?? n.issue}` : ""}`, texte: court(n.texte), direction: "SORTANT", lien: `/leads?lead=${n.leadId}`, leadId: n.leadId, filtre: "CLIENTS" })
  );
}

/** Qui a la main, quand elle a changé (dossiers/main.ts) : « La main est passée au client · Devis envoyé ». */
async function changementsDeMain({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const dossiers = await prisma.dossier.findMany({ where: { mainLe: { gte: depuis, lte: jusqua } }, orderBy: { mainLe: "desc" }, take: PRISE, select: { id: true, main: true, mainLe: true, mainMotif: true, clientNom: true, clientId: true, leadId: true } });
  return dossiers.map((d) =>
    base({
      id: `main:${d.id}`,
      le: (d.mainLe ?? new Date(0)).toISOString(),
      famille: "DOSSIER",
      type: "MAIN",
      titre: d.main === "CLIENT" ? "La main est passée au client" : "La main est revenue à toi",
      texte: court(d.mainMotif),
      lien: `/dossiers?dossier=${d.id}`,
      dossierId: d.id,
      clientId: d.clientId,
      leadId: d.leadId,
      clientNom: d.clientNom,
      filtre: "CLIENTS",
    })
  );
}

async function paiements({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const lignes = await prisma.encaissement.findMany({ where: { recuLe: { gte: depuis, lte: jusqua } }, orderBy: { recuLe: "desc" }, take: PRISE, select: { id: true, montant: true, moyen: true, payeur: true, reference: true, statut: true, recuLe: true, dossierId: true, clientId: true } });
  return lignes.map((p) =>
    base({
      id: `encaissement:${p.id}`,
      le: p.recuLe.toISOString(),
      famille: "PAIEMENT",
      type: "ENCAISSEMENT_ENREGISTRE",
      titre: `Paiement reçu : ${euros(p.montant)}${p.moyen ? ` par ${(LIBELLES_MOYEN[p.moyen as MoyenPaiement] ?? p.moyen).toLowerCase()}` : ""}${p.statut === "REJETE" ? " (rejeté depuis)" : p.statut === "ANNULE" ? " (annulé depuis)" : ""}`,
      texte: court([p.payeur, p.reference].filter(Boolean).join(" · ")),
      direction: "ENTRANT",
      lien: lienDe(p, "/finances"),
      dossierId: p.dossierId,
      clientId: p.clientId,
      clientNom: p.payeur,
      filtre: "ARGENT",
    })
  );
}

/** Les notifications parties par mail (espace, devis disponible…) et tout envoi resté en échec. */
async function envoisDeMail({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const envois = await prisma.envoiMail.findMany({
    where: { nature: { not: "ESSAI" }, OR: [{ statut: "ENVOYE", nature: "NOTIFICATION", envoyeLe: { gte: depuis, lte: jusqua } }, { statut: "ECHEC", updatedAt: { gte: depuis, lte: jusqua } }] },
    orderBy: { updatedAt: "desc" },
    take: PRISE,
    select: { id: true, statut: true, modele: true, objet: true, a: true, envoyeLe: true, updatedAt: true, dossierId: true, clientId: true, leadId: true, messageId: true },
  });
  return envois.map((e) => {
    const echec = e.statut === "ECHEC";
    return base({
      id: `envoi:${e.id}`,
      le: (echec ? e.updatedAt : (e.envoyeLe ?? e.updatedAt)).toISOString(),
      famille: "MAIL",
      type: "MAIL_NOTIFICATION",
      titre: echec ? `Mail non parti : « ${e.objet} »` : `Notification envoyée par mail : « ${e.objet} »`,
      texte: court(`à ${e.a}`),
      direction: "SORTANT",
      lien: lienDe(e, e.messageId ? `/mail?mail=${e.messageId}` : "/mail"),
      messageId: e.messageId,
      dossierId: e.dossierId,
      clientId: e.clientId,
      leadId: e.leadId,
      acteur: "le système",
      filtre: echec ? "SYSTEME" : "CLIENTS",
      cleGroupe: echec ? `envoi-echec:${e.modele ?? e.objet}` : undefined,
    });
  });
}

async function propositions({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const lignes = await prisma.proposition.findMany({
    where: { OR: [{ statut: "EN_ATTENTE", createdAt: { gte: depuis, lte: jusqua } }, { statut: { in: ["REJETEE", "ANNULEE", "ECHEC"] }, updatedAt: { gte: depuis, lte: jusqua } }, { statut: "EXECUTEE", executeLe: { gte: depuis, lte: jusqua } }] },
    orderBy: { updatedAt: "desc" },
    take: PRISE,
    select: { id: true, type: true, statut: true, titre: true, resume: true, erreurExecution: true, commentaireRejet: true, createdAt: true, updatedAt: true, decideLe: true, executeLe: true, dossierId: true, clientId: true, messageId: true },
  });
  return lignes.map((p) => {
    const enAttente = p.statut === "EN_ATTENTE";
    const titre =
      p.statut === "EN_ATTENTE" ? `À valider : ${p.titre}` : p.statut === "REJETEE" ? `Proposition ignorée : ${p.titre}` : p.statut === "ANNULEE" ? `Proposition devenue sans objet : ${p.titre}` : p.statut === "ECHEC" ? `Proposition en échec : ${p.titre}` : `Proposition exécutée : ${p.titre}`;
    const le = p.statut === "EN_ATTENTE" ? p.createdAt : p.statut === "EXECUTEE" ? (p.executeLe ?? p.updatedAt) : (p.decideLe ?? p.updatedAt);
    return base({
      id: `proposition:${p.id}`,
      le: le.toISOString(),
      famille: "PROPOSITION",
      type: p.type,
      titre,
      texte: court(p.statut === "ECHEC" ? p.erreurExecution : p.statut === "ANNULEE" ? p.commentaireRejet : p.resume),
      lien: enAttente ? `/validation?proposition=${p.id}` : (lienDe(p, p.messageId ? `/mail?mail=${p.messageId}` : "/validation")),
      messageId: p.messageId,
      dossierId: p.dossierId,
      clientId: p.clientId,
      acteur: "le système",
      filtre: p.statut === "ECHEC" ? "SYSTEME" : p.dossierId || p.clientId ? "CLIENTS" : "SYSTEME",
      ...(enAttente ? { gestes: { valider: `/api/validation/${p.id}/valider`, ignorer: `/api/validation/${p.id}/rejeter` } } : {}),
    });
  });
}

type Changement = { libelle?: unknown; champ?: unknown; texteAvant?: unknown; texteApres?: unknown; avant?: unknown; apres?: unknown };
function texteDesChangements(json: string): string | null {
  try {
    const liste = JSON.parse(json) as Changement[];
    if (!Array.isArray(liste)) return null;
    const mot = (v: unknown) => (v === null || v === undefined || v === "" ? "vide" : typeof v === "object" ? JSON.stringify(v) : String(v));
    return court(liste.map((c) => `${chaine(c.libelle) ?? chaine(c.champ) ?? "champ"} : ${mot(c.texteAvant ?? c.avant)} → ${mot(c.texteApres ?? c.apres)}`).join(" · "));
  } catch {
    return null;
  }
}

/** « Claude a modifié … » : les modifications faites par le connecteur (annulables par « annuler_modification »). */
async function modificationsDeClaude({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const [generiques, dossiers] = await Promise.all([
    prisma.modificationAssistant.findMany({ where: { par: { startsWith: "ASSISTANT:" }, createdAt: { gte: depuis, lte: jusqua } }, orderBy: { createdAt: "desc" }, take: PRISE, select: { id: true, entite: true, enregistrementId: true, nom: true, champs: true, createdAt: true, annuleeLe: true } }),
    prisma.modificationDossier.findMany({ where: { par: { startsWith: "ASSISTANT:" }, createdAt: { gte: depuis, lte: jusqua } }, orderBy: { createdAt: "desc" }, take: PRISE, select: { id: true, dossierId: true, champs: true, createdAt: true, annuleeLe: true } }),
  ]);
  const sortie: Brute[] = generiques.map((m) =>
    base({
      id: `modification:${m.id}`,
      le: m.createdAt.toISOString(),
      famille: "SYSTEME",
      type: "MODIFICATION_ASSISTANT",
      titre: `${m.annuleeLe ? "Modification de Claude annulée" : "Claude a modifié"} ${m.nom ?? m.entite.toLowerCase()}`,
      texte: texteDesChangements(m.champs),
      lien: m.entite === "DOSSIER" ? `/dossiers?dossier=${m.enregistrementId}` : m.entite === "LEAD" ? `/leads?lead=${m.enregistrementId}` : m.entite === "CLIENT" ? `/clients/${m.enregistrementId}` : null,
      dossierId: m.entite === "DOSSIER" ? m.enregistrementId : null,
      leadId: m.entite === "LEAD" ? m.enregistrementId : null,
      clientId: m.entite === "CLIENT" ? m.enregistrementId : null,
      acteur: "Claude",
      filtre: "SYSTEME",
    })
  );
  for (const m of dossiers) {
    sortie.push(base({ id: `modification-dossier:${m.id}`, le: m.createdAt.toISOString(), famille: "SYSTEME", type: "MODIFICATION_ASSISTANT", titre: m.annuleeLe ? "Modification de Claude annulée sur le dossier" : "Claude a modifié le dossier", texte: texteDesChangements(m.champs), lien: `/dossiers?dossier=${m.dossierId}`, dossierId: m.dossierId, acteur: "Claude", filtre: "SYSTEME" }));
  }
  return sortie;
}

/** Les faits système qui méritent une ligne : échec définitif, travail en échec, alerte non remise, sauvegarde faite. */
async function faitsSysteme({ depuis, jusqua }: Periode): Promise<Brute[]> {
  const [taches, planifications, alertes] = await Promise.all([
    prisma.tache.findMany({ where: { statut: "ECHEC_DEFINITIF", updatedAt: { gte: depuis, lte: jusqua } }, orderBy: { updatedAt: "desc" }, take: PRISE, select: { id: true, type: true, derniereErreur: true, updatedAt: true, termineLe: true } }),
    prisma.planification.findMany({ where: { dernierFin: { gte: depuis, lte: jusqua } }, select: { nom: true, dernierStatut: true, derniereErreur: true, dernierFin: true } }),
    prisma.alerteEnvoi.findMany({ where: { abouti: false, createdAt: { gte: depuis, lte: jusqua } }, orderBy: { createdAt: "desc" }, take: PRISE, select: { id: true, origine: true, createdAt: true } }),
  ]);
  const libelles = new Map(travauxPeriodiques().map((t) => [t.nom, t.libelle]));
  const sortie: Brute[] = taches.map((t) =>
    base({ id: `tache:${t.id}`, le: (t.termineLe ?? t.updatedAt).toISOString(), famille: "SYSTEME", type: "TACHE_EN_ECHEC", titre: `Tâche de fond en échec définitif : ${traitementDe(t.type)?.libelle ?? t.type}`, texte: court(t.derniereErreur, 160), lien: ADRESSE_SYSTEME, acteur: "le système", filtre: "SYSTEME", cleGroupe: `tache-echec:${t.type}` })
  );
  for (const p of planifications) {
    if (!p.dernierFin) continue;
    const libelle = libelles.get(p.nom) ?? p.nom;
    if (p.dernierStatut === "ECHEC") sortie.push(base({ id: `travail:${p.nom}`, le: p.dernierFin.toISOString(), famille: "SYSTEME", type: "TRAVAIL_EN_ECHEC", titre: `Travail périodique en échec : ${libelle}`, texte: court(p.derniereErreur, 160), lien: ADRESSE_SYSTEME, acteur: "le système", filtre: "SYSTEME" }));
    // Les travaux réussis sont des battements ; seule la sauvegarde du jour mérite sa ligne.
    else if (p.dernierStatut === "SUCCES" && p.nom.startsWith("sauvegarde")) sortie.push(base({ id: `travail:${p.nom}`, le: p.dernierFin.toISOString(), famille: "SYSTEME", type: "SAUVEGARDE", titre: "Sauvegarde du jour faite", lien: ADRESSE_SYSTEME, acteur: "le système", filtre: "SYSTEME" }));
  }
  for (const a of alertes) sortie.push(base({ id: `alerte:${a.id}`, le: a.createdAt.toISOString(), famille: "SYSTEME", type: "ALERTE_NON_REMISE", titre: `Alerte non remise (${a.origine}) : aucun canal n'a abouti`, lien: ADRESSE_SYSTEME, acteur: "le système", filtre: "SYSTEME", cleGroupe: `alerte:${a.origine}` }));
  return sortie;
}

/* ── Assemblage ─────────────────────────────────────────────────────────────── */

/** Les noms des personnes, en trois lectures groupées (dossier → client → lead), jamais une par ligne. */
async function nommer(entrees: Brute[]): Promise<void> {
  const dossierIds = [...new Set(entrees.map((e) => e.dossierId).filter((id): id is string => Boolean(id)))];
  const dossiers = dossierIds.length ? await prisma.dossier.findMany({ where: { id: { in: dossierIds }, archiveLe: undefined }, select: { id: true, clientNom: true, clientId: true, leadId: true } }) : [];
  const parDossier = new Map(dossiers.map((d) => [d.id, d]));
  for (const e of entrees) {
    const d = e.dossierId ? parDossier.get(e.dossierId) : undefined;
    if (!d) continue;
    e.clientNom = d.clientNom || e.clientNom;
    e.clientId ??= d.clientId;
    e.leadId ??= d.leadId;
  }
  const clientIds = [...new Set(entrees.filter((e) => !e.clientNom && e.clientId).map((e) => e.clientId as string))];
  const leadIds = [...new Set(entrees.filter((e) => !e.clientNom && !e.clientId && e.leadId).map((e) => e.leadId as string))];
  const [clients, leads] = await Promise.all([
    clientIds.length ? prisma.client.findMany({ where: { id: { in: clientIds }, archiveLe: undefined }, select: { id: true, nom: true } }) : [],
    leadIds.length ? prisma.lead.findMany({ where: { id: { in: leadIds }, archiveLe: undefined }, select: { id: true, prenom: true, nom: true } }) : [],
  ]);
  const parClient = new Map(clients.map((c) => [c.id, c.nom]));
  const parLead = new Map(leads.map((l) => [l.id, `${l.prenom} ${l.nom}`.trim()]));
  for (const e of entrees) {
    if (e.clientNom) continue;
    e.clientNom = (e.clientId && parClient.get(e.clientId)) || (e.leadId && parLead.get(e.leadId)) || null;
  }
}

/** Même type, même dossier, même document : une ligne, la plus récente, avec le nombre d'occurrences. */
function grouper(entrees: Brute[]): EntreeJournal[] {
  const parCle = new Map<string, Brute>();
  const sortie: Brute[] = [];
  for (const e of entrees) {
    if (!e.cleGroupe) {
      sortie.push(e);
      continue;
    }
    const deja = parCle.get(e.cleGroupe);
    if (!deja) {
      parCle.set(e.cleGroupe, e);
      sortie.push(e);
    } else {
      deja.occurrences += 1;
      if (e.le > deja.le) {
        deja.le = e.le;
        deja.titre = e.titre;
        deja.texte = e.texte;
        deja.id = e.id;
      }
    }
  }
  for (const e of sortie) delete e.cleGroupe;
  return sortie;
}

export async function journal(o: { depuis: Date; jusqua?: Date; filtres?: readonly FiltreJournal[]; page?: number; parPage?: number }): Promise<ResultatJournal> {
  const periode = bornerPeriode(o.depuis, o.jusqua ?? new Date());
  const messages = await messagesDuClient(periode);
  const sources = await Promise.all([
    mailsEntrants(periode),
    sms(periode),
    evenementsDesDossiers(periode, messages.evenementsJumeaux),
    devisRelus(periode),
    appels(periode),
    changementsDeMain(periode),
    paiements(periode),
    envoisDeMail(periode),
    propositions(periode),
    modificationsDeClaude(periode),
    faitsSysteme(periode),
  ]);
  const brutes = [...messages.entrees, ...sources.flat()];
  await nommer(brutes);
  const toutes = grouper(brutes).sort((a, b) => b.le.localeCompare(a.le));
  const compteurs: Record<FiltreJournal, number> = { CLIENTS: 0, ARGENT: 0, SYSTEME: 0 };
  for (const e of toutes) compteurs[e.filtre] += 1;
  const retenus = new Set<FiltreJournal>(o.filtres?.length ? o.filtres : FILTRES_JOURNAL);
  const filtrees = toutes.filter((e) => retenus.has(e.filtre));
  const parPage = Math.min(PAR_PAGE_MAX, Math.max(1, Math.trunc(o.parPage ?? PAR_PAGE_DEFAUT)));
  const pages = Math.max(1, Math.ceil(filtrees.length / parPage));
  const page = Math.min(Math.max(1, Math.trunc(o.page ?? 1)), pages);
  return { entrees: filtrees.slice((page - 1) * parPage, page * parPage), total: filtrees.length, page, pages, compteurs, depuis: periode.depuis.toISOString(), jusqua: periode.jusqua.toISOString() };
}

/** L'instant du dernier « Tout vu » (paramètre JOURNAL_VU_LE), ou null. */
export async function journalVuLe(maintenant: Date = new Date()): Promise<Date | null> {
  const valeur = await lireParametre(CLE_JOURNAL_VU, maintenant);
  if (typeof valeur !== "string") return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Le point de départ du journal : le dernier « Tout vu », sinon 48 h ; jamais plus de 30 jours. */
export async function depuisDeLaVisite(maintenant: Date = new Date()): Promise<{ vuLe: Date | null; depuis: Date }> {
  const vuLe = await journalVuLe(maintenant);
  const depuis = bornerPeriode(vuLe ?? new Date(maintenant.getTime() - HEURES_PAR_DEFAUT * 3_600_000), maintenant).depuis;
  return { vuLe, depuis };
}

/** « Depuis ta dernière visite » : le total et les compteurs, sans les lignes (pour Aujourd'hui, `etat_crm`). */
export async function depuisDerniereVisite(maintenant: Date = new Date()): Promise<{ vuLe: Date | null; depuis: Date; total: number; compteurs: Record<FiltreJournal, number> }> {
  const { vuLe, depuis } = await depuisDeLaVisite(maintenant);
  const r = await journal({ depuis, jusqua: maintenant, parPage: 1 });
  return { vuLe, depuis, total: r.compteurs.CLIENTS + r.compteurs.ARGENT + r.compteurs.SYSTEME, compteurs: r.compteurs };
}

/** « Tout vu » : pose JOURNAL_VU_LE à l'instant (une ligne de plus dans l'historique du paramètre, jamais une mise à jour). */
export async function marquerJournalVu(maintenant: Date = new Date(), source = "Tout vu (journal)"): Promise<Date> {
  await enregistrerParametre({ cle: CLE_JOURNAL_VU, valeur: maintenant.toISOString(), valableDu: maintenant, source });
  return maintenant;
}

/** « Depuis hier 18 h 40 : 6 faits (clients 4, argent 1, système 1) » : la même phrase pour l'écran et le connecteur. */
export function phraseCompteurs(compteurs: Record<FiltreJournal, number>): string {
  const total = compteurs.CLIENTS + compteurs.ARGENT + compteurs.SYSTEME;
  return `${total} ${total > 1 ? "faits" : "fait"} (clients ${compteurs.CLIENTS}, argent ${compteurs.ARGENT}, système ${compteurs.SYSTEME})`;
}
