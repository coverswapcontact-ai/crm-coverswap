import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { noterAppel } from "@/lib/commercial/appels";
import { noterRapidement } from "@/lib/commercial/appels";
import { ISSUES_APPEL } from "@/lib/commercial/constantes";
import { creerNoteAppel } from "@/lib/commercial/notes-appel";
import { ETIQUETTES_APPEL } from "@/lib/commercial/notes-constantes";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { etatIa } from "@/lib/ia/modele";
import { CATEGORIES_DEPENSE, MOYENS_DEPENSE } from "@/lib/depenses/constantes";
import { creerDepense } from "@/lib/depenses/service";
import { archiverDossier, restaurerDossier } from "@/lib/dossiers/archivage";
import { ETAPES, LIBELLES_ETAPE, MOTIFS_PERTE, UNITES, type EtapeDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { ouvrirDossierDuLead } from "@/lib/dossiers/depuis-lead";
import { genererDocument } from "@/lib/dossiers/documents";
import { changerEtape } from "@/lib/dossiers/transitions";
import { MOTIFS_ANNULATION, MOYENS_PAIEMENT } from "@/lib/encaissements/constantes";
import { annulerEncaissement, enregistrerEncaissement } from "@/lib/encaissements/service";
import { regenererLien } from "@/lib/espace/gestion";
import { accorderSimulations } from "@/lib/espace/service";
import { envoyerDepuisLOnglet } from "@/lib/mail/detail";
import { CODES_LIEN_MAIL, envoyerLienParMail, proposerLienParMail } from "@/lib/mail/lien-espace";
import { redigerBrouillon } from "@/lib/mail/redaction";
import { brouillonEnvoiDocument, envoyerDocumentParMail } from "@/lib/mail/service";
import { appliquerActionLeads } from "@/lib/prospects/menage";
import { MOTIFS_ARCHIVAGE } from "@/lib/prospects/menage-constantes";
import { changerStatutSimulation, listerSimulationsDossier, publierSimulations } from "@/lib/simulations/dossier";
import { validerProposition } from "@/lib/validation/service";
import { planifierAction } from "@/lib/agenda/planification";
import { lireDateDictee } from "../agenda";
import { definirOutil, format, lien, type ResultatOutil } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";

/**
 * Les outils d'écriture (mission 8). Chacun appelle le code du CRM, rien de
 * plus ; le niveau dit ce que le moteur exige avant d'agir. Rien ne se
 * supprime : « supprimer » archive. Toute ambiguïté sur la personne rend les
 * candidats au lieu de choisir.
 */

const ETAPES_SENSIBLES: EtapeDossier[] = ["SIGNE", "FACTURE", "ENCAISSE", "PERDU"];
const ETAPES_FACTURABLES: EtapeDossier[] = ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"];

const exigerDossier = (ids: { dossierId: string | null; nom: string }) => {
  if (!ids.dossierId) throw new ErreurMetier(`${ids.nom} n'a pas de dossier ouvert : ouvre-le d'abord (outil « ouvrir_dossier »).`, 409);
  return ids.dossierId;
};

export const outilOuvrirDossier = definirOutil({
  nom: "ouvrir_dossier",
  titre: "Ouvrir un dossier depuis un lead",
  description: "Ouvre le dossier d'un lead (coordonnées, projet, photos et simulations repris). Réversible : « archiver » le referme. Si le lead a déjà un dossier, rien n'est créé et l'outil le dit.",
  niveau: "REVERSIBLE",
  schema: schemaCible,
  executer: async (cible) => {
    const r = await cibler(cible, cible.leadId ? undefined : "LEAD");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.leadId) throw new ErreurMetier("Ce contact n'est pas un lead : un dossier s'ouvre depuis un lead.", 400);
    if (r.ids.dossierId) return { texte: `${r.ids.nom} a déjà un dossier ouvert.`, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
    const ouverture = await ouvrirDossierDuLead(r.ids.leadId, { motif: "BOUTON" });
    return { texte: `Dossier ${ouverture.cree ? "ouvert" : "retrouvé"} pour ${r.ids.nom}${ouverture.photosRangees ? `, ${ouverture.photosRangees} photo(s) rangée(s)` : ""}${ouverture.simulationsRangees ? `, ${ouverture.simulationsRangees} simulation(s) rangée(s)` : ""}.`, donnees: { dossierId: ouverture.dossierId, cree: ouverture.cree }, liens: [lien("Ouvrir le dossier", `/dossiers?dossier=${ouverture.dossierId}`)] };
  },
});

export const outilChangerEtape = definirOutil({
  nom: "changer_etape",
  titre: "Changer l'étape d'un dossier",
  description:
    "Passe un dossier à une autre étape (qualification, simulation, devis envoyé, relance, signé, planifié, chantier, facturé, encaissé, perdu, en pause). Le CRM vérifie les conditions et refuse avec la raison (devis manquant, accord manquant…). Passer à « signé », « facturé », « encaissé » ou « perdu » demande une confirmation. « Perdu » demande un motif.",
  niveau: "REVERSIBLE",
  sensible: (e) => ETAPES_SENSIBLES.includes(e.vers),
  schema: schemaCible.extend({
    vers: z.enum(ETAPES).describe("L'étape visée."),
    motif_perte: z.enum(MOTIFS_PERTE).optional().describe("Obligatoire pour « perdu »."),
    commentaire: z.string().max(500).optional(),
    date_chantier: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("AAAA-MM-JJ, pour « planifié »."),
    accord_confirme: z.boolean().optional().describe("Vrai si Lucas confirme que le bon pour accord a été donné hors espace (passage à « signé » sans accord en ligne)."),
  }),
  apercu: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    return `Je vais passer le dossier de ${r.ids.nom} à « ${LIBELLES_ETAPE[e.vers]} »${e.motif_perte ? ` (motif : ${e.motif_perte})` : ""}${e.date_chantier ? `, chantier le ${format.jour(e.date_chantier)}` : ""}.`;
  },
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    const dossierId = exigerDossier(r.ids);
    const changement = await changerEtape(dossierId, {
      vers: e.vers,
      ...(e.motif_perte ? { motifPerte: e.motif_perte } : {}),
      ...(e.commentaire ? { perteCommentaire: e.commentaire } : {}),
      ...(e.date_chantier ? { dateChantier: e.date_chantier } : {}),
      ...(e.accord_confirme ? { confirmations: { BON_POUR_ACCORD: true } } : {}),
    } as Parameters<typeof changerEtape>[1]);
    return { texte: `Dossier de ${r.ids.nom} passé de « ${LIBELLES_ETAPE[changement.de as EtapeDossier] ?? changement.de} » à « ${LIBELLES_ETAPE[e.vers]} ».`, donnees: changement, liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)] };
  },
});

