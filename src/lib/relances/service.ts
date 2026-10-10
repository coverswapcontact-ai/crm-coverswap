import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { dateEnLettres, jourParis } from "@/lib/dossiers/dates";
import { lireParametre } from "@/lib/parametres/service";
import type { PropositionSms } from "@/lib/sms/catalogue";
import { lecteurDuStop } from "@/lib/sms/conversations";
import { proposerSms } from "@/lib/sms/proposition";
import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { proposer } from "@/lib/validation/service";
import { cleRelance } from "./etape";

/**
 * Relances de devis : proposées, jamais envoyées seules. Mission 14 (partie 6) :
 * un seul circuit, deux canaux. Un devis resté sans réponse au-delà du délai
 * paramétré (DELAI_RELANCE_DEVIS, compté depuis le devis ou la dernière relance)
 * rend la relance « proposable » : le SMS à copier (toujours, RELANCE_DEVIS_1 ou
 * _2 du catalogue) et, s'il a une adresse et n'a pas refusé les mails, le mail
 * pré-rédigé à valider (proposition « Envoyer un mail », passe périodique). Une
 * relance faite compte quel que soit son canal — le mail parti ou le SMS copié —,
 * deux au plus par devis ; la copie du SMS annule le mail du même rang
 * (`relances/etape.ts`), un mail parti fait tomber le SMS de ce rang, un mail
 * validé (en cours d'envoi) aussi. Jamais de SMS vers un numéro en STOP.
 */

export const RELANCES_MAX_PAR_DEVIS = 2;
const JOUR_MS = 24 * 60 * 60_000;

export type ResumeRelances = { proposees: number; dejaProposees: number; parametreManquant: boolean; sansAdresse: number; refusMail: number };

/** Mission 13 (B16) : sans DELAI_RELANCE_DEVIS renseigné, 5 jours — le système n'attend pas un réglage pour suivre les devis. */
export const DELAI_RELANCE_DEFAUT_JOURS = 5;

/** Le délai de relance en vigueur : le paramètre daté, sinon la valeur par défaut. `parametre` : vrai quand il est renseigné. */
export async function lireDelaiRelance(maintenant: Date = new Date()): Promise<{ jours: number; parametre: boolean }> {
  const valeur = await lireParametre("DELAI_RELANCE_DEVIS", maintenant);
  return valeur === null ? { jours: DELAI_RELANCE_DEFAUT_JOURS, parametre: false } : { jours: Number(valeur), parametre: true };
}

function texteRelance(entree: { prenom: string | null; numero: string; emisLe: Date; envoyeLe: Date; rang: number }): { objet: string; texte: string } {
  const bonjour = entree.prenom ? `Bonjour ${entree.prenom},` : "Bonjour,";
  const corps =
    entree.rang === 1
      ? `Je me permets de revenir vers vous au sujet du devis n° ${entree.numero} que je vous ai adressé le ${dateEnLettres(entree.envoyeLe)}. Avez-vous pu en prendre connaissance ?\n\nJe reste à votre disposition pour toute question, ou pour l'ajuster si besoin.`
      : `Je reviens vers vous une dernière fois au sujet du devis n° ${entree.numero} du ${dateEnLettres(entree.emisLe)}. Si votre projet a changé ou a été reporté, un simple mot me permettra de mettre à jour mon suivi.\n\nJe reste à votre disposition.`;
  return {
    objet: `Votre devis n° ${entree.numero} — CoverSwap`,
    texte: `${bonjour}\n\n${corps}\n\nBien cordialement,\n\nLucas Villemin\nCoverSwap\n${EMETTEUR.telephone}`,
  };
}

/**
 * Mission 14 (R1) : la 1re relance attend le délai à partir du moment où le client a le devis — la plus tardive
 * de sa date d'émission et de son dépôt dans le CRM (un devis déposé aujourd'hui, daté d'avant, attend le délai).
 * Mission 18 (B2) : et de son envoi, quand il est parti après sa génération (événement « Devis envoyé » : mail du
 * CRM, mise en ligne) — un devis généré masqué puis envoyé par mail trois jours plus tard attend le délai depuis l'envoi.
 */
