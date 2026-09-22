import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { completerCoordonnees, rattacherLead } from "@/lib/clients/identification";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { ajouterPhoto } from "@/lib/dossiers/dossiers";
import { recalculerMain } from "@/lib/dossiers/main";
import { lireFichierConserve } from "@/lib/fichiers/stockage";
import { conserverPieces, lireListe } from "@/lib/messages/stockage";
import { decouperNom, retirerCitations, trouverCodePostalVille, trouverTelephone } from "@/lib/messages/texte";
import { notifierDemandeDuSite } from "@/lib/prospects/notification";
import { classerLeadSansBloquer } from "@/lib/prospects/qualification";
import { mettreEnFile } from "@/lib/taches/file";
import { brancherSuitesDuTri, classerMessage } from "./boite";

/**
 * Ce que le tri déclenche (mission 7) : le mail rangé dans le dossier de son
 * client (un événement, qui fait bouger « qui a la main »), le lead créé pour
 * une demande reçue d'un inconnu, les photos et plans joints rangés dans le
 * dossier (et donc dans Drive). Et le rattachement à la main, en deux gestes.
 */

export const TYPE_TACHE_PIECES_DOSSIER = "MAIL_PIECES_DOSSIER";
const ETAPES_CLOSES = ["ENCAISSE", "PERDU"];

/** Le dossier d'un mail : celui où la conversation est déjà rangée, sinon le seul dossier en cours du client. */
async function dossierDuMail(messageId: string): Promise<string | null> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { dossierId: true, clientId: true, filCanal: true } });
  if (!message?.clientId) return null;
  if (message.dossierId) return message.dossierId;
  if (message.filCanal) {
    const duFil = await prisma.message.findFirst({ where: { canal: "EMAIL", filCanal: message.filCanal, dossierId: { not: null } }, orderBy: { recuLe: "desc" }, select: { dossierId: true } });
    if (duFil?.dossierId) {
      const dossier = await prisma.dossier.findUnique({ where: { id: duFil.dossierId }, select: { clientId: true, archiveLe: true } });
      if (dossier && !dossier.archiveLe && dossier.clientId === message.clientId) return duFil.dossierId;
    }
  }
  const enCours = await prisma.dossier.findMany({ where: { clientId: message.clientId, archiveLe: null, etape: { notIn: ETAPES_CLOSES } }, select: { id: true }, take: 2 });
  return enCours.length === 1 ? enCours[0].id : null;
}

/** Le mail dans l'historique du dossier (une fois), puis « qui a la main » recalculé. */
export async function tracerMailDansDossier(messageId: string, dossierId: string): Promise<boolean> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { pieces: { select: { nom: true, enLigne: true, taille: true } } } });
  if (!message || message.automatique) return false;
  const deja = await prisma.dossierEvenement.findFirst({ where: { dossierId, metadata: { contains: `"messageId":"${message.id}"` } }, select: { id: true } });
  if (deja) return false;
  const entrant = message.sens === "ENTRANT";
  const pieces = message.pieces.filter((p) => !p.enLigne || p.taille >= 50 * 1024);
  const objet = message.objet ? `« ${message.objet.slice(0, 160)} »` : "(sans objet)";
  await prisma.$transaction([
    prisma.dossierEvenement.create({
      data: {
        dossierId,
        type: entrant ? "MAIL_RECU" : "MAIL_ENVOYE",
        direction: entrant ? "ENTRANT" : "SORTANT",
        contenu: `${entrant ? `Mail de ${message.deNom ?? message.de}` : `Mail envoyé à ${lireListe(message.a).join(", ") || "?"}`} : ${objet}${pieces.length ? ` — ${pieces.length} pièce${pieces.length > 1 ? "s" : ""} jointe${pieces.length > 1 ? "s" : ""}` : ""}`,
        metadata: JSON.stringify({ messageId: message.id, pieces: pieces.map((p) => p.nom) }),
        createdAt: message.recuLe,
      },
    }),
    prisma.message.update({ where: { id: message.id }, data: { dossierId } }),
  ]);
  await recalculerMain(dossierId);
  return true;
}

/** Un lead sans dossier : le mail dans ses échanges. */
async function tracerMailSurLeLead(messageId: string, leadId: string): Promise<void> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { sens: true, objet: true, extrait: true, automatique: true } });
  if (!message || message.automatique) return;
  await prisma.interaction.create({
    data: { leadId, type: "EMAIL", contenu: `${message.sens === "ENTRANT" ? "Mail reçu" : "Mail envoyé"} : ${message.objet ?? "(sans objet)"}${message.extrait ? ` — ${message.extrait.slice(0, 300)}` : ""}` },
  });
}

