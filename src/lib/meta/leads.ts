import { createHash } from "node:crypto";
import type { MetaLead, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { rattacherLead } from "@/lib/clients/identification";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { mettreEnFile } from "@/lib/taches/file";
import { texteDesReponses, type LeadMetaNormalise } from "./champs";
import { lireLeadMeta, type LeadGraph } from "./graph";
import { leadDepuisChargePlate } from "./pont";
import { lienFiche } from "./config";
import { communeDuCodePostal } from "./communes";
import { CANAUX_PUSH, alerter, resumerEnvoi, type ResultatCanal } from "@/lib/alertes/canaux";
import { LIBELLES_TYPE_PROJET } from "@/lib/prospects/constantes";
import { LIBELLES_PRIORITE, type Priorite } from "@/lib/prospects/priorite";
import { classerLeadSansBloquer } from "@/lib/prospects/qualification";
import { envoyerAccuseDeReception } from "@/lib/sms/accuse";

/**
 * Le chemin d'un lead Meta, de l'événement reçu à la fiche du CRM.
 *
 * 1. Le webhook enregistre l'événement (MetaLead) et rend la main à Meta tout de
 *    suite : Meta rejoue tout ce qu'il ne voit pas acquitté sous peu, et un
 *    traitement lent créerait des doublons.
 * 2. Une tâche de fond va chercher les réponses du formulaire dans l'API Graph,
 *    crée (ou rattache) le contact, puis prévient le gérant.
 * 3. Tout est idempotent par le `leadgen_id` : Meta rejoue ses événements, la
 *    clé unique de la tâche et celle de MetaLead font qu'un lead n'est jamais
 *    traité deux fois.
 *
 * Si la récupération échoue (permission `leads_retrieval` pas encore accordée,
 * panne Meta), rien n'est perdu : l'événement reste en base avec son erreur,
 * la tâche réessaie pendant plus d'une journée, l'écran Publicité le montre, et
 * le gérant est tout de même prévenu qu'un lead est arrivé.
 */
export const TACHE_LEAD = "META_LEAD";
export const TACHE_RELANCE = "META_RELANCE";
export const DELAI_RELANCE_MS = 30 * 60_000;
/** Tentatives de récupération d'un lead : environ trente heures d'essais. */
export const TENTATIVES_LEAD = 14;

export type EvenementLeadgen = {
  leadgenId: string;
  pageId?: string | null;
  formId?: string | null;
  adId?: string | null;
  adsetId?: string | null;
  /** created_time du webhook : en secondes. */
  creeLe?: number | null;
};

/** Les événements `leadgen` d'une charge de webhook Meta, sans rien supposer du reste. */
export function evenementsDeLaCharge(charge: unknown): EvenementLeadgen[] {
  const corps = charge as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  if (corps?.object !== "page" || !Array.isArray(corps.entry)) return [];
  const evenements: EvenementLeadgen[] = [];
  for (const entree of corps.entry) {
    for (const changement of entree?.changes ?? []) {
      if (changement?.field !== "leadgen") continue;
      const valeur = changement.value ?? {};
      const leadgenId = valeur.leadgen_id != null ? String(valeur.leadgen_id) : "";
      if (!/^\d{6,}$/.test(leadgenId)) continue;
      evenements.push({
        leadgenId,
        pageId: valeur.page_id != null ? String(valeur.page_id) : null,
        formId: valeur.form_id != null ? String(valeur.form_id) : null,
        // `adgroup_id` est le nom historique de la publicité dans cette charge.
        adId: valeur.ad_id != null ? String(valeur.ad_id) : valeur.adgroup_id != null ? String(valeur.adgroup_id) : null,
        adsetId: valeur.adset_id != null ? String(valeur.adset_id) : null,
        creeLe: typeof valeur.created_time === "number" ? valeur.created_time : null,
      });
    }
  }
  return evenements;
}

/**
 * Enregistre l'événement et met le traitement en file. Idempotent : le même
 * `leadgen_id` rejoué par Meta ne crée ni deuxième ligne ni deuxième tâche.
 */
export async function accuserReceptionLeadgen(evenement: EvenementLeadgen): Promise<{ metaLeadId: string; nouveau: boolean }> {
  const soumisLe = evenement.creeLe ? new Date(evenement.creeLe * 1000) : new Date();
  const existant = await prisma.metaLead.findUnique({ where: { leadgenId: evenement.leadgenId }, select: { id: true, statut: true } });
  if (existant) {
    // Meta rejoue l'événement : on ne retraite pas, on note simplement qu'il est déjà connu.
    console.log(`[meta] événement ${evenement.leadgenId} déjà reçu (${existant.statut}) : ignoré.`);
    if (existant.statut === "RECU") await mettreEnFileLead(evenement.leadgenId);
    return { metaLeadId: existant.id, nouveau: false };
  }
  const cree = await prisma.metaLead.create({
    data: {
      leadgenId: evenement.leadgenId,
      pageId: evenement.pageId ?? null,
      formId: evenement.formId ?? null,
      adId: evenement.adId ?? null,
      adsetId: evenement.adsetId ?? null,
      soumisLe: Number.isNaN(soumisLe.getTime()) ? new Date() : soumisLe,
    },
    select: { id: true },
  });
  await mettreEnFileLead(evenement.leadgenId);
  return { metaLeadId: cree.id, nouveau: true };
}

async function mettreEnFileLead(leadgenId: string): Promise<void> {
  // 14 tentatives ≈ 30 heures : le temps qu'une permission Meta soit accordée ou qu'une panne passe.
  await mettreEnFile({ type: TACHE_LEAD, cle: `meta-lead:${leadgenId}`, charge: { leadgenId }, priorite: 10, tentativesMax: TENTATIVES_LEAD });
}

/** Remet un lead en file après un échec (geste humain depuis l'écran Publicité). */
export async function rejouerLeadMeta(leadgenId: string): Promise<void> {
  const ligne = await prisma.metaLead.findUnique({ where: { leadgenId }, select: { statut: true } });
  if (!ligne) throw new Error("Lead Meta introuvable.");
  if (ligne.statut === "TRAITE") throw new Error("Ce lead est déjà dans le CRM.");
  await prisma.metaLead.update({ where: { leadgenId }, data: { statut: "RECU", erreur: null } });
  await mettreEnFile({ type: TACHE_LEAD, cle: `meta-lead:${leadgenId}`, charge: { leadgenId }, priorite: 10, tentativesMax: TENTATIVES_LEAD, mode: "RECONCILIATION" });
}

/**
 * Complète la ville depuis le code postal quand le formulaire n'a rendu qu'un numéro.
 * La déduction est signalée dans les réponses, et l'ambiguïté avec elle : plusieurs
 * communes partagent souvent un code postal.
 */
export async function completerLaVille(normalise: LeadMetaNormalise): Promise<LeadMetaNormalise> {
  if (normalise.ville || !normalise.codePostal) return normalise;
  const commune = await communeDuCodePostal(normalise.codePostal);
  if (!commune) return normalise;
  const mention = commune.certaine
    ? `${commune.nom} (déduite du code postal ${normalise.codePostal})`
    : `${commune.nom} (déduite du code postal ${normalise.codePostal} ; aussi ${commune.autres.join(", ")})`;
  return {
    ...normalise,
    ville: commune.nom,
    reponses: [...normalise.reponses, { question: "Ville", reponse: mention, cle: "__ville_deduite" }],
    reponsesLibres: [...normalise.reponsesLibres, { question: "Ville", reponse: mention, cle: "__ville_deduite" }],
  };
}

/** Le contact déjà en base qui correspond à ce téléphone ou à cet e-mail. */
async function contactExistant(normalise: LeadMetaNormalise): Promise<{ id: string; email: string | null; ville: string; codePostal: string | null } | null> {
  const telephone = normaliserTelephone(normalise.telephone);
  const neuf = telephone ? telephone.replace(/\D/g, "").slice(-9) : null;
  const pistes: Prisma.LeadWhereInput[] = [];
  if (neuf && neuf.length === 9) pistes.push({ telephone: { contains: neuf } });
  if (normalise.email) pistes.push({ email: normalise.email });
  if (pistes.length === 0) return null;
  // Les contacts archivés ne comptent pas : un lead payant ne doit jamais se ranger
  // derrière une fiche mise de côté ; il en ouvre une nouvelle.
  return prisma.lead.findFirst({
    where: { OR: pistes },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, ville: true, codePostal: true },
  });
}

