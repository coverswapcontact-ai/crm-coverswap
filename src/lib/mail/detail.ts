import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { etatIa } from "@/lib/ia/modele";
import { lireListe } from "@/lib/messages/stockage";
import { objetSansPrefixes, retirerCitations } from "@/lib/messages/texte";
import { contexteDuMail, type ContexteClient } from "./contexte";

/**
 * Un mail ouvert dans l'onglet Mail (mission 7) : toute la conversation, les
 * pièces jointes, pourquoi le tri l'a classé là, le contexte du client, les
 * brouillons déjà rédigés et les envois en cours.
 */

export type PieceDuFil = { id: string; nom: string; typeMime: string; taille: number; url: string | null; estImage: boolean };

export type MessageDuFil = {
  id: string;
  sens: "ENTRANT" | "SORTANT";
  de: string;
  deNom: string | null;
  a: string[];
  objet: string | null;
  recuLe: string;
  /** Sans l'historique cité des réponses précédentes. */
  texte: string;
  pieces: PieceDuFil[];
  automatique: boolean;
  lu: boolean;
};

export type DetailMail = {
  messageId: string;
  objet: string;
  fil: MessageDuFil[];
  correspondant: { adresse: string; nom: string | null };
  classe: string | null;
  motif: string | null;
  range: boolean;
  traite: boolean;
  nonLu: boolean;
  contexte: ContexteClient | null;
  /** Le mail à qui répondre (dernier reçu du fil). */
  enReponseA: string | null;
  lienGmail: string | null;
  brouillons: { id: string; createdAt: string; statut: string; objet: string | null; texte: string | null; consigne: string | null; manques: string[]; corrections: string[]; coutEuros: number | null }[];
  envois: { id: string; statut: string; nature: string; objet: string; a: string; envoyeLe: string | null; erreur: string | null }[];
  ia: { active: boolean; raison: string | null };
};

