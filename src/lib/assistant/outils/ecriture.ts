import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { noterAppel } from "@/lib/commercial/appels";
import { ISSUES_APPEL } from "@/lib/commercial/constantes";
import { creerNoteAppel } from "@/lib/commercial/notes-appel";
import { ETIQUETTES_APPEL } from "@/lib/commercial/notes-constantes";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { etatIa } from "@/lib/ia/modele";
import { ETAPES, LIBELLES_ETAPE, LIBELLES_MOTIF_PERTE, MOTIFS_PERTE, UNITES, type EtapeDossier } from "@/lib/dossiers/constants";
import { verifierMotifPerte } from "@/lib/dossiers/perte";
import { jourParis } from "@/lib/dossiers/dates";
import { genererDocument } from "@/lib/dossiers/documents";
import { envoiALaGeneration } from "@/lib/dossiers/devis-envoye";
import { peutNotifier } from "@/lib/mail/notifications";
import { lireLignes } from "@/lib/dossiers/stockage";
import { devisProposeDuDossier } from "@/lib/espace/devis-propose";
import { analyser } from "@/lib/commun/api";
import { LIBELLES_MOYEN, libelleMotif, MOTIFS_ANNULATION, MOTIFS_REJET, MOTIFS_SANS_ACOMPTE, MOYENS_PAIEMENT } from "@/lib/encaissements/constantes";
import { schemaAnnulation, schemaEncaissement, schemaPaiement, schemaRejet, type EntreePaiement } from "@/lib/encaissements/schemas";
import { annulerEncaissement, changerEtapeAvecPaiement, enregistrerEncaissement, rejeterEncaissement } from "@/lib/encaissements/service";
import { schemaChangementEtape } from "@/lib/dossiers/transitions";
import { envoyerDepuisLOnglet } from "@/lib/mail/detail";
import { apercuLienParMail, CODES_LIEN_MAIL, envoyerLienParMail, proposerLienParMail } from "@/lib/mail/lien-espace";
import { redigerBrouillon } from "@/lib/mail/redaction";
import { brouillonEnvoiDocument, envoyerDocumentParMail } from "@/lib/mail/service";
import { validerProposition } from "@/lib/validation/service";
import { planifierAction } from "@/lib/agenda/planification";
import { planifierDepuisMail } from "@/lib/agenda/depuis-mail";
import { lireDateDictee } from "../agenda";
import { definirOutil, format, lien } from "../definition";
import { outilSupprimer } from "./menage";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";
import { pluriel } from "@/lib/commun/format";

/**
 * Les outils d'écriture (mission 8). Chacun appelle le code du CRM, rien de
 * plus ; le niveau dit ce que le moteur exige avant d'agir. Rien ne se
 * supprime : « supprimer » archive. Toute ambiguïté sur la personne rend les
 * candidats au lieu de choisir.
 */

const ETAPES_SENSIBLES: EtapeDossier[] = ["SIGNE", "FACTURE", "ENCAISSE", "PERDU"];
const ETAPES_FACTURABLES: EtapeDossier[] = ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"];

const exigerDossier = (ids: { dossierId: string | null; nom: string }) => {
  if (!ids.dossierId) throw new ErreurMetier(`${ids.nom} n'a pas de dossier ouvert : ouvre-le d'abord (« creer » DOSSIER).`, 409);
  return ids.dossierId;
};

/** Un paiement dicté (acompte, solde, encaissement), traduit en snake_case du schéma de l'écran (`schemaPaiement`). */
export const schemaPaiementOutil = z.object({
  montant: z.number().positive().max(1_000_000),
  moyen: z.enum(MOYENS_PAIEMENT).optional().describe("VIREMENT, CHEQUE, ESPECES, CARTE, AUTRE."),
  recu_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("AAAA-MM-JJ, aujourd'hui par défaut."),
  reference: z.string().max(120).optional(),
  credite_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Chèque déjà crédité : le jour du crédit."),
  note: z.string().max(500).optional(),
});
type PaiementOutil = z.output<typeof schemaPaiementOutil>;

/** Le paiement au format du service, validé par le même schéma que l'écran. */
export function paiementDuService(p: PaiementOutil, maintenant: Date): EntreePaiement {
  return analyser(schemaPaiement, { montant: p.montant, moyen: p.moyen ?? null, recuLe: p.recu_le ?? jourParis(maintenant), reference: p.reference ?? null, crediteLe: p.credite_le ?? null, note: p.note ?? null });
}

const paiementEnMots = (p: PaiementOutil, maintenant: Date) => `${format.euros(p.montant)}${p.moyen ? ` par ${LIBELLES_MOYEN[p.moyen].toLowerCase()}` : ""} reçu le ${format.jour(p.recu_le ?? jourParis(maintenant))}${p.reference ? ` (référence ${p.reference})` : ""}${p.credite_le ? `, crédité le ${format.jour(p.credite_le)}` : ""}`;

const schemaChangerEtapeOutil = schemaCible.extend({
  vers: z.enum(ETAPES).describe("L'étape visée."),
  motif_perte: z.enum(MOTIFS_PERTE).optional().describe("Obligatoire pour « perdu »."),
  commentaire: z.string().max(2000).optional().describe("Perdu : la précision (obligatoire pour AUTRE)."),
  perte_concurrent: z.string().max(160).optional().describe("Perdu : « Remporté par » (le concurrent)."),
  perte_montant_concurrent: z.number().min(0).max(10_000_000).optional().describe("Perdu : son prix, en euros."),
  date_chantier: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("AAAA-MM-JJ, pour « planifié »."),
  accord_confirme: z.boolean().optional().describe("Vrai si Lucas confirme que le bon pour accord a été donné hors espace (passage à « signé » sans accord en ligne)."),
  devis_accepte_id: z.string().max(40).optional().describe("Signé : le devis accepté, quand le dossier en porte plusieurs (identifiant rendu par « lire_fiche »)."),
  acompte: schemaPaiementOutil.optional().describe("Signé : l'acompte reçu, enregistré dans la même opération que la signature."),
  sans_acompte: z.object({ motif: z.enum(MOTIFS_SANS_ACOMPTE.map((m) => m.code) as [string, ...string[]]), precision: z.string().max(300).optional() }).optional().describe(`Signé sans acompte : motif ${MOTIFS_SANS_ACOMPTE.map((m) => m.code).join(", ")} (+ precision pour AUTRE).`),
  solde: schemaPaiementOutil.optional().describe("Encaissé : le paiement du solde, enregistré dans la même opération."),
  survenu_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Jour réel du passage, s'il a eu lieu avant aujourd'hui (AAAA-MM-JJ)."),
});
type EntreeChangerEtape = z.output<typeof schemaChangerEtapeOutil>;