function scoreDuLead(normalise: LeadMetaNormalise, soumisLe: Date): number {
  let score = 15; // socle d'un lead de publicité payante
  const heure = soumisLe.getHours();
  if ((heure >= 9 && heure <= 12) || (heure >= 14 && heure <= 18)) score += 10;
  if (normalise.email) score += 5;
  if (normalise.telephone) score += 5;
  if (normalise.ville) score += 5;
  if (normalise.typeProjet === "CUISINE") score += 25;
  else score += 15;
  return Math.min(score, 100);
}

export type ResultatTraitement = {
  leadgenId: string;
  leadId: string | null;
  rattache: boolean;
  notifications: ResultatCanal[];
};

/**
 * Récupère les réponses du formulaire, crée ou rattache le contact, prévient.
 * Lève en cas d'échec : la tâche garde l'erreur, réessaie, et l'écran la montre.
 */
export async function traiterLeadMeta(
  leadgenId: string,
  /** Remplace la lecture dans l'API Graph : sert au mode d'essai, qui ne dépend d'aucune permission Meta. */
  lecteur: (id: string) => Promise<LeadGraph> = lireLeadMeta
): Promise<ResultatTraitement> {
  const ligne = await prisma.metaLead.findUnique({ where: { leadgenId } });
  if (!ligne) throw new Error(`Événement Meta ${leadgenId} introuvable.`);
  if (ligne.statut === "TRAITE" && ligne.leadId) {
    // Rejeu d'un lead déjà traité : on rend le compte rendu de la notification
    // d'origine plutôt qu'un tableau vide, qui se lirait « rien n'est parti ».
    let notifications: ResultatCanal[] = [];
    try {
      const lu = ligne.notifications ? (JSON.parse(ligne.notifications) as ResultatCanal[]) : [];
      if (Array.isArray(lu)) notifications = lu;
    } catch {
      notifications = [];
    }
    return { leadgenId, leadId: ligne.leadId, rattache: false, notifications };
  }

  let graph: LeadGraph;
  try {
    graph = await lecteur(leadgenId);
  } catch (erreur) {
    const message = (erreur as Error).message.slice(0, 500);
    await prisma.metaLead.update({
      where: { leadgenId },
      data: { statut: "ECHEC", erreur: message, tentatives: { increment: 1 } },
    });
    // Le gérant doit savoir qu'un lead est arrivé, même si on ne sait pas encore qui c'est.
    await alerterLeadIllisible(ligne, message);
    throw erreur;
  }

  // Ville absente mais code postal connu (champ libre où la personne n'a tapé que « 78660 ») :
  // on demande la commune à l'API publique. Rien n'est inventé si elle ne répond pas.
  const normalise = await completerLaVille(graph.normalise);
  const existant = await contactExistant(normalise);
  // Dans la fiche : les réponses aux questions personnalisées, celles qui ne sont pas
  // déjà un champ du contact. Le relevé complet du formulaire reste sur MetaLead.reponses.
  const notes = texteDesReponses(normalise.reponsesLibres) || null;

  let leadId: string;
  if (existant) {
    // Déduplication : on enrichit, on ne duplique pas.
    const maj: Prisma.LeadUpdateInput = {};
    if (!existant.email && normalise.email) maj.email = normalise.email;
    if (!existant.codePostal && normalise.codePostal) maj.codePostal = normalise.codePostal;
    if (/^(non renseign|inconnue?$)/i.test(existant.ville.trim()) && normalise.ville) maj.ville = normalise.ville;
    if (Object.keys(maj).length > 0) await prisma.lead.update({ where: { id: existant.id }, data: maj });
    leadId = existant.id;
  } else {
    const cree = await prisma.lead.create({
      data: {
        prenom: normalise.prenom,
        nom: normalise.nom,
        telephone: normalise.telephone,
        email: normalise.email,
        ville: normalise.ville || "Non renseignée",
        codePostal: normalise.codePostal,
        source: "META_ADS",
        typeProjet: normalise.typeProjet,
        scoreSignature: scoreDuLead(normalise, graph.soumisLe),
        // Horodatage réel de la soumission, pas celui de la réception.
        createdAt: graph.soumisLe,
        updatedAt: graph.soumisLe,
        campagne: graph.campagneNom ?? graph.campagneId,
        publicite: graph.adNom ?? graph.adId,
        formulaire: graph.formNom,
        metaLeadgenId: leadgenId,
        notes,
        // Mission 11 : le message libre du formulaire, dans son champ (occupation et délai : par la qualification).
        message: normalise.message,
      },
      select: { id: true },
    });
    leadId = cree.id;
  }

  await prisma.metaLead.update({
    where: { leadgenId },
    data: {
      statut: "TRAITE",
      erreur: null,
      traiteLe: new Date(),
      leadId,
      soumisLe: graph.soumisLe,
      formId: graph.formId ?? ligne.formId,
      formNom: graph.formNom,
      adId: graph.adId ?? ligne.adId,
      adNom: graph.adNom,
      adsetId: graph.adsetId ?? ligne.adsetId,
      adsetNom: graph.adsetNom,
      campagneId: graph.campagneId,
      campagneNom: graph.campagneNom,
      plateforme: graph.plateforme,
      organique: graph.organique,
      reponses: JSON.stringify(normalise.reponses),
    },
  });

  // Priorité de rappel : lue dans les réponses du formulaire (propriétaire, délai) et le code postal.
  const qualification = existant ? null : await classerLeadSansBloquer(leadId);

  // Client pérenne : jamais bloquant, rattrapé par le travail périodique.
  try {
    await rattacherLead(prisma, leadId);
  } catch (erreur) {
    console.error("[meta] rattachement du client (non bloquant) :", erreur);
  }

  // Accusé de réception par SMS : le seul envoi automatique. Pas pour un contact
  // déjà connu (il a déjà mon numéro), ni hors zone (je ne promets pas un appel).
  if (!existant && qualification?.priorite !== "A_ECARTER") {
    const accuse = await envoyerAccuseDeReception(leadId);
    console.log(`[meta] accusé de réception du lead ${leadgenId} : ${accuse.envoye ? "mis en file" : `non envoyé (${accuse.raison})`}`);
  }

  await prisma.interaction.create({
    data: {
      type: "NOTE",
      contenu: [
        `Lead Meta Ads reçu${graph.campagneNom ? ` — campagne « ${graph.campagneNom} »` : ""}`,
        graph.adNom ? `Publicité : ${graph.adNom}` : null,
        `leadgen_id : ${leadgenId}`,
        notes,
      ]
        .filter(Boolean)
        .join("\n"),
      leadId,
    },
  });

  const notifications = await notifierNouveauLead({
    leadId,
    normalise,
    campagne: graph.campagneNom,
    nouveau: !existant,
    priorite: qualification ? { classe: qualification.priorite, motif: qualification.motif } : null,
  });
  await enregistrerNotification(leadgenId, notifications);
  // Relance si personne n'a ouvert la fiche dans la demi-heure.
  await mettreEnFile({
    type: TACHE_RELANCE,
    cle: `meta-relance:${leadgenId}`,
    charge: { leadgenId, leadId },
    apres: new Date(Date.now() + DELAI_RELANCE_MS),
    priorite: 5,
  });

  return { leadgenId, leadId, rattache: Boolean(existant), notifications };
}

