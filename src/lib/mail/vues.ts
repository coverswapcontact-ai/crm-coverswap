import prisma from "@/lib/prisma";
import { lireListe } from "@/lib/messages/stockage";
import { demanderEtatGmail } from "./boite";
import { comparerPriorite, estReclamation, lireDatesExtraites, prioriteDe, type Priorite } from "./priorite";
import { TYPE_MAJ_DEPUIS_MAIL } from "./propositions-maj";

/**
 * Les trois vues de l'onglet Mail, par conversation (fil) : À traiter, Clients,
 * Administratif ; et le Rangé, replié. Calculées à la lecture, depuis la base :
 * un mail change de vue dès qu'il change d'état (lu, répondu, archivé, rangé).
 */

export const VUES_MAIL = ["A_TRAITER", "CLIENTS", "ADMINISTRATIF", "RANGES"] as const;
export type VueMail = (typeof VUES_MAIL)[number];

/** Un mail envoyé sans réponse depuis ce délai remonte dans « À traiter ». */
export const JOURS_SANS_REPONSE = 5;
const JOUR = 86_400_000;
/** Ce qu'on relit pour calculer les vues : les conversations récentes. */
const FENETRE_JOURS = 120;

export type LigneMail = {
  /** Le dernier message du fil : c'est lui qui s'ouvre. */
  messageId: string;
  fil: string;
  nombre: number;
  sens: "ENTRANT" | "SORTANT";
  /** L'autre personne du fil (expéditeur, ou destinataire d'un envoi). */
  correspondant: { adresse: string; nom: string | null };
  objet: string | null;
  extrait: string | null;
  recuLe: string;
  nonLu: boolean;
  classe: string | null;
  motif: string | null;
  contact: { type: "CLIENT" | "LEAD"; id: string; nom: string } | null;
  /** « sans réponse depuis 6 jours », « nouvelle demande », « à lire »… */
  mention: string | null;
  pieces: number;
  range: boolean;
  traite: boolean;
  aTraiter: boolean;
  automatique: boolean;
  /** Mission 9 : ce que Claude a écrit sur le dernier mail reçu, et ce que le CRM en déduit. */
  intention: string | null;
  attendu: string | null;
  priorite: Priorite;
  snoozeJusqua: string | null;
  revenu: boolean;
  propositionsEnAttente: number;
  brouillonPret: boolean;
  dates: number;
};