export const outilAjouterNote = definirOutil({
  nom: "ajouter_note",
  titre: "Ajouter une note",
  description: "Écrit une note sur un dossier (ou sur le lead s'il n'a pas de dossier). Pour une note d'appel avec issue et étiquettes, utiliser « noter_appel ».",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({ texte: z.string().min(1).max(4000) }),
  executer: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    const resultat = await noterRapidement(r.ids.dossierId ? { dossierId: r.ids.dossierId, contenu: e.texte } : { leadId: r.ids.leadId ?? undefined, contenu: e.texte });
    return { texte: `Note ajoutée ${resultat.cible === "DOSSIER" ? "au dossier" : "à la fiche"} de ${r.ids.nom}.`, liens: [r.ids.dossierId ? lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`) : lien("Lead", `/leads?lead=${r.ids.leadId}`)] };
  },
});

export const outilNoterAppel = definirOutil({
  nom: "noter_appel",
  titre: "Noter un appel",
  description:
    "Note un appel avec son issue (INTERESSE, A_RAPPELER, PAS_DE_REPONSE, PAS_INTERESSE), un texte, des étiquettes (TROP_CHER, VEUT_REFLECHIR, LOCATAIRE, PROJET_LOINTAIN, COMPARE_DEVIS, VEUT_UN_RENDU, DEJA_DECIDE, PAS_JOIGNABLE) et, pour « à rappeler » ou « pas de réponse », le moment du rappel (« jeudi 14h », « demain » ; à défaut demain 10 h). Écrit sur le dossier s'il existe, sinon sur le lead ; « intéressé » ou « pas de réponse » prépare le mail du lien de l'espace (outil « envoyer_lien_espace »).",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({
    issue: z.enum(ISSUES_APPEL),
    texte: z.string().max(2000).optional(),
    etiquettes: z.array(z.enum(ETIQUETTES_APPEL)).max(8).optional(),
    rappel: z.string().max(60).optional().describe("Quand rappeler, tel que dicté : « jeudi 14h », « demain 10h », « 2026-09-25 14:00 »."),
  }),
  executer: async (e, contexte) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    let rappelLe: string | null = null;
    if (e.rappel) {
      const date = lireDateDictee(e.rappel, contexte.maintenant);
      if (!date) throw new ErreurMetier(`Je n'ai pas compris le moment du rappel « ${e.rappel} » : donne un jour et une heure (« jeudi 14h », « 2026-09-25 14:00 »).`, 400);
      rappelLe = date.toISOString();
    }
    if (r.ids.leadId && (e.texte || e.etiquettes?.length)) await creerNoteAppel(r.ids.leadId, { texte: e.texte ?? "", etiquettes: e.etiquettes ?? [] });
    const suite = await noterAppel({ ...(r.ids.dossierId ? { dossierId: r.ids.dossierId } : { leadId: r.ids.leadId ?? undefined }), issue: e.issue, note: e.texte ?? "", rappelLe });
    return {
      texte: `${suite.resume} (${r.ids.nom})${suite.messagePropose ? ` Un mail avec le lien de son espace est prêt : « envoyer_lien_espace » avec le code ${suite.messagePropose}.` : ""}`,
      donnees: suite,
      liens: [suite.dossierId ? lien("Dossier", `/dossiers?dossier=${suite.dossierId}`) : lien("Lead", `/leads?lead=${suite.leadId}`)],
    };
  },
});

