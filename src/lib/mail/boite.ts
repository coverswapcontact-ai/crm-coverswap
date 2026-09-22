import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ficheVivante } from "@/lib/clients/fusion";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireParametre } from "@/lib/parametres/service";
import { mettreEnFile } from "@/lib/taches/file";
import { agentMailActif } from "@/lib/messages/consultation";
import {
  LIBELLE_RANGE,
  changementsGmail,
  libelleGmail,
  libellesDuMessage,
  lireMessageGmail,
  listerMessagesGmail,
  modifierLibellesGmail,
  profilGmail,
  versMessageRecu,
} from "@/lib/messages/gmail";
import { enregistrerMessageRecu, lireEntetes, lireListe } from "@/lib/messages/stockage";
import { retirerCitations } from "@/lib/messages/texte";
import { ciblesDe, trierMail, type ActionRegle, type DecisionTriMail } from "./tri";

/**
 * La boîte, au plus près du temps réel (mission 7) : synchronisation par
 * l'historique Gmail toutes les minutes, tri de chaque mail (mail/tri.ts),
 * rattachement à son contact, et Gmail qui suit ce que le CRM décide (lu,
 * archivé, rangé sous « CoverSwap/Rangé »). Rien ne se supprime, tout se remonte.
 */

export const TYPE_TACHE_ETAT_GMAIL = "MAIL_ETAT_GMAIL";
export const NOM_SYNCHRO_BOITE = "synchro-boite-mail";
export const ACTEUR_TRI = "AGENT:tri-mail";

/** Relève initiale : les 30 derniers jours (une seule fois, puis l'historique prend le relais). */
const REPRISE_INITIALE_MS = 30 * 24 * 3_600_000;
const MARGE_RELEVE_MS = 24 * 3_600_000;

export async function rangementGmailActif(): Promise<boolean> {
  return (await lireParametre("MAIL_RANGEMENT_GMAIL")) === "ACTIF";
}

/* ── Contacts et règles ────────────────────────────────────────────── */

export type ContactMail = { type: "CLIENT" | "LEAD" | "PROSPECT"; nom: string; clientId: string | null; leadId: string | null };

/** Le contact dont c'est l'adresse exacte : fiche client, sinon lead, sinon prospect. */
export async function contactParAdresse(adresse: string): Promise<ContactMail | null> {
  const propre = adresse.trim().toLowerCase();
  if (!propre.includes("@")) return null;
  const email = await prisma.clientEmail.findFirst({ where: { adresse: propre }, orderBy: { principale: "desc" }, select: { clientId: true } });
  if (email) {
    const fiche = await ficheVivante(email.clientId);
    if (fiche && !fiche.anonymiseLe) return { type: "CLIENT", nom: fiche.nom, clientId: fiche.id, leadId: null };
  }
  const lead = await prisma.lead.findFirst({ where: { email: { equals: propre } }, orderBy: { createdAt: "desc" }, select: { id: true, prenom: true, nom: true, clientId: true } });
  if (lead) return { type: "LEAD", nom: `${lead.prenom} ${lead.nom}`.replace(/Inconnu/gi, "").trim() || propre, clientId: lead.clientId, leadId: lead.id };
  const prospect = await prisma.prospect.findFirst({ where: { email: { equals: propre } }, select: { nom: true, clientId: true } });
  if (prospect) return { type: "PROSPECT", nom: prospect.nom, clientId: prospect.clientId, leadId: null };
  return null;
}

/** Les décisions de Lucas qui visent cet expéditeur (adresse exacte, puis son domaine). */
export async function reglesPour(adresse: string): Promise<ActionRegle[]> {
  const regles = await prisma.regleExpediteur.findMany({ where: { cible: { in: ciblesDe(adresse) } }, orderBy: { createdAt: "desc" }, select: { action: true } });
  return [...new Set(regles.map((r) => r.action as ActionRegle))];
}

/* ── Classer un mail ───────────────────────────────────────────────── */

const STATUT_HERITE: Record<string, string> = { CLIENT: "RATTACHE", ADMINISTRATIF: "IGNORE", HUMAIN: "A_TRIER", BRUIT: "BRUIT" };