const lireJson = (json: string | null): string[] => {
  try {
    const lu: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(lu) ? lu.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export async function detailMail(messageId: string): Promise<DetailMail> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, filCanal: true, canal: true } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  const fil = await prisma.message.findMany({
    where: message.filCanal ? { canal: message.canal, filCanal: message.filCanal } : { id: message.id },
    orderBy: { recuLe: "asc" },
    include: { contenu: { select: { texte: true } }, pieces: { orderBy: { rang: "asc" } } },
  });
  const dernier = fil[fil.length - 1];
  const entrants = fil.filter((m) => m.sens === "ENTRANT");
  const dernierEntrant = entrants.at(-1) ?? null;
  const ids = fil.map((m) => m.id);
  const [contexte, brouillons, envois, ia] = await Promise.all([
    contexteDuMail(dernier.id),
    prisma.brouillonMail.findMany({ where: { messageId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.envoiMail.findMany({ where: { OR: [{ enReponseA: { in: ids } }, { messageId: { in: ids } }] }, orderBy: { createdAt: "desc" }, take: 10 }),
    etatIa(new Date(), "IA_REDACTION"),
  ]);
  const autre = dernierEntrant ? { adresse: dernierEntrant.de, nom: dernierEntrant.deNom } : { adresse: lireListe(dernier.a)[0] ?? "", nom: contexte?.contact.nom ?? null };
  return {
    messageId: dernier.id,
    objet: objetSansPrefixes(dernier.objet) || "(sans objet)",
    fil: fil.map((m) => ({
      id: m.id,
      sens: m.sens as "ENTRANT" | "SORTANT",
      de: m.de,
      deNom: m.deNom,
      a: lireListe(m.a),
      objet: m.objet,
      recuLe: m.recuLe.toISOString(),
      texte: retirerCitations(m.contenu?.texte ?? m.extrait ?? "").trim() || (m.extrait ?? ""),
      pieces: m.pieces
        .filter((p) => !p.enLigne || p.taille >= 50 * 1024)
        .map((p) => ({ id: p.id, nom: p.nom, typeMime: p.typeMime, taille: p.taille, url: p.statut === "CONSERVEE" ? `/api/messages/${m.id}/pieces/${p.id}` : null, estImage: p.typeMime.startsWith("image/") })),
      automatique: m.automatique,
      lu: m.lu,
    })),
    correspondant: autre,
    classe: (dernierEntrant ?? dernier).classe,
    motif: (dernierEntrant ?? dernier).classeMotif,
    range: entrants.length > 0 && entrants.every((m) => m.rangeLe),
    traite: Boolean(dernier.traiteLe),
    nonLu: entrants.some((m) => !m.lu),
    contexte,
    enReponseA: dernierEntrant?.id ?? null,
    lienGmail: dernier.filCanal ? `https://mail.google.com/mail/u/0/#all/${dernier.filCanal}` : null,
    brouillons: brouillons.map((b) => ({ id: b.id, createdAt: b.createdAt.toISOString(), statut: b.statut, objet: b.objetIa, texte: b.texteIa, consigne: b.consigne, manques: lireJson(b.manques), corrections: lireJson(b.corrections), coutEuros: b.coutEuros })),
    envois: envois.map((e) => ({ id: e.id, statut: e.statut, nature: e.nature, objet: e.objet, a: e.a, envoyeLe: e.envoyeLe?.toISOString() ?? null, erreur: e.statut === "ECHEC" ? e.erreur : null })),
    ia: { active: ia.active, raison: ia.raison },
  };
}

/** Lucas envoie (son clic) : une réponse dans le fil, ou un nouveau mail. Le brouillon de l'IA garde la version envoyée. */
export async function envoyerDepuisLOnglet(entree: { a: string; objet: string; texte: string; enReponseA?: string | null; brouillonId?: string | null; dossierId?: string | null; clientId?: string | null; leadId?: string | null }): Promise<{ envoiId: string }> {
  const { programmerEnvoi } = await import("./envoi-crm");
  // Avant tout : un trou laissé par l'IA ne part jamais (et rien n'est noté comme envoyé).
  if (entree.texte.includes("[à compléter]")) throw new ErreurMetier("Le mail contient encore « [à compléter] » : remplacez-le avant d'envoyer.", 400);
  let { dossierId = null, clientId = null, leadId = null } = entree;
  if (entree.enReponseA) {
    const recu = await prisma.message.findUnique({ where: { id: entree.enReponseA }, select: { dossierId: true, clientId: true, leadId: true } });
    if (!recu) throw new ErreurMetier("Mail d'origine introuvable.", 404);
    dossierId ??= recu.dossierId;
    clientId ??= recu.clientId;
    leadId ??= recu.leadId;
  }
  const brouillon = entree.brouillonId ? await prisma.brouillonMail.findUnique({ where: { id: entree.brouillonId } }) : null;
  if (brouillon) {
    dossierId ??= brouillon.dossierId;
    clientId ??= brouillon.clientId;
    leadId ??= brouillon.leadId;
    // L'apprentissage : la version de l'IA et celle que Lucas envoie, côte à côte.
    await prisma.brouillonMail.update({
      where: { id: brouillon.id },
      data: { objetEnvoye: entree.objet, texteEnvoye: entree.texte, modifie: (brouillon.texteIa ?? "").trim() !== entree.texte.trim() || (brouillon.objetIa ?? "").trim() !== entree.objet.trim() },
    });
  }
  const cle = `${entree.enReponseA ? "reponse" : "nouveau"}:${brouillon?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
  const { id } = await programmerEnvoi({ cle, nature: entree.enReponseA ? "REPONSE" : "NOUVEAU", a: entree.a, objet: entree.objet, texte: entree.texte, enReponseA: entree.enReponseA ?? null, dossierId, clientId, leadId, brouillonId: brouillon?.id ?? null });
  return { envoiId: id };
}