export function referenceDuDevis(devis: { dateEmission: Date; createdAt: Date }, envoi: Date | EnvoiDuDevis | null = null): Date {
  const lu = envoi instanceof Date ? { le: envoi, depuisLeMail: false } : envoi;
  // Mission 18 (B3) : envoyé depuis Gmail puis enregistré après coup — l'heure du mail fait foi, pas celle du dépôt (une
  // émission datée au jour, midi, le jour même du mail ne la repousse pas).
  if (lu?.depuisLeMail) return jourParis(devis.dateEmission) > jourParis(lu.le) ? devis.dateEmission : lu.le;
  const dates = [devis.dateEmission, devis.createdAt, ...(lu ? [lu.le] : [])];
  return dates.reduce((plusTard, date) => (date.getTime() > plusTard.getTime() ? date : plusTard));
}

/** Un envoi de devis : sa date ; `depuisLeMail` : envoyé depuis Gmail, la date est celle du mail (mission 18, B3). */
export type EnvoiDuDevis = { le: Date; depuisLeMail: boolean };

/**
 * Le dernier envoi d'un devis (événement « Devis envoyé » qui le porte), parmi ceux chargés avec son dossier : sa date
 * d'écriture, ou celle du mail parti de Gmail (`envoyeLe` de l'événement, mission 18, B3).
 */
export function envoiDuDevis(dossier: { evenements: { metadata: string; createdAt: Date }[] }, devisId: string): EnvoiDuDevis | null {
  const envois = dossier.evenements
    .filter((e) => e.metadata.includes(devisId))
    .map((e) => {
      let meta: { canal?: unknown; envoyeLe?: unknown } = {};
      try {
        meta = JSON.parse(e.metadata) as typeof meta;
      } catch {
        // Metadata illisible : la date d'écriture.
      }
      const duMail = meta.canal === "GMAIL" && typeof meta.envoyeLe === "string" && !Number.isNaN(Date.parse(meta.envoyeLe));
      return duMail ? { le: new Date(meta.envoyeLe as string), depuisLeMail: true } : { le: e.createdAt, depuisLeMail: false };
    });
  return envois.reduce<EnvoiDuDevis | null>((dernier, envoi) => (!dernier || envoi.le.getTime() > dernier.le.getTime() ? envoi : dernier), null);
}

/**
 * Mission 18 (B5) : le jour où le client a eu le devis, pour le dire (« envoyé le », « envoyé il y a N jours », « adressé
 * le » de la relance) : son dernier envoi (mail du CRM, Gmail, mise en ligne dans l'espace), sinon son émission. Le dépôt
 * dans le CRM n'est pas un envoi (la référence du délai, elle, le compte : `referenceDuDevis`).
 */
export function dateDEnvoiDuDevis(devis: { dateEmission: Date }, envoi: EnvoiDuDevis | null): Date {
  return referenceDuDevis({ dateEmission: devis.dateEmission, createdAt: devis.dateEmission }, envoi);
}

/**
 * Les dossiers en « Devis envoyé » ou « Relance », non archivés (un seul si `dossierId` ; `touteEtape` : quelle que soit
 * son étape), avec leurs devis à relancer. Mission 18 (relecture) : jamais un devis généré mais pas encore envoyé (visible
 * sans annonce : variante silencieuse, espace fermé, pas d'adresse — `devisAEnvoyer`) ; la relance reste sur le devis
 * réellement envoyé, et ne parle pas d'un devis « adressé » que le client n'a pas reçu.
 */
async function chargerDossiersARelancer(filtre: { dossierId?: string; touteEtape?: boolean } = {}) {
  const dossiers = await lireDossiersARelancer(filtre);
  if (dossiers.length === 0) return dossiers;
  const { devisAEnvoyer } = await import("@/lib/dossiers/devis-envoye");
  const pasEnvoyes = new Set((await devisAEnvoyer(prisma, dossiers.map((d) => d.id))).map((d) => d.documentId));
  if (pasEnvoyes.size === 0) return dossiers;
  return dossiers.map((d) => ({ ...d, documents: d.documents.filter((document) => !pasEnvoyes.has(document.id)) }));
}