async function alerterLeadIllisible(ligne: MetaLead, message: string): Promise<void> {
  await alerter({
    titre: "Lead Meta reçu mais illisible",
    texte: [
      `Un formulaire a été rempli (leadgen_id ${ligne.leadgenId}) mais le CRM n'a pas pu lire les réponses.`,
      `Raison : ${message}`,
      "Le lead est conservé et sera récupéré automatiquement dès que l'accès sera rétabli. En attendant, il est visible dans Meta (Gestionnaire de formulaires).",
    ].join("\n\n"),
    lien: `${(process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "")}/publicite`,
    libelleLien: "Voir l'écran Publicité",
    urgence: 5,
  }, { origine: "lead-illisible" });
}

/**
 * Garde le compte rendu de la notification SUR le lead : une ligne par canal,
 * y compris ceux qui ne sont pas configurés. Sans cela, un push qui ne part
 * jamais ne laisse aucune trace ailleurs que dans les journaux du serveur, et
 * personne ne s'en aperçoit avant d'avoir perdu un lead à 78 €.
 */
export async function enregistrerNotification(leadgenId: string, resultats: ResultatCanal[]): Promise<void> {
  const abouti = resultats.some((r) => r.ok);
  const pousse = resultats.some((r) => r.ok && CANAUX_PUSH.includes(r.canal));
  try {
    await prisma.metaLead.update({
      where: { leadgenId },
      data: {
        notifications: JSON.stringify(resultats),
        ...(abouti ? { notifieLe: new Date() } : {}),
        ...(pousse ? { pousseLe: new Date() } : {}),
      },
    });
  } catch (erreur) {
    // Jamais bloquant : la notification est déjà partie, seule la trace manque.
    console.error("[meta] trace de notification non écrite :", erreur);
  }
  console.log(`[meta] notification du lead ${leadgenId} — ${resumerEnvoi(resultats)}`);
}

