import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { CANAUX, CANAUX_PUSH, canalConfigure, canauxConfigures, variablesManquantes, type Canal, type ResultatCanal } from "@/lib/alertes/canaux";
import { abonnementPage, lireEtatJeton } from "./graph";
import { etatConfiguration, type EtatConfiguration } from "./config";
import { TACHE_CONVERSION, faitsJeton, verdictJeton, type FaitsJeton, type VerdictJeton } from "./taches";
import { TACHE_LEAD } from "./leads";
import { pluriel } from "@/lib/commun/format";

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

/** État d'un canal d'alerte : configuré ou non, et ce qu'a donné le dernier envoi. */
export type EtatCanal = {
  canal: Canal;
  /** Vrai : ce canal fait sonner le téléphone (Telegram, ntfy). Le mail, non. */
  pousse: boolean;
  configure: boolean;
  /** Variables à poser sur Railway quand le canal manque. */
  manquantes: string[];
  dernier: { ok: boolean; detail: string | null; quand: string } | null;
};

export type NotificationsMeta = {
  /** Canaux configurés ; en dessous de deux, un seul point de défaillance. */
  canaux: string[];
  suffisant: boolean;
  /** Au moins un canal poussé est configuré. Faux = le téléphone ne sonnera pas. */
  push: boolean;
  etats: EtatCanal[];
  /** Leads récents pour lesquels aucune notification poussée n'est partie. */
  leadsSansPush: { leadgenId: string; quand: string; nom: string | null; detail: string }[];
};

/**
 * Mission 13 (B5) : l'état de la chaîne Meta en UNE phrase, la même partout
 * (Publicité, `sante_systeme`, `voir_publicite`), d'après les faits — ce qui est
 * entré, ce que Meta a refusé, ce qui manque — et non d'après ce que répond la
 * vérification du jeton (impossible sans META_APP_ID et META_APP_SECRET).
 */
export type EtatChaineMeta = {
  code: "COMPLETE" | "PARTIELLE" | "SILENCIEUSE" | "COUPEE";
  libelle: string;
  lectureImpossible: boolean;
  conversionsImpossibles: boolean;
  jetonARenouveler: boolean;
};

export function etatChaine(e: {
  recoit: "OUI" | "PRET" | "NON";
  recoitDetail: string;
  configuration: Pick<EtatConfiguration, "lecture" | "conversions">;
  jeton: Pick<VerdictJeton, "etat">;
  faits: Pick<FaitsJeton, "conversionsRefusees" | "leadsIllisibles">;
}): EtatChaineMeta {
  const jetonKO = e.jeton.etat === "invalide" || e.jeton.etat === "expire";
  const refus = e.faits.conversionsRefusees > 0 || e.faits.leadsIllisibles > 0;
  const lectureImpossible = !e.configuration.lecture || jetonKO || e.faits.leadsIllisibles > 0;
  const conversionsImpossibles = !e.configuration.conversions || jetonKO || e.faits.conversionsRefusees > 0;
  const jetonARenouveler = jetonKO || refus || e.jeton.etat === "proche";
  const cause = jetonARenouveler
    ? "jeton à renouveler"
    : [!e.configuration.lecture ? "META_PAGE_ACCESS_TOKEN absente" : null, !e.configuration.conversions ? "META_PIXEL_ID ou jeton de conversions absent" : null].filter(Boolean).join(", ");
  const manque = lectureImpossible && conversionsImpossibles ? `lecture des formulaires et conversions impossibles (${cause})` : lectureImpossible ? `lecture des formulaires impossible (${cause})` : conversionsImpossibles ? `conversions impossibles (${cause})` : "";
  const commun = { lectureImpossible, conversionsImpossibles, jetonARenouveler };
  if (e.recoit === "NON") return { code: "COUPEE", libelle: `Coupée : ${e.recoitDetail}`, ...commun };
  if (e.recoit === "PRET") return { code: "SILENCIEUSE", libelle: `Prête, silencieuse : configuration complète, aucun lead reçu sur 7 jours${manque ? ` ; ${manque}` : ""}.`, ...commun };
  if (!manque) return { code: "COMPLETE", libelle: "Complète : leads reçus par le webhook, formulaires lus, conversions renvoyées.", ...commun };
  return { code: "PARTIELLE", libelle: `Leads reçus par le webhook ; ${manque}.`, ...commun };
}

