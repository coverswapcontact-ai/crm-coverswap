import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { effacerImage, enregistrerImageBase64, imageBase64Acceptable } from "@/lib/simulations/images";
import { DOSSIER_SITE, RETENTION_SANS_DEMANDE_MS } from "@/lib/site/simulations";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement } from "@/lib/taches/registre";
import { resolveUploadsDir } from "@/lib/uploads";
import { analyserPhoto, zonesNonVisibles } from "./moteur/analyse-photo";
import type { AnalysePhoto } from "./moteur/types";
import { estIdPiece, type IdPiece, type IdZone } from "./zones";

/**
 * Les analyses de photos (mission 15, partie 2) : une table `AnalysePhoto`
 * clé = empreinte SHA-256 de la photo, lue AVANT tout appel vision et
 * réutilisée pour toute génération sur la même photo — site (lancée dès la
 * photo chargée, par `POST /api/simulate/analyse` et la tâche ANALYSE_PHOTO),
 * espace et CRM (à la génération). Ne lève jamais vers la génération : une
 * analyse absente ou sautée laisse générer sans elle.
 */

export const TACHE_ANALYSE_PHOTO = "ANALYSE_PHOTO";
export const DELAI_TACHE_ANALYSE_MS = 90_000;
/** La génération attend une analyse en cours au plus ce temps, puis génère sans. */
export const ATTENTE_ANALYSE_MAX_MS = 45_000;
const PAS_ATTENTE_MS = 2_000;

export type StatutAnalyse = "EN_COURS" | "PRETE" | "SAUTEE" | "ECHEC";
export type EtatAnalyse = { empreinte: string; statut: StatutAnalyse; piece: string; analyse: AnalysePhoto | null; raison: string | null };

/**
 * Ce que le site lit quand une analyse n'a pas abouti : un code, jamais le détail (`AnalysePhoto.raison` garde le
 * message complet pour le CRM — montant du budget, erreur HTTP d'OpenAI…, qui ne regardent pas le visiteur).
 */
export type CodeRaisonSite = "budget" | "cle" | "delai" | "erreur" | "invalide" | "purgee";
const CODES_RAISON: readonly CodeRaisonSite[] = ["budget", "cle", "delai", "erreur", "invalide", "purgee"];

/** Le code d'une raison enregistrée (« budget : Budget IA du mois atteint… » → « budget ») ; « erreur » à défaut. */
export function codeRaisonSite(raison: string | null | undefined): CodeRaisonSite | null {
  if (!raison) return null;
  const code = raison.split(" : ")[0].trim();
  return (CODES_RAISON as readonly string[]).includes(code) ? (code as CodeRaisonSite) : "erreur";
}

export function empreintePhoto(octets: Buffer): string {
  return createHash("sha256").update(octets).digest("hex");
}

export function lireAnalyseJson(json: string | null | undefined): AnalysePhoto | null {
  if (!json) return null;
  try {
    const lu = JSON.parse(json) as AnalysePhoto;
    return lu && typeof lu === "object" && typeof lu.description === "string" ? lu : null;
  } catch {
    return null;
  }
}

function versEtat(ligne: { empreinte: string; statut: string; piece: string; json: string | null; raison: string | null }): EtatAnalyse {
  const statut = (["EN_COURS", "PRETE", "SAUTEE", "ECHEC"] as const).find((s) => s === ligne.statut) ?? "ECHEC";
  return { empreinte: ligne.empreinte, statut, piece: ligne.piece, analyse: statut === "PRETE" ? lireAnalyseJson(ligne.json) : null, raison: ligne.raison };
}

/** L'analyse connue pour cette empreinte (archivée comprise : elle répond alors sans json), ou null. */
export async function lireAnalyse(empreinte: string): Promise<EtatAnalyse | null> {
  const ligne = await prisma.analysePhoto.findFirst({ where: { ...AVEC_ARCHIVES, empreinte } });
  return ligne ? versEtat(ligne) : null;
}

/** Une analyse EN_COURS depuis plus de deux minutes est tenue pour perdue (processus coupé) : on la refait. */
const EN_COURS_PERDUE_MS = 2 * 60_000;

