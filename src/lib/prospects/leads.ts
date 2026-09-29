import type { Prisma } from "@prisma/client";
import { mainDe, type Main } from "@/lib/dossiers/pilotage";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import prisma from "@/lib/prisma";
import { tranche } from "@/lib/commun/pagination";
import { formaterTelephone, normaliserTelephone } from "@/lib/clients/normalisation";
import { JOURS_A_TRAITER, LIBELLES_TYPE_PROJET, STATUTS_LEAD_APRES_DEVIS, libelleSourceLead } from "./constantes";
import { versVueNote } from "@/lib/commercial/notes-appel";
import { aHeureParis } from "@/lib/commercial/quand";
import type { NoteAppelVue } from "@/lib/commercial/notes-constantes";

/**
 * Section Leads : tout ce qui est entré — Meta, Google Ads, formulaires du
 * site, simulateur, contacts directs — et n'a PAS encore de dossier. Dès qu'un
 * dossier s'ouvre, le lead sort d'ici : il vit dans Dossiers, sans doublon.
 * Aucun devis envoyé n'apparaît donc dans cette liste.
 *
 * Mission 14 (29/09/2026), partie 3 — deux listes, une seule chose par écran,
 * et un lead a toujours une destination :
 *  - « À appeler » : jamais appelé (`dernierAppelLe` nul : ni fin d'appel, ni
 *    échange d'appel, ni note d'appel) et sans rappel daté ; le plus récent en
 *    haut. Les « à écarter » y restent (pastille grise) ;
 *  - « À rappeler » : déjà appelé, ou un rappel daté ; les rappels datés dans
 *    l'ordre chronologique (les retards viennent donc en tête), puis ceux sans
 *    date, le plus ancien appel d'abord.
 * Un lead ne sort des deux listes que vers un dossier, en « sans suite » (avec
 * un motif) ou archivé. « Traité » n'existe plus (`traiteLe` n'est plus lu).
 * La priorité se lit sur la pastille de chaque ligne ; elle ne change pas l'ordre.
 *
 * Exception (21/09/2026) : un lead du SIMULATEUR a son dossier ouvert tout
 * seul, mais reste ici (« À appeler ») tant qu'aucun appel n'est noté (ni sur
 * sa fiche, ni sur son dossier), sur 60 jours, et tant que son dossier n'a pas
 * dépassé la simulation. C'est le même contact et le même dossier, visible aux
 * deux endroits ; le premier appel noté (fin d'appel, échange, note d'appel) ou
 * le premier rappel daté le fait sortir vers son dossier — jamais dans « À
 * rappeler » : avec un dossier, le rappel vit sur le dossier.
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
  /** Dans « À appeler » : la personne attend depuis son arrivée. Sinon null. */
  attendDepuis: string | null;
  appels: number;
  dernierAppel: { le: string; contenu: string } | null;
  /** Dernier appel noté, quelle qu'en soit l'issue ; null = jamais appelé. */
  dernierAppelLe: string | null;
  /** Appels sans réponse consécutifs depuis le dernier appel abouti. */
  tentatives: number;
  rappelLe: string | null;
  /** Rappel daté et passé : en tête de « À rappeler », en rouge. */
  enRetard: boolean;
  /** Dans la liste « À appeler » : jamais appelé, sans rappel daté. */
  aAppeler: boolean;
  conversationId: string | null;
  smsNonLus: number;
  photos: number;
  /** A fait une simulation sur le site : il a déjà vu un rendu de sa pièce. */
  simulation: boolean;
  /** Son dossier, quand il en a déjà un (lead du simulateur pas encore appelé). */
  dossierId: string | null;
  /** Qui a la main sur ce dossier (règle unique, dossiers/main.ts), et pourquoi. */
  dossierMain: { main: Main; motif: string | null } | null;
  /** Les dernières simulations, pour en parler pendant l'appel. */
  simulations: SimulationLead[];
  archiveLe: string | null;
  archiveMotif: string | null;
  /** Doublon probable (même nom, même ville, autre numéro et autre e-mail) : à fusionner d'un clic, ou à écarter. */
  doublon: { de: string; nom: string; motif: string; dossierId: string | null } | null;
  /** Notes prises pendant les appels, de la plus récente à la plus ancienne. */
  notesAppel: NoteAppelVue[];
};

