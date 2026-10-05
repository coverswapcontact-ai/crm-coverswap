import { z } from "zod/v4";
import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lirePieceMessage } from "@/lib/messages/consultation";
import { lireListe } from "@/lib/messages/stockage";
import { LIBELLES_STATUT_DOCUMENT, type StatutDocument } from "./constants";
import { formatDateCourte, jourParis } from "./dates";
import { devisAEnvoyer, passerEnDevisEnvoye, STATUTS_DEVIS_ENVOYE } from "./devis-envoye";
import { PDF_OCTETS_MAX, rattacherDocumentExistant, schemaDocumentExistant } from "./documents-existants";
import { cleNumero, lireNumero } from "./numerotation";
import { enregistrerPdf } from "./stockage";
import { appliquerEvenementDossier, suitesEvenementDossier } from "./synchro";
import type { ChangementEtape } from "./transitions";

/**
 * Mission 18 (B3, écart 3) — un devis envoyé depuis Gmail, hors du CRM.
 *
 * 1. Le PDF est gardé : un mail SORTANT (parti de la boîte, pas par le CRM), non automatique, rangé dans le dossier d'un
 *    client (mail/rattachement.ts › suitesDuTri) voit ses PDF conservés dans le CRM (file MAIL_PDF_SORTANTS).
 * 2. Une tâche le dit : un PDF conservé d'un tel mail, dont le nom évoque un devis, de moins de 30 jours, sur un dossier
 *    vivant, et qui n'est ni un envoi du CRM (identifiant « crm: », envoi programmé ou mail de proposition de même objet
 *    et même destinataire), ni déjà dans le CRM (un devis de ce numéro, ou déposé depuis ce mail) → tâche
 *    ENREGISTRER_DEVIS « Enregistrer comme devis envoyé · Nom » (a-faire/detecteurs/dossiers.ts).
 * 3. Le geste, en une fois (`enregistrerDevisGmail`, appelé par `deposerDocument` quand la source est la pièce d'un tel
 *    mail : modale du dossier, outil « ajouter_fichier » piece_mail) : dans UNE transaction, le devis est déposé (numéro,
 *    montant, PDF du mail) ou, s'il a été généré par le CRM puis envoyé par Gmail, passé « Envoyé » ; visible dans
 *    l'espace ; l'événement « Devis envoyé » (`canal: "GMAIL"`) porte la date du mail, d'où partent les relances ; Q, S,
 *    Relance → Devis envoyé ; puis le point d'entrée (« Attendre l'accord », main). Les effets externes après.
 * Aucun mail ne part : le client a déjà le devis. Le texte du PDF n'est pas lu (aucune bibliothèque) : le montant se
 * saisit, sauf s'il est au registre des numéros.
 */

/** Au-delà, un PDF parti de Gmail n'est plus relevé (la relève initiale de la boîte couvre 30 jours). */
export const JOURS_DEVIS_GMAIL = 30;

const sansExtension = (nom: string) => nom.replace(/\.[A-Za-z0-9]{1,5}$/, "");

/**
 * Le numéro de devis lu dans le nom du fichier : « Devis-2026-012-NOM.pdf » → « 2026-012 ». Jamais une facture
 * (« F2026-… ») ni une date (« 2026-10-05 »). Rang sur trois chiffres au moins, comme le registre.
 */
export function numeroDevine(nom: string): string | null {
  const lu = /(?:^|[^A-Za-z0-9])(20\d{2})[-_ ](\d{1,4})(?!\d)(?![-_]\d{1,2}(?!\d))/.exec(sansExtension(nom));
  if (!lu) return null;
  return `${lu[1]}-${lu[2].padStart(3, "0")}`;
}

/** Un nom de PDF qui évoque un devis : « devis » dans le nom, ou un numéro de devis ; jamais une facture ni un avoir. */
export function evoqueUnDevis(nom: string): boolean {
  const propre = sansExtension(nom);
  if (/factur|invoice|\bavoir\b|(?:^|[^A-Za-z])F\d{4}[-_ ]\d/i.test(propre)) return false;
  return /devis|quote/i.test(propre) || numeroDevine(propre) !== null;
}

/** La clé du registre d'un numéro (famille, année, rang), pour comparer « 2026-12 » et « 2026-012 ». */
function cleDe(numero: string | null | undefined): string | null {
  const lu = numero ? lireNumero(numero) : null;
  return lu ? cleNumero(lu.famille, lu.annee, lu.rang) : null;
}