/**
 * L'analyse de cette photo : celle déjà faite pour la même pièce, sinon un appel
 * vision maintenant (ligne EN_COURS posée avant, résultat écrit après). Une
 * analyse en cours ailleurs (tâche du site) est attendue jusqu'à `attendreMs`.
 */
export async function obtenirAnalyse(photo: Buffer, pieceId: IdPiece, options: { parcoursId?: string | null; dossierId?: string | null; preparationId?: string | null; origine?: "SITE" | "CRM" | "ESPACE"; signal?: AbortSignal; attendreMs?: number } = {}): Promise<EtatAnalyse> {
  const empreinte = empreintePhoto(photo);
  const connue = await prisma.analysePhoto.findFirst({ where: { ...AVEC_ARCHIVES, empreinte } });
  if (connue && !connue.archiveLe) {
    if (connue.statut === "PRETE" && connue.piece === pieceId && lireAnalyseJson(connue.json)) return versEtat(connue);
    if (connue.statut === "EN_COURS" && Date.now() - connue.updatedAt.getTime() < EN_COURS_PERDUE_MS) {
      const attendue = await attendreAnalyse(empreinte, options.attendreMs ?? ATTENTE_ANALYSE_MAX_MS, options.signal);
      if (attendue && attendue.statut !== "EN_COURS") return attendue;
    }
  }
  await prisma.analysePhoto.upsert({
    where: { empreinte },
    create: { empreinte, piece: pieceId, parcoursId: options.parcoursId ?? null, statut: "EN_COURS" },
    update: { piece: pieceId, statut: "EN_COURS", raison: null, archiveLe: null, archiveMotif: null, ...(options.parcoursId ? { parcoursId: options.parcoursId } : {}) },
  });
  const resultat = await analyserPhoto(photo, pieceId, undefined, { dossierId: options.dossierId, preparationId: options.preparationId, origine: options.origine, signal: options.signal });
  if (resultat.ok) {
    await prisma.analysePhoto.update({ where: { empreinte }, data: { statut: "PRETE", json: JSON.stringify(resultat.donnees), raison: null, coutDollars: resultat.coutDollars } });
    return { empreinte, statut: "PRETE", piece: pieceId, analyse: resultat.donnees, raison: null };
  }
  const statut: StatutAnalyse = resultat.raison === "budget" || resultat.raison === "cle" ? "SAUTEE" : "ECHEC";
  await prisma.analysePhoto.update({ where: { empreinte }, data: { statut, raison: `${resultat.raison} : ${resultat.message}`.slice(0, 300), json: null } });
  console.warn(`[analyse] photo ${empreinte.slice(0, 12)} : analyse ${statut.toLowerCase()} (${resultat.raison}) — génération sans analyse`);
  return { empreinte, statut, piece: pieceId, analyse: null, raison: resultat.message };
}

/**
 * `POST /api/simulate` : les zones choisies que l'analyse connue de cette photo
 * ne voit pas (409 « zone-non-visible », avant de dépenser). Sans analyse
 * connue : aucune (on ne bloque jamais à l'aveugle).
 */