/** L'entrée de l'écran (`schemaChangementEtape`), validée par le même schéma. */
function entreeChangementEtape(e: EntreeChangerEtape, maintenant: Date) {
  return analyser(schemaChangementEtape, {
    vers: e.vers,
    ...(e.motif_perte ? { motifPerte: e.motif_perte } : {}),
    ...(e.commentaire ? { perteCommentaire: e.commentaire } : {}),
    ...(e.perte_concurrent ? { perteConcurrent: e.perte_concurrent } : {}),
    ...(e.perte_montant_concurrent !== undefined ? { perteMontantConcurrent: e.perte_montant_concurrent } : {}),
    ...(e.date_chantier ? { dateChantier: e.date_chantier } : {}),
    ...(e.accord_confirme ? { confirmations: { BON_POUR_ACCORD: true } } : {}),
    ...(e.devis_accepte_id ? { devisAccepteId: e.devis_accepte_id } : {}),
    ...(e.acompte ? { acompte: paiementDuService(e.acompte, maintenant) } : {}),
    ...(e.sans_acompte ? { sansAcompte: e.sans_acompte } : {}),
    ...(e.solde ? { solde: paiementDuService(e.solde, maintenant) } : {}),
    ...(e.survenu_le ? { survenuLe: e.survenu_le } : {}),
  });
}

export const outilChangerEtape = definirOutil({
  nom: "changer_etape",
  titre: "Changer l'étape d'un dossier",
  description:
    "Passe un dossier à une autre étape (qualification, simulation, devis envoyé, relance, signé, planifié, chantier, facturé, encaissé, perdu, en pause), par la même fonction que la fenêtre de l'écran : le CRM vérifie les conditions et refuse avec la raison (devis manquant, accord manquant…). Signé : devis_accepte_id (plusieurs devis), acompte (reçu, enregistré dans la même opération) ou sans_acompte (motif), accord_confirme (bon pour accord hors espace). Encaissé : solde (le paiement, dans la même opération). Perdu : motif_perte obligatoire (PRIX, CONCURRENT, SANS_REPONSE, PROJET_ABANDONNE, HORS_ZONE, DELAI, AUTRE + commentaire), perte_concurrent et perte_montant_concurrent ; il remonte dans manager_commercial. survenu_le : jour réel d'un passage déjà fait. Signé, facturé, encaissé, perdu, ou tout passage avec un paiement : aperçu puis confirmation.",
  niveau: "REVERSIBLE",
  sensible: (e) => ETAPES_SENSIBLES.includes(e.vers) || Boolean(e.acompte || e.solde),
  schema: schemaChangerEtapeOutil,
  apercu: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    const details = [
      e.motif_perte ? `motif : ${LIBELLES_MOTIF_PERTE[e.motif_perte].toLowerCase()}${e.commentaire ? ` (${e.commentaire})` : ""}` : null,
      e.perte_concurrent ? `remporté par ${e.perte_concurrent}${e.perte_montant_concurrent !== undefined ? ` à ${format.euros(e.perte_montant_concurrent)}` : ""}` : null,
      e.date_chantier ? `chantier le ${format.jour(e.date_chantier)}` : null,
      e.devis_accepte_id ? `devis accepté ${e.devis_accepte_id}` : null,
      e.acompte ? `acompte de ${paiementEnMots(e.acompte, contexte.maintenant)}, enregistré avec la signature` : null,
      e.sans_acompte ? `sans acompte (${libelleMotif(MOTIFS_SANS_ACOMPTE, e.sans_acompte.motif, e.sans_acompte.precision).toLowerCase()})` : null,
      e.solde ? `solde de ${paiementEnMots(e.solde, contexte.maintenant)}, enregistré avec le passage ; le client reçoit le mail « paiement reçu »` : null,
      e.survenu_le ? `passage daté du ${format.jour(e.survenu_le)}` : null,
    ].filter(Boolean);
    return `Je vais passer le dossier de ${r.ids.nom} à « ${LIBELLES_ETAPE[e.vers]} »${details.length ? ` : ${details.join(" ; ")}` : ""}.`;
  },
  executer: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    const dossierId = exigerDossier(r.ids);
    if (e.vers === "PERDU" && !e.motif_perte) throw new ErreurMetier("« Perdu » exige un motif (motif_perte) : PRIX (trop cher), CONCURRENT, SANS_REPONSE (plus de réponse), PROJET_ABANDONNE, HORS_ZONE, DELAI, ou AUTRE avec un commentaire. Demande-le à Lucas.", 400);
    const changement = await changerEtapeAvecPaiement(dossierId, entreeChangementEtape(e, contexte.maintenant) as Parameters<typeof changerEtapeAvecPaiement>[1]);
    const paiement = e.acompte ? ` Acompte de ${format.euros(e.acompte.montant)} enregistré.` : e.solde ? ` Solde de ${format.euros(e.solde.montant)} enregistré.` : "";
    return { texte: `Dossier de ${r.ids.nom} passé de « ${LIBELLES_ETAPE[changement.de as EtapeDossier] ?? changement.de} » à « ${LIBELLES_ETAPE[e.vers]} ».${paiement}${changement.avertissements?.length ? ` ${changement.avertissements.join(" ")}` : ""}`, donnees: changement, liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)] };
  },
});

