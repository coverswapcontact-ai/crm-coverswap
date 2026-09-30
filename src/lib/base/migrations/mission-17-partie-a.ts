import { createHash } from "node:crypto";
import type { TacheAFaire } from "@prisma/client";
import type { Detecteur } from "@/lib/a-faire/detecteurs/types";
import { cleTache } from "@/lib/a-faire/detecteurs/types";
import type { ConditionManuelle } from "@/lib/a-faire/detecteurs/manuelles";
import { etatDe, type EtatReponse, type Precedent } from "@/lib/a-faire/etat";
import { DUREES_DEPART, type NiveauTache, type Raccourci, type ReponseTache, type StatutTache, type TypeTache } from "@/lib/a-faire/types";
import { cleNom } from "@/lib/clients/normalisation";
import { aHeureParis } from "@/lib/commercial/quand";
import { estDossierClos } from "@/lib/dossiers/constants";
import { dateDepuisJour, jourParis } from "@/lib/dossiers/dates";
import { avecActeur } from "@/lib/journal/contexte";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import type { BaseDonnees } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Mission 17 (partie A) — mise en route des tâches de Lucas (docs/TACHES.md § 6). La sauvegarde est faite par
 * `executerMigrationsDonnees` avant toute migration. Dans l'ordre :
 *
 * 1. Première passe complète des détecteurs (`passeComplete`) : les tâches existent, les anciens leads « contactés sans
 *    suite » arrivent d'eux-mêmes dans le lot « anciens-leads » (détecteur des leads). Un échec ne bloque pas le
 *    démarrage (compteur `passeEchouee`).
 * 2. Les décisions de Lucas du 29/09, sur quatre sujets retrouvés PAR EMPREINTE du nom normalisé (sha256 de `cleNom`,
 *    16 premiers caractères hexadécimaux ; nom complet ou nom de famille seul) — jamais par un nom écrit ici : le dépôt
 *    est public. Candidats : fiches client (nom, prénom + nom de famille ; ni fusionnées, ni anonymisées, ni
 *    archivées), leads (prénom + nom ; non archivés), dossiers (nom du client ; non archivés, non clos), et ce qui leur
 *    est rattaché. Un garde-fou propre à chaque décision ; on n'agit que sur UN seul candidat net, sinon « ambigu » ou
 *    « introuvable » (et une ligne `console.info` en initiales). Une tâche absente est créée directement au bon statut.
 *    - J. R. : son dossier vivant dont la prochaine action parle du visuel → prochaine action « Attendre sa modification
 *      visuelle » dans 7 jours, posée au nom de Lucas (`modifierDossier` → `noterProchaineActionManuelle`, qui
 *      n'accepte qu'une personne ou Claude) ; ses tâches ouvertes « Plus tard » dans 7 jours (ATTEND_CLIENT) ; ses fils
 *      de mails à traiter archivés (un nouveau mail rouvre le fil) ; main recalculée.
 *    - L. B. : la tâche SIMULATION de son dossier « Pas à faire » (CLIENT_LE_FAIT) ; prochaine action « Attendre sa
 *      simulation (elle la fait elle-même) », sans date (la main passe à la cliente).
 *    - C. M. : son lead reçoit `dernierContactLe` à la date de son mail du 29/09 (le dernier mail sortant rattaché ce
 *      jour-là, sinon le 29/09 à 12 h, Paris) — elle passe dans « À rappeler » ; sa tâche APPELER « Fait ».
 *    - FLD Tech : la tâche DATE_CHANTIER de son dossier « Fait » (« réglé (Lucas, 29/09) »).
 * 3. Une tâche MANUELLE par point restant des missions 15 et 16 (lot « reprise »), clé stable `MANUELLE:reprise-<slug>`,
 *    avec sa condition d'achèvement quand elle existe (detecteurs/manuelles.ts) ; pas de tâche manuelle quand une tâche
 *    SYSTEME couvre déjà le point (jeton Meta, crédit OpenAI, API Google Calendar).
 * 4. Une passe de clôture : la liste est à jour dès le démarrage (les décisions ont changé des contacts et des dossiers),
 *    et une seconde exécution de la migration ne trouve plus rien à créer.
 *
 * Les réponses sont écrites comme le cœur les écrit (reponses.ts › enregistrerReponse : état d'avant rangé pour
 * « Annuler ») mais SANS effet en file : ce qu'elles impliquent (fils archivés, contact noté) est fait ici directement.
 * `reponduPar` = l'acteur de la migration. Rejouable sans effet : tout ce qui est déjà fait est reconnu et laissé.
 * Base vide (base neuve, essais) : rien du tout — ni passe, ni tâche manuelle.
 */

export const NOM_MIGRATION_17_A = "taches-a-faire-17-a";
export const ACTEUR_MIGRATION_17_A = `MIGRATION:${NOM_MIGRATION_17_A}`;
/** Les décisions sont celles de Lucas : la prochaine action manuelle ne se retient qu'au nom d'une personne (ou de Claude). */
const LUCAS_29_09 = { acteur: "HUMAIN:lucas (29/09)", origine: `migration ${NOM_MIGRATION_17_A} (décisions du 29/09)` };
const JOUR_DES_DECISIONS = "2026-09-29";