/**
 * Trie un mail enregistré et range la décision. Une décision de Lucas
 * (classePar LUCAS) n'est pas refaite, sauf `forcer`. Rend la décision et le
 * contact reconnu (les suites — dossier, lead, pièces — sont dans rattachement.ts).
 */
export async function classerMessage(messageId: string, options: { forcer?: boolean } = {}): Promise<{ decision: DecisionTriMail; contact: ContactMail | null } | null> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { contenu: true, pieces: { select: { typeMime: true, nom: true } } } });
  if (!message || message.canal !== "EMAIL") return null;
  if (message.classePar === "LUCAS" && !options.forcer) return null;
  const destinataires = lireListe(message.a);
  const adresses = message.sens === "ENTRANT" ? [message.de] : destinataires;
  let contact: ContactMail | null = null;
  for (const adresse of adresses) {
    contact = await contactParAdresse(adresse);
    if (contact) break;
  }
  const autres = message.filCanal
    ? await prisma.message.findMany({ where: { canal: "EMAIL", filCanal: message.filCanal, id: { not: message.id } }, select: { clientId: true, leadId: true, sens: true, recuLe: true, automatique: true } })
    : [];
  const entetes = lireEntetes(message.contenu?.entetes);
  const decision = trierMail({
    sens: message.sens as "ENTRANT" | "SORTANT",
    de: message.de,
    deNom: message.deNom,
    a: destinataires,
    compte: message.compte,
    objet: message.objet,
    texte: message.contenu?.texte ? retirerCitations(message.contenu.texte).slice(0, 2000) : message.extrait,
    entetes,
    libelles: (entetes.libelles ?? "").split(" ").filter(Boolean),
    pieces: message.pieces,
    regles: message.sens === "ENTRANT" ? await reglesPour(message.de) : [],
    contact: contact ? { type: contact.type, nom: contact.nom } : null,
    filDUnContact: autres.some((autre) => autre.clientId || autre.leadId),
  });
  // Contact du fil (autre adresse de la même personne) quand l'adresse n'est pas connue.
  const duFil = !contact && decision.classe === "CLIENT" ? autres.find((autre) => autre.clientId || autre.leadId) : undefined;
  const clientId = message.clientId ?? contact?.clientId ?? duFil?.clientId ?? null;
  const leadId = message.leadId ?? contact?.leadId ?? duFil?.leadId ?? null;
  const maintenant = new Date();
  const rangerMaintenant = decision.ranger && !message.rangeLe && !message.remonteLe;
  const remonter = !decision.ranger && message.rangeLe && decision.par !== "REGLE" && (await reglesPour(message.de)).includes("NE_JAMAIS_RANGER");
  const sortantPlusTard = autres.some((autre) => autre.sens === "SORTANT" && !autre.automatique && autre.recuLe > message.recuLe);
  await prisma.message.update({
    where: { id: message.id },
    data: {
      classe: decision.classe,
      classeMotif: decision.motif,
      classePar: decision.par,
      statut: STATUT_HERITE[decision.classe],
      categorie: decision.classe === "CLIENT" ? "CLIENT" : decision.classe === "ADMINISTRATIF" ? "ADMINISTRATIF" : decision.classe === "BRUIT" ? "BRUIT" : decision.demandeClient ? "NOUVELLE_DEMANDE" : "AUTRE",
      clientId,
      leadId,
      trieLe: maintenant,
      triePar: ACTEUR_TRI,
      ...(rangerMaintenant ? { rangeLe: maintenant, rangeMotif: decision.motif, rangePar: "TRI", lu: true } : {}),
      ...(remonter ? { rangeLe: null, rangePar: null, remonteLe: maintenant } : {}),
      ...(message.sens === "ENTRANT" && sortantPlusTard && !message.reponduLe ? { reponduLe: maintenant } : {}),
    },
  });
  // Une réponse de la boîte : les mails reçus plus tôt dans le fil sont répondus.
  if (message.sens === "SORTANT" && !message.automatique && message.filCanal) {
    await prisma.message.updateMany({ where: { canal: "EMAIL", filCanal: message.filCanal, sens: "ENTRANT", recuLe: { lte: message.recuLe }, reponduLe: null }, data: { reponduLe: message.recuLe } });
  }
  if (rangerMaintenant || remonter) await demanderEtatGmail(message.id);
  return { decision, contact };
}