export const outilNoterAppel = definirOutil({
  nom: "noter_appel",
  titre: "Noter un appel",
  description:
    "Note un appel avec son issue (INTERESSE, A_RAPPELER, PAS_DE_REPONSE, PAS_INTERESSE), un texte, des étiquettes (TROP_CHER, VEUT_REFLECHIR, LOCATAIRE, PROJET_LOINTAIN, COMPARE_DEVIS, VEUT_UN_RENDU, DEJA_DECIDE, PAS_JOIGNABLE) et, pour « à rappeler » ou « pas de réponse », le moment du rappel (« jeudi 14h », « demain » ; sans moment : demain 18 h pour « pas de réponse », sans date pour « à rappeler »). « Intéressé » ouvre son dossier et son espace ; « pas intéressé » exige motif_perte (le lead passe sans suite, ou le dossier perdu : sensible, aperçu puis confirmation, comme « changer_etape » Perdu). Écrit sur le dossier s'il existe, sinon sur le lead. La réponse donne le SMS proposé (code et texte, le lien de l'espace compris pour « intéressé ») : rien n'est envoyé, lis-le à Lucas, il le copie dans Messages ; quand il dit l'avoir envoyé, « noter_sms » avec ce code.",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({
    issue: z.enum(ISSUES_APPEL),
    texte: z.string().max(2000).optional(),
    etiquettes: z.array(z.enum(ETIQUETTES_APPEL)).max(8).optional(),
    rappel: z.string().max(60).optional().describe("Quand rappeler, tel que dicté : « jeudi 14h », « demain 10h », « 2026-09-25 14:00 »."),
    motif_perte: z.enum(MOTIFS_PERTE).optional().describe("Obligatoire pour PAS_INTERESSE : PRIX (trop cher), CONCURRENT, SANS_REPONSE (plus de réponse), PROJET_ABANDONNE, HORS_ZONE, DELAI (délai trop long), AUTRE (précisé dans « texte »)."),
  }),
  // « Pas intéressé » passe le dossier en Perdu (ou le lead sans suite) : la même perte que « changer_etape » PERDU,
  // « modifier » LEAD statut PERDU ou la tâche « client perdu », toutes sensibles — pas de chemin sans confirmation.
  sensible: (e) => e.issue === "PAS_INTERESSE",
  apercu: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu.texte;
    if (!e.motif_perte) throw new ErreurMetier(`« Pas intéressé » exige un motif (motif_perte) : ${MOTIFS_PERTE.filter((m) => m !== "AUTRE").map((m) => `${m} (${LIBELLES_MOTIF_PERTE[m].toLowerCase()})`).join(", ")}, ou AUTRE avec la précision dans « texte ». Demande-le à Lucas.`, 400);
    verifierMotifPerte(e.motif_perte, e.texte);
    const motif = LIBELLES_MOTIF_PERTE[e.motif_perte].toLowerCase();
    return `Je vais noter l'appel « pas intéressé » de ${r.ids.nom} (${motif}${e.texte ? `, « ${e.texte.slice(0, 120)} »` : ""}) : ${r.ids.dossierId ? "son dossier passe en « Perdu »" : "le lead passe sans suite"}, et la perte compte dans manager_commercial.`;
  },
  executer: async (e, contexte) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    if (e.issue === "PAS_INTERESSE" && !e.motif_perte) throw new ErreurMetier(`« Pas intéressé » exige un motif (motif_perte) : ${MOTIFS_PERTE.filter((m) => m !== "AUTRE").map((m) => `${m} (${LIBELLES_MOTIF_PERTE[m].toLowerCase()})`).join(", ")}, ou AUTRE avec la précision dans « texte ». Demande-le à Lucas.`, 400);
    // La règle unique de la perte (AUTRE exige une précision) : vérifiée avant d'écrire la note d'appel.
    if (e.issue === "PAS_INTERESSE") verifierMotifPerte(e.motif_perte, e.texte);
    let rappelLe: string | null = null;
    if (e.rappel) {
      const date = lireDateDictee(e.rappel, contexte.maintenant);
      if (!date) throw new ErreurMetier(`Je n'ai pas compris le moment du rappel « ${e.rappel} » : donne un jour et une heure (« jeudi 14h », « 2026-09-25 14:00 »).`, 400);
      rappelLe = date.toISOString();
    }
    if (r.ids.leadId && (e.texte || e.etiquettes?.length)) await creerNoteAppel(r.ids.leadId, { texte: e.texte ?? "", etiquettes: e.etiquettes ?? [] });
    const suite = await noterAppel(
      { ...(r.ids.dossierId ? { dossierId: r.ids.dossierId } : { leadId: r.ids.leadId ?? undefined }), issue: e.issue, note: e.texte ?? "", rappelLe, ...(e.issue === "PAS_INTERESSE" ? { motifPerte: e.motif_perte } : {}) },
      contexte.maintenant
    );
    // Mission 14 (parties 4 et 8) : le SMS proposé est dans la réponse (Lucas le copie depuis la conversation) ; plus de
    // mail proposé ; une fois envoyé, « noter_sms » trace la copie.
    const lignes = [`${suite.resume} (${r.ids.nom})`];
    if (suite.proposerSansSuite) lignes.push(`${suite.tentatives}ᵉ appel sans réponse d'affilée : propose à Lucas de classer sans suite (motif « Plus de réponse »), sans l'imposer.`);
    if (suite.sms) lignes.push(`SMS proposé (${suite.sms.code}) : « ${suite.sms.texte} » — une fois envoyé, dis-le-moi (« noter_sms »).`);
    return {
      texte: lignes.join("\n"),
      donnees: suite,
      liens: [suite.dossierId ? lien("Dossier", `/dossiers?dossier=${suite.dossierId}`) : lien("Lead", `/leads?lead=${suite.leadId}`)],
    };
  },
});

export const outilPlanifier = definirOutil({
  nom: "planifier",
  titre: "Planifier un rappel ou une action",
  description: "Planifie un rappel (lead) ou la prochaine action d'un dossier à un moment donné (« jeudi 14h », « demain 10h30 », « 2026-09-25 14:00 »), et l'inscrit dans Google Calendar si le droit est accordé (sinon l'outil le dit : rien n'est perdu, l'action est dans le CRM). message_id : depuis un mail (le bouton « Planifier » d'une date extraite) — l'action va sur le dossier du mail, sinon son lead. Réversible : replanifier remplace ; pour poser ou effacer la seule date de rappel d'un lead, sans agenda : « modifier » LEAD rappel_le.",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({ action: z.string().min(1).max(200).describe("« Rappeler », « Passer prendre les mesures »…"), quand: z.string().min(1).max(60), duree_minutes: z.number().int().min(5).max(480).optional().describe("Durée d'une action de dossier (30 min à défaut) ; un rappel dure toujours 15 minutes."), message_id: z.string().max(40).optional().describe("Le mail d'où vient la date (rendu par « lire_mail ») : la cible est celle du mail.") }),
  executer: async (e, contexte) => {
    const debut = lireDateDictee(e.quand, contexte.maintenant);
    if (!debut) throw new ErreurMetier(`Je n'ai pas compris « ${e.quand} » : donne un jour et une heure.`, 400);
    const origine = contexte.commande ? `« ${contexte.commande} » (application Claude)` : "application Claude";
    let p: Awaited<ReturnType<typeof planifierAction>>;
    let ids: { dossierId: string | null; leadId: string | null };
    if (e.message_id) {
      const r = await planifierDepuisMail(e.message_id, { debut, action: e.action, dureeMinutes: e.duree_minutes, origine: `${origine}, date lue dans un mail` });
      p = r;
      ids = { dossierId: r.dossierId, leadId: r.leadId };
    } else {
      const r = await cibler(e);
      if (r.ambigu) return r.ambigu;
      p = await planifierAction({ dossierId: r.ids.dossierId, leadId: r.ids.leadId, nom: r.ids.nom, action: e.action, debut, dureeMinutes: e.duree_minutes, origine });
      ids = r.ids;
    }
    return {
      texte: p.texte,
      donnees: { debut: p.debut, fin: p.fin, agenda: p.agenda, dossierId: ids.dossierId, leadId: ids.leadId },
      liens: [...(p.agenda?.lien ? [{ libelle: "Événement Google Calendar", href: p.agenda.lien }] : []), ids.dossierId ? lien("Dossier", `/dossiers?dossier=${ids.dossierId}`) : lien("Lead", `/leads?lead=${ids.leadId}`)],
    };
  },
});

