import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { aHeureParis } from "@/lib/commercial/quand";
import type { Affaire } from "@/lib/commercial/types";
import { euros, pluriel } from "@/lib/commun/format";
import { estDossierClos } from "@/lib/dossiers/constants";
import { devisAEnvoyer } from "@/lib/dossiers/devis-envoye";
import { devisGmailNonEnregistres } from "@/lib/dossiers/devis-gmail";
import { estMotifDevisAEnvoyer } from "@/lib/dossiers/main";
import { montantsDocument, versCentimes } from "@/lib/dossiers/montants";
import { lireMetadataChangementEtape } from "@/lib/dossiers/regles";
import { lireLignes, lirePhotos } from "@/lib/dossiers/stockage";
import { MOTIFS_SANS_ACOMPTE } from "@/lib/encaissements/constantes";
import { restesDesFactures } from "@/lib/encaissements/soldes";
import { jourMois } from "../achevement";
import type { Detection, NiveauTache, Raccourci, TypeTache } from "../types";
import { heureLisible } from "./libelles";
import { pilotageDuPassage } from "./pilotage-partage";
import { cleTache, type ContexteDetection, type Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur DOSSIERS — ce que l'étape et les faits d'un dossier vivant demandent à Lucas
 * (docs/TACHES.md § 3). Lecture seule : le moteur écrit et coche par absence (achevement.ts).
 *
 * La source est `pilotageCommercial(maintenant)` (affaires « dossier » dont la main est à Lucas), lue une fois :
 * - REPONDRE (SMS reçu sans réponse, ou main épinglée « Répondre à … » par un mail ou un message d'espace) →
 *   `REPONDRE:dossier:<id>`, la même clé que MAIL et ESPACE_MESSAGES (le moteur fusionne) ;
 * - PLANIFIER (signé sans date de chantier) → DATE_CHANTIER ;
 * - RAPPELER (rappel du dossier échu ce soir au plus tard) → RAPPELER. Une relance d'un devis en attente (« Relancer :
 *   … ») est laissée au détecteur RELANCES (RELANCER_DEVIS). Mission 18 (A2) : « Appeler : … » (premier appel, posé à
 *   l'ouverture automatique du dossier ou d'un nouveau projet de l'espace) s'intitule « Appeler · Nom », raison = le motif ;
 * - SIMULATION, DEVIS, et DECIDER « Envoyer le lien de son espace » → ENVOYER_LIEN. Un DEVIS « Devis prêt, pas encore
 *   envoyé » (mission 18, B1) est laissé à la lecture ENVOYER_DEVIS ci-dessous.
 * Quatre lectures propres, que le pilotage ne couvre pas (il s'arrête à « Signé ») :
 * - ENVOYER_DEVIS (mission 18, B1) : un devis généré mais pas encore envoyé (`devis-envoye.ts › devisAEnvoyer`), quelle
 *   que soit l'étape ; jamais écartée par une action posée à la main (moteur.ts). Une tâche par dossier, l'occurrence
 *   = les devis à envoyer (un nouveau devis la fait revenir après un « Fait ») ;
 * - ENREGISTRER_DEVIS (mission 18, B3) : un PDF qui ressemble à un devis, parti de Gmail chez le client, pas encore
 *   dans le CRM (`devis-gmail.ts › devisGmailNonEnregistres`) ; une tâche par PDF, jamais écartée par une action posée
 *   à la main. Raccourci : la modale de dépôt du dossier, préremplie (numéro lu dans le nom, date du mail, PDF du mail) ;
 * - ENCAISSER : SIGNE, PLANIFIE ou CHANTIER sans encaissement VALIDE ni « sans acompte » motivé (« Acompte promis, pas
 *   encore reçu » reste à encaisser) ; FACTURE avec un reste dû ;
 * - PROCHAINE_ACTION : la prochaine action posée à la main, en vigueur (`contexte.vigueur`), le jour de sa date. Le
 *   moteur écarte toutes les autres détections de ce dossier tant qu'elle l'est.
 * Montant en jeu : devis accepté, sinon accord, sinon le plus gros devis en vigueur visible, sinon l'estimation (jamais
 * un devis annulé, remplacé ou non retenu).
 *
 * Mission 17 (partie A, relecture) :
 * - occurrence du besoin (`donnees.occurrence`, moteur.ts) : l'acompte, ou le solde et sa facture ; la date du rappel ;
 *   l'instant où l'action a été posée à la main — un besoin suivant sur la même clé revient après un « Fait » ;
 * - pas de « Préparer la simulation » quand une simulation attend d'être publiée (brouillon) : « Publier » la reprend ;
 * - les restes dus des dossiers facturés sont lus en une fois (plus une lecture par dossier) ;
 * - raisons en dates absolues (« rappel prévu le 30/09 à 14 h ») : rien ne change d'un passage à l'autre.
 */

/** Le dernier instant de la journée de Paris (le serveur tourne en UTC). */
const finDeJournee = (maintenant: Date) => new Date(aHeureParis(maintenant, 1, 0).getTime() - 1);

/** Libellés du pilotage lus ici (commercial/pilotage.ts) : ne pas les reformuler l'un sans l'autre. */
const ACTION_SMS = "Répondre à son SMS";
const ACTION_LIEN = "Envoyer le lien de son espace";
const LIBELLE_ACOMPTE_A_VENIR = MOTIFS_SANS_ACOMPTE.find((m) => m.code === "ACOMPTE_A_VENIR")!.libelle;
const ETAPES_ACOMPTE = ["SIGNE", "PLANIFIE", "CHANTIER"];
const ETAPES_RELANCE_DEVIS = ["DEVIS_ENVOYE", "RELANCE"];
const LONGUEUR_ACTION = 60;
/** « Appeler : demande de devis » : un premier appel (ouverture automatique, nouveau projet), son motif après les deux-points. */
const PREMIER_APPEL = /^\s*appeler\s*:\s*(\S[\s\S]*)/i;

/** « prévu le 28/09 à 14 h », « prévu le 28/09 » (jour seul). Toujours absolu. */
function quandPrevu(date: Date, instant: Date | null, feminin = false): string {
  const aLHeure = instant !== null && instant.getTime() === date.getTime();
  return `${feminin ? "prévue" : "prévu"} le ${jourMois(date)}${aLHeure ? ` à ${heureLisible(date)}` : ""}`;
}

/** Le texte court d'une action posée à la main, pour un titre : une ligne, 60 caractères au plus, majuscule en tête. */
function actionCourte(texte: string): string {
  const ligne = texte.split("\n")[0].replace(/\s+/g, " ").trim();
  const courte = ligne.length > LONGUEUR_ACTION ? `${ligne.slice(0, LONGUEUR_ACTION - 1).trimEnd()}…` : ligne;
  return courte.charAt(0).toUpperCase() + courte.slice(1);
}

/** « demande de devis » : le motif d'un premier appel, en minuscule et court (raison de la tâche). */
function motifDuPremierAppel(texte: string): string {
  const court = actionCourte(texte);
  return court.charAt(0).toLowerCase() + court.slice(1);
}

const plusRecent = (dates: (Date | null | undefined)[]): Date | null => dates.reduce<Date | null>((max, d) => (d && (!max || d.getTime() > max.getTime()) ? d : max), null);

type DevisLu = { statut: string; totalHt: number; acomptePct: number | null; lignes: string; visibleEspace: boolean };
type AccordLu = { createdAt: Date; totalHt: number; acomptePct: number | null };

/** Le montant en jeu d'un dossier (voir l'en-tête). */
export function montantEnJeu(d: { documents: readonly DevisLu[]; accords: readonly AccordLu[]; montantEstime: number | null }): number | null {
  const accepte = d.documents.find((x) => x.statut === "ACCEPTE");
  if (accepte) return accepte.totalHt;
  if (d.accords[0]) return d.accords[0].totalHt;
  const visibles = d.documents.filter((x) => x.visibleEspace && (x.statut === "GENERE" || x.statut === "ENVOYE")).map((x) => x.totalHt);
  if (visibles.length) return Math.max(...visibles);
  return d.montantEstime ?? null;
}

/** L'acompte attendu (en euros) : celui du devis accepté, sinon de l'accord ; null s'il n'y a ni l'un ni l'autre. */
export function acompteAttendu(d: { documents: readonly DevisLu[]; accords: readonly AccordLu[] }): number | null {
  const accepte = d.documents.find((x) => x.statut === "ACCEPTE");
  if (accepte) return montantsDocument({ lignes: lireLignes(accepte.lignes), totalHt: accepte.totalHt, acomptePct: accepte.acomptePct }).acompteCentimes / 100;
  const accord = d.accords[0];
  if (accord) return accord.acomptePct ? Math.round((versCentimes(accord.totalHt) * accord.acomptePct) / 100) / 100 : 0;
  return null;
}

async function lireDossiers(ids: string[]) {
  const [dossiers, photos, changements] = await Promise.all([
    prisma.dossier.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, clientNom: true, clientTelephone: true, leadId: true, clientId: true, etape: true, photos: true, montantEstime: true, createdAt: true, updatedAt: true, mainLe: true,
        prochaineAction: true, prochaineActionDate: true, prochaineActionInstant: true,
        documents: { where: { type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" }, select: { statut: true, totalHt: true, acomptePct: true, lignes: true, visibleEspace: true } },
        accords: { where: { retireLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, totalHt: true, acomptePct: true } },
        espaces: { where: { archiveLe: null }, select: { simulations: { where: { archiveLe: null, OR: [{ choisieLe: { not: null } }, { statut: "BROUILLON" }] }, select: { choisieLe: true, statut: true } } } },
      },
    }),
    prisma.dossierEvenement.findMany({ where: { dossierId: { in: ids }, type: "ESPACE_PHOTOS" }, select: { dossierId: true, createdAt: true, survenuLe: true } }),
    prisma.dossierEvenement.findMany({ where: { dossierId: { in: ids }, type: "CHANGEMENT_ETAPE" }, select: { dossierId: true, metadata: true, createdAt: true, survenuLe: true } }),
  ]);
  const photosLe = new Map<string, Date>();
  for (const p of photos) {
    const le = p.survenuLe ?? p.createdAt;
    const avant = photosLe.get(p.dossierId);
    if (!avant || le > avant) photosLe.set(p.dossierId, le);
  }
  // Le dernier passage en « Signé », et les « sans acompte » motivés (libellé en clair dans la trace du changement d'étape).
  const signeLe = new Map<string, Date>();
  const sansAcompte = new Map<string, string[]>();
  for (const c of changements) {
    const meta = lireMetadataChangementEtape(c.metadata ?? "");
    if (!meta) continue;
    const le = c.survenuLe ?? c.createdAt;
    if (meta.vers === "SIGNE" && (!signeLe.get(c.dossierId) || le > signeLe.get(c.dossierId)!)) signeLe.set(c.dossierId, le);
    if (typeof meta.sansAcompte === "string" && meta.sansAcompte.trim()) sansAcompte.set(c.dossierId, [...(sansAcompte.get(c.dossierId) ?? []), meta.sansAcompte.trim()]);
  }
  return new Map(
    dossiers.map((d) => [
      d.id,
      {
        ...d,
        nom: d.clientNom.trim() || "Sans nom",
        nbPhotos: lirePhotos(d.photos).length,
        photosLe: photosLe.get(d.id) ?? null,
        choisieLe: plusRecent(d.espaces.flatMap((e) => e.simulations.map((s) => s.choisieLe))),
        brouillon: d.espaces.some((e) => e.simulations.some((s) => s.statut === "BROUILLON")),
        accordLe: d.accords[0]?.createdAt ?? null,
        signeLe: signeLe.get(d.id) ?? null,
        sansAcompte: sansAcompte.get(d.id) ?? [],
      },
    ])
  );
}

type DossierLu = Awaited<ReturnType<typeof lireDossiers>> extends Map<string, infer V> ? V : never;

const lienDossier = (id: string, suite = "") => `/dossiers?dossier=${id}${suite}`;

/** Les champs communs d'une détection sur ce dossier : sujet, liens personnels, montant en jeu. */
function surLeDossier(d: DossierLu, type: TypeTache, champs: { titre: string; raison: string; niveau: NiveauTache; depuis: Date; raccourci: Raccourci; echeance?: Date | null; montant?: number | null; donnees?: Record<string, unknown> }): Detection {
  return {
    cle: cleTache(type, { type: "DOSSIER", id: d.id }),
    type,
    source: "DOSSIERS",
    sujet: { type: "DOSSIER", id: d.id },
    dossierId: d.id,
    leadId: d.leadId,
    clientId: d.clientId,
    montant: montantEnJeu(d),
    ...champs,
  };
}

/** La détection d'une affaire du pilotage (dossier, main à Lucas) ; null quand ce groupe n'appelle pas de tâche ici. */
function depuisLAffaire(a: Affaire, d: DossierLu): Detection | null {
  const telephone = a.telephone ?? normaliserTelephone(d.clientTelephone);
  switch (a.groupe) {
    case "REPONDRE": {
      if (a.action === ACTION_SMS) {
        const recuLe = a.dernier?.type === "SMS reçu" ? new Date(a.dernier.le) : (d.mainLe ?? d.updatedAt);
        return surLeDossier(d, "REPONDRE", {
          titre: `Répondre · ${d.nom}`,
          raison: `SMS reçu le ${jourMois(recuLe)}`,
          niveau: 1,
          depuis: recuLe,
          raccourci: { genre: "DOSSIER", libelle: "Répondre", dossierId: d.id, rubrique: "messages", href: lienDossier(d.id, "&rubrique=messages") },
          donnees: { canal: "SMS", ...(a.conversationId ? { conversationId: a.conversationId } : {}) },
        });
      }
      const depuis = d.mainLe ?? d.updatedAt;
      return surLeDossier(d, "REPONDRE", {
        titre: `Répondre · ${d.nom}`,
        raison: `message sans réponse depuis le ${jourMois(depuis)}`,
        niveau: 1,
        depuis,
        raccourci: { genre: "ESPACE", libelle: "Répondre", dossierId: d.id, rubrique: "messages", href: lienDossier(d.id, "&rubrique=messages") },
      });
    }
    case "PLANIFIER": {
      const depuis = d.accordLe ?? d.signeLe ?? d.mainLe ?? d.updatedAt;
      return surLeDossier(d, "DATE_CHANTIER", {
        titre: `Fixer la date du chantier · ${d.nom}`,
        raison: d.accordLe ? `accord du ${jourMois(d.accordLe)}` : d.signeLe ? `signé le ${jourMois(d.signeLe)}` : "devis signé, sans date",
        niveau: 1,
        depuis,
        raccourci: { genre: "PLANIFIER", libelle: "Fixer la date", dossierId: d.id, href: lienDossier(d.id) },
      });
    }
    case "RAPPELER": {
      const relance = a.action.startsWith("Relancer");
      // La relance d'un devis en attente : le détecteur RELANCES la propose (RELANCER_DEVIS), pas de doublon ici.
      if (relance && ETAPES_RELANCE_DEVIS.includes(d.etape)) return null;
      // Mission 18 (A2) : « Appeler : demande de devis » — un premier appel, pas un rappel ; la raison dit pourquoi.
      const premier = !relance ? PREMIER_APPEL.exec(a.action) : null;
      const verbe = relance ? "Relancer" : premier ? "Appeler" : "Rappeler";
      // Sans date (main « à relancer ») : l'origine du besoin reste fixe d'un passage à l'autre.
      const date = d.prochaineActionDate ?? d.mainLe ?? d.updatedAt;
      return surLeDossier(d, "RAPPELER", {
        titre: `${verbe} · ${d.nom}`,
        raison: premier ? `${motifDuPremierAppel(premier[1])}${d.prochaineActionDate ? `, ${quandPrevu(date, d.prochaineActionInstant)}` : ""}` : d.prochaineActionDate ? `${relance ? "relance" : "rappel"} ${quandPrevu(date, d.prochaineActionInstant, relance)}` : relance ? "relance à faire" : "rappel à faire",
        niveau: 2,
        depuis: date,
        echeance: d.prochaineActionDate,
        raccourci: { genre: "APPEL", libelle: verbe, telephone, dossierId: d.id, leadId: d.leadId, href: telephone ? `tel:${telephone}` : null },
        donnees: {
          ...(d.prochaineAction ? { action: d.prochaineAction } : {}),
          ...(d.prochaineActionDate ? { occurrence: `${d.prochaineActionDate.toISOString()}|${d.prochaineAction ?? ""}` } : {}),
        },
      });
    }
    case "SIMULATION": {
      // Une simulation préparée attend d'être publiée : « Publier la simulation » (SIGNAUX) la reprend.
      if (d.brouillon) return null;
      const raison = d.nbPhotos > 0 ? `${pluriel(d.nbPhotos, "photo reçue", "photos reçues")}${d.photosLe ? ` le ${jourMois(d.photosLe)}` : ""}` : "aucune simulation publiée";
      return surLeDossier(d, "SIMULATION", {
        titre: `Préparer la simulation · ${d.nom}`,
        raison,
        niveau: 3,
        depuis: d.photosLe ?? d.mainLe ?? d.createdAt,
        raccourci: { genre: "SIMULATEUR", libelle: "Préparer la simulation", dossierId: d.id, href: `/simulateur?dossier=${d.id}` },
      });
    }
    case "DEVIS":
      // Mission 18 (B1) : le devis est fait, il reste à l'envoyer — la lecture ENVOYER_DEVIS le dit (voir detecter).
      if (estMotifDevisAEnvoyer(a.action)) return null;
      return surLeDossier(d, "DEVIS", {
        titre: `Faire le devis · ${d.nom}`,
        raison: d.choisieLe ? `simulation choisie le ${jourMois(d.choisieLe)}` : "simulation choisie",
        niveau: 3,
        depuis: d.choisieLe ?? d.mainLe ?? d.updatedAt,
        raccourci: { genre: "DEVIS", libelle: "Faire le devis", dossierId: d.id, devis: "nouveau", href: lienDossier(d.id, "&devis=nouveau") },
      });
    case "DECIDER":
      // Seul « Envoyer le lien de son espace » est une tâche de ce détecteur ; les autres « à moi » d'un dossier (une
      // demande du client dans son espace) viennent de SIGNAUX et de ESPACE_MESSAGES.
      if (!a.action.startsWith(ACTION_LIEN)) return null;
      return surLeDossier(d, "ENVOYER_LIEN", {
        titre: `Envoyer le lien · ${d.nom}`,
        raison: `dossier ouvert le ${jourMois(d.createdAt)}, sans espace`,
        niveau: 3,
        depuis: d.createdAt,
        raccourci: { genre: "SMS", libelle: "Copier le SMS", dossierId: d.id, leadId: d.leadId, sms: { action: "ENVOYER_LIEN", dossierId: d.id } },
        donnees: { occurrence: "SANS_ESPACE" },
      });
    default:
      return null;
  }
}

/** Les dossiers où il y a de l'argent à encaisser : l'acompte (signé, planifié, en chantier) ou le solde (facturé). */
async function aEncaisser(): Promise<{ acompte: string[]; solde: string[] }> {
  const candidats = await prisma.dossier.findMany({
    where: { OR: [{ etape: { in: ETAPES_ACOMPTE }, encaissements: { none: { statut: "VALIDE" } } }, { etape: "FACTURE" }] },
    select: { id: true, etape: true },
  });
  return { acompte: candidats.filter((c) => c.etape !== "FACTURE").map((c) => c.id), solde: candidats.filter((c) => c.etape === "FACTURE").map((c) => c.id) };
}

async function detecter(contexte: ContexteDetection): Promise<Detection[]> {
  const { maintenant, vigueur } = contexte;
  const [pilotage, encaisser, aEnvoyer, gmail] = await Promise.all([pilotageDuPassage(maintenant), aEncaisser(), devisAEnvoyer(), devisGmailNonEnregistres(undefined, { maintenant })]);
  const affaires = pilotage.affaires.filter((a) => a.genre === "DOSSIER" && a.main === "MOI" && a.dossierId);
  const ids = [...new Set([...affaires.map((a) => a.dossierId!), ...encaisser.acompte, ...encaisser.solde, ...aEnvoyer.map((x) => x.dossierId), ...gmail.map((x) => x.dossierId), ...vigueur.keys()])];
  const dossiers = await lireDossiers(ids);
  const detections: Detection[] = [];

  for (const a of affaires) {
    const d = dossiers.get(a.dossierId!);
    const detection = d ? depuisLAffaire(a, d) : null;
    if (detection) detections.push(detection);
  }

  // L'acompte : ni encaissement VALIDE ni « sans acompte » motivé — « Acompte promis, pas encore reçu » reste à encaisser.
  for (const id of encaisser.acompte) {
    const d = dossiers.get(id);
    if (!d || d.sansAcompte.some((motif) => !motif.startsWith(LIBELLE_ACOMPTE_A_VENIR))) continue;
    const acompte = acompteAttendu(d);
    // Un devis (ou un accord) sans acompte : rien à encaisser avant la facture.
    if (acompte === 0) continue;
    const promis = d.sansAcompte.length > 0;
    const origine = d.accordLe ? `accord du ${jourMois(d.accordLe)}` : d.signeLe ? `signé le ${jourMois(d.signeLe)}` : "devis signé";
    detections.push(
      surLeDossier(d, "ENCAISSER", {
        titre: `Encaisser l'acompte · ${d.nom}`,
        raison: promis ? `${origine}, acompte promis` : origine,
        niveau: 1,
        depuis: d.accordLe ?? d.signeLe ?? d.mainLe ?? d.updatedAt,
        montant: acompte,
        raccourci: { genre: "ENCAISSER", libelle: "Encaisser", dossierId: d.id, rubrique: "encaisser", href: lienDossier(d.id, "&rubrique=encaisser") },
        donnees: { occurrence: "ACOMPTE" },
      })
    );
  }

  // Le solde : un reste dû sur les factures actives (le dossier passe seul à « Encaissé » quand il est réglé). Lus en une fois.
  const restes = await restesDesFactures(prisma, encaisser.solde);
  for (const id of encaisser.solde) {
    const d = dossiers.get(id);
    const du = restes.get(id);
    if (!d || !du || du.resteCentimes <= 0) continue;
    const facture = du.facture;
    const reste = du.resteCentimes / 100;
    detections.push(
      surLeDossier(d, "ENCAISSER", {
        titre: `Encaisser le solde · ${d.nom}`,
        raison: `reste ${euros(reste)}${facture ? ` sur la facture ${facture.numero}` : ""}`,
        niveau: 1,
        depuis: facture?.emisLe ?? d.updatedAt,
        montant: reste,
        raccourci: { genre: "ENCAISSER", libelle: "Encaisser", dossierId: d.id, rubrique: "encaisser", href: lienDossier(d.id, "&rubrique=encaisser") },
        donnees: { occurrence: `SOLDE:${facture?.documentId ?? facture?.numero ?? "facture"}` },
      })
    );
  }

  // Mission 18 (B1) : les devis générés mais pas encore envoyés, une tâche par dossier (le plus ancien donne l'origine).
  const parDossier = new Map<string, typeof aEnvoyer>();
  for (const devis of aEnvoyer) parDossier.set(devis.dossierId, [...(parDossier.get(devis.dossierId) ?? []), devis]);
  for (const [id, liste] of parDossier) {
    const d = dossiers.get(id);
    if (!d || estDossierClos(d.etape)) continue;
    const premier = liste[0];
    detections.push(
      surLeDossier(d, "ENVOYER_DEVIS", {
        titre: `Envoyer le devis · ${d.nom}`,
        raison:
          liste.length > 1
            ? `devis ${liste.map((x) => x.numero).join(", ")} prêts, pas encore envoyés`
            : `devis ${premier.numero} prêt le ${jourMois(premier.le)}, ${premier.visible ? "pas encore annoncé" : "masqué dans son espace"}`,
        niveau: 2,
        depuis: premier.le,
        raccourci: { genre: "DOSSIER", libelle: "Envoyer le devis", dossierId: d.id, rubrique: "devis", href: lienDossier(d.id, "&rubrique=devis") },
        donnees: { documentIds: liste.map((x) => x.documentId), occurrence: liste.map((x) => x.documentId).join(",") },
      })
    );
  }

  // Mission 18 (B3) : un devis parti de Gmail, pas encore dans le CRM — une tâche par PDF, enregistré en un geste.
  for (const devis of gmail) {
    const d = dossiers.get(devis.dossierId);
    if (!d || estDossierClos(d.etape)) continue;
    const quoi = devis.devisCrm ? `devis ${devis.devisCrm.numero} du CRM` : `« ${devis.nom} »`;
    detections.push({
      ...surLeDossier(d, "ENREGISTRER_DEVIS", {
        titre: `Enregistrer comme devis envoyé · ${d.nom}`,
        raison: `${quoi} envoyé depuis Gmail le ${jourMois(devis.envoyeLe)}${devis.a ? ` à ${devis.a}` : ""} : pas encore dans le CRM (étape, relances)`,
        niveau: 2,
        depuis: devis.envoyeLe,
        raccourci: { genre: "DEVIS", libelle: "Enregistrer comme devis envoyé", dossierId: d.id, rubrique: "devis", devis: "gmail", pieceId: devis.pieceId, href: lienDossier(d.id, `&devis=gmail&piece=${devis.pieceId}`) },
        donnees: { pieceId: devis.pieceId, messageId: devis.messageId, nom: devis.nom, numero: devis.devisCrm?.numero ?? devis.numero, documentId: devis.devisCrm?.id ?? null },
      }),
      cle: cleTache("ENREGISTRER_DEVIS", { type: "DOSSIER", id: d.id }, devis.pieceId),
    });
  }

  // La prochaine action posée à la main, le jour de sa date (ou en retard) : la seule tâche de ce dossier tant qu'elle est en vigueur.
  const ceSoir = finDeJournee(maintenant);
  for (const action of vigueur.values()) {
    const d = dossiers.get(action.dossierId);
    if (!d || estDossierClos(d.etape) || !action.date || action.date.getTime() > ceSoir.getTime()) continue;
    detections.push(
      surLeDossier(d, "PROCHAINE_ACTION", {
        titre: `${actionCourte(action.action)} · ${d.nom}`,
        // « en retard » change au plus une fois (à minuit) : pas une réécriture à chaque passage.
        raison: `prévue le ${jourMois(action.date)}${action.date.getTime() < aHeureParis(maintenant, 0, 0).getTime() ? ", en retard" : ""}`,
        niveau: 2,
        depuis: action.date,
        echeance: action.date,
        raccourci: { genre: "DOSSIER", libelle: "Ouvrir le dossier", dossierId: d.id, href: lienDossier(d.id) },
        donnees: { action: action.action, poseeLe: action.le.toISOString(), par: action.par, occurrence: action.le.toISOString() },
      })
    );
  }
  return detections;
}

export const detecteurDossiers: Detecteur = { source: "DOSSIERS", detecter };