/** La pièce d'un mail parti de Gmail : mail SORTANT, non automatique, pièce téléchargeable (partie Gmail), PDF. */
type MessageGmail = { id: string; identifiantCanal: string; dossierId: string | null; clientId: string | null; objet: string | null; a: string; recuLe: Date };

/**
 * Un envoi du CRM relu par la synchronisation (identifiant « crm: », ou relevé de Gmail sans être reconnu) n'est jamais
 * pris pour un devis envoyé depuis Gmail : même objet et même destinataire qu'un mail programmé par le CRM, ou qu'un mail
 * de proposition (bouton « Envoyer par mail », outil « envoyer_document ») tracé dans le dossier.
 */
export async function estEnvoiDuCrm(message: MessageGmail, client: Transaction = prisma): Promise<boolean> {
  if (message.identifiantCanal.startsWith("crm:")) return true;
  const destinataires = lireListe(message.a).map((a) => a.toLowerCase());
  if (destinataires.length === 0 || !message.objet) return false;
  const programme = await client.envoiMail.findFirst({ where: { objet: message.objet, a: { in: destinataires }, statut: { in: ["A_ENVOYER", "ENVOYE"] } }, select: { id: true } });
  if (programme) return true;
  if (!message.dossierId) return false;
  const traces = await client.dossierEvenement.findMany({
    where: { dossierId: message.dossierId, type: "MAIL_ENVOYE", metadata: { contains: '"propositionId"' }, contenu: { contains: `« ${message.objet} »` } },
    select: { metadata: true },
  });
  return traces.some((t) => destinataires.some((a) => t.metadata.toLowerCase().includes(`"a":"${a}"`)));
}

export type DevisGmail = {
  dossierId: string;
  messageId: string;
  pieceId: string;
  nom: string;
  envoyeLe: Date;
  a: string;
  objet: string | null;
  /** Le numéro lu dans le nom du fichier (null : à saisir). */
  numero: string | null;
  /** Un devis du CRM de ce numéro, généré mais pas encore envoyé : le geste l'enregistre comme envoyé (pas de dépôt). */
  devisCrm: { id: string; numero: string } | null;
};

const lirePieceId = (metadata: string): string | null => {
  try {
    const valeur = JSON.parse(metadata) as { pieceId?: unknown };
    return typeof valeur?.pieceId === "string" ? valeur.pieceId : null;
  } catch {
    return null;
  }
};

/**
 * Les PDF partis de Gmail qui ressemblent à un devis et ne sont pas encore dans le CRM (voir l'en-tête). Lecture seule :
 * le détecteur des dossiers en fait des tâches, la modale de dépôt les relit.
 */
