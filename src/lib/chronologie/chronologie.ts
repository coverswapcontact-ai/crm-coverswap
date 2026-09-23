import prisma from "@/lib/prisma";
import { LIBELLES_ISSUE, type IssueAppel } from "@/lib/commercial/constantes";
import { LIBELLES_TYPE_EVENEMENT, type TypeEvenement } from "@/lib/dossiers/constants";
import { lireListe } from "@/lib/messages/stockage";

/**
 * Le fil unique d'un contact (mission 9) : mails, notes d'appel, gestes dans
 * l'espace client, événements du dossier, notes, propositions validées — une
 * seule chronologie, filtrable, lue par la fiche client, le panneau du dossier
 * et l'outil « lire_mail » de l'assistant. Lecture seule, sans doublon : un
 * mail vient de la table des messages, jamais de sa trace dans le dossier.
 */

export { FAMILLES_CHRONOLOGIE, LIBELLES_FAMILLE_CHRONOLOGIE, type EntreeChronologie, type FamilleChronologie } from "./familles";
import { FAMILLES_CHRONOLOGIE, type EntreeChronologie, type FamilleChronologie } from "./familles";

export type CibleChronologie = { clientId?: string | null; leadId?: string | null; dossierId?: string | null };

/** La famille d'un événement de dossier ; null = déjà couvert par une autre source (mails, appels). */
export function familleDeLEvenement(type: string): FamilleChronologie | null {
  if (type.startsWith("MAIL_") || type.startsWith("WHATSAPP_") || type === "NOTE_APPEL" || type === "APPEL") return null;
  if (type.startsWith("ESPACE_")) return "ESPACE";
  if (type.startsWith("ENCAISSEMENT_")) return "PAIEMENT";
  if (type.startsWith("DEVIS_") || type.startsWith("FACTURE_") || type.startsWith("AVOIR_") || type === "DOCUMENT_REPRIS") return "DOCUMENT";
  if (type === "NOTE_AJOUTEE") return "NOTE";
  return "DOSSIER";
}

/** Les identifiants à couvrir : le client, ses leads, ses dossiers (ou le dossier seul, avec son client et son lead). */
async function perimetre(cible: CibleChronologie): Promise<{ clientIds: string[]; leadIds: string[]; dossierIds: string[] }> {
  const clientIds = new Set<string>();
  const leadIds = new Set<string>();
  const dossierIds = new Set<string>();
  if (cible.dossierId) {
    const d = await prisma.dossier.findUnique({ where: { id: cible.dossierId }, select: { id: true, clientId: true, leadId: true } });
    if (d) {
      dossierIds.add(d.id);
      if (d.leadId) leadIds.add(d.leadId);
      // Le dossier seul : ses mails et ses appels, pas ceux des autres projets du client.
    }
  }
  if (cible.clientId) {
    const c = await prisma.client.findUnique({ where: { id: cible.clientId }, select: { id: true, leads: { select: { id: true } }, dossiers: { where: { archiveLe: null }, select: { id: true } } } });
    if (c) {
      clientIds.add(c.id);
      for (const l of c.leads) leadIds.add(l.id);
      for (const d of c.dossiers) dossierIds.add(d.id);
    }
  }
  if (cible.leadId) {
    const l = await prisma.lead.findUnique({ where: { id: cible.leadId }, select: { id: true, clientId: true, dossiers: { where: { archiveLe: null }, select: { id: true } } } });
    if (l) {
      leadIds.add(l.id);
      for (const d of l.dossiers) dossierIds.add(d.id);
    }
  }
  return { clientIds: [...clientIds], leadIds: [...leadIds], dossierIds: [...dossierIds] };
}

