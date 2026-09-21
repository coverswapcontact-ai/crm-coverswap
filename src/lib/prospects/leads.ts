import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { formaterTelephone, normaliserTelephone } from "@/lib/clients/normalisation";
import { LIBELLES_TYPE_PROJET, STATUTS_LEAD_APRES_DEVIS, libelleSourceLead } from "./constantes";

/**
 * Section Leads : tout ce qui est entré — Meta, Google Ads, formulaires du
 * site, simulateur, contacts directs — et n'a PAS encore de dossier. Dès qu'un
 * dossier s'ouvre, le lead sort d'ici : il vit dans Dossiers, sans doublon.
 * Aucun devis envoyé n'apparaît donc dans cette liste.
 *
 * Ordre : chronologique, le plus récent en haut. La priorité se lit sur la
 * pastille de chaque ligne ; elle ne change pas l'ordre.
 */

export type ReponseLead = { question: string; reponse: string };

export type LigneLead = {
  id: string;
  nom: string;
  prenom: string;
  /** Numéro lisible (06 12 34 56 78) et lien d'appel (tel:+33…) ; null si illisible. */
  telephone: string | null;
  telephoneLien: string | null;
  email: string | null;
  ville: string | null;
  codePostal: string | null;
  source: string;
  libelleSource: string;
  campagne: string | null;
  publicite: string | null;
  formulaire: string | null;
  projet: string;
  recuLe: string;
  priorite: string | null;
  prioriteMotif: string | null;
  statut: string;
  reponses: ReponseLead[];
  message: string | null;
  /** Aucun appel noté : la personne attend depuis son arrivée. Sinon null. */
  attendDepuis: string | null;
  appels: number;
  dernierAppel: { le: string; contenu: string } | null;
  rappelLe: string | null;
  /** À appeler maintenant : jamais appelé, ou rappel arrivé à échéance. */
  aAppeler: boolean;
  conversationId: string | null;
  smsNonLus: number;
  photos: number;
};

export type VueLeads = "ACTIFS" | "SANS_SUITE";
export type ListeLeads = { lignes: LigneLead[]; compteurs: { actifs: number; aAppeler: number; sansSuite: number }; sources: string[] };

const VILLES_INCONNUES = /^(|non renseign[ée]e?|inconnue?)$/i;
const LIBELLES_OCCUPATION: Record<string, string> = { PROPRIETAIRE: "Propriétaire", LOCATAIRE: "Locataire" };
/** Délai classé sans la réponse d'origine : « indéterminé » ne dit rien, on ne l'affiche pas. */
const LIBELLES_DELAI: Record<string, string> = { COURT: "Sous peu", MOYEN: "Dans quelques mois", LOINTAIN: "Plus tard" };
/** Champs d'identité des formulaires Meta : déjà affichés ailleurs sur la ligne. */
const CLES_IDENTITE = /^(full_name|first_name|last_name|phone_number|phone|email|city|zip|zip_code|post_code|postal_code|street_address|country|__)/i;

const sansDossier: Prisma.LeadWhereInput = { dossiers: { none: { archiveLe: null } }, statut: { notIn: [...STATUTS_LEAD_APRES_DEVIS] } };
const whereVue = (vue: VueLeads): Prisma.LeadWhereInput => ({ ...sansDossier, AND: [vue === "SANS_SUITE" ? { statut: "PERDU" } : { statut: { not: "PERDU" } }] });

const inclusion = {
  interactions: { where: { archiveLe: null, type: "APPEL" }, orderBy: { createdAt: "desc" }, select: { contenu: true, createdAt: true } },
  metaLeads: { orderBy: { createdAt: "desc" }, take: 1, select: { reponses: true, campagneNom: true, adNom: true, formNom: true } },
  conversationsSms: { where: { archiveLe: null }, orderBy: { dernierMessageLe: "desc" }, take: 1, select: { id: true, nonLus: true } },
  _count: { select: { photos: true } },
} satisfies Prisma.LeadInclude;