const schemaLigne = z.object({
  designation: z.string().min(1).max(200),
  sous_designation: z.string().max(200).optional(),
  quantite: z.number().positive(),
  unite: z.enum(UNITES).describe("ml (mètre linéaire), jour ou forfait."),
  prix_unitaire: z.number().min(-1_000_000).max(1_000_000).describe("En euros, tel que dit par Lucas ou lu dans le CRM (jamais inventé). Négatif seulement sur une ligne « Remise … »."),
}).refine((l) => l.prix_unitaire >= 0 || /^remise/i.test(l.designation), { message: "Un prix négatif n'est permis que sur une ligne « Remise … ».", path: ["prix_unitaire"] });

type LignePrestation = { type: "PRESTATION"; designation: string; sousDesignation: string | undefined; quantite: number; unite: (typeof UNITES)[number]; prixUnitaire: number };
type LigneDocument = LignePrestation | { type: "SECTION"; libelle: string };
/** Une ligne de section (titre qui regroupe les prestations qui suivent, comme dans le générateur de l'écran). */
const schemaSection = z.object({ section: z.string().trim().min(1).max(200).describe("Titre de section (« Cuisine », « Salle de bain »).") });
const schemaLigneOuSection = z.union([schemaSection, schemaLigne]);
type LigneDictee = z.output<typeof schemaLigneOuSection>;
type EntreeGeneration = { type: "DEVIS" | "FACTURE"; objet: string; lignes?: LigneDictee[]; remise?: number; depuis_devis?: string; avenant_de?: string; remplace?: string; depuis_espace?: boolean };

/** Les lignes préremplies d'après l'espace du client (`devisProposeDuDossier`, comme le bouton DEVIS de l'écran). */
async function lignesDeLEspace(dossierId: string): Promise<{ lignes: LigneDocument[]; resume: string }> {
  const propose = await devisProposeDuDossier(dossierId);
  if (!propose) throw new ErreurMetier("L'espace du client ne dit encore rien à chiffrer (aucune prestation cochée, aucune simulation validée) : dicte les lignes.", 409);
  const aSaisir = propose.lignes.filter((l) => l.quantite === null || l.prixUnitaire === null);
  const enMots = propose.lignes.map((l) => `${l.designation}${l.sousDesignation ? ` (${l.sousDesignation})` : ""} : ${l.quantite ?? "quantité à saisir"} ${l.unite} × ${l.prixUnitaire === null ? "prix à saisir" : format.euros(l.prixUnitaire)}`).join(" ; ");
  if (aSaisir.length) throw new ErreurMetier(`${propose.resume} Lignes préremplies : ${enMots}. ${pluriel(aSaisir.length, "ligne n'a pas", "lignes n'ont pas")} sa quantité ou son prix : demande-les à Lucas, puis redonne toutes les lignes dans « lignes » (sans depuis_espace).`, 409);
  return { lignes: propose.lignes.map((l) => ({ type: "PRESTATION" as const, designation: l.designation, sousDesignation: l.sousDesignation || undefined, quantite: l.quantite!, unite: l.unite, prixUnitaire: l.prixUnitaire! })), resume: propose.resume };
}

/**
 * Mission 11 : les lignes du document à émettre — celles dictées, ou celles du devis
 * d'origine (facture depuis un devis, avenant), plus la remise ; l'objet, préfixé pour un avenant.
 */
async function composerGeneration(dossierId: string, e: EntreeGeneration): Promise<{ type: "DEVIS" | "FACTURE"; objet: string; lignes: LigneDocument[]; origine: { id: string; numero: string } | null; remplace: { id: string; numero: string } | null }> {
  const origineId = e.depuis_devis ?? e.avenant_de ?? null;
  let origine: { id: string; numero: string; lignes: LigneDocument[]; objet: string } | null = null;
  if (origineId) {
    const d = await prisma.document.findFirst({ where: { id: origineId, dossierId, archiveLe: null, numero: { not: null } } });
    if (!d?.numero) throw new ErreurMetier(`Document ${origineId} introuvable dans ce dossier (identifiant rendu par « lire_fiche »).`, 404);
    if (e.depuis_devis && d.type !== "DEVIS") throw new ErreurMetier("depuis_devis attend un devis.", 400);
    origine = { id: d.id, numero: d.numero, objet: d.objet, lignes: lireLignes(d.lignes) as LigneDocument[] };
  }
  let remplace: { id: string; numero: string } | null = null;
  if (e.remplace) {
    const d = await prisma.document.findFirst({ where: { id: e.remplace, dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } }, select: { id: true, numero: true, statut: true } });
    if (!d?.numero) throw new ErreurMetier(`Devis ${e.remplace} introuvable dans ce dossier.`, 404);
    if (d.statut === "ACCEPTE") throw new ErreurMetier(`Le devis ${d.numero} est accepté : il ne se remplace pas (retirer l'accord d'abord).`, 409);
    remplace = { id: d.id, numero: d.numero };
  }
  const dictees: LigneDocument[] = (e.lignes ?? []).map((l) => ("section" in l ? { type: "SECTION" as const, libelle: l.section } : { type: "PRESTATION" as const, designation: l.designation, sousDesignation: l.sous_designation, quantite: l.quantite, unite: l.unite, prixUnitaire: l.prix_unitaire }));
  const deLEspace = !dictees.length && !origine && e.depuis_espace ? (await lignesDeLEspace(dossierId)).lignes : [];
  const lignes: LigneDocument[] = dictees.length ? dictees : origine ? origine.lignes.map((l) => (l.type === "PRESTATION" ? { ...l, sousDesignation: l.sousDesignation ?? undefined } : l)) : deLEspace;
  if (e.remise && e.remise > 0) lignes.push({ type: "PRESTATION", designation: "Remise commerciale", sousDesignation: undefined, quantite: 1, unite: "forfait", prixUnitaire: -e.remise });
  if (!lignes.some((l) => l.type === "PRESTATION")) throw new ErreurMetier("Aucune ligne : donne les lignes, depuis_devis / avenant_de pour reprendre celles d'un devis, ou depuis_espace pour les lignes préremplies d'après l'espace du client.", 400);
  const type = e.depuis_devis ? "FACTURE" : e.type;
  const objet = e.avenant_de && origine ? `Avenant au devis ${origine.numero} — ${e.objet || origine.objet}`.slice(0, 160) : e.objet || origine?.objet || "";
  if (!objet) throw new ErreurMetier("L'objet du document manque.", 400);
  return { type, objet, lignes, origine: origine ? { id: origine.id, numero: origine.numero } : null, remplace };
}