/* ── Empreintes ───────────────────────────────────────────────────────── */

/** L'empreinte d'un nom : sha256 du nom normalisé (`cleNom` : sans accents ni ponctuation, mots triés), 16 caractères. */
export function empreinteNom(nom: string): string {
  return createHash("sha256").update(cleNom(nom)).digest("hex").slice(0, 16);
}

export const DECISIONS_29_09 = ["jr", "lb", "cm", "fldTech"] as const;
export type CleDecision = (typeof DECISIONS_29_09)[number];
/** Pour chaque décision : les initiales (journaux) et les empreintes acceptées (nom complet, nom de famille seul). */
export type Empreintes = Partial<Record<CleDecision, { initiales: string; empreintes: readonly string[] }>>;

/** Les sujets des décisions du 29/09 : aucune personne n'est nommée ici (nom complet, puis nom de famille seul). */
export const EMPREINTES_29_09: Required<Empreintes> = {
  jr: { initiales: "J. R.", empreintes: ["8fd3fd59f33a3bde", "f4561cc1d41b5682"] },
  lb: { initiales: "L. B.", empreintes: ["0e0015ce7581f88b", "3714790c41ca04bb"] },
  cm: { initiales: "C. M.", empreintes: ["710878edbfbb23f1", "da7bbf91170b5c37"] },
  // Une entreprise (donneur d'ordre) : son nom peut s'écrire.
  fldTech: { initiales: "FLD Tech", empreintes: [empreinteNom("FLD Tech"), empreinteNom("FLDTech")] },
};

export const TEXTE_JR = "Attendre sa modification visuelle";
export const TEXTE_LB = "Attendre sa simulation (elle la fait elle-même)";
const RAISON_JR = "J'attends sa modification visuelle";
const RAISON_LB = "elle fait sa simulation elle-même";
const RAISON_CM = "contactée par mail le 29/09";
const RAISON_FLD = "réglé (Lucas, 29/09)";
/** Garde-fou de J. R. : sa prochaine action parle déjà du visuel. */
const PARLE_DU_VISUEL = /modif.*visuel|visuel/i;

/* ── Points restants des missions 15 et 16 ────────────────────────────── */

export const LOT_REPRISE = { cle: "reprise", libelle: "point restant des missions 15 et 16|points restants des missions 15 et 16" };

export type PointReprise = { slug: string; titre: string; raison: string; condition?: ConditionManuelle; couvertPar?: string; href?: string };

const SYSTEME = (code: string) => cleTache("SYSTEME", { type: "SYSTEME", id: null }, code);