type LeadCharge = Prisma.LeadGetPayload<{ include: typeof inclusion }>;

function reponsesDuLead(lead: LeadCharge): ReponseLead[] {
  const reponses: ReponseLead[] = [];
  const vues = new Set<string>();
  const ajouter = (question: string, reponse: string | null | undefined) => {
    const valeur = (reponse ?? "").trim();
    if (!valeur || vues.has(`${question}:${valeur}`.toLowerCase())) return;
    vues.add(`${question}:${valeur}`.toLowerCase());
    reponses.push({ question, reponse: valeur.slice(0, 300) });
  };
  ajouter("Occupation", lead.occupation ? (LIBELLES_OCCUPATION[lead.occupation] ?? lead.occupation) : null);
  ajouter("Délai", lead.delaiProjetTexte ?? (lead.delaiProjet ? LIBELLES_DELAI[lead.delaiProjet] : null));
  ajouter("Cuisine", lead.tailleCuisine);
  // Questions personnalisées du formulaire Meta, telles que posées.
  try {
    const brutes = JSON.parse(lead.metaLeads[0]?.reponses || "[]") as { question?: string; reponse?: string; cle?: string }[];
    const dejaDites = new Set(reponses.map((r) => r.reponse.toLowerCase()));
    for (const brute of brutes) {
      if (!brute.question || !brute.reponse || CLES_IDENTITE.test(brute.cle ?? "")) continue;
      if (dejaDites.has(brute.reponse.trim().toLowerCase())) continue;
      ajouter(brute.question, brute.reponse);
    }
  } catch {
    // Réponses illisibles : les champs propres du lead suffisent.
  }
  ajouter("Finition", lead.referenceChoisie);
  ajouter("Style", lead.styleSouhaite);
  if (lead.mlEstimes) ajouter("Linéaire", `${lead.mlEstimes} ml`);
  if (lead.prixDevis) ajouter("Simulé", `${Math.round(lead.prixDevis)} €`);
  return reponses.slice(0, 8);
}

function versLigne(lead: LeadCharge, maintenant: Date): LigneLead {
  const numero = normaliserTelephone(lead.telephone);
  const prenom = lead.prenom.trim() === "Inconnu" ? "" : lead.prenom.trim();
  const nomFamille = lead.nom.trim() === "Inconnu" ? "" : lead.nom.trim();
  const nom = (!prenom || prenom.toLowerCase() === nomFamille.toLowerCase() ? nomFamille || prenom : `${prenom} ${nomFamille}`).trim() || "Contact sans nom";
  const dernier = lead.interactions[0] ?? null;
  const rappelEchu = Boolean(lead.rappelLe && lead.rappelLe.getTime() <= maintenant.getTime());
  const jamaisAppele = lead.interactions.length === 0 && (lead.statut === "NOUVEAU" || lead.statut === "DEVIS_DEMANDE");
  const conversation = lead.conversationsSms[0] ?? null;
  const meta = lead.metaLeads[0] ?? null;
  return {
    id: lead.id,
    nom,
    prenom: prenom || nom,
    telephone: numero ? formaterTelephone(numero) : lead.telephone.trim() || null,
    telephoneLien: numero ? `tel:${numero}` : null,
    email: lead.email,
    ville: VILLES_INCONNUES.test(lead.ville.trim()) ? null : lead.ville.trim(),
    codePostal: lead.codePostal,
    source: lead.source,
    libelleSource: libelleSourceLead(lead.source),
    campagne: lead.campagne ?? meta?.campagneNom ?? null,
    publicite: lead.publicite ?? meta?.adNom ?? null,
    formulaire: lead.formulaire ?? meta?.formNom ?? null,
    projet: LIBELLES_TYPE_PROJET[lead.typeProjet] ?? lead.typeProjet,
    recuLe: lead.createdAt.toISOString(),
    priorite: lead.priorite,
    prioriteMotif: lead.prioriteMotif,
    statut: lead.statut,
    reponses: reponsesDuLead(lead),
    message: lead.message?.trim() || null,
    attendDepuis: jamaisAppele ? lead.createdAt.toISOString() : null,
    appels: lead.interactions.length,
    dernierAppel: dernier ? { le: dernier.createdAt.toISOString(), contenu: dernier.contenu.slice(0, 200) } : null,
    rappelLe: lead.rappelLe?.toISOString() ?? null,
    aAppeler: lead.statut !== "PERDU" && (rappelEchu || (jamaisAppele && !lead.rappelLe)),
    conversationId: conversation?.id ?? null,
    smsNonLus: conversation?.nonLus ?? 0,
    photos: lead._count.photos,
  };
}