export type SimulationLead = { id: string; le: string; reference: string | null; prix: number | null; avant: string | null; apres: string | null };

export type VueLeads = "A_APPELER" | "A_RAPPELER" | "SANS_SUITE" | "ARCHIVES";
export type CompteursLeads = {
  aAppeler: number;
  aRappeler: number;
  /** Rappels datés et passés : le compteur de l'onglet Leads. */
  enRetard: number;
  /** Rappels datés plus tard dans la journée (heure de Paris). */
  aujourdhui: number;
  sansSuite: number;
  archives: number;
  /** Les deux listes ensemble (à appeler + à rappeler). */
  actifs: number;
};
export type ListeLeads = { lignes: LigneLead[]; compteurs: CompteursLeads; sources: string[]; /** Mission 13 (lot 6) : la page demandée et le total du filtre (absents des réponses d'avant, en cache). */ total?: number; page?: number; parPage?: number };

const VILLES_INCONNUES = /^(|non renseign[ée]e?|inconnue?)$/i;
const LIBELLES_OCCUPATION: Record<string, string> = { PROPRIETAIRE: "Propriétaire", LOCATAIRE: "Locataire" };
/** Délai classé sans la réponse d'origine : « indéterminé » ne dit rien, on ne l'affiche pas. */
const LIBELLES_DELAI: Record<string, string> = { COURT: "Sous peu", MOYEN: "Dans quelques mois", LOINTAIN: "Plus tard" };
/** Champs d'identité des formulaires Meta : déjà affichés ailleurs sur la ligne. */
const CLES_IDENTITE = /^(full_name|first_name|last_name|phone_number|phone|email|city|zip|zip_code|post_code|postal_code|street_address|country|__)/i;

const JOUR_MS = 86_400_000;
/** Étapes où un dossier ouvert par la simulation attend encore le premier appel. */
const ETAPES_AVANT_APPEL = ["QUALIFICATION", "SIMULATION"];
const APPEL = { type: "APPEL", archiveLe: null };

const APRES_DEVIS: readonly string[] = STATUTS_LEAD_APRES_DEVIS;

/** Le cas général : pas de dossier vivant, ni perdu, ni après devis (le pilotage commercial lit la même règle). */
export const LEAD_SANS_DOSSIER: Prisma.LeadWhereInput = { dossiers: { none: { archiveLe: null } }, statut: { notIn: [...STATUTS_LEAD_APRES_DEVIS, "PERDU"] } };

/**
 * Lead du simulateur, dossier déjà ouvert, jamais appelé (ni appel ni note d'appel retenus, aucun rappel daté), depuis
 * moins de 60 jours (arrivée ou dernière simulation). Il n'est donc jamais que dans « À appeler ».
 */
function simulationNonAppelee(maintenant: Date): Prisma.LeadWhereInput {
  const limite = new Date(maintenant.getTime() - JOURS_A_TRAITER * JOUR_MS);
  return {
    statut: { notIn: [...STATUTS_LEAD_APRES_DEVIS, "PERDU"] },
    dernierAppelLe: null,
    rappelLe: null,
    interactions: { none: APPEL },
    dossiers: { some: { archiveLe: null, etape: { in: ETAPES_AVANT_APPEL } }, none: { archiveLe: null, evenements: { some: APPEL } } },
    AND: [
      { OR: [{ source: "SITE_SIMULATEUR" }, { simulations: { some: { archiveLe: null } } }] },
      { OR: [{ createdAt: { gte: limite } }, { simulations: { some: { archiveLe: null, createdAt: { gte: limite } } } }] },
    ],
  };
}