/** La notification envoyée dès qu'un lead arrive : prénom, téléphone cliquable, projet, ville, lien. */
export async function notifierNouveauLead(params: {
  leadId: string;
  normalise: Pick<LeadMetaNormalise, "prenom" | "nom" | "telephone" | "ville" | "typeProjet" | "reponsesLibres">;
  campagne?: string | null;
  nouveau: boolean;
  relance?: boolean;
  /** Classe de rappel : elle ouvre le titre, et règle l'insistance du push. */
  priorite?: { classe: Priorite; motif: string } | null;
}): Promise<ResultatCanal[]> {
  const { normalise } = params;
  const classe = params.priorite?.classe ?? null;
  // Prioritaire : push urgent. À écarter (hors zone) : push ordinaire, sans insister.
  const urgenceSelonClasse = classe === "PRIORITAIRE" ? 5 : classe === "A_ECARTER" || classe === "SECONDAIRE" ? 3 : 4;
  const projet = LIBELLES_TYPE_PROJET[normalise.typeProjet] ?? normalise.typeProjet;
  const lignes = [
    `${normalise.prenom} ${normalise.nom}`.trim(),
    normalise.telephone ? `📞 ${normalise.telephone}` : "Téléphone non communiqué",
    `Projet : ${projet}${normalise.ville ? ` · ${normalise.ville}` : ""}`,
    params.priorite ? `${LIBELLES_PRIORITE[params.priorite.classe].toUpperCase()} — ${params.priorite.motif}` : null,
    params.campagne ? `Campagne : ${params.campagne}` : null,
    ...normalise.reponsesLibres.slice(0, 3).map((r) => `${r.question} : ${r.reponse}`),
    params.nouveau ? null : "⚠️ Ce contact existait déjà : la demande a été rattachée à sa fiche.",
  ].filter(Boolean) as string[];

  return alerter({
    titre: params.relance
      ? `Lead Meta non traité depuis 30 min — ${normalise.prenom}`
      : `${classe === "PRIORITAIRE" ? "PRIORITAIRE — " : classe === "A_ECARTER" ? "Hors zone — " : ""}Nouveau lead Meta — ${normalise.prenom}${normalise.ville ? ` (${normalise.ville})` : ""}`,
    texte: params.relance ? [`Personne n'a encore ouvert cette fiche.`, ...lignes].join("\n") : lignes.join("\n"),
    lien: lienFiche(params.leadId),
    libelleLien: "Ouvrir la fiche",
    telephone: normalise.telephone || undefined,
    urgence: params.relance ? 5 : urgenceSelonClasse,
  }, { origine: params.relance ? "relance-lead" : "lead-meta" });
}