export async function devisGmailNonEnregistres(client: Transaction = prisma, options: { dossierIds?: readonly string[]; maintenant?: Date } = {}): Promise<DevisGmail[]> {
  const maintenant = options.maintenant ?? new Date();
  const pieces = await client.pieceMessage.findMany({
    where: {
      statut: "CONSERVEE",
      typeMime: "application/pdf",
      partie: { not: "" },
      fichierId: { not: null },
      message: {
        archiveLe: null,
        canal: "EMAIL",
        sens: "SORTANT",
        automatique: false,
        recuLe: { gte: new Date(maintenant.getTime() - JOURS_DEVIS_GMAIL * 24 * 60 * 60_000) },
        dossierId: options.dossierIds ? { in: [...options.dossierIds] } : { not: null },
        dossier: { archiveLe: null, etape: { notIn: ["PERDU", "ENCAISSE"] } },
      },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, nom: true, message: { select: { id: true, identifiantCanal: true, dossierId: true, clientId: true, objet: true, a: true, recuLe: true } } },
  });
  const candidates = pieces.filter((p) => p.message.dossierId && evoqueUnDevis(p.nom));
  if (candidates.length === 0) return [];
  const dossierIds = [...new Set(candidates.map((p) => p.message.dossierId!))];
  const numeros = [...new Set(candidates.map((p) => numeroDevine(p.nom)).filter((n): n is string => Boolean(n)))];
  const [deposes, documents, ailleurs, aEnvoyer] = await Promise.all([
    client.dossierEvenement.findMany({ where: { dossierId: { in: dossierIds }, type: "DEVIS_ENVOYE", metadata: { contains: '"canal":"GMAIL"' } }, select: { metadata: true } }),
    client.document.findMany({ where: { dossierId: { in: dossierIds }, type: "DEVIS", numero: { not: null }, archiveLe: null }, select: { id: true, dossierId: true, numero: true, createdAt: true } }),
    numeros.length ? client.document.findMany({ where: { type: "DEVIS", numero: { in: numeros }, archiveLe: null }, select: { numero: true } }) : Promise.resolve([]),
    devisAEnvoyer(client, dossierIds),
  ]);
  const piecesDeposees = new Set(deposes.map((e) => lirePieceId(e.metadata)).filter(Boolean));
  const numerosAilleurs = new Set(ailleurs.map((d) => cleDe(d.numero)));
  const idsAEnvoyer = new Set(aEnvoyer.map((d) => d.documentId));

  const resultat: DevisGmail[] = [];
  for (const p of candidates) {
    if (piecesDeposees.has(p.id)) continue;
    const dossierId = p.message.dossierId!;
    const numero = numeroDevine(p.nom);
    const cle = cleDe(numero);
    const duDossier = documents.filter((d) => d.dossierId === dossierId);
    const meme = cle ? duDossier.find((d) => cleDe(d.numero) === cle) : undefined;
    let devisCrm: DevisGmail["devisCrm"] = null;
    if (meme) {
      // Le devis du CRM de ce numéro : déjà envoyé, accepté, refusé… → rien à faire ; pas encore envoyé → à enregistrer.
      if (!idsAEnvoyer.has(meme.id)) continue;
      devisCrm = { id: meme.id, numero: meme.numero! };
    } else if (cle && numerosAilleurs.has(cle)) {
      continue;
    } else if (!cle && duDossier.some((d) => d.createdAt.getTime() >= p.message.recuLe.getTime())) {
      // Sans numéro lisible : un devis entré dans le dossier après le mail est celui-là.
      continue;
    }
    if (await estEnvoiDuCrm(p.message, client)) continue;
    resultat.push({ dossierId, messageId: p.message.id, pieceId: p.id, nom: p.nom, envoyeLe: p.message.recuLe, a: lireListe(p.message.a)[0] ?? "", objet: p.message.objet, numero, devisCrm });
  }
  return resultat;
}

/** La pièce de la modale « Enregistrer comme devis envoyé » : le candidat, et le montant du registre si le numéro y est. */
export async function lireDevisGmail(dossierId: string, pieceId: string): Promise<DevisGmail & { registre: { numero: string; montant: number | null; emisLe: Date | null } | null }> {
  const [candidat] = (await devisGmailNonEnregistres(prisma, { dossierIds: [dossierId] })).filter((c) => c.pieceId === pieceId);
  if (!candidat) throw new ErreurMetier("Ce PDF parti de Gmail est déjà enregistré dans le dossier (ou n'y est plus à enregistrer).", 404);
  const lu = candidat.numero ? lireNumero(candidat.numero) : null;
  const ligne = lu ? await prisma.numeroDocument.findUnique({ where: { cle: cleNumero(lu.famille, lu.annee, lu.rang) }, select: { numero: true, montant: true, emisLe: true, documentId: true } }) : null;
  return { ...candidat, registre: ligne && !ligne.documentId ? { numero: ligne.numero, montant: ligne.montant, emisLe: ligne.emisLe } : null };
}

/** La modale « Enregistrer comme devis envoyé » (route /api/dossiers/[id]/devis-gmail) : les champs du dépôt, la pièce. */
export const schemaDevisGmail = z.object({
  messageId: z.string("Mail manquant.").max(40),
  pieceId: z.string("Pièce manquante.").max(40),
  numero: z.string().trim().max(30).nullable().optional(),
  montant: z.number("Montant invalide.").gt(0, "Le montant doit être supérieur à zéro.").max(10_000_000, "Montant invalide.").nullable().optional(),
  dateEmission: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date d'émission invalide.").nullable().optional(),
  acomptePct: z.number().int().min(0).max(100).nullable().optional(),
  libelleVariante: z.string().trim().max(80).nullable().optional(),
  objet: z.string().trim().max(160).nullable().optional(),
  inscrireAuRegistre: z.boolean().optional(),
});