/** La base commune des deux listes : ni perdu, ni après devis, sans dossier vivant — ou lead du simulateur pas encore appelé (les archivés sont écartés par l'extension du journal). */
const whereActif = (maintenant: Date): Prisma.LeadWhereInput => ({ OR: [LEAD_SANS_DOSSIER, simulationNonAppelee(maintenant)] });
/** « À appeler » : jamais appelé, sans rappel daté. */
const JAMAIS_APPELE: Prisma.LeadWhereInput = { dernierAppelLe: null, rappelLe: null };
/** « À rappeler » : déjà appelé, ou un rappel daté. */
const DEJA_APPELE: Prisma.LeadWhereInput = { OR: [{ dernierAppelLe: { not: null } }, { rappelLe: { not: null } }] };

function whereVue(vue: VueLeads, maintenant: Date): Prisma.LeadWhereInput {
  switch (vue) {
    case "ARCHIVES":
      return { archiveLe: { not: null } };
    case "SANS_SUITE":
      return { dossiers: { none: { archiveLe: null } }, statut: "PERDU" };
    case "A_APPELER":
      return { AND: [whereActif(maintenant), JAMAIS_APPELE] };
    case "A_RAPPELER":
      return { AND: [whereActif(maintenant), DEJA_APPELE] };
  }
}

/**
 * L'ordre de chaque liste, entièrement côté serveur (la pagination est exacte). « À rappeler » : les rappels datés
 * d'abord, du plus ancien au plus lointain (les retards en tête), puis les rappels sans date, le plus ancien appel
 * d'abord ; à égalité, l'arrivée, puis l'identifiant (un ordre total : une ligne ne saute pas d'une page à l'autre).
 */
const ORDRE: Record<VueLeads, Prisma.LeadOrderByWithRelationInput[]> = {
  A_APPELER: [{ createdAt: "desc" }],
  A_RAPPELER: [{ rappelLe: { sort: "asc", nulls: "last" } }, { dernierAppelLe: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
  SANS_SUITE: [{ createdAt: "desc" }],
  ARCHIVES: [{ archiveLe: "desc" }],
};

const inclusion = {
  interactions: { where: { archiveLe: null, type: "APPEL" }, orderBy: { createdAt: "desc" }, select: { contenu: true, createdAt: true } },
  metaLeads: { orderBy: { createdAt: "desc" }, take: 1, select: { reponses: true, campagneNom: true, adNom: true, formNom: true } },
  conversationsSms: { where: { archiveLe: null }, orderBy: { dernierMessageLe: "desc" }, take: 1, select: { id: true, nonLus: true } },
  dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, etape: true, main: true, mainMotif: true, prochaineActionDate: true, _count: { select: { evenements: { where: APPEL } } } } },
  simulations: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, createdAt: true, referenceChoisie: true, prixDevis: true, imageBeforePath: true, imageOriginalPath: true, imageAfterPath: true } },
  _count: { select: { photos: true, simulations: { where: { archiveLe: null } } } },
  notesAppel: { where: { archiveLe: null }, orderBy: { appelLe: "desc" }, take: 20 },
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
  const dossier = lead.dossiers[0] ?? null;
  const simulation = lead.source === "SITE_SIMULATEUR" || lead._count.simulations > 0;
  // Un lead revenu faire une simulation « arrive » à sa dernière simulation.
  const derniereSimulation = lead.simulations[0]?.createdAt ?? null;
  const arrivee = derniereSimulation && derniereSimulation > lead.createdAt ? derniereSimulation : lead.createdAt;
  // La base des deux listes (même règle que `whereActif`) : avec un dossier (ouvert par la simulation), seulement tant
  // qu'aucun appel n'est noté, ni sur la fiche ni sur le dossier, ni rappel daté, sur 60 jours, avant le devis.
  const recent = maintenant.getTime() - arrivee.getTime() <= JOURS_A_TRAITER * JOUR_MS;
  const jamaisAppele = !lead.dernierAppelLe && !lead.rappelLe;
  const actif =
    !lead.archiveLe &&
    lead.statut !== "PERDU" &&
    !APRES_DEVIS.includes(lead.statut) &&
    (!dossier || (simulation && jamaisAppele && lead.interactions.length === 0 && dossier._count.evenements === 0 && recent && ETAPES_AVANT_APPEL.includes(dossier.etape)));
  const aAppeler = actif && jamaisAppele;
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
    attendDepuis: aAppeler ? (dossier ? arrivee : lead.createdAt).toISOString() : null,
    appels: lead.interactions.length,
    dernierAppel: dernier ? { le: dernier.createdAt.toISOString(), contenu: dernier.contenu.slice(0, 200) } : null,
    dernierAppelLe: lead.dernierAppelLe?.toISOString() ?? null,
    tentatives: lead.tentatives,
    rappelLe: lead.rappelLe?.toISOString() ?? null,
    enRetard: actif && Boolean(lead.rappelLe && lead.rappelLe.getTime() < maintenant.getTime()),
    aAppeler,
    conversationId: conversation?.id ?? null,
    smsNonLus: conversation?.nonLus ?? 0,
    photos: lead._count.photos,
    simulation,
    archiveLe: lead.archiveLe?.toISOString() ?? null,
    archiveMotif: lead.archiveMotif,
    doublon: lead.doublonDe && !lead.doublonTraiteLe ? { de: lead.doublonDe, nom: "", motif: lead.doublonMotif ?? "Doublon probable", dossierId: null } : null,
    dossierId: dossier?.id ?? null,
    dossierMain: dossier
      ? {
          main: mainDe({ etape: dossier.etape as EtapeDossier, prochaineActionDate: dossier.prochaineActionDate?.toISOString() ?? null, main: dossier.main === "MOI" || dossier.main === "CLIENT" ? dossier.main : null }, new Date()),
          motif: dossier.mainMotif && !dossier.mainMotif.startsWith("Étape «") ? dossier.mainMotif : null,
        }
      : null,
    notesAppel: lead.notesAppel.map(versVueNote),
    simulations: lead.simulations.map((s) => {
      const avant = s.imageOriginalPath ?? s.imageBeforePath;
      return { id: s.id, le: s.createdAt.toISOString(), reference: s.referenceChoisie, prix: s.prixDevis, avant: avant ? `/api/uploads/${avant}` : null, apres: s.imageAfterPath ? `/api/uploads/${s.imageAfterPath}` : null };
    }),
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