async function lireDossiersARelancer(filtre: { dossierId?: string; touteEtape?: boolean }) {
  return prisma.dossier.findMany({
    where: filtre.dossierId && filtre.touteEtape ? { id: filtre.dossierId } : { ...(filtre.dossierId ? { id: filtre.dossierId } : {}), etape: { in: ["DEVIS_ENVOYE", "RELANCE"] }, archiveLe: null },
    include: {
      // Mission 14 : seulement les devis que le client voit, jamais un devis archivé (l'extension ne filtre pas les include).
      documents: { where: { type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE"] }, visibleEspace: true, archiveLe: null }, orderBy: { dateEmission: "desc" } },
      // Mission 18 (B2) : les envois des devis, du plus récent au plus ancien (référence des relances).
      evenements: { where: { type: "DEVIS_ENVOYE", archiveLe: null }, orderBy: { createdAt: "desc" }, select: { metadata: true, createdAt: true } },
      // Le numéro du SMS : celui du lead d'abord (`proposerSms`), sinon celui du dossier — pour le STOP.
      lead: { select: { telephone: true } },
      client: {
        select: {
          prenom: true,
          // Jamais une adresse archivée (erronée) : l'extension ne filtre pas les include.
          emails: { where: { archiveLe: null }, orderBy: [{ principale: "desc" }, { createdAt: "asc" }], take: 1, select: { adresse: true } },
          consentements: { orderBy: { recueilliLe: "desc" }, take: 1, select: { statut: true } },
        },
      },
    },
  });
}

type DossierARelancer = Awaited<ReturnType<typeof chargerDossiersARelancer>>[number];

/* ── Le compte des relances : une règle, tous canaux ─────────────────────── */

type TraceRelance = { dossierId: string; type: string; metadata: string; createdAt: Date };

/** Les traces de relance de ces dossiers : mails de relance partis (MAIL_ENVOYE, motif RELANCE_DEVIS) et SMS copiés portant une relance. */
async function tracesDeRelance(dossierIds: readonly string[]): Promise<TraceRelance[]> {
  if (dossierIds.length === 0) return [];
  return prisma.dossierEvenement.findMany({
    where: { dossierId: { in: [...dossierIds] }, OR: [{ type: "MAIL_ENVOYE", metadata: { contains: "RELANCE_DEVIS" } }, { type: "SMS_COPIE", metadata: { contains: '"relance"' } }] },
    orderBy: { createdAt: "desc" },
    select: { dossierId: true, type: true, metadata: true, createdAt: true },
  });
}

function documentDeLaRelance(metadata: string): string | null {
  try {
    const relance = (JSON.parse(metadata) as { relance?: { documentId?: unknown } }).relance;
    return typeof relance?.documentId === "string" ? relance.documentId : null;
  } catch {
    return null;
  }
}

/**
 * Les relances faites d'un devis, de la plus récente à la plus ancienne : le mail de relance parti (sa metadata porte
 * le motif et le devis) et le SMS de relance copié (`metadata.relance.documentId`, mission 14, partie 6). LA règle du
 * compte (deux au plus, tous canaux) et de la référence du délai (la dernière relance).
 */
export function relancesDuDevis(traces: readonly TraceRelance[], dossierId: string, devisId: string): { le: Date; canal: "MAIL" | "SMS" }[] {
  return traces
    .filter((t) => t.dossierId === dossierId)
    .flatMap((t): { le: Date; canal: "MAIL" | "SMS" }[] => {
      if (t.type === "MAIL_ENVOYE") return t.metadata.includes("RELANCE_DEVIS") && t.metadata.includes(devisId) ? [{ le: t.createdAt, canal: "MAIL" }] : [];
      return t.type === "SMS_COPIE" && documentDeLaRelance(t.metadata) === devisId ? [{ le: t.createdAt, canal: "SMS" }] : [];
    });
}

/* ── L'état des relances, devis par devis ─────────────────────────────────── */

export type DevisARelancer = {
  dossierId: string;
  clientNom: string;
  documentId: string;
  numero: string;
  totalHt: number;
  emisLe: string;
  joursDepuisEmission: number;
  /** Mission 18 (B5) : le dernier envoi du devis (mail, Gmail, mise en ligne), sinon son émission (`dateDEnvoiDuDevis`). */
  envoyeLe: string;
  joursDepuisEnvoi: number;
  relancesFaites: number;
  derniereRelanceLe: string | null;
  prochaineProposableLe: string | null;
  /** Le rang de la prochaine relance (relances faites + 1). */
  rang: number;
  /** Le délai est écoulé depuis la référence, moins de deux relances sont faites et aucun mail de relance n'est en cours d'envoi : la relance est à faire. */
  proposable: boolean;
  adresse: string | null;
  refusMail: boolean;
  /** Le client a répondu STOP (conversation SMS de son numéro) : aucun SMS de relance ne lui est proposé. */
  stop: boolean;
  /** Le SMS à copier (quand la relance est proposable, sauf STOP) : texte du catalogue, téléphone, relance à compter. */
  sms: PropositionSms | null;
  /** Le numéro du SMS (celui du lead d'abord, sinon celui du dossier), même quand le SMS n'est pas préparé (`sms: false`). */
  telephone: string | null;
  /** La proposition de mail de relance qui attend sa validation, s'il y en a une (sinon : pas d'adresse, refus des mails, pas encore proposée ou déjà traitée). */
  mail: { propositionId: string; a: string | null; expireLe: string | null } | null;
  /**
   * Le mail de relance de CE rang qui n'attend plus sa validation et n'est pas parti : validé, en cours d'envoi
   * (VALIDEE : la relance est faite, elle n'est plus proposable) ; en échec (ECHEC : à réessayer, ou le SMS l'annule) ;
   * rejeté, annulé ou expiré (clé unique : il ne sera pas reproposé, le SMS seul).
   */
  mailTraite: { propositionId: string; statut: StatutMailTraite } | null;
};

export type StatutMailTraite = "VALIDEE" | "ECHEC" | "REJETEE" | "ANNULEE" | "EXPIREE";
const STATUTS_TRAITES: readonly string[] = ["VALIDEE", "ECHEC", "REJETEE", "ANNULEE", "EXPIREE"];

const destinataireDuMail = (contenu: string): string | null => {
  try {
    const a = (JSON.parse(contenu) as { a?: unknown }).a;
    return typeof a === "string" ? a : null;
  } catch {
    return null;
  }
};

/**
 * Mission 11, puis 14 (partie 6) : l'état des relances, devis par devis — pour « voir_relances », la feuille des
 * relances et la fiche du dossier (`relancesProposables`). Un devis dont la relance est proposable porte son SMS à
 * copier (sauf STOP) ; le client sans e-mail y est, avec son SMS. Un mail de relance validé et pas encore parti rend
 * la relance non proposable : elle est faite. Rien n'est écrit (le SMS n'ouvre aucun espace).
 */
export async function listerRelances(maintenant: Date = new Date(), filtre: { dossierId?: string; sms?: boolean } = {}): Promise<{ delai: number; delaiParDefaut: boolean; devis: DevisARelancer[] }> {
  const { jours: delai, parametre } = await lireDelaiRelance(maintenant);
  const dossiers = await chargerDossiersARelancer({ dossierId: filtre.dossierId });
  // Mission 13 (lot 6) : les relances déjà faites en une requête pour tous les dossiers (plus de N+1).
  const traces = await tracesDeRelance(dossiers.map((d) => d.id));
  const etats = dossiers.flatMap((dossier) => {
    const devis = dossier.documents[0];
    if (!devis?.numero || !devis.dateEmission) return [];
    const relances = relancesDuDevis(traces, dossier.id, devis.id);
    return [{ dossier, devis, numero: devis.numero, emisLe: devis.dateEmission, relances, rang: relances.length + 1 }];
  });
  // Les mails de relance en attente (tout rang), et celui du rang à venir quel que soit son statut (clé unique : jamais reproposé).
  const [mails, estEnStop] = await Promise.all([
    prisma.proposition.findMany({
      where: { type: "ENVOI_MAIL", OR: [{ statut: "EN_ATTENTE", contenu: { contains: "RELANCE_DEVIS" } }, { cleUnicite: { in: etats.map((e) => cleRelance(e.devis.id, e.rang)) } }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, statut: true, contenu: true, expireLe: true, cleUnicite: true },
    }),
    lecteurDuStop(etats.flatMap((e) => [e.dossier.lead?.telephone, e.dossier.clientTelephone])),
  ]);
  const liste: DevisARelancer[] = [];
  for (const { dossier, devis, numero, emisLe, relances, rang } of etats) {
    const consentement = dossier.client?.consentements[0]?.statut;
    const adresse = dossier.clientEmail ?? dossier.client?.emails[0]?.adresse ?? null;
    const envoi = envoiDuDevis(dossier, devis.id);
    const reference = relances[0]?.le ?? referenceDuDevis({ dateEmission: emisLe, createdAt: devis.createdAt }, envoi);
    const envoyeLe = dateDEnvoiDuDevis({ dateEmission: emisLe }, envoi);
    const prochaine = relances.length < RELANCES_MAX_PAR_DEVIS ? new Date(reference.getTime() + delai * JOUR_MS) : null;
    const proposition = mails.find((p) => p.statut === "EN_ATTENTE" && p.contenu.includes(devis.id));
    // Le mail de CE rang déjà décidé : validé (il part), en échec, ou écarté. Celui d'un rang passé est compté par sa trace.
    const traite = mails.find((p) => p.cleUnicite === cleRelance(devis.id, rang) && STATUTS_TRAITES.includes(p.statut));
    // Un mail de relance validé part (file d'exécution) : la relance est faite, rien d'autre à proposer.
    const proposable = prochaine !== null && prochaine.getTime() <= maintenant.getTime() && traite?.statut !== "VALIDEE";
    const stop = estEnStop([dossier.lead?.telephone, dossier.clientTelephone]);
    // Mission 17 (partie A, relecture) : `sms: false` (détecteur des tâches, comptes du jour) ne prépare pas le SMS —
    // une lecture par devis à chaque passage ; l'écran SMS le prépare à l'ouverture.
    const sms =
      proposable && !stop && filtre.sms !== false
        ? await proposerSms({ action: "RELANCE_DEVIS", dossierId: dossier.id, relance: { documentId: devis.id, rang } }, maintenant).catch((erreur: unknown) => {
            console.error(`[relances] SMS de relance impossible à préparer pour le dossier ${dossier.id} :`, erreur);
            return null;
          })
        : null;
    liste.push({
      dossierId: dossier.id,
      clientNom: dossier.clientNom,
      documentId: devis.id,
      numero,
      totalHt: devis.totalHt,
      emisLe: emisLe.toISOString(),
      joursDepuisEmission: Math.floor((maintenant.getTime() - emisLe.getTime()) / JOUR_MS),
      envoyeLe: envoyeLe.toISOString(),
      joursDepuisEnvoi: Math.max(0, Math.floor((maintenant.getTime() - envoyeLe.getTime()) / JOUR_MS)),
      relancesFaites: relances.length,
      derniereRelanceLe: relances[0]?.le.toISOString() ?? null,
      prochaineProposableLe: prochaine?.toISOString() ?? null,
      rang,
      proposable,
      adresse,
      refusMail: consentement === "REFUSE" || consentement === "RETIRE",
      stop,
      sms,
      telephone: normaliserTelephone(dossier.lead?.telephone ?? null) ?? normaliserTelephone(dossier.clientTelephone ?? null),
      mail: proposition ? { propositionId: proposition.id, a: destinataireDuMail(proposition.contenu), expireLe: proposition.expireLe?.toISOString() ?? null } : null,
      mailTraite: traite ? { propositionId: traite.id, statut: traite.statut as StatutMailTraite } : null,
    });
  }
  // Mission 18 (relecture) : les plus anciens d'abord, comptés depuis l'envoi (mise en ligne, mail) et non l'émission.
  return { delai, delaiParDefaut: !parametre, devis: liste.sort((a, b) => b.joursDepuisEnvoi - a.joursDepuisEnvoi || b.joursDepuisEmission - a.joursDepuisEmission) };
}

/* ── Le mail de relance (proposition à valider) ───────────────────────────── */

/** « Le mail de relance n° 1 du devis … a été annulé : il ne sera pas reproposé ; la relance reste possible par SMS. » */
export function mailDejaTraite(rang: number, numero: string, statut: string): string {
  const mail = `Le mail de relance n° ${rang} du devis ${numero}`;
  if (statut === "VALIDEE") return `${mail} est validé et part : la relance est faite.`;
  if (statut === "EXECUTEE") return `${mail} est déjà parti : la relance est faite.`;
  if (statut === "ECHEC") return `${mail} n'est pas parti (échec) : le réessayer depuis « À valider », ou copier le SMS de relance (qui l'annule).`;
  const participe = statut === "REJETEE" ? "rejeté" : statut === "EXPIREE" ? "expiré" : "annulé";
  return `${mail} a été ${participe} : il ne sera pas reproposé ; la relance reste possible par SMS (« lister » RELANCES).`;
}

export type RelanceProposee = { propositionId: string; creee: boolean; rang: number; numero: string; documentId: string; a: string; objet: string; texte: string };

/**
 * La relance d'un devis par mail : une proposition « Envoyer un mail » pré-rédigée. `forcer` passe outre le délai
 * (jamais le refus des mails, l'absence d'adresse ni le plafond) ; `apercuSeulement` ne crée rien. Le rang compte
 * aussi les SMS de relance copiés.
 */
export async function relancerDevis(dossierId: string, options: { maintenant?: Date; forcer?: boolean; documentId?: string; apercuSeulement?: boolean; delai?: number | null } = {}): Promise<RelanceProposee> {
  const maintenant = options.maintenant ?? new Date();
  const dossier: DossierARelancer | undefined = (await chargerDossiersARelancer({ dossierId, touteEtape: true }))[0];
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const devis = options.documentId ? dossier.documents.find((d) => d.id === options.documentId) : dossier.documents[0];
  if (!devis?.numero || !devis.dateEmission) throw new ErreurMetier(`Aucun devis envoyé en attente de réponse pour ${dossier.clientNom}.`, 409);
  const consentement = dossier.client?.consentements[0]?.statut;
  if (consentement === "REFUSE" || consentement === "RETIRE") throw new ErreurMetier(`${dossier.clientNom} a refusé les mails : relancer par téléphone.`, 409);
  const adresse = dossier.clientEmail ?? dossier.client?.emails[0]?.adresse ?? null;
  if (!adresse) throw new ErreurMetier(`Aucune adresse e-mail pour ${dossier.clientNom} : relancer par téléphone ou SMS.`, 409);
  const relances = relancesDuDevis(await tracesDeRelance([dossier.id]), dossier.id, devis.id);
  if (relances.length >= RELANCES_MAX_PAR_DEVIS) throw new ErreurMetier(`Déjà ${RELANCES_MAX_PAR_DEVIS} relances faites pour le devis ${devis.numero} (mail ou SMS) : plus de relance.`, 409);
  const delai = options.delai === undefined || options.delai === null ? (await lireDelaiRelance(maintenant)).jours : options.delai;
  const envoi = envoiDuDevis(dossier, devis.id);
  const reference = relances[0]?.le ?? referenceDuDevis({ dateEmission: devis.dateEmission, createdAt: devis.createdAt }, envoi);
  if (!options.forcer && maintenant.getTime() - reference.getTime() < delai * JOUR_MS) throw new ErreurMetier("Délai de relance pas encore écoulé.", 409);
  const rang = relances.length + 1;
  // « relancer » (forcer) : le mail de ce rang déjà validé, en échec ou écarté n'est jamais reproposé — le dire tout de suite.
  const existant = options.forcer ? await prisma.proposition.findUnique({ where: { cleUnicite: cleRelance(devis.id, rang) }, select: { statut: true } }) : null;
  if (existant && existant.statut !== "EN_ATTENTE") throw new ErreurMetier(mailDejaTraite(rang, devis.numero, existant.statut), 409);
  // Mission 18 (B5) : « envoyé il y a N jours », « adressé le » : depuis l'envoi (mail, Gmail, mise en ligne), pas l'émission.
  const envoyeLe = dateDEnvoiDuDevis({ dateEmission: devis.dateEmission }, envoi);
  const jours = Math.max(0, Math.floor((maintenant.getTime() - envoyeLe.getTime()) / JOUR_MS));
  const { objet, texte } = texteRelance({ prenom: dossier.client?.prenom ?? null, numero: devis.numero, emisLe: devis.dateEmission, envoyeLe, rang });
  if (options.apercuSeulement) return { propositionId: "", creee: false, rang, numero: devis.numero, documentId: devis.id, a: adresse, objet, texte };
  const { id, creee } = await proposer({
    type: "ENVOI_MAIL",
    titre: `Relancer ${dossier.clientNom} : devis ${devis.numero}`,
    resume: `Devis envoyé il y a ${jours} jours, sans réponse enregistrée. Relance n° ${rang} sur ${RELANCES_MAX_PAR_DEVIS}.${options.forcer ? " Demandée par Lucas (sans attendre le délai)." : ""}`,
    raisonnement: `Dossier à l'étape « ${dossier.etape === "RELANCE" ? "Relance" : "Devis envoyé"} » ; ${
      relances.length ? `dernière relance (${relances[0].canal === "SMS" ? "SMS" : "mail"}) le ${dateEnLettres(relances[0].le)}` : envoi ? `devis émis le ${dateEnLettres(devis.dateEmission)}, envoyé le ${dateEnLettres(envoyeLe)}` : `devis émis le ${dateEnLettres(devis.dateEmission)}`
    } ; délai de relance : ${delai} jours.`,
    contenu: { motif: "RELANCE_DEVIS", dossierId: dossier.id, clientId: dossier.clientId, a: adresse, objet, texte, documentIds: [devis.id] },
    cleUnicite: cleRelance(devis.id, rang),
    dossierId: dossier.id,
    clientId: dossier.clientId ?? undefined,
    expireLe: new Date(maintenant.getTime() + 14 * JOUR_MS),
  });
  return { propositionId: id, creee, rang, numero: devis.numero, documentId: devis.id, a: adresse, objet, texte };
}

/**
 * La passe périodique : le mail de relance de chaque devis dû, pour les clients qui ont une adresse et n'ont pas
 * refusé les mails. Les autres (`sansAdresse`, `refusMail`) ne sont plus oubliés : leur SMS est dans la liste
 * calculée (`listerRelances`, `relancesProposables`), rien à créer en base pour eux.
 */
export async function proposerRelances(maintenant: Date = new Date()): Promise<ResumeRelances> {
  const resume: ResumeRelances = { proposees: 0, dejaProposees: 0, parametreManquant: false, sansAdresse: 0, refusMail: 0 };
  const { jours: delai } = await lireDelaiRelance(maintenant);
  const dossiers = await chargerDossiersARelancer();
  const traces = await tracesDeRelance(dossiers.map((d) => d.id));

  for (const dossier of dossiers) {
    const devis = dossier.documents[0];
    if (!devis?.numero || !devis.dateEmission) continue;
    const consentement = dossier.client?.consentements[0]?.statut;
    if (consentement === "REFUSE" || consentement === "RETIRE") {
      resume.refusMail++;
      continue;
    }
    const adresse = dossier.clientEmail ?? dossier.client?.emails[0]?.adresse ?? null;
    if (!adresse) {
      resume.sansAdresse++;
      continue;
    }
    const relances = relancesDuDevis(traces, dossier.id, devis.id);
    if (relances.length >= RELANCES_MAX_PAR_DEVIS) continue;
    const reference = relances[0]?.le ?? referenceDuDevis({ dateEmission: devis.dateEmission, createdAt: devis.createdAt }, envoiDuDevis(dossier, devis.id));
    if (maintenant.getTime() - reference.getTime() < delai * JOUR_MS) continue;
    const { creee } = await relancerDevis(dossier.id, { maintenant, delai });
    if (creee) resume.proposees++;
    else resume.dejaProposees++;
  }
  return resume;
}

export function enregistrerTachesRelances(): void {
  enregistrerTravailPeriodique({
    nom: "propositions-relances",
    libelle: "Propositions de relance des devis sans réponse (remplacé par la messagerie, mission 25)",
    acteur: "SYSTEME:relances",
    intervalleMs: 6 * 60 * 60_000,
    // Mission 25 : les relances de devis (D2 à D5) sont préparées par le moteur de la messagerie, à l'heure prévue,
    // après la garde de silence ; ce circuit de mails proposés toutes les 6 h ne tourne plus (pas de doublon).
    estActif: () => false,
    executer: async () => {
      const resume = await proposerRelances();
      if (resume.parametreManquant) console.info("[relances] délai de relance non renseigné : aucune proposition");
    },
  });
}