const TYPES_DEVINES: [RegExp, string][] = [
  [/salles? de bains?|salles? d'eau|vasque|douche/i, "SDB"],
  [/meubles?|dressing|placards?|armoires?|biblioth[èe]que/i, "MEUBLES"],
  [/restaurant|bar|comptoir|boutique|commerce|bureau|local|h[ôo]tel/i, "PRO"],
  [/cuisines?|fa[çc]ades?|plan de travail|cr[ée]dence|[îi]lot/i, "CUISINE"],
];

/**
 * Un inconnu qui demande un devis par mail devient un lead (source « mail »),
 * rattaché à une fiche client (créée ou retrouvée), et Lucas est prévenu comme
 * pour une demande du site. Rejouable : pas de second lead pour la même adresse.
 */
export async function creerLeadDepuisMail(messageId: string, options: { notifier?: boolean } = {}): Promise<{ leadId: string; cree: boolean }> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { contenu: true } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  if (message.sens !== "ENTRANT") throw new ErreurMetier("Ce mail est parti de votre boîte : pas de lead à créer.", 400);
  const adresse = normaliserEmail(message.de);
  if (!adresse) throw new ErreurMetier("Adresse de l'expéditeur illisible.", 400);
  const existant = await prisma.lead.findFirst({ where: { email: adresse }, orderBy: { createdAt: "desc" }, select: { id: true, clientId: true } });
  if (existant) {
    await prisma.message.update({ where: { id: message.id }, data: { leadId: existant.id, clientId: message.clientId ?? existant.clientId } });
    return { leadId: existant.id, cree: false };
  }
  const texte = retirerCitations(message.contenu?.texte ?? message.extrait ?? "").slice(0, 4000);
  const { prenom, nomFamille } = decouperNom(message.deNom);
  const lieu = trouverCodePostalVille(texte);
  const telephone = trouverTelephone(texte) ?? "";
  const typeProjet = TYPES_DEVINES.find(([motif]) => motif.test(`${message.objet ?? ""} ${texte}`))?.[1] ?? "AUTRE";
  const { leadId, clientId } = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        prenom: prenom ?? "",
        nom: nomFamille ?? (prenom ? "" : adresse.split("@")[0]),
        telephone,
        email: adresse,
        ville: lieu?.ville ?? "",
        codePostal: lieu?.codePostal ?? null,
        source: "MAIL",
        typeProjet,
        message: texte.slice(0, 2000) || null,
        notes: `Demande reçue par mail le ${message.recuLe.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} : ${message.objet ?? "(sans objet)"}`,
      },
    });
    await tx.interaction.create({ data: { leadId: lead.id, type: "EMAIL", contenu: `Mail reçu : ${message.objet ?? "(sans objet)"} — ${texte.slice(0, 300)}` } });
    const clientId = await rattacherLead(tx, lead.id, null);
    return { leadId: lead.id, clientId };
  });
  await prisma.message.update({ where: { id: message.id }, data: { leadId, clientId, classe: "CLIENT", classeMotif: "Demande reçue par mail : lead créé.", statut: "RATTACHE", categorie: "NOUVELLE_DEMANDE" } });
  await classerLeadSansBloquer(leadId);
  if (options.notifier !== false) {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { prenom: true, nom: true, telephone: true, ville: true, typeProjet: true, priorite: true, prioriteMotif: true } });
    await notifierDemandeDuSite({
      leadId,
      prenom: lead.prenom || "Inconnu",
      nom: lead.nom || "Inconnu",
      telephone: lead.telephone,
      ville: lead.ville || null,
      typeProjet: lead.typeProjet,
      source: "MAIL",
      nouveau: true,
      simulations: 0,
      photos: 0,
      message: message.objet,
      priorite: lead.priorite ? { classe: lead.priorite as never, motif: lead.prioriteMotif ?? "" } : null,
    }).catch((erreur) => console.error("[mail] notification du lead :", erreur));
  }
  return { leadId, cree: true };
}

/** Photos et plans d'un client connu : conservés, puis les photos rangées dans son dossier (donc dans Drive). */
export async function rangerPiecesDansDossier(messageId: string): Promise<{ photos: number; documents: number }> {
  const bilan = await conserverPieces(messageId);
  if (bilan.erreurs > 0) throw new Error(`${bilan.erreurs} pièce(s) jointe(s) en échec : nouvel essai plus tard`);
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { dossierId: true, pieces: { where: { statut: "CONSERVEE" }, include: { fichier: true } } } });
  if (!message?.dossierId) return { photos: 0, documents: 0 };
  let photos = 0;
  let documents = 0;
  for (const piece of message.pieces) {
    if (!piece.fichier) continue;
    if (piece.typeMime.startsWith("image/") && !piece.enLigne) {
      // Une photo déjà rangée (même nom et même taille dans ce dossier) ne l'est pas deux fois.
      const deja = await prisma.dossierEvenement.findFirst({ where: { dossierId: message.dossierId, type: "NOTE_AJOUTEE", metadata: { contains: `"pieceId":"${piece.id}"` } }, select: { id: true } });
      if (deja) continue;
      const { contenu } = await lireFichierConserve(piece.fichier.id);
      await ajouterPhoto(message.dossierId, new File([new Uint8Array(contenu)], piece.nom, { type: piece.typeMime }));
      await prisma.dossierEvenement.create({ data: { dossierId: message.dossierId, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: `Photo reçue par mail rangée dans le dossier : ${piece.nom}`, metadata: JSON.stringify({ pieceId: piece.id, messageId }) } });
      photos++;
    } else if (piece.typeMime === "application/pdf") {
      documents++;
    }
  }
  return { photos, documents };
}