/** L'état de la chaîne et du jeton d'après la base seulement (aucun appel à Meta) : pour la santé du système. */
export async function resumeChaineMeta(maintenant: Date = new Date()): Promise<{ chaine: EtatChaineMeta; jeton: VerdictJeton; surSeptJours: number }> {
  const configuration = etatConfiguration();
  const septJours = new Date(maintenant.getTime() - 7 * JOUR_MS);
  const [surSeptJours, faits] = await Promise.all([prisma.metaLead.count({ where: { ...AVEC_ARCHIVES, recuLe: { gte: septJours } } }), faitsJeton(maintenant)]);
  const jeton = verdictJeton(null, maintenant, faits);
  const manques = [!configuration.signature ? "META_APP_SECRET absente" : null, !configuration.verification ? "META_VERIFY_TOKEN absente" : null].filter((m): m is string => m !== null);
  const recoit: "OUI" | "PRET" | "NON" = surSeptJours > 0 ? "OUI" : manques.length === 0 ? "PRET" : "NON";
  const recoitDetail = recoit === "OUI" ? `${pluriel(surSeptJours, "lead")} reçus sur 7 jours.` : recoit === "PRET" ? "Configuration complète ; aucun lead reçu sur 7 jours." : `Il manque : ${manques.join(", ")} — le webhook refuse ou ne peut pas être validé.`;
  return { chaine: etatChaine({ recoit, recoitDetail, configuration, jeton, faits }), jeton, surSeptJours };
}