const totalDe = (lignes: LigneDocument[]) => lignes.reduce((t, l) => (l.type === "PRESTATION" ? t + l.quantite * l.prixUnitaire : t), 0);
const ligneEnMots = (l: LigneDocument) => (l.type === "PRESTATION" ? `${l.designation} ${l.quantite} ${l.unite} × ${format.euros(l.prixUnitaire)}` : `[${l.libelle}]`);

export const outilGenererDocument = definirOutil({
  nom: "generer_document",
  titre: "Générer un devis ou une facture",
  description:
    "Émet un devis ou une facture avec ses lignes (désignation, quantité, unité, prix unitaire ; lignes de section pour regrouper ; une ligne « Remise … » peut avoir un prix négatif, ou donne « remise » en euros), sur un dossier existant. depuis_espace: true préremplit les lignes d'après l'espace du client (le bouton DEVIS des tâches) : l'aperçu les montre avant tout. Un dossier porte autant de devis que nécessaire : un nouveau devis S'AJOUTE aux devis proposés (libelle_variante : « façades seules », « façades + plan de travail » ; le client en choisira un dans son espace) — il ne remplace un devis existant que si « remplace » (identifiant) le dit. notifier: false évite le mail automatique « votre devis est disponible » (vrai par défaut). Générer n'est pas envoyer : un devis n'est « envoyé » (étape Devis envoyé, main au client, relances) que s'il est annoncé par ce mail (adresse valide, espace ouvert) ; sinon il reste à envoyer — masqué dans son espace en Qualification ou Simulation, tâche « Envoyer le devis » — jusqu'à l'envoi par mail (envoyer_document) ou sa mise en ligne (modifier DOCUMENT, visible_espace: true). depuis_devis (identifiant) fait la facture à partir des lignes du devis (lignes facultatives) ; avenant_de (identifiant) émet un avenant (objet préfixé, lignes du devis reprises ou dictées). Une facture ne se génère que sur un dossier signé (ou plus loin). Le document est numéroté, figé, rangé dans le dossier. Sensible : aperçu puis confirmation. Les prix viennent de Lucas ou des tarifs du CRM, jamais d'une estimation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({
    type: z.enum(["DEVIS", "FACTURE"]),
    objet: z.string().max(160).optional().describe("Obligatoire, sauf depuis_devis / avenant_de (repris du devis)."),
    lignes: z.array(schemaLigneOuSection).max(60).optional().describe("Les lignes, dans l'ordre : prestation { designation, sous_designation, quantite, unite, prix_unitaire } ou section { section } (titre qui regroupe les suivantes). Obligatoires, sauf depuis_devis / avenant_de / depuis_espace."),
    depuis_espace: z.boolean().optional().describe("Devis prérempli d'après l'espace du client (prestations cochées, teintes de la simulation validée, métré donné, tarifs du CRM) : l'aperçu montre les lignes ; une quantité ou un prix manquant est demandé à Lucas."),
    acompte_pct: z.number().int().min(0).max(100).optional().describe("Devis : pourcentage d'acompte (30 par défaut)."),
    note_ml: z.boolean().optional().describe("Mention « mètre linéaire » sur le document (vrai par défaut)."),
    libelle_variante: z.string().trim().max(80).optional().describe("Devis : le libellé de la variante, visible par le client (« façades seules »)."),
    notifier: z.boolean().optional().describe("Devis : faux = pas de mail « votre devis est disponible » (vrai par défaut) ; en Qualification ou Simulation, le devis reste alors masqué et à envoyer."),
    remplace: z.string().max(40).optional().describe("Devis : identifiant du devis remplacé (il passe « Remplacé »). Sans lui, le nouveau devis s'ajoute."),
    depuis_devis: z.string().max(40).optional().describe("Facture depuis ce devis : ses lignes sont reprises."),
    avenant_de: z.string().max(40).optional().describe("Avenant à ce devis : objet préfixé « Avenant au devis N° », lignes reprises sauf lignes dictées."),
    remise: z.number().positive().max(1_000_000).optional().describe("Remise en euros HT : ajoute une ligne « Remise commerciale » négative."),
  }),
  apercu: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    const dossierId = exigerDossier(r.ids);
    const c = await composerGeneration(dossierId, { type: e.type, objet: e.objet ?? "", lignes: e.lignes, remise: e.remise, depuis_devis: e.depuis_devis, avenant_de: e.avenant_de, remplace: e.remplace, depuis_espace: e.depuis_espace });
    const proposes = c.type === "DEVIS" && !c.remplace ? await prisma.document.findMany({ where: { dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, select: { numero: true, libelleVariante: true } }) : [];
    // Mission 18 (B1) : générer n'est pas envoyer — l'aperçu dit ce qui se passera, avec la même règle que l'émission.
    const envoi = c.type === "DEVIS" ? await envoiPrevu(dossierId, e.notifier !== false) : "";
    return `Je vais émettre ${c.type === "DEVIS" ? "un devis" : "une facture"} « ${c.objet} »${e.libelle_variante ? ` (variante « ${e.libelle_variante} »)` : ""} pour ${r.ids.nom} : ${c.lignes.map(ligneEnMots).join(" ; ")} — total ${format.euros(totalDe(c.lignes))}${c.type === "DEVIS" ? `, acompte ${e.acompte_pct ?? 30} %` : ""}.${c.remplace ? ` Il remplace le devis ${c.remplace.numero} (qui passe « Remplacé »).` : ""}${c.origine ? ` ${e.depuis_devis ? "Fait d'après" : "Avenant au"} devis ${c.origine.numero}.` : ""}${proposes.length ? ` Il s'ajoute ${proposes.length > 1 ? `aux ${proposes.length} devis déjà proposés` : `au devis ${proposes[0].numero} déjà proposé`} : le client en choisira un.` : ""} Le document sera numéroté et figé${envoi}.`;
  },
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    const dossierId = exigerDossier(r.ids);
    const c = await composerGeneration(dossierId, { type: e.type, objet: e.objet ?? "", lignes: e.lignes, remise: e.remise, depuis_devis: e.depuis_devis, avenant_de: e.avenant_de, remplace: e.remplace, depuis_espace: e.depuis_espace });
    if (c.type === "FACTURE") {
      const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { etape: true } });
      if (!ETAPES_FACTURABLES.includes(dossier.etape as EtapeDossier)) throw new ErreurMetier(`Une facture ne se génère que sur un dossier signé ; celui de ${r.ids.nom} est à « ${LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape} ».`, 409);
    }
    const resultat = await genererDocument(dossierId, {
      type: c.type,
      objet: c.objet,
      lignes: c.lignes,
      noteMl: e.note_ml ?? true,
      acomptePct: c.type === "DEVIS" ? (e.acompte_pct ?? 30) : null,
      remplaceDocumentId: c.type === "DEVIS" && c.remplace ? c.remplace.id : null,
      libelleVariante: c.type === "DEVIS" ? e.libelle_variante || null : null,
      notifier: e.notifier,
    });
    const { document, envoi } = resultat as { document: { id: string; numero: string | null; totalHt: number }; envoi?: { visible: boolean; envoye: boolean; mail: boolean } | null };
    return {
      texte: `${c.type === "DEVIS" ? "Devis" : "Facture"} ${document.numero ?? ""}${e.libelle_variante ? ` « ${e.libelle_variante} »` : ""} émis${c.type === "FACTURE" ? "e" : ""} pour ${r.ids.nom} : ${format.euros(document.totalHt)}.${c.remplace ? ` Remplace le devis ${c.remplace.numero}.` : ""}${c.origine ? ` ${e.depuis_devis ? "D'après le" : "Avenant au"} devis ${c.origine.numero}.` : ""} Rangé${c.type === "FACTURE" ? "e" : ""} dans le dossier${!envoi ? "" : envoi.envoye ? `, proposé dans son espace${envoi.mail ? " et annoncé par mail" : ", sans mail"} : il est envoyé` : `, ${envoi.visible ? "visible dans son espace sans annonce" : "masqué dans son espace"} : PAS encore envoyé (tâche « Envoyer le devis » ; envoyer_document pour l'envoyer par mail)`}.`,
      donnees: { documentId: document.id, numero: document.numero, totalHt: document.totalHt, dossierId, libelleVariante: e.libelle_variante ?? null, remplace: c.remplace, origine: c.origine, envoye: envoi?.envoye ?? null, visibleEspace: envoi?.visible ?? null },
      liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)],
    };
  },
});