export const outilPlanifier = definirOutil({
  nom: "planifier",
  titre: "Planifier un rappel ou une action",
  description: "Planifie un rappel (lead) ou la prochaine action d'un dossier à un moment donné (« jeudi 14h », « demain 10h30 », « 2026-09-25 14:00 »), et l'inscrit dans Google Calendar si le droit est accordé (sinon l'outil le dit : rien n'est perdu, l'action est dans le CRM). Réversible : replanifier remplace.",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({ action: z.string().min(1).max(200).describe("« Rappeler », « Passer prendre les mesures »…"), quand: z.string().min(1).max(60), duree_minutes: z.number().int().min(5).max(480).optional() }),
  executer: async (e, contexte) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    const debut = lireDateDictee(e.quand, contexte.maintenant);
    if (!debut) throw new ErreurMetier(`Je n'ai pas compris « ${e.quand} » : donne un jour et une heure.`, 400);
    const p = await planifierAction({ dossierId: r.ids.dossierId, leadId: r.ids.leadId, nom: r.ids.nom, action: e.action, debut, dureeMinutes: e.duree_minutes, origine: contexte.commande ? `« ${contexte.commande} » (application Claude)` : "application Claude" });
    return {
      texte: p.texte,
      donnees: { debut: p.debut, fin: p.fin, agenda: p.agenda },
      liens: [...(p.agenda?.lien ? [{ libelle: "Événement Google Calendar", href: p.agenda.lien }] : []), r.ids.dossierId ? lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`) : lien("Lead", `/leads?lead=${r.ids.leadId}`)],
    };
  },
});

const schemaLigne = z.object({
  designation: z.string().min(1).max(200),
  sous_designation: z.string().max(200).optional(),
  quantite: z.number().positive(),
  unite: z.enum(UNITES).describe("ml (mètre linéaire), jour ou forfait."),
  prix_unitaire: z.number().min(0).describe("En euros, tel que dit par Lucas ou lu dans le CRM (jamais inventé)."),
});

export const outilGenererDocument = definirOutil({
  nom: "generer_document",
  titre: "Générer un devis ou une facture",
  description:
    "Émet un devis ou une facture avec ses lignes (désignation, quantité, unité, prix unitaire), sur un dossier existant. Une facture ne se génère que sur un dossier signé (ou plus loin). Le document est numéroté, figé, rangé dans le dossier et visible dans l'espace du client ; un devis déclenche le mail automatique « votre devis est disponible ». Sensible : aperçu puis confirmation. Les prix viennent de Lucas ou des tarifs du CRM, jamais d'une estimation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({
    type: z.enum(["DEVIS", "FACTURE"]),
    objet: z.string().min(1).max(160),
    lignes: z.array(schemaLigne).min(1).max(40),
    acompte_pct: z.number().int().min(0).max(100).optional().describe("Devis : pourcentage d'acompte (30 par défaut)."),
    note_ml: z.boolean().optional().describe("Mention « mètre linéaire » sur le document (vrai par défaut)."),
  }),
  apercu: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    const total = e.lignes.reduce((t, l) => t + l.quantite * l.prix_unitaire, 0);
    return `Je vais émettre ${e.type === "DEVIS" ? "un devis" : "une facture"} « ${e.objet} » pour ${r.ids.nom} : ${e.lignes.map((l) => `${l.designation} ${l.quantite} ${l.unite} × ${format.euros(l.prix_unitaire)}`).join(" ; ")} — total ${format.euros(total)}${e.type === "DEVIS" ? `, acompte ${e.acompte_pct ?? 30} %` : ""}. Le document sera numéroté et figé${e.type === "DEVIS" ? ", et le client recevra le mail « votre devis est disponible »" : ""}.`;
  },
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    const dossierId = exigerDossier(r.ids);
    if (e.type === "FACTURE") {
      const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { etape: true } });
      if (!ETAPES_FACTURABLES.includes(dossier.etape as EtapeDossier)) throw new ErreurMetier(`Une facture ne se génère que sur un dossier signé ; celui de ${r.ids.nom} est à « ${LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape} ».`, 409);
    }
    const resultat = await genererDocument(dossierId, {
      type: e.type,
      objet: e.objet,
      lignes: e.lignes.map((l) => ({ type: "PRESTATION" as const, designation: l.designation, sousDesignation: l.sous_designation, quantite: l.quantite, unite: l.unite, prixUnitaire: l.prix_unitaire })),
      noteMl: e.note_ml ?? true,
      acomptePct: e.type === "DEVIS" ? (e.acompte_pct ?? 30) : null,
    });
    const document = (resultat as { document: { id: string; numero: string | null; totalHt: number } }).document;
    return { texte: `${e.type === "DEVIS" ? "Devis" : "Facture"} ${document.numero ?? ""} émis${e.type === "FACTURE" ? "e" : ""} pour ${r.ids.nom} : ${format.euros(document.totalHt)}. Rangé${e.type === "FACTURE" ? "e" : ""} dans le dossier et visible dans son espace.`, donnees: { documentId: document.id, numero: document.numero, totalHt: document.totalHt, dossierId }, liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)] };
  },
});

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

export const outilPublierSimulation = definirOutil({
  nom: "publier_simulation",
  titre: "Publier des simulations dans l'espace du client",
  description: "Publie les simulations en brouillon d'un dossier (toutes, ou celles données) dans l'espace du client, qui reçoit le mail automatique « votre simulation est prête ». Sensible : aperçu puis confirmation. « masquer_simulation » fait l'inverse.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ simulationIds: z.array(z.string().max(40)).max(20).optional() }),
  apercu: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    const { simulations } = await listerSimulationsDossier(exigerDossier(r.ids));
    const cibles = simulations.filter((s) => s.statut !== "PUBLIEE" && (!e.simulationIds || e.simulationIds.includes(s.id)));
    return cibles.length ? `Je vais publier ${cibles.length} simulation(s) pour ${r.ids.nom} (${cibles.map((s) => s.titre ?? s.id).join(", ")}) ; le client recevra le mail « votre simulation est prête ».` : `Aucune simulation à publier pour ${r.ids.nom}.`;
  },
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    const dossierId = exigerDossier(r.ids);
    const { simulations } = await listerSimulationsDossier(dossierId);
    const ids = simulations.filter((s) => s.statut !== "PUBLIEE" && (!e.simulationIds || e.simulationIds.includes(s.id))).map((s) => s.id);
    if (ids.length === 0) return { texte: `Aucune simulation à publier pour ${r.ids.nom}.` };
    const resultat = await publierSimulations(dossierId, ids, { prevenir: false });
    return { texte: `${resultat.publiees} simulation(s) publiée(s) pour ${r.ids.nom}. ${resultat.mail?.programme ? "Le mail « votre simulation est prête » part." : `Pas de mail : ${resultat.mail?.raison ?? "rien de nouveau"}.`}`, donnees: resultat, liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)] };
  },
});

export const outilMasquerSimulation = definirOutil({
  nom: "masquer_simulation",
  titre: "Masquer une simulation",
  description: "Retire une simulation de la vue du client (elle reste dans le dossier). Réversible par « publier_simulation ».",
  niveau: "REVERSIBLE",
  schema: z.object({ dossierId: z.string().max(40), simulationId: z.string().max(40) }),
  executer: async (e) => {
    await changerStatutSimulation(e.dossierId, e.simulationId, "masquer");
    return { texte: "Simulation masquée : le client ne la voit plus.", liens: [lien("Dossier", `/dossiers?dossier=${e.dossierId}`)] };
  },
});

export const outilEnvoyerLienEspace = definirOutil({
  nom: "envoyer_lien_espace",
  titre: "Envoyer le lien de l'espace client par mail",
  description: "Ouvre l'espace du client s'il ne l'est pas (et son dossier) et lui envoie par mail le lien, avec la phrase adaptée : LIEN_ESPACE (après un appel intéressé : déposer les photos), INJOIGNABLE_LIEN (« j'ai essayé de vous joindre »), LIEN_ESPACE_RAPPEL (renvoyer le lien d'un projet en cours). Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ code: z.enum(CODES_LIEN_MAIL).optional(), phrase: z.string().max(600).optional().describe("Remplace la phrase proposée."), a: z.email().optional() }),
  apercu: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu.texte;
    const p = await proposerLienParMail({ dossierId: r.ids.dossierId, leadId: r.ids.leadId, code: e.code ?? "LIEN_ESPACE" });
    return `Je vais envoyer à ${e.a ?? p.a ?? "(adresse manquante)"} le mail « ${p.objet} » : « Bonjour${p.prenom ? ` ${p.prenom}` : ""}, ${e.phrase ?? p.phrase} » avec le bouton « ${p.bouton} » vers son espace.`;
  },
  executer: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    const p = await proposerLienParMail({ dossierId: r.ids.dossierId, leadId: r.ids.leadId, code: e.code ?? "LIEN_ESPACE" });
    const a = e.a ?? p.a;
    if (!a) throw new ErreurMetier("Aucune adresse e-mail pour ce contact : indique-la (paramètre « a »).", 409);
    const envoi = await envoyerLienParMail({ dossierId: p.dossierId, code: p.code, a, objet: p.objet, phrase: e.phrase ?? p.phrase, jeton: randomBytes(6).toString("hex") });
    return { texte: `Mail avec le lien de l'espace ${envoi.deja ? "déjà parti" : "envoyé"} à ${a} (${r.ids.nom}).`, donnees: { dossierId: p.dossierId, envoiId: envoi.envoiId }, liens: [lien("Dossier", `/dossiers?dossier=${p.dossierId}`)] };
  },
});

export const outilRenouvelerLien = definirOutil({
  nom: "renouveler_lien",
  titre: "Renouveler le lien de l'espace d'un client",
  description: "Émet un nouveau lien (l'ancien cesse de fonctionner, pour tous ses projets) et l'envoie par mail au client. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ envoyer_par_mail: z.boolean().optional().describe("Vrai par défaut.") }),
  apercu: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu.texte;
    return `Je vais émettre un nouveau lien d'espace pour ${r.ids.nom} (l'ancien ne fonctionnera plus)${e.envoyer_par_mail === false ? "" : " et le lui envoyer par mail"}.`;
  },
  executer: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    if (!r.ids.clientId) throw new ErreurMetier("Ce contact n'a pas de fiche client, donc pas d'espace permanent.", 409);
    const permanent = await prisma.espacePermanent.findUnique({ where: { clientId: r.ids.clientId }, select: { id: true } });
    if (!permanent) throw new ErreurMetier(`${r.ids.nom} n'a pas encore d'espace : « envoyer_lien_espace » l'ouvre.`, 409);
    const resultat = await regenererLien(permanent.id, { mail: e.envoyer_par_mail !== false });
    return { texte: `Nouveau lien émis pour ${r.ids.nom}${resultat.mail ? ", mail envoyé" : ""}. L'ancien ne fonctionne plus.`, donnees: { lien: resultat.lien, mail: resultat.mail }, liens: [lien("Espaces clients", "/espaces")] };
  },
});

