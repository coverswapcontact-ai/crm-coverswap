import prisma from "@/lib/prisma";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { mainDe } from "@/lib/dossiers/pilotage";
import { LIBELLES_ETIQUETTE_APPEL, type EtiquetteAppel } from "@/lib/commercial/notes-constantes";
import { LIBELLES_ISSUE, type IssueAppel } from "@/lib/commercial/constantes";
import { vueEspaceCrm } from "@/lib/espace/vue-crm";
import { famillesDe, lireSelection, resumerSelection } from "@/lib/prestations/prestations";
import { libelleSourceLead } from "@/lib/prospects/constantes";

/**
 * Le contexte du client, à côté du mail (mission 7) : sa fiche, ses projets
 * (étape, qui a la main, devis et paiement, simulations, état de son espace),
 * sa dernière note d'appel. Le même contexte nourrit la rédaction par l'IA
 * (mail/redaction.ts), qui n'en reçoit que ce qui sert à écrire.
 */

export type ProjetContexte = {
  dossierId: string;
  nom: string;
  etape: string;
  etapeLibelle: string;
  main: "MOI" | "CLIENT" | "A_RELANCER" | "AUCUNE";
  mainMotif: string | null;
  prochaineAction: string | null;
  prochaineActionDate: string | null;
  dateChantier: string | null;
  devis: { numero: string; totalTtc: number; statut: string; emisLe: string | null; consultations: number; signeLe: string | null } | null;
  paiement: { total: number; recu: number; reste: number; acompte: number | null; acomptePct: number | null; acompteRecu: boolean; regle: boolean } | null;
  simulations: { publiees: number; faitesParLeClient: number; choisie: string | null } ;
  espace: { etat: string; resteAFaire: string; derniereVisite: string | null; visites: number; lienActif: boolean } | null;
};

export type ContexteClient = {
  contact: { type: "CLIENT" | "LEAD" | "INCONNU"; clientId: string | null; leadId: string | null; nom: string; prenom: string | null; ville: string | null; source: string | null; telephone: string | null; emails: string[] };
  projets: ProjetContexte[];
  derniereNoteAppel: { le: string; texte: string; etiquettes: string[]; issue: string | null } | null;
  notesAppel: { le: string; texte: string; etiquettes: string[]; issue: string | null }[];
};

const lireEtiquettes = (json: string) => {
  try {
    return (JSON.parse(json) as string[]).map((code) => LIBELLES_ETIQUETTE_APPEL[code as EtiquetteAppel] ?? code);
  } catch {
    return [];
  }
};

async function projetsDuClient(clientId: string | null, leadId: string | null): Promise<ProjetContexte[]> {
  const ou = [...(clientId ? [{ clientId }] : []), ...(leadId ? [{ leadId }] : [])];
  if (ou.length === 0) return [];
  const dossiers = await prisma.dossier.findMany({
    where: { archiveLe: null, OR: ou },
    orderBy: { updatedAt: "desc" },
    take: 4,
    select: { id: true, objet: true, etape: true, main: true, mainMotif: true, prochaineAction: true, prochaineActionDate: true, dateChantier: true, prestations: true },
  });
  const maintenant = new Date();
  return Promise.all(
    dossiers.map(async (d) => {
      const vue = await vueEspaceCrm(d.id).catch(() => null);
      const selection = lireSelection(d.prestations);
      const nom = famillesDe(selection).length ? resumerSelection(selection) : d.objet;
      return {
        dossierId: d.id,
        nom,
        etape: d.etape,
        etapeLibelle: LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape,
        main: mainDe({ etape: d.etape as EtapeDossier, prochaineActionDate: d.prochaineActionDate?.toISOString() ?? null, main: d.main === "MOI" || d.main === "CLIENT" ? d.main : null }, maintenant),
        mainMotif: d.mainMotif && !d.mainMotif.startsWith("Étape «") ? d.mainMotif : null,
        prochaineAction: d.prochaineAction,
        prochaineActionDate: d.prochaineActionDate?.toISOString() ?? null,
        dateChantier: d.dateChantier?.toISOString() ?? null,
        devis: vue?.devis ? { numero: vue.devis.numero, totalTtc: vue.devis.total, statut: vue.devis.statut, emisLe: null, consultations: vue.devis.consultations, signeLe: vue.accord?.le ?? null } : null,
        paiement: vue?.paiement
          ? { total: vue.paiement.total, recu: vue.paiement.recu, reste: vue.paiement.reste, acompte: vue.paiement.acompte?.montant ?? null, acomptePct: vue.paiement.acompte?.pct ?? null, acompteRecu: vue.paiement.acompte?.statut === "PAYE", regle: vue.paiement.regle }
          : null,
        simulations: {
          publiees: vue?.simulations.filter((s) => s.statut === "PUBLIEE" && s.source !== "CLIENT").length ?? 0,
          faitesParLeClient: vue?.simulations.filter((s) => s.source === "CLIENT").length ?? 0,
          choisie: vue?.choix ? vue.choix.zones.map((z) => `${z.libelle || z.zone} : ${z.nom || z.ref}${z.ref ? ` (${z.ref})` : ""}`).join(" · ") || "une simulation validée" : null,
        },
        espace: vue
          ? { etat: vue.etapeLibelle, resteAFaire: vue.resteAFaire, derniereVisite: vue.permanent?.dernierAccesLe ?? vue.dernierAccesLe, visites: vue.permanent?.nbAcces ?? vue.nbAcces, lienActif: Boolean(vue.lien) }
          : null,
      };
    })
  );
}