/** Ce que la génération d'un devis fera, dit à l'aperçu (mission 18, B1 : la règle de documents.ts › emettre). */
async function envoiPrevu(dossierId: string, notifier: boolean): Promise<string> {
  const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { etape: true } });
  const etat = await peutNotifier("DEVIS_DISPONIBLE", dossierId);
  const prevu = envoiALaGeneration({ etape: dossier.etape as EtapeDossier, notifier, ...etat });
  const sansMail = !notifier ? " ; aucun mail ne partira (notifier: false)" : !etat.modeleActif ? " ; le mail « votre devis est disponible » est coupé dans Paramètres" : "";
  if (prevu.envoye) return prevu.mail ? ", et le client recevra le mail « votre devis est disponible » : le devis sera envoyé" : `${sansMail} : mis en ligne dans son espace, il vaut envoi`;
  const pourquoi = sansMail ? "" : ` (${(etat.raison ?? "pas d'annonce possible").replace(/\.$/, "").toLowerCase()})`;
  return `${sansMail} ; il ne sera PAS envoyé${pourquoi} : ${prevu.visible ? "visible dans son espace sans annonce" : "masqué dans son espace"}, à envoyer ensuite (tâche « Envoyer le devis »)`;
}

export const outilEnvoyerDocument = definirOutil({
  nom: "envoyer_document",
  titre: "Envoyer un devis ou une facture par mail",
  description: "Envoie par mail, en pièce jointe, un devis ou une facture déjà émis (identifiant du document, rendu par « lire_fiche » ou « generer_document »). Le texte du mail est proposé par le CRM et peut être remplacé. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: z.object({ dossierId: z.string().max(40), documentId: z.string().max(40), a: z.email().optional().describe("Destinataire ; à défaut l'adresse du client."), objet: z.string().max(200).optional(), texte: z.string().max(10_000).optional() }),
  apercu: async (e) => {
    const b = await brouillonEnvoiDocument(e.dossierId, e.documentId);
    return `Je vais envoyer « ${e.objet ?? b.objet} » à ${e.a ?? (b.a || "(adresse manquante)")} avec le document en pièce jointe :\n${(e.texte ?? b.texte).slice(0, 800)}`;
  },
  executer: async (e, contexte) => {
    const b = await brouillonEnvoiDocument(e.dossierId, e.documentId);
    const a = e.a ?? b.a;
    if (!a) throw new ErreurMetier("Aucune adresse e-mail pour ce client : indique-la (paramètre « a »).", 409);
    const proposition = await envoyerDocumentParMail(e.dossierId, e.documentId, { a, objet: e.objet ?? b.objet, texte: e.texte ?? b.texte });
    // Confirmé par Lucas dans Claude : la proposition est validée dans la foulée (même chemin d'envoi que depuis le CRM).
    await validerProposition(proposition.id);
    void contexte;
    return { texte: `Mail envoyé à ${a} avec le document en pièce jointe (« ${e.objet ?? b.objet} »).`, donnees: { propositionId: proposition.id }, liens: [lien("Dossier", `/dossiers?dossier=${e.dossierId}`)] };
  },
});

/**
 * Le code par défaut, comme l'écran : LIEN_ESPACE tant que le projet en est aux photos (rien dans l'espace), sinon
 * LIEN_ESPACE_RAPPEL (projet, simulations, devis ou accord déjà là).
 */
export async function codeLienParDefaut(dossierId: string | null): Promise<(typeof CODES_LIEN_MAIL)[number]> {
  if (!dossierId) return "LIEN_ESPACE";
  const espace = await prisma.espaceClient.findUnique({ where: { dossierId }, select: { souhaits: true, choix: true, _count: { select: { simulations: true } } } });
  if (!espace) return "LIEN_ESPACE";
  const devis = await prisma.document.count({ where: { dossierId, type: "DEVIS", archiveLe: null, visibleEspace: true, numero: { not: null } } });
  return espace.souhaits || espace.choix || espace._count.simulations > 0 || devis > 0 ? "LIEN_ESPACE_RAPPEL" : "LIEN_ESPACE";
}

