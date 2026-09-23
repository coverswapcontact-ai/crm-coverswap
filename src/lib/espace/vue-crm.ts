import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireZones, libelleZoneClient, type ZoneTeinte } from "@/lib/simulateur/types-surface";
import { etapeEspace, LIBELLES_ETAPE_ESPACE, progression, type EtapeEspace } from "./etapes";
import { composerFaits, dateSignature, lireDevisEtPaiements, type PaiementEspace } from "./faits";
import { confirmationRequise, lienApercu, lienEspace } from "./liens";
import { figeDuProjet, LIBELLES_PASTILLE, projetsVisibles } from "./projets";
import { enregistrerPrestations } from "@/lib/prestations/dossier";
import { lireSelection } from "@/lib/prestations/prestations";
import { lireProjet, projetComplet, projetDepuisEntree, projetPrecise, resumerProjet, schemaProjet, type ProjetClient } from "./projet";
import { accorderSimulations, choisir, photosDuClient, quotaSimulations } from "./service";
import { devaliderChoix, devaliderProjet, lirePhotosRetirees, remettrePhoto, retirerAccord, retirerDemandeProposition, retirerPhoto, validerProjet } from "./validations";
import { messagesEspace, repondreDansLEspace, type MessageEspaceVue } from "./messages";

/**
 * L'espace d'un client vu — et piloté — depuis le CRM : tout ce qu'il a fait,
 * écrit et validé, ce qu'il lui reste à faire, et les gestes que Lucas peut
 * faire à sa place (valider, dévalider, modifier son projet, accorder des
 * simulations, remettre une photo, réinitialiser une étape). Les montants,
 * l'accord et les paiements viennent de `faits.ts`, comme pour le client.
 */

export type VueEspaceCrm = {
  id: string;
  /** Le lien du CLIENT (son espace permanent, tous projets) ; l'aperçu s'ouvre sur ce projet. */
  lien: string | null;
  apercu: string | null;
  expireLe: string;
  revoqueLe: string | null;
  premierAccesLe: string | null;
  dernierAccesLe: string | null;
  nbAcces: number;
  /** L'espace permanent du client : ses visites (toutes), la confirmation du téléphone, ses autres projets. */
  permanent: { id: string; code: string; dernierAccesLe: string | null; nbAcces: number; lienEmisLe: string; confirmationRequise: boolean; revoqueLe: string | null; projetsAccordes: number; projetDemandeLe: string | null } | null;
  autresProjets: { dossierId: string; nom: string; etapeDossier: string; fige: string | null }[];
  typeProjet: string;
  etape: EtapeEspace;
  etapeLibelle: string;
  etapes: ReturnType<typeof progression>;
  /** Ce qu'il lui reste à faire, en une phrase. */
  resteAFaire: string;
  photos: { id: string; url: string }[];
  photosRetirees: { id: string; url: string; le: string; par: string }[];
  projet: (ProjetClient & { resume: string }) | null;
  projetValide: { le: string; par: string } | null;
  projetManque: string | null;
  simulations: { id: string; titre: string | null; source: string; statut: string; zones: ZoneTeinte[]; choisie: boolean; commentaire: string | null; le: string; vueLe: string | null; url: string }[];
  choix: { mode: string; le: string; commentaire: string | null; zones: ZoneTeinte[] } | null;
  proposition: { le: string; message: string | null; simulationId: string | null } | null;
  creation: { faites: number; faitesSite: number; restantes: number; offertes: number; enCours: number; demandeesLe: string | null };
  favoris: string[];
  devis: { id: string; numero: string; total: number; repris: boolean; statut: string; consultations: number; consulteLe: string | null } | null;
  accord: { le: string; nom: string; source: "ESPACE" | "CRM"; signature: boolean } | null;
  accordsRetires: { le: string; retireLe: string; par: string | null; motif: string | null; nom: string }[];
  paiement: PaiementEspace | null;
  avis: { note: number; texte: string; publication?: boolean; le?: string } | null;
  /** Les derniers gestes du client (et de Lucas à sa place), du plus récent au plus ancien. */
  gestes: { le: string; type: string; contenu: string; auteur: "CLIENT" | "LUCAS" }[];
  /** Ancien nom (écran du 21/09), gardé pour les écrans qui le lisent encore. */
  propositionDemandeeLe: string | null;
  /** Mission 10 : ses messages et les réponses de Lucas, du plus récent au plus ancien ; `messagesNonLus` : à lui de répondre. */
  messages: MessageEspaceVue[];
  messagesNonLus: number;
};

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