/** docs/REPRISE-MISSION.md (rapports finals des missions 15 et 16, compléments de la mission 14), plus le connecteur Claude. */
export const POINTS_REPRISE: readonly PointReprise[] = [
  { slug: "banc-comparaison", titre: "Lancer le banc de comparaison", raison: "mission 15 · environ 6,82 $ (jusqu'à 12,08 $)", condition: "BANC_LANCE", href: "/simulateur/banc" },
  { slug: "simulateur-v2", titre: "Passer le simulateur en V2", raison: "mission 15 · si le studio gagne au banc (paramètre SIMULATEUR_MOTEUR)", condition: "SIMULATEUR_V2", href: "/parametres#simulateur" },
  { slug: "photos-cartes-pieces", titre: "Fournir les photos des cartes de pièces", raison: "mission 15 · photos de réalisation des cinq cartes de pièces" },
  { slug: "cle-turnstile", titre: "Poser la clé Turnstile", raison: "mission 15 · captcha inactif en production" },
  { slug: "effacement-images-banc", titre: "Confirmer l'effacement des images du banc", raison: "mission 15 · effacement à 30 jours" },
  { slug: "simulateur-iphone", titre: "Essayer le simulateur sur iPhone", raison: "mission 15 · HEIC, pincer-zoom, appareil photo, zone sûre" },
  { slug: "api-google-calendar", titre: "Activer l'API Google Calendar", raison: "mission 15 · Google Cloud → API et services, puis « Reconnecter » dans Paramètres → Connexions", condition: "CALENDAR_ACTIVE", couvertPar: SYSTEME("google-api-agenda"), href: "/parametres#connexions" },
  { slug: "connecteur-claude", titre: "Reconnecter le connecteur Claude", raison: "nouvelle liste d'outils (mission 17)" },
  { slug: "jeton-meta", titre: "Renouveler le jeton Meta", raison: "mission 15 · conversions refusées (code 190) depuis le 28/09", condition: "JETON_META", couvertPar: SYSTEME("jeton-meta") },
  { slug: "depots-prives", titre: "Passer les dépôts en privé", raison: "mission 15 · et purger l'historique" },
  { slug: "regles-avis-google", titre: "Valider les règles des avis Google", raison: "mission 16 · attribution, copie de 24 h : à trancher avant de poser les clés" },
  { slug: "cles-avis-google", titre: "Poser les clés des avis Google", raison: "mission 16 · GOOGLE_PLACES_API_KEY et GOOGLE_PLACE_ID sur Railway", condition: "AVIS_GOOGLE" },
  { slug: "tarifs-metrage", titre: "Compléter les tarifs au métrage", raison: "mission 16 · seules les façades de cuisine ont un prix (110 €/ml)", condition: "TARIFS_COMPLETS" },
  { slug: "deplacement-faq", titre: "Accorder « Déplacement compris » avec la FAQ", raison: "mission 16 · frais hors zone" },
  { slug: "etudes-de-cas", titre: "Rédiger les études de cas", raison: "mission 16 · textes et photos, publication « Réalisation » depuis le CRM avec accord", condition: "REALISATION_PUBLIEE" },
  { slug: "images-ancienne-racine", titre: "Trancher l'origine des trois images", raison: "mission 16 · ancienne racine du dépôt du site" },
  { slug: "variables-vercel", titre: "Retirer les variables de suivi de Vercel", raison: "mission 16 · GTM, GA, pixel Meta et Clarity (NEXT_PUBLIC_…)" },
  { slug: "vercel-analytics-gtm", titre: "Désactiver Vercel Analytics et GTM", raison: "mission 16 · et le conteneur GTM" },
  { slug: "utm-meta", titre: "Ajouter utm_source=meta aux publicités", raison: "mission 16 · liens des publicités Meta" },
  { slug: "politique-confidentialite", titre: "Relire la politique de confidentialité", raison: "mission 16" },
  { slug: "conversions-meta", titre: "Décider l'envoi des conversions Meta", raison: "mission 16 · toutes les demandes, ou seulement celles venues de Meta" },
  { slug: "conservation-visites", titre: "Fixer la conservation des visites du site", raison: "mission 16 · les visites (EvenementSite) ne sont jamais purgées" },
  { slug: "solde-openai", titre: "Noter le solde OpenAI", raison: "mission 16 · Paramètres → Simulateur (crédit OpenAI)", condition: "SOLDE_OPENAI_NOTE", couvertPar: SYSTEME("credit-openai"), href: "/parametres#simulateur" },
  { slug: "espace-pret", titre: "Vérifier « Votre espace est prêt »", raison: "mission 16 · sur la première vraie demande du site" },
  { slug: "regeneration-lien-espace", titre: "Trancher la régénération du lien d'espace", raison: "mission 14 · au premier envoi du lien" },
  { slug: "secret-webhook", titre: "Faire tourner le secret webhook", raison: "mission 14" },
  { slug: "appel-iphone", titre: "Vivre un vrai appel sur iPhone", raison: "mission 14 · application à jour installée, appel de bout en bout" },
  { slug: "fonds-unsplash", titre: "Retirer les fonds Unsplash", raison: "mission 16 · pages par pièce, si voulu" },
];

export const cleReprise = (slug: string) => `MANUELLE:reprise-${slug}`;

/* ── Compteurs ────────────────────────────────────────────────────────── */

export type CompteursMiseEnRoute = {
  /** Décisions du 29/09 appliquées (0 ou 1 chacune ; 0 si déjà faite). */
  jr: number;
  lb: number;
  cm: number;
  fldTech: number;
  ambigus: number;
  introuvables: number;
  decisionsEchouees: number;
  /** Tâches créées : par les passes, et par les décisions (tâche absente créée au bon statut). */
  tachesCreees: number;
  /** Nouvelles tâches du lot « anciens-leads ». */
  anciensLeads: number;
  /** Fils de mails archivés (J. R.). */
  filsArchives: number;
  manuelles: number;
  passeEchouee: number;
};

const zero = (): CompteursMiseEnRoute => ({ jr: 0, lb: 0, cm: 0, fldTech: 0, ambigus: 0, introuvables: 0, decisionsEchouees: 0, tachesCreees: 0, anciensLeads: 0, filsArchives: 0, manuelles: 0, passeEchouee: 0 });

export type OptionsMiseEnRoute = {
  maintenant?: Date;
  empreintes?: Empreintes;
  /** Remplace la liste des détecteurs des passes (essais). */
  detecteurs?: readonly Detecteur[];
};

const journal = (texte: string) => console.info(`[migration ${NOM_MIGRATION_17_A}] ${texte}`);

/* ── Les candidats ────────────────────────────────────────────────────── */

type ClientLu = { id: string; cles: string[] };
type LeadLu = { id: string; clientId: string | null; statut: string; dernierContactLe: Date | null; cles: string[] };
type DossierLu = { id: string; clientId: string | null; leadId: string | null; clientNom: string; etape: string; prochaineAction: string | null; prochaineActionManuelle: string | null; dateChantier: Date | null; cles: string[] };
type Index = { clients: ClientLu[]; leads: LeadLu[]; dossiers: DossierLu[] };