export const outilSaisirEncaissement = definirOutil({
  nom: "saisir_encaissement",
  titre: "Saisir un encaissement",
  description: "Enregistre un paiement reçu sur un dossier (montant, moyen, date de réception, référence), imputé sur ses factures ; le dossier suit (acompte reçu, soldé). Le client reçoit le mail automatique « paiement reçu ». Sensible : aperçu puis confirmation. Une facture acquittée exige cet encaissement.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ montant: z.number().positive(), moyen: z.enum(MOYENS_PAIEMENT).optional(), recu_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("AAAA-MM-JJ, aujourd'hui par défaut."), reference: z.string().max(120).optional(), note: z.string().max(500).optional() }),
  apercu: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    return `Je vais enregistrer un encaissement de ${format.euros(e.montant)}${e.moyen ? ` par ${e.moyen.toLowerCase()}` : ""} reçu le ${format.jour(e.recu_le ?? jourParis(contexte.maintenant))} sur le dossier de ${r.ids.nom}${e.reference ? ` (référence ${e.reference})` : ""}.`;
  },
  executer: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    const dossierId = exigerDossier(r.ids);
    const resultat = (await enregistrerEncaissement({ paiement: { montant: e.montant, moyen: e.moyen ?? null, recuLe: e.recu_le ?? jourParis(contexte.maintenant), reference: e.reference ?? null, note: e.note ?? null }, dossierId })) as { encaissement?: { id: string } } | unknown;
    const id = (resultat as { encaissement?: { id: string } })?.encaissement?.id ?? null;
    return { texte: `Encaissement de ${format.euros(e.montant)} enregistré sur le dossier de ${r.ids.nom}.`, donnees: { encaissementId: id, dossierId }, liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)] };
  },
});