const DEVIS_EN_ATTENTE = { where: { type: "DEVIS", numero: { not: null }, archiveLe: null, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { createdAt: "desc" as const }, take: 1, select: { totalHt: true } };
const DOSSIERS_DU_CONTACT = { where: { archiveLe: null }, select: { etape: true, documents: DEVIS_EN_ATTENTE } };
type Extras = { propositions: Map<string, number>; brouillons: Set<string> };

export type CompteursMail = Record<VueMail, number> & { nonLusATraiter: number };

type MessageLu = Awaited<ReturnType<typeof chargerMessages>>[number];

function chargerMessages(depuis: Date) {
  return prisma.message.findMany({
    where: { canal: "EMAIL", recuLe: { gte: depuis }, archiveLe: null },
    orderBy: { recuLe: "asc" },
    select: {
      id: true,
      filCanal: true,
      sens: true,
      de: true,
      deNom: true,
      a: true,
      objet: true,
      extrait: true,
      recuLe: true,
      lu: true,
      classe: true,
      classeMotif: true,
      categorie: true,
      rangeLe: true,
      traiteLe: true,
      automatique: true,
      clientId: true,
      leadId: true,
      intention: true,
      intentionAttendu: true,
      datesExtraites: true,
      snoozeJusqua: true,
      client: { select: { nom: true, dossiers: DOSSIERS_DU_CONTACT } },
      lead: { select: { prenom: true, nom: true, dossiers: DOSSIERS_DU_CONTACT } },
      _count: { select: { pieces: true } },
    },
  });
}

const PRIORITE_CLASSE: Record<string, number> = { CLIENT: 4, ADMINISTRATIF: 3, HUMAIN: 2, BRUIT: 1 };

function ligneDuFil(fil: MessageLu[], maintenant: Date, extras: Extras = { propositions: new Map(), brouillons: new Set() }): LigneMail {
  const dernier = fil[fil.length - 1];
  const entrants = fil.filter((m) => m.sens === "ENTRANT");
  const sortants = fil.filter((m) => m.sens === "SORTANT" && !m.automatique);
  const dernierEntrant = entrants.at(-1) ?? null;
  const dernierSortant = sortants.at(-1) ?? null;
  const classe = [...fil].sort((a, b) => (PRIORITE_CLASSE[b.classe ?? ""] ?? 0) - (PRIORITE_CLASSE[a.classe ?? ""] ?? 0))[0]?.classe ?? null;
  // Rangé : tout ce qu'on a reçu dans ce fil est rangé (une réponse d'un humain le fait remonter).
  const range = entrants.length > 0 && entrants.every((m) => m.rangeLe) && sortants.length === 0;
  const traite = Boolean(dernier.traiteLe);
  const nonLu = entrants.some((m) => !m.lu && !m.rangeLe);
  const avecContact = fil.find((m) => m.clientId || m.leadId);
  const contact = avecContact?.clientId
    ? { type: "CLIENT" as const, id: avecContact.clientId, nom: avecContact.client?.nom ?? "" }
    : avecContact?.leadId
      ? { type: "LEAD" as const, id: avecContact.leadId, nom: `${avecContact.lead?.prenom ?? ""} ${avecContact.lead?.nom ?? ""}`.replace(/Inconnu/gi, "").trim() }
      : null;
  const humain = classe === "CLIENT" || classe === "HUMAIN";
  const attendReponse = humain && dernierEntrant !== null && (!dernierSortant || dernierSortant.recuLe < dernierEntrant.recuLe) && !dernierEntrant.rangeLe;
  const joursSansReponse = dernierSortant && (!dernierEntrant || dernierEntrant.recuLe < dernierSortant.recuLe) ? Math.floor((maintenant.getTime() - dernierSortant.recuLe.getTime()) / JOUR) : 0;
  const sansReponse = humain && joursSansReponse >= JOURS_SANS_REPONSE;
  const administratifNonLu = classe === "ADMINISTRATIF" && nonLu;
  // Mission 9 : remis à plus tard → hors d'« À traiter » jusqu'à la date, puis « Revenu » en tête.
  const snoozes = fil.map((m) => m.snoozeJusqua).filter((d): d is Date => d instanceof Date);
  const snoozeJusqua = snoozes.length ? new Date(Math.max(...snoozes.map((d) => d.getTime()))) : null;
  const enAttente = snoozeJusqua !== null && snoozeJusqua > maintenant;
  const revenu = snoozeJusqua !== null && snoozeJusqua <= maintenant && !traite && !range;
  const aTraiter = (!range && !traite && (attendReponse || sansReponse || administratifNonLu) && !enAttente) || revenu;
  const reference = dernierEntrant ?? dernier;
  const dates = lireDatesExtraites(reference.datesExtraites);
  const dossiersContact = [...(avecContact?.client?.dossiers ?? []), ...(avecContact?.lead?.dossiers ?? [])];
  const devis = dossiersContact.filter((d) => d.etape === "DEVIS_ENVOYE" || d.etape === "RELANCE").flatMap((d) => d.documents.map((x) => x.totalHt));
  const priorite = prioriteDe({
    revenu,
    reclamation: humain && estReclamation([dernier.objet, reference.extrait, reference.intentionAttendu]),
    devisEnAttente: devis.length ? Math.max(...devis) : null,
    dossierActif: dossiersContact.some((d) => d.etape !== "PERDU" && d.etape !== "ENCAISSE"),
    lead: contact?.type === "LEAD" || fil.some((m) => m.categorie === "NOUVELLE_DEMANDE"),
    administratifEcheance: classe === "ADMINISTRATIF" && dates.some((d) => d.nature === "ECHEANCE"),
  });
  const cleFil = dernier.filCanal ?? dernier.id;
  const mention = !aTraiter
    ? null
    : revenu
      ? "Revenu"
      : sansReponse
      ? `Sans réponse depuis ${joursSansReponse} jours`
      : dernierEntrant && fil.some((m) => m.categorie === "NOUVELLE_DEMANDE")
        ? "Nouvelle demande"
        : administratifNonLu
          ? "À lire"
          : "Attend votre réponse";
  const autre = dernier.sens === "ENTRANT" ? { adresse: dernier.de, nom: dernier.deNom } : { adresse: lireListe(dernier.a)[0] ?? "", nom: contact?.nom ?? null };
  return {
    messageId: dernier.id,
    fil: dernier.filCanal ?? dernier.id,
    nombre: fil.length,
    sens: dernier.sens as "ENTRANT" | "SORTANT",
    correspondant: autre,
    objet: dernier.objet,
    extrait: dernier.extrait,
    recuLe: dernier.recuLe.toISOString(),
    nonLu,
    classe,
    motif: (dernierEntrant ?? dernier).classeMotif,
    contact,
    mention,
    pieces: fil.reduce((total, m) => total + m._count.pieces, 0),
    range,
    traite,
    aTraiter,
    automatique: fil.every((m) => m.automatique),
    intention: reference.intention,
    attendu: reference.intentionAttendu,
    priorite,
    snoozeJusqua: snoozeJusqua?.toISOString() ?? null,
    revenu,
    propositionsEnAttente: extras.propositions.get(cleFil) ?? 0,
    brouillonPret: extras.brouillons.has(cleFil),
    dates: dates.length,
  };
}

/** Cartes en attente et brouillons déposés par l'assistant, par fil (mission 9). */
async function extrasDesFils(messages: MessageLu[]): Promise<Extras> {
  const filDe = new Map(messages.map((m) => [m.id, m.filCanal ?? m.id]));
  const ids = [...filDe.keys()];
  const propositions = new Map<string, number>();
  const brouillons = new Set<string>();
  if (ids.length === 0) return { propositions, brouillons };
  const [cartes, deposes] = await Promise.all([
    prisma.proposition.findMany({ where: { statut: "EN_ATTENTE", type: TYPE_MAJ_DEPUIS_MAIL, messageId: { in: ids } }, select: { messageId: true } }),
    prisma.brouillonMail.findMany({ where: { statut: "BROUILLON", source: "ASSISTANT", messageId: { in: ids } }, select: { messageId: true } }),
  ]);
  for (const c of cartes) {
    const fil = filDe.get(c.messageId ?? "");
    if (fil) propositions.set(fil, (propositions.get(fil) ?? 0) + 1);
  }
  for (const b of deposes) {
    const fil = filDe.get(b.messageId ?? "");
    if (fil) brouillons.add(fil);
  }
  return { propositions, brouillons };
}

/** Toutes les conversations récentes, calculées une fois. */
export async function conversations(maintenant: Date = new Date()): Promise<LigneMail[]> {
  const messages = await chargerMessages(new Date(maintenant.getTime() - FENETRE_JOURS * JOUR));
  const fils = new Map<string, MessageLu[]>();
  for (const m of messages) {
    const cle = m.filCanal ?? m.id;
    fils.set(cle, [...(fils.get(cle) ?? []), m]);
  }
  const extras = await extrasDesFils(messages);
  return [...fils.values()].map((fil) => ligneDuFil(fil, maintenant, extras)).sort((a, b) => b.recuLe.localeCompare(a.recuLe));
}

export function filtrerVue(lignes: LigneMail[], vue: VueMail): LigneMail[] {
  switch (vue) {
    case "A_TRAITER":
      // Par valeur (mission 9) : revenus, réclamations, devis en attente par montant, dossiers, leads, échéances, le reste.
      return lignes.filter((l) => l.aTraiter).sort(comparerPriorite);
    case "CLIENTS":
      return lignes.filter((l) => !l.range && l.classe === "CLIENT");
    case "ADMINISTRATIF":
      return lignes.filter((l) => !l.range && l.classe === "ADMINISTRATIF");
    case "RANGES":
      return lignes.filter((l) => l.range);
  }
}

export function compter(lignes: LigneMail[]): CompteursMail {
  return {
    A_TRAITER: filtrerVue(lignes, "A_TRAITER").length,
    CLIENTS: filtrerVue(lignes, "CLIENTS").length,
    ADMINISTRATIF: filtrerVue(lignes, "ADMINISTRATIF").length,
    RANGES: filtrerVue(lignes, "RANGES").length,
    nonLusATraiter: filtrerVue(lignes, "A_TRAITER").filter((l) => l.nonLu).length,
  };
}

export async function listerVue(vue: VueMail, options: { recherche?: string; limite?: number } = {}): Promise<{ lignes: LigneMail[]; compteurs: CompteursMail }> {
  const toutes = await conversations();
  const recherche = options.recherche?.trim().toLowerCase();
  const filtrees = filtrerVue(toutes, vue).filter(
    (l) => !recherche || [l.correspondant.adresse, l.correspondant.nom, l.objet, l.extrait, l.contact?.nom].some((champ) => champ?.toLowerCase().includes(recherche))
  );
  return { lignes: filtrees.slice(0, options.limite ?? 200), compteurs: compter(toutes) };
}

/**
 * « Tout nettoyer » : tout ce qui ne demande rien et traîne encore dans la
 * boîte de réception est archivé et marqué lu (dans Gmail aussi). Les
 * échanges clients restent dans Clients, l'administratif dans Administratif ;
 * rien n'est supprimé, et rien de ce qui est « À traiter » n'est touché.
 */
export async function toutNettoyer(maintenant: Date = new Date()): Promise<{ archives: number }> {
  const lignes = await conversations(maintenant);
  const aNettoyer = lignes.filter((l) => !l.aTraiter && !l.traite && !l.range);
  const fils = aNettoyer.map((l) => l.fil);
  const messages = await prisma.message.findMany({
    where: { canal: "EMAIL", OR: [{ filCanal: { in: fils } }, { id: { in: fils } }], dansBoite: true, traiteLe: null },
    select: { id: true },
  });
  await prisma.message.updateMany({ where: { id: { in: messages.map((m) => m.id) } }, data: { traiteLe: maintenant, lu: true } });
  for (const m of messages) await demanderEtatGmail(m.id);
  return { archives: aNettoyer.length };
}

/**
 * Bilan du tri (vérification, lecture seule) : ce que la boîte contient
 * aujourd'hui, ce que chaque vue montre, et la liste de ce qui est rangé.
 */
export async function bilanTri(maintenant: Date = new Date()) {
  const lignes = await conversations(maintenant);
  const messages = await prisma.message.count({ where: { canal: "EMAIL", sens: "ENTRANT", recuLe: { gte: new Date(maintenant.getTime() - FENETRE_JOURS * JOUR) } } });
  const dansBoite = await prisma.message.count({ where: { canal: "EMAIL", sens: "ENTRANT", dansBoite: true, recuLe: { gte: new Date(maintenant.getTime() - FENETRE_JOURS * JOUR) } } });
  const nonLusDansBoite = await prisma.message.count({ where: { canal: "EMAIL", sens: "ENTRANT", dansBoite: true, lu: false, recuLe: { gte: new Date(maintenant.getTime() - FENETRE_JOURS * JOUR) } } });
  const ranges = filtrerVue(lignes, "RANGES");
  const parMotif = new Map<string, number>();
  for (const l of ranges) parMotif.set(l.motif ?? "—", (parMotif.get(l.motif ?? "—") ?? 0) + 1);
  return {
    fenetreJours: FENETRE_JOURS,
    avant: { messagesRecus: messages, dansLaBoite: dansBoite, nonLusDansLaBoite: nonLusDansBoite, conversations: lignes.length },
    apres: compter(lignes),
    rangesParMotif: [...parMotif.entries()].sort((a, b) => b[1] - a[1]).map(([motif, nombre]) => ({ motif, nombre })),
    ranges: ranges.map((l) => ({ de: l.correspondant.nom ? `${l.correspondant.nom} <${l.correspondant.adresse}>` : l.correspondant.adresse, objet: l.objet, recuLe: l.recuLe, motif: l.motif })),
    aTraiter: filtrerVue(lignes, "A_TRAITER").map((l) => ({ de: l.correspondant.nom ?? l.correspondant.adresse, objet: l.objet, mention: l.mention })),
  };
}
