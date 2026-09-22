import type { Prisma } from "@prisma/client";
import { mainDe, type Main } from "@/lib/dossiers/pilotage";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import prisma from "@/lib/prisma";
import { formaterTelephone, normaliserTelephone } from "@/lib/clients/normalisation";
import { JOURS_A_TRAITER, LIBELLES_TYPE_PROJET, STATUTS_LEAD_APRES_DEVIS, libelleSourceLead } from "./constantes";
import { versVueNote } from "@/lib/commercial/notes-appel";
import type { NoteAppelVue } from "@/lib/commercial/notes-constantes";

/**
 * Section Leads : tout ce qui est entré — Meta, Google Ads, formulaires du
 * site, simulateur, contacts directs — et n'a PAS encore de dossier. Dès qu'un
 * dossier s'ouvre, le lead sort d'ici : il vit dans Dossiers, sans doublon.
 * Aucun devis envoyé n'apparaît donc dans cette liste.
 *
 * Ordre : chronologique, le plus récent en haut. La priorité se lit sur la
 * pastille de chaque ligne ; elle ne change pas l'ordre.
 *
 * Exception (21/09/2026) : un lead du SIMULATEUR a son dossier ouvert tout
 * seul, mais reste ici — et dans la file d'appels — tant qu'aucun appel n'est
 * noté (ni sur sa fiche, ni sur son dossier), sur 60 jours, et tant que son
 * dossier n'a pas dépassé la simulation. C'est le même contact et le même
 * dossier, visible aux deux endroits ; le premier appel noté le fait sortir.
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
  /** A fait une simulation sur le site : il a déjà vu un rendu de sa pièce. */
  simulation: boolean;
  /** Son dossier, quand il en a déjà un (lead du simulateur pas encore appelé). */
  dossierId: string | null;
  /** Qui a la main sur ce dossier (règle unique, dossiers/main.ts), et pourquoi. */
  dossierMain: { main: Main; motif: string | null } | null;
  /** Les dernières simulations, pour en parler pendant l'appel. */
  simulations: SimulationLead[];
  /** Marqué comme traité depuis Leads : hors de la file d'appels. */
  traiteLe: string | null;
  archiveLe: string | null;
  archiveMotif: string | null;
  /** Doublon probable (même nom, même ville, autre numéro et autre e-mail) : à fusionner d'un clic, ou à écarter. */
  doublon: { de: string; nom: string; motif: string; dossierId: string | null } | null;
  /** Notes prises pendant les appels, de la plus récente à la plus ancienne. */
  notesAppel: NoteAppelVue[];
};

export type SimulationLead = { id: string; le: string; reference: string | null; prix: number | null; avant: string | null; apres: string | null };

export type VueLeads = "ACTIFS" | "SANS_SUITE" | "ARCHIVES";
export type ListeLeads = { lignes: LigneLead[]; compteurs: { actifs: number; aAppeler: number; sansSuite: number; archives: number }; sources: string[] };

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

/** Le cas général : pas de dossier. */
const sansDossierActif: Prisma.LeadWhereInput = { dossiers: { none: { archiveLe: null } }, statut: { notIn: [...STATUTS_LEAD_APRES_DEVIS, "PERDU"] } };

/** Lead du simulateur, dossier déjà ouvert, jamais appelé, depuis moins de 60 jours (arrivée ou dernière simulation). */
function simulationNonAppelee(maintenant: Date): Prisma.LeadWhereInput {
  const limite = new Date(maintenant.getTime() - JOURS_A_TRAITER * JOUR_MS);
  return {
    statut: { notIn: [...STATUTS_LEAD_APRES_DEVIS, "PERDU"] },
    traiteLe: null,
    interactions: { none: APPEL },
    dossiers: { some: { archiveLe: null, etape: { in: ETAPES_AVANT_APPEL } }, none: { archiveLe: null, evenements: { some: APPEL } } },
    AND: [
      { OR: [{ source: "SITE_SIMULATEUR" }, { simulations: { some: { archiveLe: null } } }] },
      { OR: [{ createdAt: { gte: limite } }, { simulations: { some: { archiveLe: null, createdAt: { gte: limite } } } }] },
    ],
  };
}