export const outilAnnulerEncaissement = definirOutil({
  nom: "annuler_encaissement",
  titre: "Annuler un encaissement",
  description: "Annule un encaissement saisi par erreur (motif : ERREUR_MONTANT, ERREUR_DATE, ERREUR_PIECE, DOUBLON, AUTRE). L'encaissement reste dans l'historique, marqué annulé. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: z.object({ encaissementId: z.string().max(40), motif: z.enum(MOTIFS_ANNULATION.map((m) => m.code) as [string, ...string[]]), precision: z.string().max(300).optional() }),
  apercu: async (e) => {
    const enc = await prisma.encaissement.findUnique({ where: { id: e.encaissementId }, select: { montant: true, payeur: true, recuLe: true, statut: true } });
    if (!enc) return "Encaissement introuvable.";
    return `Je vais annuler l'encaissement de ${format.euros(enc.montant)} (${enc.payeur}, reçu le ${format.jour(enc.recuLe)}) pour le motif ${e.motif}.`;
  },
  executer: async (e) => {
    const message = await annulerEncaissement(e.encaissementId, { motif: e.motif, precision: e.precision });
    return { texte: message ? `Encaissement annulé. ${message}` : "Encaissement annulé.", liens: [lien("Finances", "/finances")] };
  },
});