/* ── Gmail suit le CRM ─────────────────────────────────────────────── */

export async function demanderEtatGmail(messageId: string): Promise<void> {
  await mettreEnFile({ type: TYPE_TACHE_ETAT_GMAIL, cle: `mail-gmail:${messageId}`, mode: "RECONCILIATION", charge: { messageId }, priorite: 2 });
}

/**
 * Applique à Gmail l'état voulu par le CRM : rangé (libellé, lu, hors de la
 * boîte), archivé (hors de la boîte), lu ou non lu, remonté. Le rangement
 * d'office attend l'interrupteur « Rangement d'office dans Gmail » ; ce que
 * Lucas range lui-même part toujours. Rejouable : ne change que l'écart.
 */
export async function appliquerEtatGmail(messageId: string): Promise<string> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { identifiantCanal: true, canal: true, lu: true, rangeLe: true, rangePar: true, traiteLe: true, remonteLe: true, sens: true },
  });
  if (!message || message.canal !== "EMAIL") return "rien";
  const actuels = await libellesDuMessage(message.identifiantCanal);
  if (!actuels) return "introuvable dans Gmail";
  const range = await libelleGmail(LIBELLE_RANGE);
  const ajouter = new Set<string>();
  const retirer = new Set<string>();
  const rangementPermis = message.rangePar === "LUCAS" || (await rangementGmailActif());
  if (message.rangeLe && rangementPermis) {
    ajouter.add(range);
    retirer.add("INBOX");
    retirer.add("UNREAD");
  } else {
    if (actuels.includes(range)) retirer.add(range);
    if (message.remonteLe && !message.traiteLe && message.sens === "ENTRANT") ajouter.add("INBOX");
    if (message.traiteLe) retirer.add("INBOX");
    if (message.lu) retirer.add("UNREAD");
    else ajouter.add("UNREAD");
  }
  const aAjouter = [...ajouter].filter((l) => !actuels.includes(l));
  const aRetirer = [...retirer].filter((l) => actuels.includes(l));
  if (aAjouter.length === 0 && aRetirer.length === 0) return "déjà à jour";
  const resultat = await modifierLibellesGmail(message.identifiantCanal, { ajouter: aAjouter, retirer: aRetirer });
  if (resultat === "FAIT") await prisma.message.update({ where: { id: messageId }, data: { dansBoite: !retirer.has("INBOX") && (ajouter.has("INBOX") || actuels.includes("INBOX")), ...(retirer.has("UNREAD") ? { lu: true } : {}) } });
  return `${resultat.toLowerCase()} (+${aAjouter.join(",") || "∅"} −${aRetirer.join(",") || "∅"})`;
}

/* ── Synchronisation ───────────────────────────────────────────────── */

export type BilanSynchro = { mode: "HISTORIQUE" | "RELEVE" | "INACTIF"; nouveaux: number; majLibelles: number };

type Suites = (messageId: string, resultat: Awaited<ReturnType<typeof classerMessage>>) => Promise<void>;
let suitesDuTri: Suites | null = null;
/** Les suites d'un mail trié (dossier, lead, pièces) : branchées par rattachement.ts (pas d'import circulaire). */
export function brancherSuitesDuTri(suites: Suites): void {
  suitesDuTri = suites;
}

async function accueillirMessage(idGmail: string, compte: string): Promise<boolean> {
  const gmail = await lireMessageGmail(idGmail);
  if (!gmail) return false;
  const recu = versMessageRecu(gmail, compte);
  const { id, nouveau } = await enregistrerMessageRecu(recu);
  if (!nouveau) return false;
  await prisma.message.update({ where: { id }, data: { lu: !recu.libelles.includes("UNREAD"), dansBoite: recu.libelles.includes("INBOX") } });
  const resultat = await classerMessage(id);
  if (suitesDuTri) await suitesDuTri(id, resultat).catch((erreur) => console.error(`[mail] suites du tri ${id} :`, erreur));
  return true;
}