/** Les suites d'un mail trié : dossier, lead, pièces (branchées sur la synchro ; exportées pour les essais sur copie). */
export async function suitesDuTri(messageId: string, resultat: Awaited<ReturnType<typeof classerMessage>>): Promise<void> {
  if (!resultat) return;
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { clientId: true, leadId: true, sens: true, automatique: true, _count: { select: { pieces: true } } } });
  if (!message || message.automatique) return;
  if (resultat.decision.classe === "CLIENT" && message.clientId) {
    const dossierId = await dossierDuMail(messageId);
    if (dossierId) {
      await tracerMailDansDossier(messageId, dossierId);
      if (message.sens === "ENTRANT" && message._count.pieces > 0) await mettreEnFile({ type: TYPE_TACHE_PIECES_DOSSIER, cle: `mail-pieces:${messageId}`, charge: { messageId } });
    } else if (message.leadId) {
      await tracerMailSurLeLead(messageId, message.leadId);
    }
    return;
  }
  if (resultat.decision.classe === "CLIENT" && message.leadId) {
    await tracerMailSurLeLead(messageId, message.leadId);
    return;
  }
  if (resultat.decision.demandeClient && message.sens === "ENTRANT" && !message.clientId && !message.leadId) {
    await creerLeadDepuisMail(messageId);
  }
}

brancherSuitesDuTri(suitesDuTri);

/**
 * Rattacher à la main, en deux gestes (chercher le client, toucher son nom) :
 * le fil entier est rattaché, l'adresse ajoutée à sa fiche, le mail tracé dans
 * son dossier. Les prochains mails de cette adresse seront reconnus seuls.
 */
export async function rattacherALaMain(messageId: string, clientId: string, dossierId?: string | null): Promise<{ dossierId: string | null }> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, de: true, sens: true, filCanal: true, canal: true, a: true } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, archiveLe: true } });
  if (!client || client.archiveLe) throw new ErreurMetier("Fiche client introuvable ou archivée.", 404);
  if (dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientId: true } });
    if (!dossier || dossier.clientId !== clientId) throw new ErreurMetier("Ce dossier n'est pas celui de ce client.", 409);
  }
  const adresse = message.sens === "ENTRANT" ? message.de : lireListe(message.a)[0];
  const fil = message.filCanal ? await prisma.message.findMany({ where: { canal: message.canal, filCanal: message.filCanal }, select: { id: true } }) : [{ id: message.id }];
  await prisma.$transaction(async (tx) => {
    if (adresse && normaliserEmail(adresse)) await completerCoordonnees(tx, clientId, { emails: [adresse] });
    await tx.message.updateMany({
      where: { id: { in: fil.map((m) => m.id) } },
      data: { clientId, classe: "CLIENT", classeMotif: "Rattaché à la main par Lucas.", classePar: "LUCAS", statut: "RATTACHE", categorie: "CLIENT", rangeLe: null, rangePar: null, ...(dossierId ? { dossierId } : {}) },
    });
  });
  const cible = dossierId ?? (await dossierDuMail(message.id));
  if (cible) for (const m of fil) await tracerMailDansDossier(m.id, cible);
  return { dossierId: cible };
}

export function enregistrerTachesRattachement(enregistrer: (type: string, traitement: { libelle: string; acteur: string; delaiMaxMs?: number; executer: (charge: unknown) => Promise<unknown> }) => void): void {
  enregistrer(TYPE_TACHE_PIECES_DOSSIER, {
    libelle: "Photos et plans reçus par mail, rangés dans le dossier du client (et dans Drive)",
    acteur: "SYSTEME:boite-mail",
    delaiMaxMs: 5 * 60_000,
    executer: async (charge) => {
      const messageId = (charge as { messageId?: unknown } | null)?.messageId;
      if (typeof messageId !== "string") throw new Error("Charge invalide : messageId manquant");
      return rangerPiecesDansDossier(messageId);
    },
  });
}