export async function zonesNonVisiblesPourPhoto(photoBase64: string, zones: IdZone[]): Promise<IdZone[]> {
  if (zones.length === 0) return [];
  const octets = Buffer.from(photoBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const etat = await lireAnalyse(empreintePhoto(octets)).catch(() => null);
  return etat?.statut === "PRETE" && etat.analyse ? zonesNonVisibles(etat.analyse, zones) : [];
}

/** Attend qu'une analyse en cours se termine (au plus `maxMs`), en relisant la ligne toutes les deux secondes. */
export async function attendreAnalyse(empreinte: string, maxMs: number, signal?: AbortSignal): Promise<EtatAnalyse | null> {
  const fin = Date.now() + maxMs;
  for (;;) {
    const etat = await lireAnalyse(empreinte);
    if (!etat || etat.statut !== "EN_COURS") return etat;
    if (Date.now() >= fin || signal?.aborted) return etat;
    await new Promise((r) => setTimeout(r, Math.min(PAS_ATTENTE_MS, Math.max(0, fin - Date.now()))));
  }
}

/* ── Le site : analyse lancée dès la photo chargée ────────────────── */

export type DemandeAnalyseSite = {
  parcoursId: string;
  piece: string;
  photoBase64: string;
  /** Le quota du visiteur, demandé (et compté) SEULEMENT quand une analyse doit être mise en file. */
  quota?: () => { ok: boolean; raison?: "ip" | "global" };
};
export type ReponseAnalyseSite = { ok: true; empreinte: string; statut: StatutAnalyse; analyse: AnalysePhoto | null; raison: CodeRaisonSite | null; /** Vrai quand une tâche vient d'être mise en file (202). */ nouvelle: boolean } | { ok: false; status: number; raison: string; message: string };

/**
 * `POST /api/simulate/analyse` : la photo est écrite sur le volume et la tâche
 * ANALYSE_PHOTO mise en file ; réponse immédiate. Une analyse déjà prête pour
 * cette photo est rendue tout de suite (sans rien compter au visiteur). Le
 * `parcoursId` du dernier demandeur est gardé (preuve du suivi).
 */
export async function demanderAnalyseSite(demande: DemandeAnalyseSite): Promise<ReponseAnalyseSite> {
  if (!estIdPiece(demande.piece)) return { ok: false, status: 400, raison: "bad-request", message: "Pièce inconnue." };
  if (!imageBase64Acceptable(demande.photoBase64)) return { ok: false, status: 400, raison: "photo-refusee", message: "Cette photo n'a pas pu être lue : reprenez-la ou choisissez-en une autre." };
  const octets = Buffer.from(demande.photoBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const empreinte = empreintePhoto(octets);
  const connue = await prisma.analysePhoto.findFirst({ where: { ...AVEC_ARCHIVES, empreinte } });
  if (connue && !connue.archiveLe && connue.statut === "PRETE" && connue.piece === demande.piece && lireAnalyseJson(connue.json)) {
    if (connue.parcoursId !== demande.parcoursId) await prisma.analysePhoto.update({ where: { empreinte }, data: { parcoursId: demande.parcoursId } });
    return { ok: true, empreinte, statut: "PRETE", analyse: lireAnalyseJson(connue.json), raison: null, nouvelle: false };
  }
  if (connue && !connue.archiveLe && connue.statut === "EN_COURS" && Date.now() - connue.updatedAt.getTime() < EN_COURS_PERDUE_MS) {
    if (connue.parcoursId !== demande.parcoursId) await prisma.analysePhoto.update({ where: { empreinte }, data: { parcoursId: demande.parcoursId } });
    return { ok: true, empreinte, statut: "EN_COURS", analyse: null, raison: null, nouvelle: false };
  }
  // Une analyse va être faite (un appel vision, une photo sur le volume) : c'est ici, et seulement ici, que le quota compte.
  const quota = demande.quota?.() ?? { ok: true };
  if (!quota.ok) {
    return quota.raison === "global"
      ? { ok: false, status: 429, raison: "global-quota", message: "Le service d'analyse des photos est très demandé aujourd'hui : vous pouvez lancer la simulation sans." }
      : { ok: false, status: 429, raison: "ip-quota", message: "Limite d'analyses atteinte pour aujourd'hui : vous pouvez lancer la simulation sans." };
  }
  const photoPath = await enregistrerImageBase64(demande.photoBase64, path.join(DOSSIER_SITE, demande.parcoursId, "analyses"), `${empreinte}.jpg`);
  if (!photoPath) return { ok: false, status: 500, raison: "stockage", message: "La photo n'a pas pu être enregistrée de notre côté : réessayez dans un instant." };
  await prisma.analysePhoto.upsert({
    where: { empreinte },
    create: { empreinte, piece: demande.piece, parcoursId: demande.parcoursId, statut: "EN_COURS", photoPath },
    update: { piece: demande.piece, parcoursId: demande.parcoursId, statut: "EN_COURS", raison: null, json: null, photoPath, archiveLe: null, archiveMotif: null },
  });
  await mettreEnFile({ type: TACHE_ANALYSE_PHOTO, cle: `analyse-photo:${empreinte}`, charge: { empreinte }, priorite: 8, tentativesMax: 1, mode: "RECONCILIATION" });
  return { ok: true, empreinte, statut: "EN_COURS", analyse: null, raison: null, nouvelle: true };
}

/** `GET /api/simulate/analyse?e=&p=` : l'état pour ce parcours seulement (null : 404 sans détail) ; la raison d'un échec n'est qu'un code. */
export async function suivreAnalyseSite(empreinte: string, parcoursId: string): Promise<ReponseAnalyseSite | null> {
  const ligne = await prisma.analysePhoto.findFirst({ where: { ...AVEC_ARCHIVES, empreinte, parcoursId } });
  if (!ligne) return null;
  const etat = versEtat(ligne);
  if (ligne.archiveLe) return { ok: true, empreinte, statut: "ECHEC", analyse: null, raison: "purgee", nouvelle: false };
  if (etat.statut === "EN_COURS" && Date.now() - ligne.updatedAt.getTime() > EN_COURS_PERDUE_MS) return { ok: true, empreinte, statut: "ECHEC", analyse: null, raison: "delai", nouvelle: false };
  return { ok: true, empreinte, statut: etat.statut, analyse: etat.analyse, raison: etat.statut === "PRETE" || etat.statut === "EN_COURS" ? null : codeRaisonSite(etat.raison), nouvelle: false };
}

/** Le corps de la tâche ANALYSE_PHOTO : analyse la photo en attente, puis l'efface du volume. */
export async function executerAnalysePhoto(empreinte: string, signal?: AbortSignal): Promise<{ statut: StatutAnalyse | "INCHANGE" }> {
  const ligne = await prisma.analysePhoto.findFirst({ where: { ...AVEC_ARCHIVES, empreinte } });
  if (!ligne || ligne.archiveLe) return { statut: "INCHANGE" };
  if (ligne.statut === "PRETE" && lireAnalyseJson(ligne.json)) {
    await effacerImage(ligne.photoPath);
    if (ligne.photoPath) await prisma.analysePhoto.update({ where: { empreinte }, data: { photoPath: null } });
    return { statut: "INCHANGE" };
  }
  const photo = ligne.photoPath ? await fs.readFile(path.join(resolveUploadsDir(), ligne.photoPath)).catch(() => null) : null;
  if (!photo) {
    await prisma.analysePhoto.update({ where: { empreinte }, data: { statut: "ECHEC", raison: "erreur : photo introuvable sur le volume", photoPath: null } });
    return { statut: "ECHEC" };
  }
  const piece = estIdPiece(ligne.piece) ? ligne.piece : "cuisine";
  // La ligne est EN_COURS : `obtenirAnalyse` ne l'attend que si elle est récente — on la marque perdue avant, pour qu'il analyse tout de suite.
  await prisma.analysePhoto.update({ where: { empreinte }, data: { updatedAt: new Date(Date.now() - EN_COURS_PERDUE_MS - 1000) } });
  const etat = await obtenirAnalyse(photo, piece, { parcoursId: ligne.parcoursId, origine: "SITE", signal, attendreMs: 0 });
  await effacerImage(ligne.photoPath);
  await prisma.analysePhoto.update({ where: { empreinte }, data: { photoPath: null } });
  return { statut: etat.statut };
}

/** Purge à 30 jours : json effacé, photo en attente effacée, ligne archivée (jamais supprimée). */
export async function purgerAnalyses(maintenant: Date = new Date()): Promise<number> {
  const limite = new Date(maintenant.getTime() - RETENTION_SANS_DEMANDE_MS);
  const perimees = await prisma.analysePhoto.findMany({ where: { archiveLe: null, createdAt: { lt: limite } }, take: 200, select: { empreinte: true, photoPath: true } });
  for (const a of perimees) {
    await effacerImage(a.photoPath);
    await prisma.analysePhoto.update({ where: { empreinte: a.empreinte }, data: { json: null, photoPath: null, parcoursId: null, archiveLe: maintenant, archiveMotif: "Analyse de plus de 30 jours : description et photo effacées" } });
  }
  return perimees.length;
}

/** Enregistrement de la tâche (traitements.ts) : voie longue, priorité au-dessus des générations (elles l'attendent), une tentative. */
export function enregistrerTachesAnalyses(): void {
  enregistrerTraitement(TACHE_ANALYSE_PHOTO, {
    libelle: "Simulateur : analyse d'une photo (vision)",
    acteur: "SYSTEME:simulateur-analyse",
    tentativesMax: 1,
    delaiMaxMs: DELAI_TACHE_ANALYSE_MS,
    voie: "longue",
    executer: async (charge, { signal }) => executerAnalysePhoto((charge as { empreinte: string }).empreinte, signal),
  });
}
