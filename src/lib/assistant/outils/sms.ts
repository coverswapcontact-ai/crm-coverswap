import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { estJourSeul, estRappel } from "@/lib/agenda/rappels";
import { aHeureParis, jourLisible, quandLisible } from "@/lib/commercial/quand";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { relancesAvisProposables } from "@/lib/relances/avis";
import { RELANCES_PHOTOS_MAX, relancesPhotosProposables } from "@/lib/relances/photos";
import { relancesReactivationProposables } from "@/lib/relances/reactivation";
import { listerRelances, RELANCES_MAX_PAR_DEVIS } from "@/lib/relances/service";
import { CODES_LIEN_ESPACE, CODES_SMS, type ActionSms, type CodeSms, type RelanceAvisSms, type RelanceDevisSms, type RelancePhotosSms, type RelanceReactivationSms, type RelanceSms } from "@/lib/sms/catalogue";
import { CODE_LIBRE, noterSmsCopie } from "@/lib/sms/copie";
import { LONGUEUR_MAX_SMS } from "@/lib/sms/envoi";
import { texteDuCatalogue } from "@/lib/sms/modeles";
import { proposerSms } from "@/lib/sms/proposition";
import { definirOutil, lien } from "../definition";
import { cibler, type Ids } from "./cible";
import { schemaCible } from "./lecture";

/**
 * Mission 14 (29/09/2026), partie 8 — « noter_sms » : Lucas dit avoir envoyé un
 * SMS (celui que « noter_appel », « voir_relances », « espaces_clients » ou
 * « lien_espace » lui a proposé, ou un que Claude lui a rédigé) ; l'outil le
 * note avec les mêmes effets que le bouton « Copier » de l'écran SMS
 * (`sms/copie.ts › noterSmsCopie`, origine ASSISTANT) : trace dans l'histoire
 * du dossier (ou les échanges du lead), lien de l'espace communiqué (la main
 * passe au client, « Lien pas encore envoyé » tombe), relance de devis comptée,
 * relance photos comptée (un SMS de lien sur un espace que « voir_relances »
 * propose de relancer, comme la feuille Relances → écran SMS → Copier).
 * Mission 18 (A4) : DEMANDE_AVIS compte la demande d'avis du dossier, et
 * REACTIVATION la réactivation du contact (tracée sur le lead), quand la liste
 * des relances les propose. Rien n'est envoyé ici.
 */

/** L'action de `proposerSms` qui recompose le texte d'un code (prénom, lien, rappel) ; les accusés n'en ont pas. */
const ACTION_DU_CODE: Partial<Record<CodeSms, ActionSms>> = {
  PAS_DE_REPONSE: "PAS_DE_REPONSE",
  PAS_DE_REPONSE_SIMULATION: "PAS_DE_REPONSE",
  PAS_DE_REPONSE_2: "PAS_DE_REPONSE",
  A_RAPPELER: "A_RAPPELER",
  LIEN_ESPACE: "LIEN_ESPACE",
  LIEN_ESPACE_SIMULATION: "LIEN_ESPACE",
  INJOIGNABLE_LIEN: "INJOIGNABLE_LIEN",
  LIEN_ESPACE_RAPPEL: "LIEN_ESPACE_RAPPEL",
  LIEN_ESPACE_NOUVEAU: "LIEN_ESPACE_RAPPEL",
  SIMULATION_PRETE: "LIEN_ESPACE_RAPPEL",
  RELANCE_DEVIS_1: "RELANCE_DEVIS",
  RELANCE_DEVIS_2: "RELANCE_DEVIS",
  DEMANDE_AVIS: "RELANCE_AVIS",
  REACTIVATION: "REACTIVATION",
};

const CODES_RELANCE_DEVIS: readonly string[] = ["RELANCE_DEVIS_1", "RELANCE_DEVIS_2"];
const CODES_LIEN: readonly string[] = CODES_LIEN_ESPACE;

/** Le rappel posé sur le contact ; `jourSeul` : un rappel de dossier noté au jour, sans heure choisie (`estJourSeul`). */
type Rappel = { le: Date; jourSeul: boolean } | null;

/** Le rappel posé sur le contact : celui du dossier (« Rappeler… » daté, comme l'agenda le lit), sinon celui du lead. */
async function rappelDe(ids: Ids): Promise<Rappel> {
  if (ids.dossierId) {
    const d = await prisma.dossier.findUnique({ where: { id: ids.dossierId }, select: { prochaineAction: true, prochaineActionDate: true, prochaineActionInstant: true } });
    if (!d?.prochaineActionDate || !estRappel(d.prochaineAction)) return null;
    return { le: d.prochaineActionDate, jourSeul: estJourSeul(d.prochaineActionDate, d.prochaineActionInstant) };
  }
  if (ids.leadId) {
    const rappelLe = (await prisma.lead.findUnique({ where: { id: ids.leadId }, select: { rappelLe: true } }))?.rappelLe ?? null;
    return rappelLe ? { le: rappelLe, jourSeul: false } : null;
  }
  return null;
}