/** Libellés changés dans Gmail (par Lucas sur son téléphone, ou par le CRM) : le CRM les reflète. */
async function refleterLibelles(idGmail: string, libelles: string[], rangeId: string): Promise<boolean> {
  const message = await prisma.message.findFirst({ where: { canal: "EMAIL", identifiantCanal: idGmail }, select: { id: true, de: true, lu: true, dansBoite: true, rangeLe: true, traiteLe: true } });
  if (!message) return false;
  const lu = !libelles.includes("UNREAD");
  const dansBoite = libelles.includes("INBOX");
  const data: Record<string, unknown> = {};
  if (lu !== message.lu) data.lu = lu;
  if (dansBoite !== message.dansBoite) data.dansBoite = dansBoite;
  // Remonté dans Gmail (libellé retiré, remis dans la boîte) : son expéditeur ne sera plus jamais rangé.
  if (message.rangeLe && !libelles.includes(rangeId) && dansBoite) {
    Object.assign(data, { rangeLe: null, rangePar: null, remonteLe: new Date() });
    await poserRegle(message.de, "NE_JAMAIS_RANGER", "Remonté dans Gmail par Lucas", "LUCAS:gmail");
  }
  // Archivé dans Gmail : traité ; remis dans la boîte : de nouveau à traiter.
  if (!message.rangeLe && message.dansBoite && !dansBoite && !message.traiteLe) data.traiteLe = new Date();
  if (!message.rangeLe && !message.dansBoite && dansBoite && message.traiteLe) data.traiteLe = null;
  if (Object.keys(data).length === 0) return false;
  await prisma.message.update({ where: { id: message.id }, data });
  return true;
}

/** Première synchronisation : les 30 derniers jours relus (nouveaux mails et libellés actuels des connus), puis le point d'historique. */
async function releveInitiale(compte: string, signal?: AbortSignal): Promise<{ nouveaux: number; majLibelles: number }> {
  const dernier = await prisma.message.findFirst({ where: { canal: "EMAIL", compte }, orderBy: { recuLe: "desc" }, select: { recuLe: true } });
  const depuis = Math.min(Date.now() - REPRISE_INITIALE_MS, dernier ? dernier.recuLe.getTime() - MARGE_RELEVE_MS : Date.now());
  const identifiants = await listerMessagesGmail(`after:${Math.floor(depuis / 1000)} -in:spam -in:trash -in:drafts -in:chats`, 800);
  const connus = new Map(
    (await prisma.message.findMany({ where: { ...AVEC_ARCHIVES, canal: "EMAIL", identifiantCanal: { in: identifiants.map((e) => e.id) } }, select: { id: true, identifiantCanal: true, classe: true } })).map((m) => [m.identifiantCanal, m])
  );
  const rangeId = await libelleGmail(LIBELLE_RANGE);
  let nouveaux = 0;
  let majLibelles = 0;
  for (const { id } of [...identifiants].reverse()) {
    if (signal?.aborted) break;
    const connu = connus.get(id);
    if (!connu) {
      if (await accueillirMessage(id, compte)) nouveaux++;
      continue;
    }
    const libelles = await libellesDuMessage(id);
    if (libelles && (await refleterLibelles(id, libelles, rangeId))) majLibelles++;
    // Les mails relevés par l'ancienne section Messages reçoivent leur classe, et leurs suites.
    if (!connu.classe) {
      const resultat = await classerMessage(connu.id);
      if (suitesDuTri) await suitesDuTri(connu.id, resultat).catch((erreur) => console.error(`[mail] suites du tri ${connu.id} :`, erreur));
    }
  }
  return { nouveaux, majLibelles };
}