function resteAFaire(etape: EtapeEspace, projetManque: string | null, projetValide: boolean, photos: number): string {
  switch (etape) {
    case "PHOTOS":
      return "Déposer des photos de sa pièce.";
    case "PROJET":
      return projetManque ? `Préciser son projet (${projetManque.replace(/\.$/, "").toLowerCase()}), puis le valider.` : "Valider son projet.";
    case "SIMULATIONS":
      return `${photos === 0 ? "Déposer une photo, " : ""}${projetValide ? "" : "valider son projet, "}créer ou regarder ses simulations, en valider une.`.replace(/^./, (c) => c.toUpperCase());
    case "ATTENTE_DEVIS":
      return "Rien : il attend son devis (à toi de le faire).";
    case "DEVIS":
      return "Lire son devis, compléter ses coordonnées, donner son bon pour accord.";
    case "ACOMPTE":
      return "Régler son acompte.";
    case "CHANTIER":
      return "Rien : le chantier est à venir ou en cours.";
    case "TERMINE":
      return "Donner son avis, s'il ne l'a pas fait.";
    default:
      return "";
  }
}

export async function vueEspaceCrm(dossierId: string): Promise<VueEspaceCrm | null> {
  const espace = await prisma.espaceClient.findUnique({ where: { dossierId }, include: { simulations: { where: { archiveLe: null }, orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] } } });
  if (!espace) return null;
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: {
      clientNom: true,
      etape: true,
      photos: true,
      prestations: true,
      lead: { select: { typeProjet: true } },
      documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" } },
      accords: { orderBy: { createdAt: "desc" } },
      encaissements: { select: { montant: true, moyen: true, recuLe: true, statut: true } },
      evenements: { where: { archiveLe: null, OR: [{ type: "CHANGEMENT_ETAPE" }, { type: { startsWith: "ESPACE_" } }] }, orderBy: { createdAt: "desc" }, take: 200, select: { type: true, contenu: true, metadata: true, createdAt: true, survenuLe: true, direction: true } },
    },
  });
  if (!dossier) return null;
  const selection = lireSelection(dossier.prestations);
  const typeProjet = Object.keys(selection)[0] ?? dossier.lead?.typeProjet ?? "AUTRE";
  const lecture = lireDevisEtPaiements({ devis: dossier.documents, accords: dossier.accords, encaissements: dossier.encaissements, clientNom: dossier.clientNom, signeLe: dateSignature(dossier.evenements.filter((e) => e.type === "CHANGEMENT_ETAPE")) });
  const [photos, quota] = await Promise.all([photosDuClient(dossierId, dossier.photos), quotaSimulations(espace)]);
  const projet = lireProjet(espace.souhaits, selection, dossier.lead?.typeProjet);
  const publiees = espace.simulations.filter((s) => s.statut === "PUBLIEE");
  type ChoixBrut = { mode?: string; simulationId?: string; zones?: ZoneTeinte[]; commentaire?: string | null; le?: string };
  const choixBrut = ((): ChoixBrut | null => {
    try {
      return espace.choix ? (JSON.parse(espace.choix) as ChoixBrut) : null;
    } catch {
      return null;
    }
  })();
  const faits = composerFaits({
    photos: photos.length,
    projetPrecise: projetPrecise(projet),
    projetValide: Boolean(espace.projetValideLe),
    simulationsCrm: publiees.filter((s) => s.source !== "SITE" && s.source !== "CLIENT").length,
    simulationsSite: publiees.filter((s) => s.source === "SITE").length,
    simulationsClient: publiees.filter((s) => s.source === "CLIENT").length,
    choix: Boolean(espace.choixLe && choixBrut),
    lecture,
    etapeDossier: dossier.etape,
  });
  const etape = etapeEspace(faits);
  const manque = projetComplet(projet);
  const permanent = espace.permanentId ? await prisma.espacePermanent.findUnique({ where: { id: espace.permanentId } }) : null;
  const expire = !permanent && espace.expireLe.getTime() < Date.now();
  const revoque = permanent?.revoqueLe ?? espace.revoqueLe;
  const autres = permanent ? (await projetsVisibles(prisma, permanent.id)).filter((p) => p.dossierId !== dossierId) : [];
  const messages = await messagesEspace({ dossierId, limite: 40 });
  const zonesDuChoix = choixBrut?.mode === "COMPOSITE" ? (choixBrut.zones ?? []) : lireZones(espace.simulations.find((s) => s.id === choixBrut?.simulationId)?.zones ?? null);
  let avis: VueEspaceCrm["avis"] = null;
  try {
    avis = espace.avis ? (JSON.parse(espace.avis) as VueEspaceCrm["avis"]) : null;
  } catch {
    avis = null;
  }
  return {
    id: espace.id,
    lien: revoque ? null : lienEspace(permanent ?? espace),
    apercu: revoque || expire ? null : lienApercu(permanent ?? espace, Date.now(), permanent ? espace : null),
    expireLe: espace.expireLe.toISOString(),
    revoqueLe: iso(revoque),
    premierAccesLe: iso(espace.premierAccesLe),
    dernierAccesLe: iso(espace.dernierAccesLe),
    nbAcces: espace.nbAcces,
    permanent: permanent
      ? { id: permanent.id, code: permanent.code, dernierAccesLe: iso(permanent.dernierAccesLe), nbAcces: permanent.nbAcces, lienEmisLe: permanent.lienEmisLe.toISOString(), confirmationRequise: confirmationRequise(permanent), revoqueLe: iso(permanent.revoqueLe), projetsAccordes: permanent.projetsAccordes, projetDemandeLe: iso(permanent.projetDemandeLe) }
      : null,
    autresProjets: autres.map((p) => ({ dossierId: p.dossierId, nom: p.nomProjet ?? p.dossier.objet ?? "Projet", etapeDossier: p.dossier.etape, fige: figeDuProjet(p.dossier.etape) ? LIBELLES_PASTILLE[figeDuProjet(p.dossier.etape) === "TERMINE" ? "TERMINE" : "NON_REALISE"] : null })),
    typeProjet,
    etape,
    etapeLibelle: LIBELLES_ETAPE_ESPACE[etape],
    etapes: progression(faits),
    resteAFaire: resteAFaire(etape, manque, Boolean(espace.projetValideLe), photos.length),
    photos: photos.map((p) => ({ id: p.id, url: `/api/dossiers/${dossierId}/photos/${p.id}` })),
    photosRetirees: lirePhotosRetirees(espace.photosRetirees).map((p) => ({ id: p.id, url: `/api/dossiers/${dossierId}/espace/photos-retirees/${p.id}`, le: p.le, par: p.par })),
    projet: projet ? { ...projet, resume: resumerProjet(projet) } : null,
    projetValide: espace.projetValideLe ? { le: espace.projetValideLe.toISOString(), par: espace.projetValidePar ?? "CLIENT" } : null,
    projetManque: manque,
    simulations: espace.simulations.map((s) => ({
      id: s.id,
      titre: s.titre,
      source: s.source,
      statut: s.statut,
      zones: lireZones(s.zones).map((z) => ({ ...z, libelle: libelleZoneClient(z.zone, typeProjet) ?? z.libelle })),
      choisie: Boolean(s.choisieLe),
      commentaire: s.commentaireClient,
      le: (s.publieeLe ?? s.createdAt).toISOString(),
      vueLe: iso(s.vueLe),
      url: `/api/dossiers/${dossierId}/simulations/${s.id}/image`,
    })),
    choix: espace.choixLe && choixBrut ? { mode: choixBrut.mode ?? "UNE", le: espace.choixLe.toISOString(), commentaire: choixBrut.commentaire ?? null, zones: zonesDuChoix } : null,
    proposition: espace.propositionDemandeeLe ? { le: espace.propositionDemandeeLe.toISOString(), message: espace.propositionMessage, simulationId: espace.propositionSimulationId } : null,
    creation: { faites: quota.faites, faitesSite: quota.faitesSite, restantes: quota.restantes, offertes: quota.gratuites + quota.accordees, enCours: quota.enCours.length, demandeesLe: iso(espace.simulationsDemandeesLe) },
    favoris: (() => {
      try {
        const v: unknown = JSON.parse(permanent?.favoris ?? espace.favoris ?? "[]");
        return Array.isArray(v) ? v.filter((r): r is string => typeof r === "string") : [];
      } catch {
        return [];
      }
    })(),
    devis: lecture.devis && lecture.montants ? { id: lecture.devis.id, numero: lecture.devis.numero!, total: lecture.montants.totalTtcCentimes / 100, repris: lecture.devis.origine === "REPRISE", statut: lecture.devis.statut, consultations: espace.devisConsulteId === lecture.devis.id ? espace.devisConsultations : 0, consulteLe: espace.devisConsulteId === lecture.devis.id ? iso(espace.devisConsulteLe) : null } : null,
    accord: lecture.accord ? { le: lecture.accord.le.toISOString(), nom: lecture.accord.nom, source: lecture.accord.source, signature: lecture.accord.signature } : null,
    accordsRetires: dossier.accords.filter((a) => a.retireLe).map((a) => ({ le: a.createdAt.toISOString(), retireLe: a.retireLe!.toISOString(), par: a.retirePar, motif: a.retireMotif, nom: a.nomSignataire })),
    paiement: lecture.accord ? lecture.paiement : null,
    avis,
    gestes: dossier.evenements
      .filter((e) => e.type.startsWith("ESPACE_"))
      .slice(0, 40)
      .map((e) => ({ le: (e.survenuLe ?? e.createdAt).toISOString(), type: e.type, contenu: e.contenu, auteur: e.direction === "ENTRANT" ? ("CLIENT" as const) : ("LUCAS" as const) })),
    propositionDemandeeLe: iso(espace.propositionDemandeeLe),
    messages,
    messagesNonLus: messages.filter((m) => m.auteur === "CLIENT" && !m.luLe).length,
  };
}