const empreintesDe = (...noms: (string | null | undefined)[]): string[] => [...new Set(noms.filter((n): n is string => Boolean(n && cleNom(n))).map(empreinteNom))];

/** Les candidats, lus une fois : fiches client (ni fusionnées, ni anonymisées, ni archivées), leads et dossiers vivants. */
async function lireIndex(client: BaseDonnees): Promise<Index> {
  const [clients, exclus, leads, dossiers] = await Promise.all([
    client.client.findMany({ where: { fusionneDansId: null, anonymiseLe: null }, select: { id: true, nom: true, prenom: true, nomFamille: true } }),
    client.client.findMany({ where: { ...AVEC_ARCHIVES, OR: [{ fusionneDansId: { not: null } }, { anonymiseLe: { not: null } }, { archiveLe: { not: null } }] }, select: { id: true } }),
    client.lead.findMany({ select: { id: true, prenom: true, nom: true, clientId: true, statut: true, dernierContactLe: true } }),
    client.dossier.findMany({ select: { id: true, clientId: true, leadId: true, clientNom: true, etape: true, prochaineAction: true, prochaineActionManuelle: true, dateChantier: true } }),
  ]);
  const horsJeu = new Set(exclus.map((c) => c.id));
  return {
    clients: clients.map((c) => ({ id: c.id, cles: empreintesDe(c.nom, [c.prenom, c.nomFamille].filter(Boolean).join(" ")) })),
    leads: leads.filter((l) => !(l.clientId && horsJeu.has(l.clientId))).map((l) => ({ id: l.id, clientId: l.clientId, statut: l.statut, dernierContactLe: l.dernierContactLe, cles: empreintesDe(`${l.prenom} ${l.nom}`) })),
    dossiers: dossiers.filter((d) => !estDossierClos(d.etape) && !(d.clientId && horsJeu.has(d.clientId))).map((d) => ({ ...d, cles: empreintesDe(d.clientNom) })),
  };
}

type Personne = { leads: LeadLu[]; dossiers: DossierLu[] };

/** Ce qui porte l'une des empreintes, et ce qui y est rattaché (dossiers et leads des fiches, lead d'un dossier). */
function retrouver(index: Index, empreintes: readonly string[]): Personne {
  const voulues = new Set(empreintes);
  const porte = (x: { cles: string[] }) => x.cles.some((c) => voulues.has(c));
  const clientIds = new Set(index.clients.filter(porte).map((c) => c.id));
  const leadsDirects = new Set(index.leads.filter(porte).map((l) => l.id));
  const dossiers = index.dossiers.filter((d) => porte(d) || (d.clientId && clientIds.has(d.clientId)) || (d.leadId && leadsDirects.has(d.leadId)));
  const leadsDesDossiers = new Set(dossiers.map((d) => d.leadId).filter(Boolean));
  const leads = index.leads.filter((l) => leadsDirects.has(l.id) || (l.clientId && clientIds.has(l.clientId)) || leadsDesDossiers.has(l.id));
  return { leads, dossiers };
}

type Choix<T> = { un: T } | { ambigu: number } | { introuvable: true };

/** Le premier palier qui retient quelqu'un décide : un seul → lui ; plusieurs → ambigu. Aucun → introuvable. */
function choisir<T>(candidats: readonly T[], paliers: readonly ((x: T) => boolean)[]): Choix<T> {
  for (const palier of paliers) {
    const retenus = candidats.filter(palier);
    if (retenus.length === 1) return { un: retenus[0] };
    if (retenus.length > 1) return { ambigu: retenus.length };
  }
  return { introuvable: true };
}

/* ── Écrire une réponse (comme le cœur, sans effet en file) ───────────── */

type Reponse = { statut: Exclude<StatutTache, "A_FAIRE">; reponse: ReponseTache; raison: string | null; texte: string; jusqua?: Date | null };

const ETAT_A_FAIRE: EtatReponse = { statut: "A_FAIRE", reponse: null, reponseRaison: null, reponseTexte: null, reponduLe: null, reponduPar: null, plusTardJusqua: null, revenueLe: null, dureeReelleSec: null };

function colonnesReponse(r: Reponse, avant: EtatReponse, maintenant: Date) {
  const precedent: Precedent = { avant, reponse: r.reponse, le: maintenant.toISOString(), effet: null };
  return { statut: r.statut, reponse: r.reponse, reponseRaison: r.raison, reponseTexte: r.texte, reponduLe: maintenant, reponduPar: ACTEUR_MIGRATION_17_A, plusTardJusqua: r.jusqua ?? null, revenueLe: null, precedent: JSON.stringify(precedent) };
}

/** Écrit la réponse sur la ligne telle qu'elle a été lue (un passage concurrent l'emporte). Rend vrai si écrite. */
async function repondre(client: BaseDonnees, t: TacheAFaire, r: Reponse, maintenant: Date): Promise<boolean> {
  const { count } = await client.tacheAFaire.updateMany({ where: { id: t.id, updatedAt: t.updatedAt }, data: colonnesReponse(r, etatDe(t), maintenant) });
  return count === 1;
}