/**
 * Relance : la fiche n'a toujours pas été ouverte une demi-heure après.
 * Rend `true` quand une relance est effectivement partie.
 */
export async function relancerSiNonTraite(leadgenId: string, leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      vuLe: true,
      statut: true,
      archiveLe: true,
      priorite: true,
      prioriteMotif: true,
      prenom: true,
      nom: true,
      telephone: true,
      ville: true,
      typeProjet: true,
      interactions: { where: { type: { in: ["APPEL", "SMS", "EMAIL"] } }, select: { id: true }, take: 1 },
    },
  });
  if (!lead) return false;
  // Fiche ouverte, contact pris, statut avancé ou contact archivé : rien à rappeler.
  if (lead.vuLe || lead.archiveLe || lead.statut !== "NOUVEAU" || lead.interactions.length > 0) return false;
  // Hors zone : Lucas a été prévenu une fois, inutile d'insister une demi-heure plus tard.
  if (lead.priorite === "A_ECARTER") return false;
  const metaLead = await prisma.metaLead.findUnique({ where: { leadgenId }, select: { campagneNom: true, reponses: true } });
  let reponsesLibres: { question: string; reponse: string; cle: string }[] = [];
  try {
    reponsesLibres = metaLead?.reponses ? (JSON.parse(metaLead.reponses) as typeof reponsesLibres) : [];
  } catch {
    reponsesLibres = [];
  }
  const notifications = await notifierNouveauLead({
    leadId,
    normalise: {
      prenom: lead.prenom,
      nom: lead.nom,
      telephone: lead.telephone,
      ville: lead.ville,
      typeProjet: lead.typeProjet as LeadMetaNormalise["typeProjet"],
      reponsesLibres,
    },
    campagne: metaLead?.campagneNom ?? null,
    nouveau: true,
    relance: true,
    priorite: lead.priorite ? { classe: lead.priorite as Priorite, motif: lead.prioriteMotif ?? "" } : null,
  });
  await enregistrerNotification(leadgenId, notifications);
  return true;
}