/**
 * La relance de devis que ce SMS fait : le devis du dossier que le client attend (le seul lu par `listerRelances`) et
 * son rang (relances faites + 1), retrouvés seuls. Refus clair sans devis, ou après deux relances.
 */
async function relanceDuDossier(ids: Ids, maintenant: Date): Promise<RelanceDevisSms & { numero: string }> {
  if (!ids.dossierId) throw new ErreurMetier(`${ids.nom} n'a pas de dossier : une relance de devis se note sur son dossier. Note ce SMS sans code de relance (texte seul) si besoin.`, 409);
  const devis = (await listerRelances(maintenant, { dossierId: ids.dossierId })).devis[0];
  if (!devis) throw new ErreurMetier(`Aucun devis à relancer dans le dossier de ${ids.nom} : il faut un devis numéroté, visible dans son espace, sur un dossier en « Devis envoyé » ou « Relance ». Note ce SMS sans code de relance (texte seul) si besoin.`, 409);
  if (devis.relancesFaites >= RELANCES_MAX_PAR_DEVIS) throw new ErreurMetier(`Déjà ${devis.relancesFaites} relances faites pour le devis ${devis.numero} de ${ids.nom} (mail ou SMS) : plus de relance à compter. Note ce SMS sans code de relance (texte seul) si besoin.`, 409);
  return { documentId: devis.documentId, rang: devis.rang, numero: devis.numero };
}

/**
 * La relance photos que ce SMS de lien fait : le dossier est de ceux que « voir_relances » propose de relancer
 * aujourd'hui (espace ouvert sans photo ni simulation, délai écoulé, moins de deux relances), avec son rang. Sinon
 * rien : un lien envoyé hors relance n'en compte pas une (comme la colonne Espace de Dossiers).
 */
async function relancePhotosDuDossier(ids: Ids, maintenant: Date): Promise<RelancePhotosSms | null> {
  if (!ids.dossierId) return null;
  const p = (await relancesPhotosProposables(maintenant, { dossierId: ids.dossierId }))[0];
  return p ? { type: "PHOTOS", rang: p.rang } : null;
}

/** Mission 18 (A4) : la demande d'avis que ce SMS fait, si la liste des relances la propose pour ce dossier ; sinon rien. */
async function relanceAvisDuDossier(ids: Ids, maintenant: Date): Promise<RelanceAvisSms | null> {
  if (!ids.dossierId) return null;
  const a = (await relancesAvisProposables(maintenant, { dossierId: ids.dossierId, sms: false }))[0];
  return a ? { type: "AVIS", rang: a.rang } : null;
}

/** Mission 18 (A4) : la réactivation que ce SMS fait, si la liste des relances la propose pour ce contact ; sinon rien. */
async function relanceReactivationDuContact(ids: Ids, maintenant: Date): Promise<RelanceReactivationSms | null> {
  if (!ids.leadId) return null;
  const r = (await relancesReactivationProposables(maintenant, { leadId: ids.leadId, sms: false }))[0];
  return r ? { type: "REACTIVATION", rang: r.rang } : null;
}

/**
 * Le texte d'un code, recomposé comme le CRM l'aurait proposé (prénom, lien de l'espace — ouvert s'il le faut, comme
 * « lien_espace » —, rappel posé). Si le CRM aurait choisi une autre variante (tentatives, simulation du site…), le
 * code dit par Lucas est gardé, rempli avec les mêmes variables. Un rappel noté au jour seul se dit par son jour
 * (« jeudi »), jamais par une heure que Lucas n'a pas choisie.
 */
async function texteDuCode(code: CodeSms, ids: Ids, relance: RelanceSms | null, maintenant: Date): Promise<string> {
  const rappel = await rappelDe(ids);
  const action = ACTION_DU_CODE[code] ?? "A_RAPPELER";
  const p = await proposerSms({ action, leadId: ids.leadId, dossierId: ids.dossierId, rappelLe: rappel && !rappel.jourSeul ? rappel.le : null, relance }, maintenant);
  if (p.code === code && !rappel?.jourSeul) return p.texte;
  const quand = rappel?.jourSeul ? jourLisible(rappel.le, maintenant) : quandLisible(rappel?.le ?? (code.startsWith("PAS_DE_REPONSE") ? aHeureParis(maintenant, 1, 18) : null), maintenant);
  return texteDuCatalogue(code, { prenom: p.prenom, lien: p.lien, quand });
}