export const outilEnvoyerLienEspace = definirOutil({
  nom: "envoyer_lien_espace",
  titre: "Envoyer le lien de l'espace client par mail",
  description: "Ouvre l'espace du client s'il ne l'est pas (et son dossier) et lui envoie par mail le lien, avec la phrase adaptée : LIEN_ESPACE (déposer les photos), INJOIGNABLE_LIEN (« j'ai essayé de vous joindre »), LIEN_ESPACE_RAPPEL (renvoyer le lien d'un projet en cours). Sans code : LIEN_ESPACE tant que l'espace est vide, sinon LIEN_ESPACE_RAPPEL (la règle de l'écran). a, objet et phrase remplacent ceux proposés. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ code: z.enum(CODES_LIEN_MAIL).optional(), objet: z.string().trim().min(2).max(150).optional().describe("Remplace l'objet proposé."), phrase: z.string().trim().min(10).max(600).optional().describe("Remplace la phrase proposée."), a: z.email().optional() }),
  apercu: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu.texte;
    const p = await apercuLienParMail({ dossierId: r.ids.dossierId, leadId: r.ids.leadId, code: e.code ?? (await codeLienParDefaut(r.ids.dossierId)) });
    return `${p.dossierId ? "" : "J'ouvrirai son dossier et son espace, puis j"}${p.dossierId ? "Je" : "e"} vais envoyer à ${e.a ?? p.a ?? "(adresse manquante)"} le mail « ${e.objet ?? p.objet} » (${p.code}) : « Bonjour${p.prenom ? ` ${p.prenom}` : ""}, ${e.phrase ?? p.phrase} » avec le bouton « ${p.bouton} » vers son espace.`;
  },
  executer: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    const p = await proposerLienParMail({ dossierId: r.ids.dossierId, leadId: r.ids.leadId, code: e.code ?? (await codeLienParDefaut(r.ids.dossierId)) });
    const a = e.a ?? p.a;
    if (!a) throw new ErreurMetier("Aucune adresse e-mail pour ce contact : indique-la (paramètre « a »).", 409);
    const envoi = await envoyerLienParMail({ dossierId: p.dossierId, code: p.code, a, objet: e.objet ?? p.objet, phrase: e.phrase ?? p.phrase, jeton: randomBytes(6).toString("hex") });
    return { texte: `Mail avec le lien de l'espace ${envoi.deja ? "déjà parti" : "envoyé"} à ${a} (${r.ids.nom}, ${p.code}).`, donnees: { dossierId: p.dossierId, envoiId: envoi.envoiId, code: p.code }, liens: [lien("Dossier", `/dossiers?dossier=${p.dossierId}`)] };
  },
});

/** La pièce réglée, dite par son numéro (« F-2026-012 », « 2026-038 ») ou l'identifiant du registre : la ligne du registre. */
async function pieceDuRegistre(piece: string): Promise<{ id: string; numero: string; type: string; documentId: string | null }> {
  const brut = piece.trim();
  const ligne = (await prisma.numeroDocument.findUnique({ where: { id: brut }, select: { id: true, numero: true, type: true, documentId: true } })) ?? (await prisma.numeroDocument.findFirst({ where: { numero: brut }, orderBy: { createdAt: "desc" }, select: { id: true, numero: true, type: true, documentId: true } }));
  if (!ligne) throw new ErreurMetier(`Pièce « ${piece} » introuvable au registre : donne le numéro tel qu'imprimé (« lister » ENCOURS ou « etat_crm » NUMEROTATION).`, 404);
  return ligne;
}

export const outilSaisirEncaissement = definirOutil({
  nom: "saisir_encaissement",
  titre: "Saisir un encaissement",
  description:
    "Enregistre un paiement reçu (montant, moyen, date de réception, référence, date de crédit d'un chèque, note), par la même fonction que l'écran. piece = le numéro du devis (acompte) ou de la facture réglée ; sans pièce, imputation automatique sur les pièces du dossier. Une facture hors CRM (sans dossier) se règle avec piece seule. payeur : le nom du payeur s'il n'est pas le client. Le dossier suit (acompte reçu, soldé) ; le client reçoit le mail « paiement reçu ». Pour signer ou passer « encaissé » avec le paiement dans la même opération : « changer_etape » (acompte, solde). Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.partial().extend({
    ...schemaPaiementOutil.shape,
    piece: z.string().max(40).optional().describe("Numéro du devis ou de la facture réglé (ou identifiant du registre)."),
    payeur: z.string().max(160).optional().describe("Nom du payeur, s'il n'est pas le client."),
  }),
  apercu: async (e, contexte) => {
    const piece = e.piece ? await pieceDuRegistre(e.piece) : null;
    let nom = "";
    if (e.dossierId || e.clientId || e.leadId || e.nom) {
      const r = await cibler({ dossierId: e.dossierId, clientId: e.clientId, leadId: e.leadId, nom: e.nom }, "DOSSIER");
      if (r.ambigu) return r.ambigu.texte;
      nom = r.ids.nom;
    }
    return `Je vais enregistrer un encaissement de ${paiementEnMots(e, contexte.maintenant)}${nom ? ` sur le dossier de ${nom}` : ""}${piece ? `, imputé sur ${piece.type === "DEVIS" ? "le devis" : "la facture"} ${piece.numero}` : ", imputé automatiquement"}${e.payeur ? `, payé par ${e.payeur}` : ""}. Le client recevra le mail « paiement reçu ».`;
  },
  executer: async (e, contexte) => {
    let dossierId: string | null = null;
    let nom: string | null = null;
    if (e.dossierId || e.clientId || e.leadId || e.nom) {
      const r = await cibler({ dossierId: e.dossierId, clientId: e.clientId, leadId: e.leadId, nom: e.nom }, "DOSSIER");
      if (r.ambigu) return r.ambigu;
      dossierId = exigerDossier(r.ids);
      nom = r.ids.nom;
    }
    const piece = e.piece ? await pieceDuRegistre(e.piece) : null;
    if (!dossierId && !piece) throw new ErreurMetier("Donne le dossier, ou la pièce réglée (numéro de la facture) pour une facture hors CRM.", 400);
    const entree = analyser(schemaEncaissement, { paiement: paiementDuService(e, contexte.maintenant), numeroDocumentId: piece?.id ?? null, payeur: e.payeur ?? null });
    const resultat = await enregistrerEncaissement({ ...entree, dossierId });
    const cible = resultat.dossierId ?? dossierId;
    return { texte: `Encaissement de ${format.euros(e.montant)} enregistré${nom ? ` sur le dossier de ${nom}` : ""}${piece ? ` (${piece.numero})` : ""}.`, donnees: { encaissementId: resultat.encaissement.id, dossierId: cible, piece: piece?.numero ?? null }, liens: [cible ? lien("Dossier", `/dossiers?dossier=${cible}`) : lien("Finances", "/finances")] };
  },
});