export type SanteMeta = {
  /** Mission 13 : l'état en une phrase, le même partout. */
  chaine: EtatChaineMeta;
  configuration: EtatConfiguration;
  notifications: NotificationsMeta;
  webhook: {
    /** Un événement a-t-il été reçu ces sept derniers jours ? */
    actif: boolean;
    dernierLeadLe: string | null;
    dernierLeadNom: string | null;
    surSeptJours: number;
    surVingtQuatreHeures: number;
    total: number;
    abonnement: { abonne: boolean; champs: string[]; erreur?: string } | null;
    /** Mission 11 : le voyant honnête — OUI : des leads entrent (quoi que dise la vérification de l'abonnement) ; PRET : configuration complète, aucun lead sur 7 jours ; NON : il manque quelque chose. */
    recoit: "OUI" | "PRET" | "NON";
    recoitDetail: string;
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
  // Sans les archivés : un lead d'essai ou mis de côté ne doit pas peser sur le
  // jugement porté sur une campagne. Les compteurs de réception, eux, comptent tout.
  const lignes = await prisma.metaLead.findMany({
    where: { soumisLe: { gte: depuis } },
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

/**
 * L'état réel des canaux d'alerte : ce qui est configuré, et ce qu'a donné le
 * dernier envoi sur chacun. Un canal absent apparaît ici en toutes lettres avec
 * le nom des variables à poser — il ne disparaît pas silencieusement.
 */
export async function etatNotifications(jours = 7): Promise<NotificationsMeta> {
  const depuis = new Date(Date.now() - jours * JOUR_MS);
  // Sans les archivés : un lead d'essai mis de côté ne doit pas réclamer une
  // notification pour l'éternité.
  const recents = await prisma.metaLead.findMany({
    where: { recuLe: { gte: depuis }, statut: "TRAITE" },
    orderBy: { recuLe: "desc" },
    take: 100,
    select: { leadgenId: true, recuLe: true, notifications: true, pousseLe: true, lead: { select: { prenom: true, nom: true } } },
  });

  const lireResultats = (brut: string | null): ResultatCanal[] => {
    if (!brut) return [];
    try {
      const lu = JSON.parse(brut) as ResultatCanal[];
      return Array.isArray(lu) ? lu : [];
    } catch {
      return [];
    }
  };

  const etats: EtatCanal[] = CANAUX.map((canal) => {
    const configure = canalConfigure(canal);
    let dernier: EtatCanal["dernier"] = null;
    for (const ligne of recents) {
      const trouve = lireResultats(ligne.notifications).find((r) => r.canal === canal);
      if (trouve) {
        dernier = { ok: trouve.ok, detail: trouve.detail ?? null, quand: ligne.recuLe.toISOString() };
        break;
      }
    }
    return { canal, pousse: CANAUX_PUSH.includes(canal), configure, manquantes: variablesManquantes(canal), dernier };
  });

  // Un lead traité dont aucune notification poussée n'a abouti : le téléphone n'a
  // pas sonné. C'est exactement ce qui s'est produit les 20 et 21 septembre.
  const leadsSansPush = recents
    .filter((l) => !l.pousseLe)
    .slice(0, 20)
    .map((l) => {
      const resultats = lireResultats(l.notifications);
      const push = resultats.filter((r) => CANAUX_PUSH.includes(r.canal));
      return {
        leadgenId: l.leadgenId,
        quand: l.recuLe.toISOString(),
        nom: l.lead ? `${l.lead.prenom} ${l.lead.nom}`.trim() : null,
        detail:
          push.length === 0
            ? "aucun canal poussé n'a été tenté"
            : push.map((r) => `${r.canal} : ${r.detail ?? (r.ok ? "envoyée" : "échec")}`).join(" · "),
      };
    });

  const canaux = canauxConfigures();
  return {
    canaux,
    suffisant: canaux.length >= 2,
    push: CANAUX_PUSH.some((c) => canalConfigure(c)),
    etats,
    leadsSansPush,
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
  const faits = await faitsJeton(new Date(maintenant));
  const jeton = verdictJeton(jetonBrut, new Date(maintenant), faits);
  const notifications = await etatNotifications();
  const canaux = notifications.canaux;

  const alertes: string[] = [];
  if (!configuration.signature) alertes.push("META_APP_SECRET absente : le webhook refuse tous les appels de Meta.");
  if (!configuration.verification) alertes.push("META_VERIFY_TOKEN absente : Meta ne peut pas valider l'adresse du webhook.");
  if (!configuration.lecture) alertes.push("META_PAGE_ACCESS_TOKEN absente : les réponses des formulaires ne peuvent pas être lues.");
  if (!configuration.conversions) alertes.push("META_PIXEL_ID ou META_CONVERSIONS_TOKEN absente : les conversions ne repartent pas vers Meta.");
  if (canaux.length === 0) alertes.push("Aucun canal de notification : un lead qui arrive ne prévient personne.");
  else if (!notifications.push) {
    // Le cas vécu : RESEND_API_KEY posée, rien d'autre. Un mail ne fait pas sonner un téléphone.
    const aPoser = notifications.etats.filter((e) => e.pousse).flatMap((e) => e.manquantes);
    alertes.push(`Aucune notification poussée : seul le mail part, le téléphone ne sonne pas. À poser sur Railway : ${aPoser.join(", ")}.`);
  } else if (canaux.length < 2) alertes.push(`Un seul canal de notification (${canaux[0]}) : prévoir un second pour éviter le point de défaillance unique.`);
  for (const etat of notifications.etats.filter((e) => e.configure && e.dernier && !e.dernier.ok)) {
    alertes.push(`Canal ${etat.canal} en échec au dernier envoi : ${etat.dernier?.detail ?? "raison inconnue"}.`);
  }
  // Un lead payant sans campagne ni publicité : le Zap ne transmet pas l'attribution
  // (ou le lead vient de l'outil de test de Meta). Sans elle, impossible de juger une publicité.
  const sansAttribution = await prisma.metaLead.count({ where: { recuLe: { gte: septJours }, statut: "TRAITE", organique: false, campagneId: null, campagneNom: null, adId: null, adNom: null } });
  if (sansAttribution > 0) {
    alertes.push(`${pluriel(sansAttribution, "lead")} reçus sur 7 jours sans campagne ni publicité : vérifier dans le Zap les champs campaign_name, adset_name et ad_name (un lead de l'outil de test Meta n'en porte pas).`);
  }
  if (notifications.leadsSansPush.length > 0) {
    alertes.push(`${pluriel(notifications.leadsSansPush.length, "lead")} reçus sans notification poussée : personne n'a été prévenu sur son téléphone.`);
  }
  if (abonnement && !abonnement.abonne) alertes.push("La page n'est pas abonnée au champ « leadgen » : Meta n'enverra rien.");
  if (echecs.length > 0) alertes.push(`${pluriel(echecs.length, "lead")} reçus mais pas encore dans le CRM.`);

  // Le voyant dit ce qui s'est réellement passé : des leads reçus ces 7 jours = le webhook reçoit, même si la
  // vérification de l'abonnement de la page échoue (jeton, droits) ; sans lead, il dit si la chaîne est prête.
  const manques = [!configuration.signature ? "META_APP_SECRET absente" : null, !configuration.verification ? "META_VERIFY_TOKEN absente" : null].filter((m): m is string => m !== null);
  const recoit: "OUI" | "PRET" | "NON" = surSeptJours > 0 ? "OUI" : manques.length === 0 && (abonnement === null || abonnement.abonne) ? "PRET" : "NON";
  const recoitDetail =
    recoit === "OUI"
      ? `${pluriel(surSeptJours, "lead")} reçus sur 7 jours, dernier ${dernier ? `le ${dernier.recuLe.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}` : "—"}${abonnement && !abonnement.abonne ? " ; la vérification de l'abonnement dit « non abonnée » alors que les leads entrent : c'est la vérification qui se trompe (jeton ou droits), pas le webhook" : ""}.`
      : recoit === "PRET"
        ? `Configuration complète${abonnement ? ", page abonnée" : ""} ; aucun lead reçu sur 7 jours${dernier ? ` (dernier le ${dernier.recuLe.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })})` : " (jamais)"}.`
        : manques.length
          ? `Il manque : ${manques.join(", ")} — le webhook refuse ou ne peut pas être validé.`
          : `La page n'est pas abonnée au champ « leadgen »${abonnement?.erreur ? ` (${abonnement.erreur})` : ""} et aucun lead n'est entré sur 7 jours.`;

  const chaine = etatChaine({ recoit, recoitDetail, configuration, jeton, faits });
  // Mission 13 (B5) : une seule ligne sur le jeton, cohérente avec l'état de la chaîne.
  if (chaine.jetonARenouveler) alertes.push(`Jeton Meta à renouveler : ${jeton.message}`);

  return {
    chaine,
    configuration,
    notifications,
    webhook: {
      actif: surSeptJours > 0,
      dernierLeadLe: dernier?.recuLe.toISOString() ?? null,
      dernierLeadNom: dernier?.lead ? `${dernier.lead.prenom} ${dernier.lead.nom}`.trim() : null,
      surSeptJours,
      surVingtQuatreHeures,
      total,
      abonnement,
      recoit,
      recoitDetail,
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