export const outilRattacherDepense = definirOutil({
  nom: "rattacher_depense",
  titre: "Rattacher une dépense",
  description: "Enregistre une dépense (montant, fournisseur, catégorie : MATIERE, FOURNITURES, SOUS_TRAITANCE, DEPLACEMENT, OUTILLAGE, PUBLICITE, LOGICIELS, ASSURANCE, BANQUE, FORMATION, AUTRE), rattachée à un chantier ou hors chantier. Réversible (archivable dans Dépenses).",
  niveau: "REVERSIBLE",
  schema: schemaCible.partial().extend({ montant: z.number().positive(), fournisseur: z.string().min(1).max(120), categorie: z.enum(CATEGORIES_DEPENSE.map((c) => c.code) as [string, ...string[]]), payee_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), libelle: z.string().max(200).optional(), moyen: z.enum(MOYENS_DEPENSE).optional(), hors_chantier: z.boolean().optional() }),
  executer: async (e, contexte) => {
    let dossierId: string | null = null;
    let nom: string | null = null;
    if (e.dossierId || e.clientId || e.leadId || e.nom) {
      const r = await cibler({ dossierId: e.dossierId, clientId: e.clientId, leadId: e.leadId, nom: e.nom }, "DOSSIER");
      if (r.ambigu) return r.ambigu;
      dossierId = r.ids.dossierId;
      nom = r.ids.nom;
    }
    const { depense, dejaRecue } = await creerDepense({ payeeLe: e.payee_le ?? jourParis(contexte.maintenant), montant: e.montant, fournisseur: e.fournisseur, categorie: e.categorie as (typeof CATEGORIES_DEPENSE)[number]["code"], libelle: e.libelle ?? null, moyen: e.moyen ?? null, dossierId, horsChantier: e.hors_chantier ?? !dossierId, note: null }, null);
    return { texte: `Dépense ${dejaRecue ? "déjà connue" : "enregistrée"} : ${format.euros(depense.montant)} chez ${depense.fournisseur} (${depense.categorie})${nom ? `, rattachée au chantier de ${nom}` : ", hors chantier"}.`, donnees: { depenseId: depense.id }, liens: [lien("Dépenses", "/finances")] };
  },
});