/** Le contexte d'un contact (fiche client, ou lead sans fiche). */
export async function contexteDuContact(demande: { clientId?: string | null; leadId?: string | null; dossierId?: string | null }): Promise<ContexteClient | null> {
  // Depuis un dossier : son client, sinon son lead.
  const dossier = demande.dossierId && !demande.clientId && !demande.leadId ? await prisma.dossier.findUnique({ where: { id: demande.dossierId }, select: { clientId: true, leadId: true } }) : null;
  const ids = dossier ? { clientId: dossier.clientId, leadId: dossier.clientId ? null : dossier.leadId } : demande;
  // Un lead rattaché à un client : c'est la fiche du client qui parle (ses adresses, tous ses projets).
  const leadDemande = ids.leadId ? await prisma.lead.findUnique({ where: { id: ids.leadId } }) : null;
  const clientId = ids.clientId ?? leadDemande?.clientId ?? null;
  const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, include: { emails: { where: { archiveLe: null }, orderBy: { principale: "desc" } }, telephones: { where: { archiveLe: null }, orderBy: { principal: "desc" } } } }) : null;
  const leadId = ids.leadId ?? (client ? (await prisma.lead.findFirst({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id : null) ?? null;
  const lead = leadDemande ?? (leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null);
  if (!client && !lead) return null;
  const notes = await prisma.noteAppel.findMany({
    where: { archiveLe: null, lead: client ? { clientId: client.id } : { id: leadId ?? "" } },
    orderBy: { appelLe: "desc" },
    take: 4,
    select: { appelLe: true, texte: true, etiquettes: true, issue: true },
  });
  const notesLues = notes
    .filter((n) => n.texte.trim() || n.issue || n.etiquettes !== "[]")
    .map((n) => ({ le: n.appelLe.toISOString(), texte: n.texte.trim(), etiquettes: lireEtiquettes(n.etiquettes), issue: n.issue ? (LIBELLES_ISSUE[n.issue as IssueAppel] ?? n.issue) : null }));
  const nomLead = lead ? `${lead.prenom} ${lead.nom}`.replace(/Inconnu/gi, "").trim() : "";
  return {
    contact: {
      type: client ? "CLIENT" : "LEAD",
      clientId: client?.id ?? null,
      leadId: lead?.id ?? null,
      nom: client?.nom ?? (nomLead || lead?.email || "Contact"),
      prenom: client?.prenom ?? (lead?.prenom && !/inconnu/i.test(lead.prenom) ? lead.prenom : null),
      ville: client?.ville ?? lead?.ville ?? null,
      source: lead ? libelleSourceLead(lead.source) : (client?.source ?? null),
      telephone: client?.telephones[0]?.saisi ?? lead?.telephone ?? null,
      emails: [...new Set([...(client?.emails.map((e) => e.adresse) ?? []), ...(lead?.email ? [lead.email.trim().toLowerCase()] : [])])],
    },
    projets: await projetsDuClient(client?.id ?? null, lead?.id ?? null),
    derniereNoteAppel: notesLues[0] ?? null,
    notesAppel: notesLues,
  };
}

/** Le contexte du contact d'un mail ; null pour un inconnu (à rattacher). */
export async function contexteDuMail(messageId: string): Promise<ContexteClient | null> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { clientId: true, leadId: true, filCanal: true } });
  if (!message) return null;
  let { clientId, leadId } = message;
  if (!clientId && !leadId && message.filCanal) {
    const duFil = await prisma.message.findFirst({ where: { canal: "EMAIL", filCanal: message.filCanal, OR: [{ clientId: { not: null } }, { leadId: { not: null } }] }, select: { clientId: true, leadId: true } });
    clientId = duFil?.clientId ?? null;
    leadId = duFil?.leadId ?? null;
  }
  return clientId || leadId ? contexteDuContact({ clientId, leadId }) : null;
}