/** La fiche vient d'être ouverte dans le CRM : la relance n'a plus lieu d'être. */
export async function marquerFicheVue(leadId: string): Promise<void> {
  await prisma.lead.updateMany({ where: { id: leadId, vuLe: null }, data: { vuLe: new Date() } });
}

/**
 * Reçoit un lead Meta livré à plat par un intermédiaire (Zapier) et le fait
 * entrer par la MÊME porte que le webhook natif : ligne MetaLead, champs
 * normalisés, déduplication, notification, relance, écran Publicité.
 *
 * Idempotent par le `leadgen_id` de Meta. Quand l'intermédiaire ne le transmet
 * pas, une clé stable est fabriquée à partir du contact et de l'horodatage :
 * deux envois du même lead ne font toujours qu'une fiche.
 */
export async function recevoirLeadDuPont(
  corps: Record<string, unknown>,
  origine = "Zapier"
): Promise<ResultatTraitement & { nouveau: boolean }> {
  const lead = leadDepuisChargePlate(corps);
  // Les CLÉS reçues, jamais les valeurs : c'est ce qui dit, dans les journaux du
  // serveur, si le Zap transmet bien campagne, ensemble et publicité. Un lead de
  // l'outil de test de Meta n'en a pas (il ne vient d'aucune publicité).
  const cles = Object.keys(corps);
  const vides = cles.filter((cle) => corps[cle] === null || corps[cle] === undefined || String(corps[cle]).trim() === "");
  console.log(`[meta] pont ${origine} — clés reçues : ${cles.join(", ") || "aucune"}${vides.length ? ` — vides : ${vides.join(", ")}` : ""}`);
  const leadgenId =
    lead.leadgenId ??
    `pont-${createHash("sha256")
      .update(`${origine}|${lead.normalise.telephone}|${lead.normalise.email ?? ""}|${lead.soumisLe.toISOString()}`)
      .digest("hex")
      .slice(0, 24)}`;

  const donnees = {
    pageId: lead.pageId,
    formId: lead.formId,
    formNom: lead.formNom,
    adId: lead.adId,
    adNom: lead.adNom,
    adsetId: lead.adsetId,
    adsetNom: lead.adsetNom,
    campagneId: lead.campagneId,
    campagneNom: lead.campagneNom,
    plateforme: lead.plateforme,
    organique: lead.organique,
    soumisLe: lead.soumisLe,
  };
  const existant = await prisma.metaLead.findUnique({ where: { leadgenId }, select: { id: true, statut: true } });
  if (existant) {
    console.log(`[meta] lead ${leadgenId} déjà reçu (${existant.statut}) via ${origine} : non retraité.`);
  } else {
    await prisma.metaLead.create({ data: { leadgenId, ...donnees } });
  }

  const resultat = await traiterLeadMeta(leadgenId, async () => lead);
  return { ...resultat, nouveau: !existant };
}