const schemaArchivage = z.object({
  leads: z.array(z.string().max(40)).max(200).optional().describe("Identifiants de leads."),
  dossiers: z.array(z.string().max(40)).max(50).optional().describe("Identifiants de dossiers."),
  motif: z.string().min(2).max(300).describe("Pourquoi (« doublon », « test », « hors cible », ou une phrase)."),
});

function motifLead(motif: string): (typeof MOTIFS_ARCHIVAGE)[number] {
  const m = motif.toLowerCase();
  if (/doublon/.test(m)) return "DOUBLON";
  if (/test|essai/.test(m)) return "TEST";
  if (/hors|zone|cible|trop loin/.test(m)) return "HORS_CIBLE";
  return "AUTRE";
}

async function nomsDe(leads: string[], dossiers: string[]) {
  const [l, d] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: leads } }, select: { id: true, prenom: true, nom: true, ville: true } }),
    prisma.dossier.findMany({ where: { id: { in: dossiers } }, select: { id: true, clientNom: true, objet: true } }),
  ]);
  return { leads: l.map((x) => `${x.prenom} ${x.nom}`.trim() + (x.ville ? ` (${x.ville})` : "")), dossiers: d.map((x) => `${x.clientNom} — ${x.objet}`), inconnus: leads.length + dossiers.length - l.length - d.length };
}

async function archiver(e: z.output<typeof schemaArchivage>): Promise<ResultatOutil> {
  const leads = [...new Set(e.leads ?? [])];
  const dossiers = [...new Set(e.dossiers ?? [])];
  if (leads.length + dossiers.length === 0) throw new ErreurMetier("Rien à archiver : donne des identifiants de leads ou de dossiers (« chercher », « leads_a_appeler »).", 400);
  const noms = await nomsDe(leads, dossiers);
  if (noms.inconnus) throw new ErreurMetier(`${noms.inconnus} identifiant(s) inconnu(s) : rien n'a été fait.`, 404);
  const faits: string[] = [];
  if (leads.length) {
    const { ids } = await appliquerActionLeads({ action: "ARCHIVER", ids: leads, motif: motifLead(e.motif) });
    faits.push(`${ids.length} lead(s) archivé(s)`);
  }
  for (const id of dossiers) await archiverDossier(id, e.motif);
  if (dossiers.length) faits.push(`${dossiers.length} dossier(s) archivé(s)`);
  return { texte: `${faits.join(" et ")} (motif : ${e.motif}). Rien n'est supprimé : « restaurer » les remet.`, donnees: { leads, dossiers }, liens: [lien("Leads", "/leads")] };
}

const apercuArchivage = async (e: z.output<typeof schemaArchivage>) => {
  const noms = await nomsDe([...new Set(e.leads ?? [])], [...new Set(e.dossiers ?? [])]);
  return `Je vais archiver ${noms.leads.length} lead(s)${noms.leads.length ? ` : ${noms.leads.join(", ")}` : ""}${noms.dossiers.length ? ` et ${noms.dossiers.length} dossier(s) : ${noms.dossiers.join(", ")}` : ""} — motif « ${e.motif} ». Réversible.`;
};

export const outilArchiver = definirOutil({
  nom: "archiver",
  titre: "Archiver des leads ou des dossiers",
  description: "Archive un ou plusieurs leads (ils sortent de la file) ou dossiers, avec un motif. Réversible par « restaurer ». Au-delà de trois éléments : aperçu de la liste, puis confirmation. Pour « tous sauf X » : liste d'abord (« leads_a_appeler »), retire X, puis donne les identifiants restants.",
  niveau: "REVERSIBLE",
  schema: schemaArchivage,
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0),
  apercu: apercuArchivage,
  executer: archiver,
});