export const outilNoterSms = definirOutil({
  nom: "noter_sms",
  titre: "Noter un SMS envoyé par Lucas",
  description:
    "Quand Lucas dit avoir envoyé un SMS (« c'est envoyé », « je lui ai envoyé le lien »), note-le dans le CRM avec les mêmes effets que le bouton « Copier » de l'écran SMS : trace dans l'histoire du dossier (ou les échanges du lead), lien de l'espace communiqué (la main passe au client, « Lien pas encore envoyé » tombe), relance de devis comptée (RELANCE_DEVIS_1 ou _2 : le devis du dossier et son rang sont retrouvés seuls, 2 relances au plus), relance photos comptée (un SMS de lien — LIEN_ESPACE, LIEN_ESPACE_RAPPEL… — sur un espace que « lister » RELANCES ou ESPACES (filtré) propose de relancer : 2 au plus), demande d'avis comptée (DEMANDE_AVIS, sur le dossier que « lister » RELANCES propose : une fois), réactivation comptée (REACTIVATION, sur le contact que « lister » RELANCES propose, tracée dans ses échanges : une fois ; refusée sans son accord aux messages commerciaux). Donne le code du catalogue (celui du SMS proposé par « noter_appel », « lister » RELANCES ou ESPACES, « lien_espace ») et/ou le texte envoyé tel quel : code seul → le texte est recomposé depuis le catalogue ; texte seul → noté comme texte libre (aussi pour un SMS que tu as rédigé toi-même). Rien n'est envoyé par le CRM.",
  niveau: "REVERSIBLE",
  schema: schemaCible
    .extend({
      code: z.enum(CODES_SMS).optional().describe("Le code du catalogue SMS (rendu avec le SMS proposé) ; sans texte, le CRM recompose le texte pour la trace."),
      texte: z.string().trim().min(1).max(LONGUEUR_MAX_SMS).optional().describe("Le texte envoyé, tel quel (modifié par Lucas, ou rédigé par toi) ; sans code, noté comme texte libre."),
    })
    .refine((e) => e.code !== undefined || e.texte !== undefined, { message: "Donne le code du SMS (catalogue), le texte envoyé, ou les deux." }),
  executer: async (e, contexte) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    const ids = r.ids;
    const code = e.code ?? CODE_LIBRE;
    const relanceDevis = e.code && CODES_RELANCE_DEVIS.includes(e.code) ? await relanceDuDossier(ids, contexte.maintenant) : null;
    // Un SMS de lien sur un espace à relancer pour ses photos compte la relance, comme « Copier » depuis la feuille Relances.
    const relancePhotos = e.code && CODES_LIEN.includes(e.code) ? await relancePhotosDuDossier(ids, contexte.maintenant) : null;
    // Mission 18 (A4) : la demande d'avis et la réactivation, comptées quand la liste des relances les propose.
    const relanceAvis = e.code === "DEMANDE_AVIS" ? await relanceAvisDuDossier(ids, contexte.maintenant) : null;
    const relanceReactivation = e.code === "REACTIVATION" ? await relanceReactivationDuContact(ids, contexte.maintenant) : null;
    const relance: RelanceSms | null = relanceDevis ? { documentId: relanceDevis.documentId, rang: relanceDevis.rang } : (relancePhotos ?? relanceAvis ?? relanceReactivation);
    const recompose = e.texte === undefined;
    const texte = e.texte ?? (await texteDuCode(e.code!, ids, relanceDevis ? { documentId: relanceDevis.documentId, rang: relanceDevis.rang } : (relanceAvis ?? relanceReactivation), contexte.maintenant));
    const copie = await noterSmsCopie({ code, texte, leadId: ids.leadId, dossierId: ids.dossierId, relance, origine: "ASSISTANT" }, contexte.maintenant);
    // Un double toucher (même SMS en moins de 10 minutes) n'écrit rien : aucun effet à annoncer, aucune relance comptée.
    const effets = [
      code === CODE_LIBRE ? "texte libre" : null,
      ...(copie.deja
        ? ["déjà noté il y a moins de 10 minutes : rien de plus n'est écrit"]
        : [
            copie.cible === "DOSSIER" ? "écrit dans l'histoire du dossier" : "écrit dans les échanges du lead",
            copie.lien ? "lien de l'espace communiqué : la main passe au client" : null,
            relanceDevis ? `relance n° ${relanceDevis.rang} du devis ${relanceDevis.numero} comptée (${RELANCES_MAX_PAR_DEVIS} au plus, mail ou SMS)` : null,
            relancePhotos ? `relance photos n° ${relancePhotos.rang} comptée (${RELANCES_PHOTOS_MAX} au plus)` : null,
            relanceAvis ? "demande d'avis comptée (une seule)" : null,
            relanceReactivation ? "réactivation comptée (une seule)" : null,
          ]),
    ].filter((x): x is string => Boolean(x));
    return {
      texte: `Noté : SMS ${code === CODE_LIBRE ? "" : `${code} `}envoyé à ${ids.nom} (${effets.join(", ")}).${recompose ? `\nTexte noté : « ${texte} »` : ""}`,
      donnees: { ...copie, code, texte, relance: copie.deja ? null : relance },
      liens: [copie.dossierId ? lien("Dossier", `/dossiers?dossier=${copie.dossierId}`) : lien("Lead", `/leads?lead=${copie.leadId}`)],
    };
  },
});

export const OUTILS_SMS = [outilNoterSms];