/* ── Les gestes de Lucas, à la place du client ─────────────────────── */

export const schemaGesteEspace = z.discriminatedUnion("geste", [
  z.object({ geste: z.literal("valider-projet") }),
  z.object({ geste: z.literal("devalider-projet") }),
  z.object({ geste: z.literal("modifier-projet"), projet: schemaProjet }),
  z.object({ geste: z.literal("valider-simulation"), simulationId: z.string().min(1).max(40) }),
  z.object({ geste: z.literal("devalider-simulation") }),
  z.object({ geste: z.literal("retirer-demande") }),
  z.object({ geste: z.literal("retirer-accord"), motif: z.string().trim().max(500).default("") }),
  z.object({ geste: z.literal("accorder"), nombre: z.number().int().min(1).max(20).default(3) }),
  z.object({ geste: z.literal("retirer-photo"), photoId: z.string().min(1).max(80) }),
  z.object({ geste: z.literal("remettre-photo"), photoId: z.string().min(1).max(80) }),
  z.object({ geste: z.literal("reinitialiser"), etape: z.enum(["PROJET", "SIMULATIONS", "DEVIS"]) }),
  z.object({ geste: z.literal("repondre"), texte: z.string().trim().min(2).max(2000) }),
]);
export type GesteEspace = z.output<typeof schemaGesteEspace>;