export type EntreeDevisGmail = {
  messageId: string;
  pieceId: string;
  numero?: string | null;
  montant?: number | null;
  /** AAAA-MM-JJ ; par défaut le jour du mail. */
  dateEmission?: string | null;
  acomptePct?: number | null;
  libelleVariante?: string | null;
  objet?: string | null;
  inscrireAuRegistre?: boolean;
};

export type ResultatDevisGmail = {
  /** DEPOSE : devis fait ailleurs, rattaché avec le PDF du mail ; ENVOYE : devis du CRM, passé « Envoyé ». */
  nature: "DEPOSE" | "ENVOYE";
  documentId: string;
  numero: string;
  avertissements: string[];
  changements: ChangementEtape[];
  /** Déjà enregistré depuis ce mail : rien n'a changé (nouvelle tentative, double clic). */
  deja: boolean;
  nom: string;
  octets: number;
};

/** La pièce et son mail, vérifiés : un PDF parti de Gmail chez le client de ce dossier. Rend null pour toute autre pièce. */
export async function pieceEnvoyeeDepuisGmail(messageId: string, pieceId: string): Promise<{ nom: string; message: MessageGmail } | null> {
  const piece = await prisma.pieceMessage.findUnique({
    where: { id: pieceId },
    select: { messageId: true, nom: true, typeMime: true, partie: true, message: { select: { id: true, identifiantCanal: true, dossierId: true, clientId: true, objet: true, a: true, recuLe: true, sens: true, automatique: true, canal: true } } },
  });
  if (!piece || piece.messageId !== messageId) return null;
  const m = piece.message;
  if (m.canal !== "EMAIL" || m.sens !== "SORTANT" || m.automatique || !piece.partie || piece.typeMime !== "application/pdf") return null;
  return { nom: piece.nom, message: { id: m.id, identifiantCanal: m.identifiantCanal, dossierId: m.dossierId, clientId: m.clientId, objet: m.objet, a: m.a, recuLe: m.recuLe } };
}

/** L'événement « Devis envoyé » d'un envoi depuis Gmail : la date du mail (référence des relances) et sa pièce. */
async function ecrireEnvoiGmail(tx: Transaction, dossierId: string, envoi: { documentId: string; numero: string; message: MessageGmail; pieceId: string; renduVisible: boolean }): Promise<void> {
  const a = lireListe(envoi.message.a)[0] ?? "le client";
  await tx.dossierEvenement.create({
    data: {
      dossierId,
      type: "DEVIS_ENVOYE",
      direction: "INTERNE",
      contenu: `Devis ${envoi.numero} envoyé depuis Gmail à ${a} le ${formatDateCourte(envoi.message.recuLe)}${envoi.renduVisible ? ", rendu visible dans son espace" : ""}`,
      metadata: JSON.stringify({ documentId: envoi.documentId, canal: "GMAIL", messageId: envoi.message.id, pieceId: envoi.pieceId, envoyeLe: envoi.message.recuLe.toISOString() }),
    },
  });
}

/**
 * « Enregistrer comme devis envoyé » (voir l'en-tête) : le PDF est vérifié avant toute écriture ; tout le reste se fait
 * dans une transaction ; rejouable (un second appel pour la même pièce rend `deja`, sans rien écrire).
 */