export async function chronologieDuContact(cible: CibleChronologie, options: { limite?: number; familles?: readonly FamilleChronologie[] } = {}): Promise<{ entrees: EntreeChronologie[]; total: number }> {
  const { clientIds, leadIds, dossierIds } = await perimetre(cible);
  if (clientIds.length + leadIds.length + dossierIds.length === 0) return { entrees: [], total: 0 };
  const familles = new Set<FamilleChronologie>(options.familles?.length ? options.familles : FAMILLES_CHRONOLOGIE);
  const ou = [...(clientIds.length ? [{ clientId: { in: clientIds } }] : []), ...(leadIds.length ? [{ leadId: { in: leadIds } }] : []), ...(dossierIds.length ? [{ dossierId: { in: dossierIds } }] : [])];

  const [messages, notes, evenements, propositions] = await Promise.all([
    familles.has("MAIL")
      ? prisma.message.findMany({ where: { canal: "EMAIL", archiveLe: null, OR: ou }, orderBy: { recuLe: "desc" }, take: 200, select: { id: true, sens: true, de: true, deNom: true, a: true, objet: true, extrait: true, recuLe: true, automatique: true, dossierId: true, intention: true, intentionAttendu: true } })
      : [],
    familles.has("APPEL") && leadIds.length
      ? prisma.noteAppel.findMany({ where: { leadId: { in: leadIds }, archiveLe: null }, orderBy: { appelLe: "desc" }, take: 100, select: { id: true, appelLe: true, texte: true, issue: true, leadId: true } })
      : [],
    dossierIds.length
      ? prisma.dossierEvenement.findMany({ where: { dossierId: { in: dossierIds }, archiveLe: null }, orderBy: { createdAt: "desc" }, take: 400, select: { id: true, type: true, direction: true, contenu: true, createdAt: true, survenuLe: true, dossierId: true } })
      : [],
    familles.has("PROPOSITION")
      ? prisma.proposition.findMany({ where: { statut: "EXECUTEE", archiveLe: null, OR: [...(clientIds.length ? [{ clientId: { in: clientIds } }] : []), ...(dossierIds.length ? [{ dossierId: { in: dossierIds } }] : [])] }, orderBy: { executeLe: "desc" }, take: 100, select: { id: true, type: true, titre: true, resume: true, executeLe: true, decideLe: true, decidePar: true, dossierId: true, messageId: true } })
      : [],
  ]);

  const entrees: EntreeChronologie[] = [];
  for (const m of messages) {
    entrees.push({
      id: `mail:${m.id}`,
      le: m.recuLe.toISOString(),
      famille: "MAIL",
      type: m.sens === "ENTRANT" ? "MAIL_RECU" : "MAIL_ENVOYE",
      titre: `${m.sens === "ENTRANT" ? `De ${m.deNom ?? m.de}` : m.automatique ? `Automatique à ${lireListe(m.a)[0] ?? "?"}` : `À ${lireListe(m.a)[0] ?? "?"}`} — ${m.objet ?? "(sans objet)"}`,
      texte: [m.extrait, m.intentionAttendu ? `Attendu : ${m.intentionAttendu}` : null].filter(Boolean).join(" · ") || null,
      direction: m.sens === "ENTRANT" ? "ENTRANT" : "SORTANT",
      lien: `/mail?mail=${m.id}`,
      messageId: m.id,
      dossierId: m.dossierId,
    });
  }
  for (const n of notes) {
    entrees.push({
      id: `appel:${n.id}`,
      le: n.appelLe.toISOString(),
      famille: "APPEL",
      type: "APPEL",
      titre: `Appel${n.issue ? ` — ${LIBELLES_ISSUE[n.issue as IssueAppel] ?? n.issue}` : ""}`,
      texte: n.texte || null,
      direction: "SORTANT",
      lien: `/leads?lead=${n.leadId}`,
      messageId: null,
      dossierId: null,
    });
  }
  for (const e of evenements) {
    const famille = familleDeLEvenement(e.type);
    if (!famille || !familles.has(famille)) continue;
    entrees.push({
      id: `evenement:${e.id}`,
      le: (e.survenuLe ?? e.createdAt).toISOString(),
      famille,
      type: e.type,
      titre: LIBELLES_TYPE_EVENEMENT[e.type as TypeEvenement] ?? e.type,
      texte: e.contenu || null,
      direction: e.direction as EntreeChronologie["direction"],
      lien: `/dossiers?dossier=${e.dossierId}`,
      messageId: null,
      dossierId: e.dossierId,
    });
  }
  for (const p of propositions) {
    entrees.push({
      id: `proposition:${p.id}`,
      le: (p.executeLe ?? p.decideLe ?? new Date(0)).toISOString(),
      famille: "PROPOSITION",
      type: p.type,
      titre: p.titre,
      texte: [p.resume, p.decidePar ? `validée par ${p.decidePar.replace(/^HUMAIN:/, "")}` : null].filter(Boolean).join(" · ") || null,
      direction: "INTERNE",
      lien: p.dossierId ? `/dossiers?dossier=${p.dossierId}` : p.messageId ? `/mail?mail=${p.messageId}` : null,
      messageId: p.messageId,
      dossierId: p.dossierId,
    });
  }
  entrees.sort((a, b) => b.le.localeCompare(a.le));
  return { entrees: entrees.slice(0, options.limite ?? 80), total: entrees.length };
}