export const outilAnnulerEncaissement = definirOutil({
  nom: "annuler_encaissement",
  titre: "Annuler un encaissement, ou rejeter un chèque",
  description:
    "Deux gestes de l'écran sur un paiement enregistré (identifiant rendu par « lire_fiche » ou « lister » CHEQUES). nature ANNULER (défaut) : saisi par erreur (motif ERREUR_MONTANT, ERREUR_DATE, ERREUR_PIECE, DOUBLON, AUTRE). nature REJETER : chèque revenu impayé (motif SANS_PROVISION, OPPOSITION, IRREGULIER, AUTRE ; le = jour du rejet) ; le dossier recule si l'acompte ou le solde n'est plus réglé. L'encaissement reste dans l'historique, marqué annulé ou rejeté. Pour corriger un montant ou une date sans annuler : « modifier » ENCAISSEMENT. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: z.object({
    encaissementId: z.string().max(40),
    nature: z.enum(["ANNULER", "REJETER"]).optional().describe("ANNULER (défaut) ou REJETER (chèque impayé)."),
    motif: z.enum([...new Set([...MOTIFS_ANNULATION, ...MOTIFS_REJET].map((m) => m.code))] as [string, ...string[]]),
    precision: z.string().max(300).optional(),
    le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("REJETER : le jour du rejet (aujourd'hui par défaut)."),
  }),
  apercu: async (e) => {
    const enc = await prisma.encaissement.findUnique({ where: { id: e.encaissementId }, select: { montant: true, payeur: true, recuLe: true, moyen: true } });
    if (!enc) return "Encaissement introuvable.";
    if (e.nature === "REJETER") return `Je vais marquer rejeté le chèque de ${format.euros(enc.montant)} (${enc.payeur}, reçu le ${format.jour(enc.recuLe)}) : ${libelleMotif(MOTIFS_REJET, e.motif, e.precision).toLowerCase()}, le ${format.jour(e.le ?? jourParis(new Date()))}. Le dossier recule si ce paiement réglait l'acompte ou le solde.`;
    return `Je vais annuler l'encaissement de ${format.euros(enc.montant)} (${enc.payeur}, reçu le ${format.jour(enc.recuLe)}) pour le motif ${libelleMotif(MOTIFS_ANNULATION, e.motif, e.precision).toLowerCase()}.`;
  },
  executer: async (e, contexte) => {
    if (e.nature === "REJETER") {
      const entree = analyser(schemaRejet, { motif: e.motif, precision: e.precision, le: e.le ?? jourParis(contexte.maintenant) });
      const dossierId = await rejeterEncaissement(e.encaissementId, entree);
      return { texte: "Chèque marqué rejeté : il reste dans l'historique, le dossier suit.", donnees: { dossierId }, liens: [dossierId ? lien("Dossier", `/dossiers?dossier=${dossierId}`) : lien("Finances", "/finances")] };
    }
    const entree = analyser(schemaAnnulation, { motif: e.motif, precision: e.precision });
    const dossierId = await annulerEncaissement(e.encaissementId, entree);
    return { texte: "Encaissement annulé : il reste dans l'historique, marqué annulé ; le dossier suit.", donnees: { dossierId }, liens: [dossierId ? lien("Dossier", `/dossiers?dossier=${dossierId}`) : lien("Finances", "/finances")] };
  },
});

export const outilRedigerMail = definirOutil({
  nom: "rediger_mail",
  titre: "Rédiger un mail avec l'IA du CRM",
  description: "Demande au CRM un brouillon de mail à un client (réponse à un mail reçu, ou nouveau mail à un contact), rédigé par l'IA avec tout le contexte du dossier et une garde qui remplace par « [à compléter] » tout prix, date ou délai absent du CRM. Coût ≈ 0,015 € par brouillon. Rien n'est envoyé : relis, puis « envoyer_mail ».",
  niveau: "LECTURE",
  schema: schemaCible.partial().extend({ messageId: z.string().max(40).optional().describe("Le mail reçu auquel répondre (rendu par « lister » MAILS ou « lire_mail »)."), consigne: z.string().max(500).optional() }),
  executer: async (e) => {
    let clientId = e.clientId ?? null;
    let leadId = e.leadId ?? null;
    let dossierId = e.dossierId ?? null;
    if (!e.messageId && (e.nom || clientId || leadId || dossierId)) {
      const r = await cibler({ dossierId: e.dossierId, clientId: e.clientId, leadId: e.leadId, nom: e.nom });
      if (r.ambigu) return r.ambigu;
      clientId = r.ids.clientId;
      leadId = r.ids.leadId;
      dossierId = r.ids.dossierId;
    }
    const ia = await etatIa(new Date(), "IA_REDACTION");
    if (!ia.active) throw new ErreurMetier(`L'IA du CRM n'écrit pas : ${ia.raison ?? "en pause"} Rédige le brouillon toi-même et dépose-le avec « deposer_brouillon ».`, 409);
    const b = await redigerBrouillon({ messageId: e.messageId ?? null, clientId, leadId, dossierId, consigne: e.consigne ?? null });
    return { texte: `Brouillon (≈ ${b.coutEuros.toFixed(3).replace(".", ",")} €) à ${b.a ?? "(destinataire à préciser)"}, objet « ${b.objet} » :\n${b.texte}${b.manques.length ? `\n\nÀ compléter avant d'envoyer : ${b.manques.join(", ")}.` : ""}\nPour envoyer : « envoyer_mail » avec brouillonId ${b.id}${b.enReponseA ? `, en_reponse_a ${b.enReponseA}` : ""}.`, donnees: b };
  },
});

export const outilEnvoyerMail = definirOutil({
  nom: "envoyer_mail",
  titre: "Envoyer un mail à un client",
  description: "Envoie un mail depuis la boîte Gmail du CRM, dans la conversation s'il répond à un mail reçu (en_reponse_a). Le texte est celui que Lucas a relu (souvent le brouillon de « rediger_mail », corrigé). Un « [à compléter] » restant bloque l'envoi. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.partial().extend({ a: z.email(), objet: z.string().min(1).max(200), texte: z.string().min(1).max(20_000), en_reponse_a: z.string().max(40).optional(), brouillonId: z.string().max(40).optional() }),
  apercu: async (e) => `Je vais envoyer à ${e.a}, objet « ${e.objet} » :\n${e.texte.slice(0, 1200)}${e.texte.length > 1200 ? "…" : ""}`,
  executer: async (e) => {
    let clientId = e.clientId ?? null;
    let leadId = e.leadId ?? null;
    let dossierId = e.dossierId ?? null;
    if (e.nom && !clientId && !leadId && !dossierId) {
      const r = await cibler({ nom: e.nom });
      if (r.ambigu) return r.ambigu;
      clientId = r.ids.clientId;
      leadId = r.ids.leadId;
      dossierId = r.ids.dossierId;
    }
    const { envoiId } = await envoyerDepuisLOnglet({ a: e.a, objet: e.objet, texte: e.texte, enReponseA: e.en_reponse_a ?? null, brouillonId: e.brouillonId ?? null, clientId, leadId, dossierId });
    return { texte: `Mail envoyé à ${e.a} (« ${e.objet} »). Il part de la boîte Gmail et s'inscrit dans le dossier.`, donnees: { envoiId }, liens: [lien("Mail", "/mail")] };
  },
});

export const OUTILS_ECRITURE = [outilChangerEtape, outilNoterAppel, outilPlanifier, outilGenererDocument, outilEnvoyerDocument, outilEnvoyerLienEspace, outilSaisirEncaissement, outilAnnulerEncaissement, outilSupprimer, outilRedigerMail, outilEnvoyerMail];