async function espaceDuDossier(dossierId: string) {
  const espace = await prisma.espaceClient.findUnique({ where: { dossierId } });
  if (!espace) throw new ErreurMetier("Ce dossier n'a pas encore d'espace client.", 404);
  return espace;
}

export async function gesteDeLucas(dossierId: string, geste: GesteEspace): Promise<void> {
  const espace = await espaceDuDossier(dossierId);
  switch (geste.geste) {
    case "valider-projet":
      return validerProjet(espace, "LUCAS");
    case "devalider-projet":
      return devaliderProjet(espace, "LUCAS", "depuis le CRM");
    case "modifier-projet": {
      const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { prestations: true, lead: { select: { typeProjet: true } } } });
      const typeProjet = dossier?.lead?.typeProjet ?? null;
      const avant = lireProjet(espace.souhaits, lireSelection(dossier?.prestations), typeProjet);
      const { selection, souhaits } = projetDepuisEntree(geste.projet, avant, typeProjet);
      const apres = lireProjet(JSON.stringify(souhaits), selection, typeProjet);
      await enregistrerPrestations(dossierId, selection, "LUCAS");
      await prisma.espaceClient.update({ where: { id: espace.id }, data: { souhaits: JSON.stringify(souhaits), souhaitsLe: new Date() } });
      await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_SOUHAITS", direction: "INTERNE", contenu: `Projet modifié par Lucas, à la place du client : ${resumerProjet(apres) || "vidé"}`.slice(0, 1500), metadata: JSON.stringify({ auteur: "LUCAS", avant }) } });
      // Un projet validé qui n'est plus complet ne peut pas rester « validé ».
      if (espace.projetValideLe && projetComplet(apres)) await devaliderProjet(espace, "LUCAS", "il n'est plus complet");
      return;
    }
    case "valider-simulation":
      await choisir(espace, { simulationId: geste.simulationId, commentaire: "" }, "LUCAS");
      return;
    case "devalider-simulation":
      return devaliderChoix(espace, "LUCAS");
    case "retirer-demande":
      return retirerDemandeProposition(espace, "LUCAS");
    case "retirer-accord":
      await retirerAccord(espace, "LUCAS", geste.motif);
      return;
    case "accorder":
      await accorderSimulations(espace.id, geste.nombre);
      return;
    case "retirer-photo":
      return retirerPhoto(espace, geste.photoId, "LUCAS");
    case "remettre-photo":
      return remettrePhoto(espace.id, geste.photoId);
    case "repondre":
      await repondreDansLEspace(dossierId, geste.texte);
      return;
    case "reinitialiser": {
      if (geste.etape === "PROJET") {
        await devaliderProjet(espace, "LUCAS", "étape réinitialisée");
        const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { prestations: true } });
        await prisma.espaceClient.update({ where: { id: espace.id }, data: { souhaits: null, souhaitsLe: null } });
        await enregistrerPrestations(dossierId, {}, "LUCAS");
        await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_ETAPE_REINITIALISEE", direction: "INTERNE", contenu: "Étape « Projet » réinitialisée par Lucas : le client la refait (ce qu'il avait saisi est gardé ici)", metadata: JSON.stringify({ etape: "PROJET", avant: lireProjet(espace.souhaits, lireSelection(dossier?.prestations)) }) } });
      } else if (geste.etape === "SIMULATIONS") {
        await devaliderChoix(espace, "LUCAS");
        await retirerDemandeProposition(await espaceDuDossier(dossierId), "LUCAS");
        await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_ETAPE_REINITIALISEE", direction: "INTERNE", contenu: "Étape « Simulations » réinitialisée par Lucas : plus de simulation validée, plus de demande en attente (ses simulations restent)", metadata: JSON.stringify({ etape: "SIMULATIONS" }) } });
      } else {
        await retirerAccord(espace, "LUCAS", "Étape « Devis » réinitialisée");
        await prisma.espaceClient.update({ where: { id: espace.id }, data: { devisConsultations: 0, devisConsulteId: null, devisConsulteLe: null } });
        await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_ETAPE_REINITIALISEE", direction: "INTERNE", contenu: "Étape « Devis » réinitialisée par Lucas : accord en ligne retiré (preuve gardée), compteur de lectures remis à zéro", metadata: JSON.stringify({ etape: "DEVIS" }) } });
      }
      return;
    }
  }
}

/** Une photo que le client a retirée : servie à Lucas seulement (le fichier n'a pas bougé). */
export async function lirePhotoRetiree(dossierId: string, photoId: string): Promise<{ contenu: Buffer; type: string }> {
  const espace = await prisma.espaceClient.findFirst({ where: { ...AVEC_ARCHIVES, dossierId }, select: { photosRetirees: true } });
  const photo = lirePhotosRetirees(espace?.photosRetirees).find((p) => p.id === photoId);
  if (!photo) throw new ErreurMetier("Photo introuvable.", 404);
  const { lireFichier } = await import("@/lib/dossiers/stockage");
  const contenu = await lireFichier(photo.chemin);
  if (!contenu) throw new ErreurMetier("Photo introuvable sur le serveur.", 404);
  const extension = photo.chemin.split(".").pop()?.toLowerCase();
  return { contenu, type: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "heic" ? "image/heic" : "image/jpeg" };
}