/** Un passage : l'historique Gmail depuis le dernier point (ou la relève initiale). */
export async function synchroniserBoite(options: { signal?: AbortSignal } = {}): Promise<BilanSynchro> {
  const connexion = await agentMailActif();
  if (!connexion) return { mode: "INACTIF", nouveaux: 0, majLibelles: 0 };
  const etat = await prisma.etatBoiteMail.findUnique({ where: { compte: connexion.compte } });
  try {
    if (!etat?.historyId) {
      const { historyId } = await profilGmail();
      const bilan = await releveInitiale(connexion.compte, options.signal);
      await prisma.etatBoiteMail.upsert({
        where: { compte: connexion.compte },
        create: { compte: connexion.compte, historyId, derniereSynchro: new Date() },
        update: { historyId, derniereSynchro: new Date(), derniereErreur: null },
      });
      return { mode: "RELEVE", ...bilan };
    }
    const changements = await changementsGmail(etat.historyId);
    if (!changements) {
      // Point d'historique trop ancien chez Gmail : relève par recherche au prochain passage.
      await prisma.etatBoiteMail.update({ where: { compte: connexion.compte }, data: { historyId: null, derniereErreur: "Historique Gmail expiré : relève complète au prochain passage." } });
      return { mode: "HISTORIQUE", nouveaux: 0, majLibelles: 0 };
    }
    const rangeId = changements.libelles.size > 0 ? await libelleGmail(LIBELLE_RANGE) : "";
    let nouveaux = 0;
    let majLibelles = 0;
    const connus = new Set(
      (await prisma.message.findMany({ where: { ...AVEC_ARCHIVES, canal: "EMAIL", identifiantCanal: { in: changements.ajoutes } }, select: { identifiantCanal: true } })).map((m) => m.identifiantCanal)
    );
    for (const id of changements.ajoutes) {
      if (options.signal?.aborted) break;
      if (connus.has(id)) continue;
      if (await accueillirMessage(id, connexion.compte)) nouveaux++;
    }
    for (const [id, libelles] of changements.libelles) {
      if (changements.ajoutes.includes(id) && !connus.has(id)) continue;
      if (await refleterLibelles(id, libelles, rangeId)) majLibelles++;
    }
    await prisma.etatBoiteMail.update({ where: { compte: connexion.compte }, data: { historyId: changements.historyId, derniereSynchro: new Date(), derniereErreur: null } });
    return { mode: "HISTORIQUE", nouveaux, majLibelles };
  } catch (erreur) {
    await prisma.etatBoiteMail
      .upsert({
        where: { compte: connexion.compte },
        create: { compte: connexion.compte, derniereErreur: (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 500) },
        update: { derniereErreur: (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 500) },
      })
      .catch(() => undefined);
    throw erreur;
  }
}

/* ── Règles d'expéditeur ───────────────────────────────────────────── */

export async function poserRegle(adresse: string, action: ActionRegle, motif: string, par: string, domaine = false): Promise<void> {
  const cible = domaine ? ciblesDe(adresse)[1] ?? adresse.toLowerCase() : adresse.trim().toLowerCase();
  const contraire = action === "RANGER" ? "NE_JAMAIS_RANGER" : action === "NE_JAMAIS_RANGER" ? "RANGER" : null;
  await prisma.$transaction(async (tx) => {
    // Une nouvelle décision remplace la décision contraire (archivée, jamais effacée).
    if (contraire) await tx.regleExpediteur.updateMany({ where: { cible, action: contraire }, data: { archiveLe: new Date(), archiveMotif: `Remplacée : ${motif}` } });
    const deja = await tx.regleExpediteur.findFirst({ where: { cible, action } });
    if (!deja) await tx.regleExpediteur.create({ data: { cible, action, motif, par } });
  });
}

/* ── Les gestes de Lucas ───────────────────────────────────────────── */

async function messagesDuFil(messageId: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, filCanal: true, canal: true } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  return message.filCanal ? prisma.message.findMany({ where: { canal: message.canal, filCanal: message.filCanal }, select: { id: true, sens: true, de: true, rangeLe: true } }) : [{ ...(await prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { id: true, sens: true, de: true, rangeLe: true } })) }];
}