/** Déjà répondue par une personne, Claude ou la migration (pas une coche du CRM) : la réponse tient. */
const repondueALaMain = (t: TacheAFaire) => (t.statut === "FAITE" || t.statut === "PAS_A_FAIRE") && Boolean(t.reponduPar) && !t.reponduPar!.startsWith("SYSTEME:");

type NouvelleTache = { type: TypeTache; source: "DOSSIERS" | "LEADS"; sujet: { type: "DOSSIER" | "LEAD"; id: string }; dossierId: string | null; leadId: string | null; clientId: string | null; titre: string; raison: string; niveau: NiveauTache; raccourci: Raccourci };

/** Une tâche que la passe n'a pas vue, créée directement au statut de la décision (clé du détecteur : pas de doublon). */
async function creerAuStatut(client: BaseDonnees, n: NouvelleTache, r: Reponse, maintenant: Date): Promise<boolean> {
  try {
    await client.tacheAFaire.create({
      data: {
        cle: cleTache(n.type, n.sujet),
        type: n.type,
        source: n.source,
        sujetType: n.sujet.type,
        sujetId: n.sujet.id,
        leadId: n.leadId,
        dossierId: n.dossierId,
        clientId: n.clientId,
        titre: n.titre,
        raison: n.raison,
        niveau: n.niveau,
        montant: null,
        depuis: maintenant,
        dureeMin: DUREES_DEPART[n.type],
        raccourci: JSON.stringify(n.raccourci),
        donnees: "{}",
        detecteLe: maintenant,
        ...colonnesReponse(r, ETAT_A_FAIRE, maintenant),
      },
    });
    return true;
  } catch (erreur) {
    if ((erreur as { code?: string }).code === "P2002") return false;
    throw erreur;
  }
}

type Issue = { appliquee: boolean; creees: number; fils: number } | { ambigu: number } | { introuvable: true };
const rien = { appliquee: false, creees: 0, fils: 0 };

const nomDuDossier = (d: DossierLu) => d.clientNom.replace(/\s+/g, " ").trim() || "client sans nom";

/** Pose la prochaine action au nom de Lucas (dossiers.ts › modifierDossier → noterProchaineActionManuelle). Rend vrai si changée. */
async function poserProchaineAction(d: DossierLu, texte: string, jour: string | null, maintenant: Date): Promise<boolean> {
  if (d.prochaineAction === texte && d.prochaineActionManuelle === texte) return false;
  const { modifierDossier, schemaModification } = await import("@/lib/dossiers/dossiers");
  const { noterProchaineActionManuelle } = await import("@/lib/dossiers/prochaine-action-manuelle");
  await avecActeur(LUCAS_29_09, async () => {
    if (d.prochaineAction !== texte) await modifierDossier(d.id, schemaModification.parse({ prochaineAction: texte, prochaineActionDate: jour }));
    // Le texte était déjà là sans être retenu comme manuel : noterProchaineActionManuelle ne voit pas de changement.
    else await noterProchaineActionManuelle(d.id, { action: texte, avant: null, date: jour ? dateDepuisJour(jour) : null }, maintenant);
  });
  return true;
}

/* ── Les quatre décisions ─────────────────────────────────────────────── */

async function decisionJR(client: BaseDonnees, p: Personne, maintenant: Date): Promise<Issue> {
  const choix = choisir(p.dossiers, [(d) => PARLE_DU_VISUEL.test(d.prochaineAction ?? "")]);
  if (!("un" in choix)) return choix;
  const d = choix.un;
  const { jusquaPlusTard } = await import("@/lib/a-faire/reponses");
  const jusqua = jusquaPlusTard({ quand: "SEMAINE" }, maintenant);
  let change = await poserProchaineAction(d, TEXTE_JR, jourParis(aHeureParis(maintenant, 7, 12)), maintenant);

  // Ses tâches ouvertes : celles du dossier, et celles de sa fiche ou de son lead qui ne visent aucun dossier.
  const personnels = [...(d.leadId ? [{ leadId: d.leadId }] : []), ...(d.clientId ? [{ clientId: d.clientId }] : [])];
  const ouvertes = await client.tacheAFaire.findMany({
    where: { statut: { in: ["A_FAIRE", "PLUS_TARD"] }, type: { not: "SYSTEME" }, OR: [{ dossierId: d.id }, ...personnels.map((lien) => ({ dossierId: null, ...lien }))] },
  });
  for (const t of ouvertes) {
    if (t.statut === "PLUS_TARD" && t.reponduPar === ACTEUR_MIGRATION_17_A && t.reponseRaison === "ATTEND_CLIENT") continue;
    if (await repondre(client, t, { statut: "PLUS_TARD", reponse: "PLUS_TARD", raison: "ATTEND_CLIENT", texte: RAISON_JR, jusqua }, maintenant)) change = true;
  }

  // Ses fils de mails à traiter : archivés (plus rien à traiter tant qu'il ne réécrit pas ; un nouveau mail rouvre le fil).
  const messages = await client.message.findMany({
    where: { canal: "EMAIL", traiteLe: null, rangeLe: null, OR: [{ dossierId: d.id }, ...personnels] },
    orderBy: { recuLe: "asc" },
    select: { id: true, filCanal: true },
  });
  const parFil = new Map<string, string>();
  for (const m of messages) if (!parFil.has(m.filCanal ?? m.id)) parFil.set(m.filCanal ?? m.id, m.id);
  if (parFil.size) {
    const { archiverFil } = await import("@/lib/mail/boite");
    for (const messageId of parFil.values()) await archiverFil(messageId);
    change = true;
  }
  if (change) await (await import("@/lib/dossiers/main")).recalculerMain(d.id);
  return { appliquee: change, creees: 0, fils: parFil.size };
}