function whereRecherche(recherche: string | undefined): Prisma.LeadWhereInput {
  const brut = (recherche ?? "").trim();
  if (!brut) return {};
  const chiffres = brut.replace(/\D/g, "");
  if (chiffres.length >= 6 && /^[\d\s.+()-]+$/.test(brut)) {
    const fin = chiffres.replace(/^(33|0)/, "").slice(-9);
    return { OR: [{ telephone: { contains: chiffres } }, { telephone: { contains: fin } }] };
  }
  return {
    AND: brut.split(/\s+/).filter(Boolean).slice(0, 5).map((terme) => ({
      OR: [{ nom: { contains: terme } }, { prenom: { contains: terme } }, { email: { contains: terme.toLowerCase() } }, { ville: { contains: terme } }, { campagne: { contains: terme } }],
    })),
  };
}

/** À appeler maintenant, traduit pour la base : jamais appelé et sans rappel prévu, ou rappel échu. Les « à écarter » ne comptent pas : on ne les appelle pas. */
function whereAAppeler(maintenant: Date): Prisma.LeadWhereInput {
  return {
    ...whereVue("ACTIFS"),
    NOT: { priorite: "A_ECARTER" },
    OR: [
      { rappelLe: { lte: maintenant } },
      { rappelLe: null, statut: { in: ["NOUVEAU", "DEVIS_DEMANDE"] }, interactions: { none: { type: "APPEL", archiveLe: null } } },
    ],
  };
}

export async function listerLeads(filtres: { vue?: VueLeads; source?: string; recherche?: string; limite?: number } = {}, maintenant: Date = new Date()): Promise<ListeLeads> {
  const vue = filtres.vue ?? "ACTIFS";
  const communs: Prisma.LeadWhereInput[] = [filtres.source ? { source: filtres.source } : {}, whereRecherche(filtres.recherche)];
  const [leads, actifs, aAppeler, sansSuite, sources] = await Promise.all([
    prisma.lead.findMany({ where: { AND: [...communs, whereVue(vue)] }, include: inclusion, orderBy: { createdAt: "desc" }, take: Math.min(filtres.limite ?? 300, 500) }),
    prisma.lead.count({ where: whereVue("ACTIFS") }),
    prisma.lead.count({ where: whereAAppeler(maintenant) }),
    prisma.lead.count({ where: whereVue("SANS_SUITE") }),
    prisma.lead.groupBy({ by: ["source"], where: whereVue("ACTIFS"), _count: { _all: true } }),
  ]);
  return {
    lignes: leads.map((lead) => versLigne(lead, maintenant)),
    compteurs: { actifs, aAppeler, sansSuite },
    sources: sources.sort((a, b) => b._count._all - a._count._all).map((s) => s.source),
  };
}

/** Compteur de la navigation : les leads à appeler maintenant. */
export function compterLeadsAAppeler(maintenant: Date = new Date()): Promise<number> {
  return prisma.lead.count({ where: whereAAppeler(maintenant) });
}

/** Une seule ligne, rafraîchie après un appel (le mode « enchaîner » n'a pas à recharger toute la liste). */
export async function chargerLigneLead(id: string, maintenant: Date = new Date()): Promise<LigneLead | null> {
  const lead = await prisma.lead.findFirst({ where: { id }, include: inclusion });
  return lead ? versLigne(lead, maintenant) : null;
}