const whereVue = (vue: VueLeads, maintenant: Date): Prisma.LeadWhereInput =>
  vue === "ARCHIVES"
    ? { archiveLe: { not: null } }
    : vue === "SANS_SUITE"
      ? { dossiers: { none: { archiveLe: null } }, statut: "PERDU" }
      : { OR: [sansDossierActif, simulationNonAppelee(maintenant)] };

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
  const rappelEchu = Boolean(lead.rappelLe && lead.rappelLe.getTime() <= maintenant.getTime());
  const dossier = lead.dossiers[0] ?? null;
  const simulation = lead.source === "SITE_SIMULATEUR" || lead._count.simulations > 0;
  // Un lead revenu faire une simulation « arrive » à sa dernière simulation.
  const derniereSimulation = lead.simulations[0]?.createdAt ?? null;
  const arrivee = derniereSimulation && derniereSimulation > lead.createdAt ? derniereSimulation : lead.createdAt;
  // Avec un dossier (ouvert par la simulation), un appel noté sur le dossier compte aussi.
  const jamaisAppele = dossier
    ? lead.interactions.length === 0 && dossier._count.evenements === 0
    : lead.interactions.length === 0 && (lead.statut === "NOUVEAU" || lead.statut === "DEVIS_DEMANDE");
  const recent = maintenant.getTime() - (dossier ? arrivee : lead.createdAt).getTime() <= JOURS_A_TRAITER * JOUR_MS;
  const aAppeler =
    !lead.archiveLe &&
    !lead.traiteLe &&
    lead.statut !== "PERDU" &&
    lead.priorite !== "A_ECARTER" &&
    (dossier ? simulation && jamaisAppele && recent && ETAPES_AVANT_APPEL.includes(dossier.etape) : rappelEchu || (jamaisAppele && !lead.rappelLe && recent));
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
    attendDepuis: jamaisAppele ? (dossier ? arrivee : lead.createdAt).toISOString() : null,
    appels: lead.interactions.length,
    dernierAppel: dernier ? { le: dernier.createdAt.toISOString(), contenu: dernier.contenu.slice(0, 200) } : null,
    rappelLe: lead.rappelLe?.toISOString() ?? null,
    // Un lead jamais appelé reste « à appeler » soixante jours ; au-delà il reste dans la liste, mais la file d'appels ne le propose plus (un rappel posé, lui, vaut toujours).
    aAppeler,
    conversationId: conversation?.id ?? null,
    smsNonLus: conversation?.nonLus ?? 0,
    photos: lead._count.photos,
    simulation,
    traiteLe: lead.traiteLe?.toISOString() ?? null,
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

/** À appeler maintenant, traduit pour la base : jamais appelé et sans rappel prévu, ou rappel échu. Les « à écarter » ne comptent pas : on ne les appelle pas. */
function whereAAppeler(maintenant: Date): Prisma.LeadWhereInput {
  return {
    AND: [
      // (une priorité absente n'est pas « à écarter » : en SQL, NOT sur une valeur nulle écarterait ces leads)
      { OR: [{ priorite: null }, { priorite: { not: "A_ECARTER" } }] },
      { traiteLe: null },
      {
        OR: [
          {
            ...sansDossierActif,
            OR: [
              { rappelLe: { lte: maintenant } },
              { rappelLe: null, statut: { in: ["NOUVEAU", "DEVIS_DEMANDE"] }, createdAt: { gte: new Date(maintenant.getTime() - JOURS_A_TRAITER * JOUR_MS) }, interactions: { none: APPEL } },
            ],
          },
          simulationNonAppelee(maintenant),
        ],
      },
    ],
  };
}

export async function listerLeads(filtres: { vue?: VueLeads; source?: string; recherche?: string; limite?: number } = {}, maintenant: Date = new Date()): Promise<ListeLeads> {
  const vue = filtres.vue ?? "ACTIFS";
  const communs: Prisma.LeadWhereInput[] = [filtres.source ? { source: filtres.source } : {}, whereRecherche(filtres.recherche)];
  const [leads, actifs, aAppeler, sansSuite, archives, sources] = await Promise.all([
    prisma.lead.findMany({ where: { AND: [...communs, whereVue(vue, maintenant)] }, include: inclusion, orderBy: vue === "ARCHIVES" ? { archiveLe: "desc" } : { createdAt: "desc" }, take: Math.min(filtres.limite ?? 300, 500) }),
    prisma.lead.count({ where: whereVue("ACTIFS", maintenant) }),
    prisma.lead.count({ where: whereAAppeler(maintenant) }),
    prisma.lead.count({ where: whereVue("SANS_SUITE", maintenant) }),
    prisma.lead.count({ where: whereVue("ARCHIVES", maintenant) }),
    prisma.lead.groupBy({ by: ["source"], where: whereVue("ACTIFS", maintenant), _count: { _all: true } }),
  ]);
  return {
    lignes: await avecDoublons(leads.map((lead) => versLigne(lead, maintenant))),
    compteurs: { actifs, aAppeler, sansSuite, archives },
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