async function tacheDe(client: BaseDonnees, type: TypeTache, sujet: { type: "DOSSIER" | "LEAD"; id: string }) {
  return client.tacheAFaire.findUnique({ where: { cle: cleTache(type, sujet) } });
}

/** La tâche de la décision : répondue si elle est ouverte (ou cochée par le CRM), créée au bon statut si elle manque. */
async function deciderTache(client: BaseDonnees, n: NouvelleTache, r: Reponse, maintenant: Date, creerSiAbsente = true): Promise<{ change: boolean; creee: boolean }> {
  const t = await tacheDe(client, n.type, n.sujet);
  if (t) {
    if (t.archiveLe || repondueALaMain(t)) return { change: false, creee: false };
    return { change: await repondre(client, t, r, maintenant), creee: false };
  }
  if (!creerSiAbsente) return { change: false, creee: false };
  const creee = await creerAuStatut(client, n, r, maintenant);
  return { change: creee, creee };
}

async function decisionLB(client: BaseDonnees, p: Personne, maintenant: Date): Promise<Issue> {
  const simulations = new Map<string, TacheAFaire | null>();
  for (const d of p.dossiers) simulations.set(d.id, await tacheDe(client, "SIMULATION", { type: "DOSSIER", id: d.id }));
  const ouverte = (d: DossierLu) => ["A_FAIRE", "PLUS_TARD"].includes(simulations.get(d.id)?.statut ?? "");
  const choix = choisir(p.dossiers, [(d) => ouverte(d) || d.prochaineActionManuelle === TEXTE_LB, (d) => d.etape === "QUALIFICATION" || d.etape === "SIMULATION"]);
  if (!("un" in choix)) return choix;
  const d = choix.un;
  const nom = nomDuDossier(d);
  const { change, creee } = await deciderTache(
    client,
    { type: "SIMULATION", source: "DOSSIERS", sujet: { type: "DOSSIER", id: d.id }, dossierId: d.id, leadId: d.leadId, clientId: d.clientId, titre: `Préparer la simulation · ${nom}`, raison: "décision du 29/09", niveau: 3, raccourci: { genre: "SIMULATEUR", libelle: "Préparer la simulation", dossierId: d.id, href: `/simulateur?dossier=${d.id}` } },
    { statut: "PAS_A_FAIRE", reponse: "PAS_A_FAIRE", raison: "CLIENT_LE_FAIT", texte: RAISON_LB },
    maintenant
  );
  const pose = await poserProchaineAction(d, TEXTE_LB, null, maintenant);
  if (change || pose) await (await import("@/lib/dossiers/main")).recalculerMain(d.id);
  return { appliquee: change || pose, creees: creee ? 1 : 0, fils: 0 };
}