export const outilSupprimer = definirOutil({
  nom: "supprimer",
  titre: "Supprimer (= archiver)",
  description: "Rien ne se supprime dans le CRM : une demande de suppression devient un archivage, réversible par « restaurer ». Mêmes paramètres qu'« archiver ».",
  niveau: "REVERSIBLE",
  schema: schemaArchivage,
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0),
  apercu: async (e) => `Rien ne se supprime : ce sera un archivage, réversible. ${await apercuArchivage(e)}`,
  executer: async (e) => {
    const r = await archiver(e);
    return { ...r, texte: `Rien ne se supprime : archivé à la place. ${r.texte}` };
  },
});

export const outilRestaurer = definirOutil({
  nom: "restaurer",
  titre: "Restaurer des leads ou des dossiers archivés",
  description: "Remet des leads ou des dossiers archivés à leur place (inverse d'« archiver »).",
  niveau: "REVERSIBLE",
  schema: z.object({ leads: z.array(z.string().max(40)).max(200).optional(), dossiers: z.array(z.string().max(40)).max(50).optional() }),
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0),
  executer: async (e) => {
    const leads = [...new Set(e.leads ?? [])];
    const dossiers = [...new Set(e.dossiers ?? [])];
    if (leads.length + dossiers.length === 0) throw new ErreurMetier("Rien à restaurer.", 400);
    const faits: string[] = [];
    if (leads.length) faits.push(`${(await appliquerActionLeads({ action: "RESTAURER", ids: leads })).ids.length} lead(s) restauré(s)`);
    for (const id of dossiers) await restaurerDossier(id);
    if (dossiers.length) faits.push(`${dossiers.length} dossier(s) restauré(s)`);
    return { texte: faits.join(" et ") + ".", liens: [lien("Leads", "/leads")] };
  },
});

export const outilAccorderSimulations = definirOutil({
  nom: "accorder_simulations",
  titre: "Accorder des simulations supplémentaires",
  description: "Offre au client des simulations de plus dans son espace (au-delà du nombre gratuit). Réversible en pratique (quota).",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({ nombre: z.number().int().min(1).max(20).optional() }),
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    const dossierId = exigerDossier(r.ids);
    const espace = await prisma.espaceClient.findUnique({ where: { dossierId }, select: { id: true } });
    if (!espace) throw new ErreurMetier(`${r.ids.nom} n'a pas encore d'espace ouvert.`, 409);
    const resultat = await accorderSimulations(espace.id, e.nombre ?? 3);
    return { texte: `${e.nombre ?? 3} simulation(s) accordée(s) à ${r.ids.nom} (${resultat.accordees} en tout).`, liens: [lien("Dossier", `/dossiers?dossier=${dossierId}`)] };
  },
});

export const outilRedigerMail = definirOutil({
  nom: "rediger_mail",
  titre: "Rédiger un mail avec l'IA du CRM",
  description: "Demande au CRM un brouillon de mail à un client (réponse à un mail reçu, ou nouveau mail à un contact), rédigé par l'IA avec tout le contexte du dossier et une garde qui remplace par « [à compléter] » tout prix, date ou délai absent du CRM. Coût ≈ 0,015 € par brouillon. Rien n'est envoyé : relis, puis « envoyer_mail ».",
  niveau: "LECTURE",
  schema: schemaCible.partial().extend({ messageId: z.string().max(40).optional().describe("Le mail reçu auquel répondre (rendu par « mails_a_traiter »)."), consigne: z.string().max(500).optional() }),
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

export const OUTILS_ECRITURE = [outilOuvrirDossier, outilChangerEtape, outilAjouterNote, outilNoterAppel, outilPlanifier, outilGenererDocument, outilEnvoyerDocument, outilPublierSimulation, outilMasquerSimulation, outilEnvoyerLienEspace, outilRenouvelerLien, outilSaisirEncaissement, outilAnnulerEncaissement, outilRattacherDepense, outilArchiver, outilSupprimer, outilRestaurer, outilAccorderSimulations, outilRedigerMail, outilEnvoyerMail];
