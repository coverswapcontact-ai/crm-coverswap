import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { canauxConfigures } from "@/lib/alertes/canaux";
import { abonnementPage, lireEtatJeton } from "./graph";
import { etatConfiguration, type EtatConfiguration } from "./config";
import { TACHE_CONVERSION, verdictJeton, type VerdictJeton } from "./taches";
import { TACHE_LEAD } from "./leads";

/**
 * L'état de l'intégration Meta en un coup d'œil : le webhook reçoit-il, quand
 * est arrivé le dernier lead, combien sur sept jours, qu'est-ce qui a échoué,
 * où en sont le jeton et les conversions.
 *
 * Tout se lit en base sauf deux vérifications qui interrogent Meta (abonnement
 * de la page, état du jeton) ; elles sont facultatives et jamais bloquantes.
 */
const JOUR_MS = 24 * 60 * 60_000;

export type LeadEnEchec = {
  leadgenId: string;
  recuLe: string;
  soumisLe: string;
  erreur: string | null;
  tentatives: number;
  campagne: string | null;
};

export type ResultatParAxe = {
  /** Nom lisible ; l'identifiant quand Meta n'a pas rendu le nom. */
  nom: string;
  leads: number;
  contactes: number;
  devis: number;
  signes: number;
  perdus: number;
};

export type Resultats = {
  jours: number;
  depuis: string;
  leads: number;
  parCampagne: ResultatParAxe[];
  parPublicite: ResultatParAxe[];
};

export type SanteMeta = {
  configuration: EtatConfiguration;
  /** Canaux de notification actifs ; en dessous de deux, un seul point de défaillance. */
  notifications: { canaux: string[]; suffisant: boolean };
  webhook: {
    /** Un événement a-t-il été reçu ces sept derniers jours ? */
    actif: boolean;
    dernierLeadLe: string | null;
    dernierLeadNom: string | null;
    surSeptJours: number;
    surVingtQuatreHeures: number;
    total: number;
    abonnement: { abonne: boolean; champs: string[]; erreur?: string } | null;
  };
  echecs: { nombre: number; leads: LeadEnEchec[] };
  enAttente: number;
  jeton: VerdictJeton;
  conversions: { envoyees7j: number; enEchec: number; derniereLe: string | null };
  /** Résultats par campagne et par publicité sur la fenêtre demandée. */
  resultats: Resultats;
  /** Ce qui empêche encore la chaîne de fonctionner de bout en bout. */
  alertes: string[];
};

/** Durée d'observation par défaut : la longueur d'une campagne de Lucas. */
export const JOURS_RESULTATS = 21;

const APRES_DEVIS = new Set(["DEVIS_ENVOYE", "SIGNE", "CHANTIER_PLANIFIE", "TERMINE"]);
const SIGNES = new Set(["SIGNE", "CHANTIER_PLANIFIE", "TERMINE"]);
const CONTACTES = new Set(["CONTACTE", "DEVIS_DEMANDE", ...APRES_DEVIS]);

/** Leads Meta d'une fenêtre, regroupés par campagne puis par publicité. */
export async function resultatsMeta(jours = JOURS_RESULTATS): Promise<Resultats> {
  const depuis = new Date(Date.now() - jours * JOUR_MS);
  const lignes = await prisma.metaLead.findMany({
    where: { ...AVEC_ARCHIVES, soumisLe: { gte: depuis } },
    select: {
      campagneNom: true,
      campagneId: true,
      adNom: true,
      adId: true,
      lead: { select: { statut: true, archiveLe: true } },
    },
  });

  const regrouper = (cle: (l: (typeof lignes)[number]) => string): ResultatParAxe[] => {
    const par = new Map<string, ResultatParAxe>();
    for (const ligne of lignes) {
      const nom = cle(ligne);
      const axe = par.get(nom) ?? { nom, leads: 0, contactes: 0, devis: 0, signes: 0, perdus: 0 };
      axe.leads++;
      const statut = ligne.lead?.statut;
      if (statut && CONTACTES.has(statut)) axe.contactes++;
      if (statut && APRES_DEVIS.has(statut)) axe.devis++;
      if (statut && SIGNES.has(statut)) axe.signes++;
      if (statut === "PERDU") axe.perdus++;
      par.set(nom, axe);
    }
    return [...par.values()].sort((a, b) => b.leads - a.leads || a.nom.localeCompare(b.nom, "fr"));
  };

  return {
    jours,
    depuis: depuis.toISOString(),
    leads: lignes.length,
    parCampagne: regrouper((l) => l.campagneNom ?? l.campagneId ?? "Campagne inconnue"),
    parPublicite: regrouper((l) => l.adNom ?? l.adId ?? "Publicité inconnue"),
  };
}