async function decisionCM(client: BaseDonnees, p: Personne, maintenant: Date): Promise<Issue> {
  const appels = new Map<string, TacheAFaire | null>();
  for (const l of p.leads) appels.set(l.id, await tacheDe(client, "APPELER", { type: "LEAD", id: l.id }));
  const choix = choisir(
    p.leads.filter((l) => l.statut !== "PERDU"),
    [(l) => Boolean(appels.get(l.id)), () => true]
  );
  if (!("un" in choix)) return choix;
  const l = choix.un;
  // La date de son mail du 29/09 : le dernier mail sortant rattaché ce jour-là (heure de Paris), sinon 12 h.
  const jour = dateDepuisJour(JOUR_DES_DECISIONS);
  const dossiers = p.dossiers.filter((d) => d.leadId === l.id).map((d) => d.id);
  const mail = await client.message.findFirst({
    where: {
      sens: "SORTANT",
      canal: "EMAIL",
      recuLe: { gte: aHeureParis(jour, 0, 0), lt: aHeureParis(jour, 1, 0) },
      OR: [{ leadId: l.id }, ...(l.clientId ? [{ clientId: l.clientId }] : []), ...(dossiers.length ? [{ dossierId: { in: dossiers } }] : [])],
    },
    orderBy: { recuLe: "desc" },
    select: { recuLe: true },
  });
  const le = mail?.recuLe ?? aHeureParis(jour, 0, 12);
  const { retenirContactEcrit } = await import("@/lib/prospects/contact-ecrit");
  const contact = await retenirContactEcrit(l.id, le, client);
  const sansDossier = !(await client.dossier.findFirst({ where: { leadId: l.id }, select: { id: true } }));
  const lead = await client.lead.findUniqueOrThrow({ where: { id: l.id }, select: { prenom: true, nom: true, telephone: true } });
  const nom = `${lead.prenom} ${lead.nom}`.replace(/\s+/g, " ").trim() || "contact sans nom";
  const { change, creee } = await deciderTache(
    client,
    { type: "APPELER", source: "LEADS", sujet: { type: "LEAD", id: l.id }, dossierId: null, leadId: l.id, clientId: l.clientId, titre: `Appeler · ${nom}`, raison: "décision du 29/09", niveau: 3, raccourci: { genre: "APPEL", libelle: "Appeler", telephone: lead.telephone, leadId: l.id, href: lead.telephone ? `tel:${lead.telephone}` : null } },
    { statut: "FAITE", reponse: "FAIT", raison: null, texte: RAISON_CM },
    maintenant,
    // « Appeler » ne vise qu'un contact sans dossier (détecteur des leads) : pas de tâche créée pour un lead qui en a un.
    sansDossier
  );
  return { appliquee: contact || change, creees: creee ? 1 : 0, fils: 0 };
}

async function decisionFLD(client: BaseDonnees, p: Personne, maintenant: Date): Promise<Issue> {
  const dates = new Map<string, TacheAFaire | null>();
  for (const d of p.dossiers) dates.set(d.id, await tacheDe(client, "DATE_CHANTIER", { type: "DOSSIER", id: d.id }));
  const vue = (d: DossierLu) => {
    const t = dates.get(d.id);
    return Boolean(t && (["A_FAIRE", "PLUS_TARD"].includes(t.statut) || (t.reponduPar === ACTEUR_MIGRATION_17_A && t.reponseTexte === RAISON_FLD)));
  };
  const choix = choisir(p.dossiers, [vue, (d) => d.etape === "SIGNE" && !d.dateChantier]);
  if (!("un" in choix)) return choix;
  const d = choix.un;
  const { change, creee } = await deciderTache(
    client,
    { type: "DATE_CHANTIER", source: "DOSSIERS", sujet: { type: "DOSSIER", id: d.id }, dossierId: d.id, leadId: d.leadId, clientId: d.clientId, titre: `Fixer la date du chantier · ${nomDuDossier(d)}`, raison: "décision du 29/09", niveau: 1, raccourci: { genre: "PLANIFIER", libelle: "Fixer la date", dossierId: d.id, href: `/dossiers?dossier=${d.id}` } },
    { statut: "FAITE", reponse: "FAIT", raison: null, texte: RAISON_FLD },
    maintenant
  );
  return { appliquee: change, creees: creee ? 1 : 0, fils: 0 };
}

const DECISIONS: Record<CleDecision, (client: BaseDonnees, p: Personne, maintenant: Date) => Promise<Issue>> = { jr: decisionJR, lb: decisionLB, cm: decisionCM, fldTech: decisionFLD };

/* ── Tâches manuelles de la reprise ───────────────────────────────────── */

async function creerManuelles(client: BaseDonnees, maintenant: Date): Promise<number> {
  let creees = 0;
  const couvertes: string[] = [];
  for (const point of POINTS_REPRISE) {
    const cle = cleReprise(point.slug);
    if (await client.tacheAFaire.findUnique({ where: { cle }, select: { id: true } })) continue;
    if (point.couvertPar) {
      const systeme = await client.tacheAFaire.findUnique({ where: { cle: point.couvertPar }, select: { archiveLe: true } });
      if (systeme && !systeme.archiveLe) {
        couvertes.push(point.slug);
        continue;
      }
    }
    const raccourci: Raccourci = point.href ? { genre: "PAGE", libelle: "Ouvrir", href: point.href } : { genre: "PAGE", libelle: "Faire", href: null };
    try {
      await client.tacheAFaire.create({
        data: {
          cle,
          type: "MANUELLE",
          source: "MANUELLE",
          sujetType: "SYSTEME",
          sujetId: null,
          titre: point.titre,
          raison: point.raison,
          niveau: 3,
          montant: null,
          depuis: maintenant,
          dureeMin: DUREES_DEPART.MANUELLE,
          raccourci: JSON.stringify(raccourci),
          donnees: JSON.stringify(point.condition ? { condition: { code: point.condition }, reprise: point.slug } : { reprise: point.slug }),
          lot: LOT_REPRISE.cle,
          lotLibelle: LOT_REPRISE.libelle,
          statut: "A_FAIRE",
          detecteLe: maintenant,
        },
      });
      creees++;
    } catch (erreur) {
      if ((erreur as { code?: string }).code !== "P2002") throw erreur;
    }
  }
  if (couvertes.length) journal(`points déjà couverts par une tâche du CRM (pas de tâche à moi) : ${couvertes.join(", ")}`);
  return creees;
}