/** Rappels passés des deux listes (un rappel daté place toujours le lead dans « À rappeler »). */
const whereEnRetard = (maintenant: Date): Prisma.LeadWhereInput => ({ AND: [whereActif(maintenant), { rappelLe: { lt: maintenant } }] });

export async function listerLeads(filtres: { vue?: VueLeads; source?: string; recherche?: string; limite?: number; page?: number; parPage?: number } = {}, maintenant: Date = new Date()): Promise<ListeLeads> {
  const vue = filtres.vue ?? "A_APPELER";
  const communs: Prisma.LeadWhereInput[] = [filtres.source ? { source: filtres.source } : {}, whereRecherche(filtres.recherche)];
  // Mission 13 (lot 6) : une page à la fois quand l'écran la demande ; `limite` reste pour l'assistant et l'audit.
  const page = filtres.page ? tranche(filtres.page, filtres.parPage) : null;
  const where: Prisma.LeadWhereInput = { AND: [...communs, whereVue(vue, maintenant)] };
  // « Aujourd'hui » : jusqu'à minuit, heure de Paris (le serveur tourne en UTC).
  const finDuJour = aHeureParis(maintenant, 1, 0);
  const [leads, aAppeler, aRappeler, enRetard, aujourdhui, sansSuite, archives, sources, total] = await Promise.all([
    prisma.lead.findMany({ where, include: inclusion, orderBy: ORDRE[vue], ...(page ? { skip: page.skip, take: page.take } : { take: Math.min(filtres.limite ?? 300, 500) }) }),
    prisma.lead.count({ where: whereVue("A_APPELER", maintenant) }),
    prisma.lead.count({ where: whereVue("A_RAPPELER", maintenant) }),
    prisma.lead.count({ where: whereEnRetard(maintenant) }),
    prisma.lead.count({ where: { AND: [whereActif(maintenant), { rappelLe: { gte: maintenant, lt: finDuJour } }] } }),
    prisma.lead.count({ where: whereVue("SANS_SUITE", maintenant) }),
    prisma.lead.count({ where: whereVue("ARCHIVES", maintenant) }),
    prisma.lead.groupBy({ by: ["source"], where: whereActif(maintenant), _count: { _all: true } }),
    prisma.lead.count({ where }),
  ]);
  return {
    lignes: await avecDoublons(leads.map((lead) => versLigne(lead, maintenant))),
    compteurs: { aAppeler, aRappeler, enRetard, aujourdhui, sansSuite, archives, actifs: aAppeler + aRappeler },
    sources: sources.sort((a, b) => b._count._all - a._count._all).map((s) => s.source),
    total,
    page: page?.page ?? 1,
    parPage: page?.parPage ?? leads.length,
  };
}