/** Lu ou non lu (tout le fil), dans le CRM et dans Gmail. */
export async function marquerLu(messageId: string, lu: boolean): Promise<void> {
  const fil = await messagesDuFil(messageId);
  const entrants = fil.filter((m) => m.sens === "ENTRANT");
  const cibles = lu ? entrants : entrants.slice(-1);
  await prisma.message.updateMany({ where: { id: { in: cibles.map((m) => m.id) } }, data: { lu } });
  for (const m of cibles) await demanderEtatGmail(m.id);
}

/** Archiver (traité) : hors d'« À traiter », hors de la boîte de réception Gmail ; se désarchive. */
export async function archiverFil(messageId: string, archiver = true): Promise<void> {
  const fil = await messagesDuFil(messageId);
  await prisma.message.updateMany({ where: { id: { in: fil.map((m) => m.id) } }, data: archiver ? { traiteLe: new Date(), lu: true } : { traiteLe: null } });
  for (const m of fil) await demanderEtatGmail(m.id);
}

/** Remonter un mail rangé : il revient, et son expéditeur ne sera plus jamais rangé. */
export async function remonter(messageId: string): Promise<void> {
  const fil = await messagesDuFil(messageId);
  const ranges = fil.filter((m) => m.rangeLe);
  if (ranges.length === 0) return;
  await prisma.message.updateMany({ where: { id: { in: ranges.map((m) => m.id) } }, data: { rangeLe: null, rangePar: null, remonteLe: new Date(), traiteLe: null, classePar: "LUCAS" } });
  for (const m of ranges) {
    if (m.sens === "ENTRANT") await poserRegle(m.de, "NE_JAMAIS_RANGER", "Mail remonté à la main : ne plus jamais ranger cet expéditeur", "LUCAS");
    // Il n'était pas du bruit : il retrouve une classe utile.
    const classe = await prisma.message.findUnique({ where: { id: m.id }, select: { clientId: true, leadId: true } });
    await prisma.message.update({ where: { id: m.id }, data: { classe: classe?.clientId || classe?.leadId ? "CLIENT" : "HUMAIN", classeMotif: "Remonté à la main par Lucas.", statut: "A_TRIER" } });
    await demanderEtatGmail(m.id);
  }
}

/** « Ne plus me montrer cet expéditeur » : pour toujours ; ses mails, présents et à venir, sont rangés. */
export async function nePlusMontrer(messageId: string): Promise<{ ranges: number }> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { de: true, sens: true } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  if (message.sens !== "ENTRANT") throw new ErreurMetier("Ce mail est parti de votre boîte : rien à masquer.", 400);
  const contact = await contactParAdresse(message.de);
  if (contact?.type === "CLIENT") throw new ErreurMetier(`C'est l'adresse de ${contact.nom}, un client : elle ne peut pas être masquée d'ici.`, 409);
  await poserRegle(message.de, "RANGER", "Ne plus me montrer cet expéditeur", "LUCAS");
  const aRanger = await prisma.message.findMany({ where: { canal: "EMAIL", de: message.de.toLowerCase(), sens: "ENTRANT", rangeLe: null }, select: { id: true } });
  const maintenant = new Date();
  await prisma.message.updateMany({
    where: { id: { in: aRanger.map((m) => m.id) } },
    data: { rangeLe: maintenant, rangePar: "LUCAS", rangeMotif: "Vous avez demandé de ne plus voir cet expéditeur.", classe: "BRUIT", classePar: "REGLE", lu: true, remonteLe: null },
  });
  for (const m of aRanger) await demanderEtatGmail(m.id);
  return { ranges: aRanger.length };
}

/** Classer à la main (Clients, Administratif, à lire) : la décision de Lucas l'emporte sur le tri. */
export async function classerALaMain(messageId: string, classe: "ADMINISTRATIF" | "HUMAIN" | "CLIENT", pourLExpediteur = false): Promise<void> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { de: true, sens: true } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  await prisma.message.update({ where: { id: messageId }, data: { classe, classeMotif: "Classé à la main par Lucas.", classePar: "LUCAS" } });
  if (pourLExpediteur && classe === "ADMINISTRATIF" && message.sens === "ENTRANT") await poserRegle(message.de, "ADMINISTRATIF", "Classé en administratif par Lucas", "LUCAS");
}