export async function enregistrerDevisGmail(dossierId: string, entree: EntreeDevisGmail): Promise<ResultatDevisGmail> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, archiveLe: true, clientId: true } });
  if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  const piece = await pieceEnvoyeeDepuisGmail(entree.messageId, entree.pieceId);
  if (!piece) throw new ErreurMetier("Cette pièce n'est pas un PDF parti de la boîte Gmail.", 400);
  if (piece.message.dossierId !== dossierId && !(dossier.clientId && piece.message.clientId === dossier.clientId)) {
    throw new ErreurMetier("Ce mail n'est pas rangé chez le client de ce dossier.", 409);
  }

  const deja = await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "DEVIS_ENVOYE", metadata: { contains: `"pieceId":"${entree.pieceId}"` } }, select: { metadata: true } });
  if (deja) {
    const documentId = (JSON.parse(deja.metadata) as { documentId: string }).documentId;
    const document = await prisma.document.findUnique({ where: { id: documentId }, select: { numero: true } });
    return { nature: "DEPOSE", documentId, numero: document?.numero ?? "", avertissements: [], changements: [], deja: true, nom: piece.nom, octets: 0 };
  }

  // Le PDF d'abord : vide, trop lourd ou pas un PDF → rien n'est écrit, aucun numéro consommé.
  const fichier = await lirePieceMessage(entree.messageId, entree.pieceId);
  if (fichier.contenu.length === 0) throw new ErreurMetier("Le PDF est vide.", 400);
  if (fichier.contenu.length > PDF_OCTETS_MAX) throw new ErreurMetier("PDF trop lourd : 9 Mo maximum.", 413);
  if (fichier.contenu.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ErreurMetier("Ce fichier n'est pas un PDF.", 415);

  const numero = entree.numero?.trim() || numeroDevine(piece.nom);
  if (!numero) throw new ErreurMetier("Le numéro du devis est obligatoire (illisible dans le nom du fichier).", 400);
  const cle = cleDe(numero);
  const devisDuDossier = await prisma.document.findMany({ where: { dossierId, type: "DEVIS", numero: { not: null }, archiveLe: null }, select: { id: true, numero: true, statut: true, visibleEspace: true } });
  const existant = cle ? devisDuDossier.find((d) => cleDe(d.numero) === cle) : undefined;
  if (existant && !(STATUTS_DEVIS_ENVOYE as readonly string[]).includes(existant.statut)) {
    throw new ErreurMetier(`Le devis ${existant.numero} est déjà « ${LIBELLES_STATUT_DOCUMENT[existant.statut as StatutDocument] ?? existant.statut} » : rien à enregistrer.`, 409);
  }
  if (!existant && !entree.montant) throw new ErreurMetier("Le montant HT est obligatoire.", 400);

  const { resultat, suites } = await prisma.$transaction(
    async (tx) => {
      let documentId: string;
      let numeroFinal: string;
      let avertissements: string[] = [];
      const changements: ChangementEtape[] = [];
      if (existant) {
        // Généré par le CRM, envoyé par Gmail : « Envoyé », visible dans son espace ; le PDF reste celui du CRM.
        await tx.document.update({ where: { id: existant.id }, data: { statut: "ENVOYE", visibleEspace: true } });
        await ecrireEnvoiGmail(tx, dossierId, { documentId: existant.id, numero: existant.numero!, message: piece.message, pieceId: entree.pieceId, renduVisible: !existant.visibleEspace });
        documentId = existant.id;
        numeroFinal = existant.numero!;
        const changement = await passerEnDevisEnvoye(tx, dossierId, { documentId, raison: `devis ${numeroFinal} envoyé depuis Gmail` });
        if (changement) changements.push(changement);
      } else {
        const repris = await rattacherDocumentExistant(
          tx,
          dossierId,
          schemaDocumentExistant.parse({
            type: "DEVIS",
            numero,
            dateEmission: entree.dateEmission || jourParis(piece.message.recuLe),
            montant: entree.montant,
            objet: entree.objet ?? null,
            statut: "ENVOYE",
            acomptePct: entree.acomptePct ?? null,
            libelleVariante: entree.libelleVariante ?? null,
            visibleEspace: true,
            inscrireAuRegistre: entree.inscrireAuRegistre ?? false,
          })
        );
        // Le PDF du mail, écrit pendant la transaction (fichier seul : jamais le client Prisma global ici) ; une
        // transaction annulée laisse au plus un fichier orphelin, écrasé par le prochain dépôt de ce numéro.
        const chemin = await enregistrerPdf(dossierId, "DEVIS", repris.numero, fichier.contenu);
        await tx.document.update({ where: { id: repris.documentId }, data: { pdfPath: chemin } });
        await ecrireEnvoiGmail(tx, dossierId, { documentId: repris.documentId, numero: repris.numero, message: piece.message, pieceId: entree.pieceId, renduVisible: false });
        documentId = repris.documentId;
        numeroFinal = repris.numero;
        avertissements = repris.avertissements;
        changements.push(...repris.changements);
      }
      const appliquees = await appliquerEvenementDossier(tx, dossierId, { type: "DEVIS_ENVOYE", documentId, canal: "GMAIL" });
      return {
        resultat: { nature: existant ? ("ENVOYE" as const) : ("DEPOSE" as const), documentId, numero: numeroFinal, avertissements, changements, deja: false, nom: piece.nom, octets: fichier.contenu.length },
        suites: { ...appliquees, changements },
      };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
  await suitesEvenementDossier(suites);
  return resultat;
}