/** Compteur de l'onglet Leads : les rappels en retard, rien d'autre (mission 14). */
export function compterLeadsEnRetard(maintenant: Date = new Date()): Promise<number> {
  return prisma.lead.count({ where: whereEnRetard(maintenant) });
}

export type RappelLead = { leadId: string; nom: string; telephone: string; le: Date; enRetard: boolean };

/**
 * Mission 14 (partie 3) — les rappels datés des leads, lus comme l'onglet Leads : seulement les leads des deux listes
 * (ni perdu, ni archivé, ni avec un dossier : son rappel vit sur le dossier), du plus proche au plus lointain ;
 * `enRetard` = rappel passé (`compteurs.enRetard`). `avant` coupe (fin de la journée de Paris :
 * `aHeureParis(maintenant, 1, 0)`). Lecteur unique de l'assistant (`manager_operations`, `point_du_jour`).
 */
export async function rappelsDesLeads(maintenant: Date = new Date(), avant?: Date): Promise<RappelLead[]> {
  const leads = await prisma.lead.findMany({
    where: { AND: [whereActif(maintenant), { rappelLe: avant ? { lt: avant } : { not: null } }] },
    select: { id: true, prenom: true, nom: true, telephone: true, rappelLe: true },
    orderBy: [{ rappelLe: "asc" }, { id: "asc" }],
    take: 500,
  });
  return leads.flatMap((l) =>
    l.rappelLe ? [{ leadId: l.id, nom: `${l.prenom} ${l.nom}`.replace(/\bInconnu\b/g, "").trim() || "Contact sans nom", telephone: l.telephone, le: l.rappelLe, enRetard: l.rappelLe.getTime() < maintenant.getTime() }] : []
  );
}

/** Une seule ligne, rafraîchie après un appel (le mode « enchaîner » n'a pas à recharger toute la liste). */
export async function chargerLigneLead(id: string, maintenant: Date = new Date()): Promise<LigneLead | null> {
  const lead = await prisma.lead.findFirst({ where: { id }, include: inclusion });
  return lead ? (await avecDoublons([versLigne(lead, maintenant)]))[0] : null;
}

/** Le contact que chaque doublon probable semble doubler : son nom et son dossier en cours, pour fusionner en connaissance de cause. */
async function avecDoublons(lignes: LigneLead[]): Promise<LigneLead[]> {
  const ids = [...new Set(lignes.flatMap((l) => (l.doublon ? [l.doublon.de] : [])))];
  if (ids.length === 0) return lignes;
  const originaux = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, prenom: true, nom: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
  const parId = new Map(originaux.map((o) => [o.id, o]));
  return lignes.map((l) => {
    if (!l.doublon) return l;
    const original = parId.get(l.doublon.de);
    // Le contact d'origine a été archivé entre-temps : plus rien à fusionner.
    if (!original) return { ...l, doublon: null };
    return { ...l, doublon: { ...l.doublon, nom: `${original.prenom} ${original.nom}`.replace(/Inconnu/g, "").trim() || "Contact sans nom", dossierId: original.dossiers[0]?.id ?? null } };
  });
}