export async function santeMeta(options: { interrogerMeta?: boolean; jours?: number } = {}): Promise<SanteMeta> {
  const interroger = options.interrogerMeta ?? true;
  const maintenant = Date.now();
  const septJours = new Date(maintenant - 7 * JOUR_MS);
  const vingtQuatre = new Date(maintenant - JOUR_MS);
  const configuration = etatConfiguration();

  const [dernier, surSeptJours, surVingtQuatreHeures, total, echecs, enAttente, conversions, conversionsEchec, derniereConversion] = await Promise.all([
    prisma.metaLead.findFirst({ where: AVEC_ARCHIVES, orderBy: { recuLe: "desc" }, include: { lead: { select: { prenom: true, nom: true, ville: true } } } }),
    prisma.metaLead.count({ where: { ...AVEC_ARCHIVES, recuLe: { gte: septJours } } }),
    prisma.metaLead.count({ where: { ...AVEC_ARCHIVES, recuLe: { gte: vingtQuatre } } }),
    prisma.metaLead.count({ where: AVEC_ARCHIVES }),
    prisma.metaLead.findMany({
      where: { ...AVEC_ARCHIVES, statut: { in: ["ECHEC", "RECU"] }, recuLe: { lt: new Date(maintenant - 5 * 60_000) } },
      orderBy: { recuLe: "desc" },
      take: 50,
      select: { leadgenId: true, recuLe: true, soumisLe: true, erreur: true, tentatives: true, campagneNom: true, campagneId: true },
    }),
    prisma.tache.count({ where: { type: TACHE_LEAD, statut: { in: ["EN_ATTENTE", "EN_COURS"] } } }),
    prisma.tache.count({ where: { type: TACHE_CONVERSION, statut: "TERMINEE", updatedAt: { gte: septJours } } }),
    prisma.tache.count({ where: { type: TACHE_CONVERSION, statut: "ECHEC_DEFINITIF" } }),
    prisma.tache.findFirst({ where: { type: TACHE_CONVERSION, statut: "TERMINEE" }, orderBy: { termineLe: "desc" }, select: { termineLe: true } }),
  ]);

  const [abonnement, jetonBrut] = interroger && configuration.lecture ? await Promise.all([abonnementPage(), lireEtatJeton()]) : [null, null];
  const jeton = verdictJeton(jetonBrut);
  const canaux = canauxConfigures();

  const alertes: string[] = [];
  if (!configuration.signature) alertes.push("META_APP_SECRET absente : le webhook refuse tous les appels de Meta.");
  if (!configuration.verification) alertes.push("META_VERIFY_TOKEN absente : Meta ne peut pas valider l'adresse du webhook.");
  if (!configuration.lecture) alertes.push("META_PAGE_ACCESS_TOKEN absente : les réponses des formulaires ne peuvent pas être lues.");
  if (!configuration.conversions) alertes.push("META_PIXEL_ID ou META_CONVERSIONS_TOKEN absente : les conversions ne repartent pas vers Meta.");
  if (canaux.length === 0) alertes.push("Aucun canal de notification : un lead qui arrive ne prévient personne.");
  else if (canaux.length < 2) alertes.push(`Un seul canal de notification (${canaux[0]}) : prévoir un second pour éviter le point de défaillance unique.`);
  if (abonnement && !abonnement.abonne) alertes.push("La page n'est pas abonnée au champ « leadgen » : Meta n'enverra rien.");
  if (jeton.etat === "proche" || jeton.etat === "expire" || jeton.etat === "invalide") alertes.push(jeton.message);
  if (echecs.length > 0) alertes.push(`${echecs.length} lead(s) reçus mais pas encore dans le CRM.`);

  return {
    configuration,
    notifications: { canaux, suffisant: canaux.length >= 2 },
    webhook: {
      actif: surSeptJours > 0,
      dernierLeadLe: dernier?.recuLe.toISOString() ?? null,
      dernierLeadNom: dernier?.lead ? `${dernier.lead.prenom} ${dernier.lead.nom}`.trim() : null,
      surSeptJours,
      surVingtQuatreHeures,
      total,
      abonnement,
    },
    echecs: {
      nombre: echecs.length,
      leads: echecs.map((e) => ({
        leadgenId: e.leadgenId,
        recuLe: e.recuLe.toISOString(),
        soumisLe: e.soumisLe.toISOString(),
        erreur: e.erreur,
        tentatives: e.tentatives,
        campagne: e.campagneNom ?? e.campagneId,
      })),
    },
    enAttente,
    jeton,
    conversions: { envoyees7j: conversions, enEchec: conversionsEchec, derniereLe: derniereConversion?.termineLe?.toISOString() ?? null },
    resultats: await resultatsMeta(options.jours ?? JOURS_RESULTATS),
    alertes,
  };
}