/* ── La mise en route ─────────────────────────────────────────────────── */

async function passe(maintenant: Date, detecteurs: readonly Detecteur[] | undefined, quelle: string): Promise<{ ok: boolean; crees: number }> {
  try {
    const { passeComplete } = await import("@/lib/a-faire/detection");
    const bilan = await passeComplete(maintenant, detecteurs ? { detecteurs } : {});
    const echecs = bilan.sources.filter((s) => !s.couverte).map((s) => s.source);
    if (echecs.length) console.warn(`[migration ${NOM_MIGRATION_17_A}] ${quelle} : sources en échec (${echecs.join(", ")}), reprises au prochain passage`);
    return { ok: true, crees: bilan.reconciliation.crees };
  } catch (erreur) {
    console.error(`[migration ${NOM_MIGRATION_17_A}] ${quelle} en échec (le démarrage continue) :`, erreur);
    return { ok: false, crees: 0 };
  }
}

/** Base neuve (aucun contact, dossier ni fiche client, même archivés) : rien à mettre en route. */
async function baseVide(client: BaseDonnees): Promise<boolean> {
  const [lead, dossier, fiche] = await Promise.all([
    client.lead.findFirst({ where: AVEC_ARCHIVES, select: { id: true } }),
    client.dossier.findFirst({ where: AVEC_ARCHIVES, select: { id: true } }),
    client.client.findFirst({ where: AVEC_ARCHIVES, select: { id: true } }),
  ]);
  return !lead && !dossier && !fiche;
}

/**
 * La mise en route, avec la table des empreintes en paramètre (les essais la donnent pour des noms fictifs). Ne lève
 * pas pour une décision ou une passe en échec : c'est compté, et le démarrage continue.
 */
export async function miseEnRoute(client: BaseDonnees, options: OptionsMiseEnRoute = {}): Promise<CompteursMiseEnRoute> {
  const maintenant = options.maintenant ?? new Date();
  const empreintes = options.empreintes ?? EMPREINTES_29_09;
  const c = zero();
  if (await baseVide(client)) {
    journal("base vide : rien à mettre en route");
    return c;
  }
  const lotAnciens = () => client.tacheAFaire.count({ where: { lot: "anciens-leads" } });
  const anciensAvant = await lotAnciens();

  // 1. Première passe : les tâches existent avant les décisions.
  const premiere = await passe(maintenant, options.detecteurs, "première passe");
  c.tachesCreees += premiere.crees;
  if (!premiere.ok) c.passeEchouee++;

  // 2. Les décisions du 29/09, par empreinte.
  const index = await lireIndex(client);
  for (const cle of DECISIONS_29_09) {
    const sujet = empreintes[cle];
    if (!sujet) continue;
    try {
      const issue = await DECISIONS[cle](client, retrouver(index, sujet.empreintes), maintenant);
      if ("ambigu" in issue) {
        c.ambigus++;
        journal(`${sujet.initiales} : ${issue.ambigu} candidats, rien n'est fait (à régler à la main)`);
      } else if ("introuvable" in issue) {
        c.introuvables++;
        journal(`${sujet.initiales} : introuvable (ou garde-fou non tenu), rien n'est fait`);
      } else {
        c[cle] = issue.appliquee ? 1 : 0;
        c.tachesCreees += issue.creees;
        c.filsArchives += issue.fils;
        journal(`${sujet.initiales} : ${issue.appliquee ? "décision appliquée" : "déjà appliquée"}`);
      }
    } catch (erreur) {
      c.decisionsEchouees++;
      console.error(`[migration ${NOM_MIGRATION_17_A}] ${sujet.initiales} : décision en échec (le démarrage continue) :`, erreur);
    }
  }

  // 3. Les points restants des missions 15 et 16.
  c.manuelles = await creerManuelles(client, maintenant);

  // 4. Passe de clôture : la liste suit les décisions ; les conditions des tâches à moi déjà remplies sont cochées.
  const cloture = await passe(maintenant, options.detecteurs, "passe de clôture");
  c.tachesCreees += cloture.crees;
  if (!cloture.ok) c.passeEchouee++;

  c.anciensLeads = Math.max(0, (await lotAnciens()) - anciensAvant);
  journal(`${c.tachesCreees} tâches créées, dont ${c.anciensLeads} anciens leads en lot ; ${c.manuelles} tâches à moi (reprise)`);
  return c;
}

export const migrationTachesAFaire17A: MigrationDonnees = {
  nom: NOM_MIGRATION_17_A,
  description: "Tâches de Lucas : première passe des détecteurs, décisions du 29/09 (sujets retrouvés par empreinte), lot des anciens leads, tâches à moi des points restants des missions 15 et 16",
  executer: async (client) => ({ ...(await miseEnRoute(client)) }),
};
