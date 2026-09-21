import type { NoteAppel } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ETIQUETTES_APPEL, LIBELLES_ETIQUETTE_APPEL, type EtiquetteAppel, type NoteAppelVue } from "./notes-constantes";

/**
 * Notes d'appel : ce que le contact a dit pendant l'appel (ce qu'il a en tête,
 * ses contraintes, ses objections), tapé ou dicté au fil de l'appel, et des
 * étiquettes à toucher. Une note par appel, datée ; les appels s'empilent.
 *
 * Elles vivent sur le contact (le lead) et y restent s'il n'aboutit jamais :
 * elles servent à améliorer le discours. Dès qu'il a un dossier, chaque note est
 * reprise dans l'historique du dossier, à la date de l'appel (événement
 * NOTE_APPEL, `survenuLe`), et tenue à jour si elle change ensuite.
 */

export const schemaNoteAppel = z.object({
  texte: z.string().max(8000, "Note trop longue (8 000 caractères au plus).").optional(),
  etiquettes: z.array(z.enum(ETIQUETTES_APPEL)).max(ETIQUETTES_APPEL.length).optional(),
  /** Début de l'appel, quand l'écran l'a noté (appui sur le numéro). */
  appelLe: z.iso.datetime().optional(),
});
export type EntreeNoteAppel = z.output<typeof schemaNoteAppel>;

export function lireEtiquettes(json: string | null | undefined): EtiquetteAppel[] {
  try {
    const valeur: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(valeur) ? [...new Set(valeur.filter((e): e is EtiquetteAppel => (ETIQUETTES_APPEL as readonly string[]).includes(e)))] : [];
  } catch {
    return [];
  }
}

export function versVueNote(note: Pick<NoteAppel, "id" | "appelLe" | "updatedAt" | "texte" | "etiquettes" | "issue" | "dossierEvenementId">): NoteAppelVue {
  return {
    id: note.id,
    appelLe: note.appelLe.toISOString(),
    majLe: note.updatedAt.toISOString(),
    texte: note.texte,
    etiquettes: lireEtiquettes(note.etiquettes),
    issue: note.issue,
    dansDossier: Boolean(note.dossierEvenementId),
  };
}

const vide = (note: Pick<NoteAppel, "texte" | "etiquettes">) => !note.texte.trim() && lireEtiquettes(note.etiquettes).length === 0;

/** Le texte d'une note dans l'historique du dossier : sa date, ses étiquettes, puis ce qui a été dit. */
export function contenuPourDossier(note: Pick<NoteAppel, "appelLe" | "texte" | "etiquettes">): string {
  const date = note.appelLe.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const etiquettes = lireEtiquettes(note.etiquettes).map((e) => LIBELLES_ETIQUETTE_APPEL[e]);
  return [`Note d'appel du ${date}${etiquettes.length ? ` — ${etiquettes.join(", ")}` : ""}`, note.texte.trim()].filter(Boolean).join("\n").slice(0, 8000);
}

async function dossierVivantDuLead(leadId: string): Promise<string | null> {
  const dossier = await prisma.dossier.findFirst({ where: { leadId, archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return dossier?.id ?? null;
}

/**
 * Reflète une note dans l'historique du dossier du contact : créée à la date de
 * l'appel, puis mise à jour à chaque enregistrement. Une note encore vide n'y
 * va pas ; sans dossier, rien à faire (elle y ira à l'ouverture du dossier).
 */
async function refleterDansDossier(note: NoteAppel, dossierConnu?: string | null): Promise<NoteAppel> {
  if (note.dossierEvenementId) {
    const existant = await prisma.dossierEvenement.findUnique({ where: { id: note.dossierEvenementId }, select: { id: true } });
    if (existant) {
      await prisma.dossierEvenement.update({ where: { id: existant.id }, data: { contenu: contenuPourDossier(note), metadata: JSON.stringify({ noteAppelId: note.id, etiquettes: lireEtiquettes(note.etiquettes), issue: note.issue }) } });
      return note;
    }
  }
  if (vide(note)) return note;
  const dossierId = dossierConnu === undefined ? await dossierVivantDuLead(note.leadId) : dossierConnu;
  if (!dossierId) return note;
  const evenement = await prisma.dossierEvenement.create({
    data: { dossierId, type: "NOTE_APPEL", direction: "INTERNE", contenu: contenuPourDossier(note), survenuLe: note.appelLe, metadata: JSON.stringify({ noteAppelId: note.id, etiquettes: lireEtiquettes(note.etiquettes), issue: note.issue }) },
  });
  return prisma.noteAppel.update({ where: { id: note.id }, data: { dossierEvenementId: evenement.id } });
}

export async function notesDuLead(leadId: string): Promise<NoteAppelVue[]> {
  const notes = await prisma.noteAppel.findMany({ where: { leadId, archiveLe: null }, orderBy: { appelLe: "desc" } });
  return notes.map(versVueNote);
}

export async function creerNoteAppel(leadId: string, entree: EntreeNoteAppel): Promise<NoteAppelVue> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  const appelLe = entree.appelLe ? new Date(entree.appelLe) : new Date();
  // Une date d'appel dans le futur (horloge du téléphone décalée) est ramenée à maintenant.
  const note = await prisma.noteAppel.create({
    data: { leadId, texte: entree.texte ?? "", etiquettes: JSON.stringify([...new Set(entree.etiquettes ?? [])]), appelLe: appelLe.getTime() > Date.now() ? new Date() : appelLe },
  });
  return versVueNote(await refleterDansDossier(note));
}

export async function modifierNoteAppel(leadId: string, noteId: string, entree: EntreeNoteAppel): Promise<NoteAppelVue> {
  const note = await prisma.noteAppel.findFirst({ where: { id: noteId, leadId } });
  if (!note) throw new ErreurMetier("Note introuvable.", 404);
  if (note.archiveLe) throw new ErreurMetier("Cette note est archivée.", 409);
  const suite = await prisma.noteAppel.update({
    where: { id: note.id },
    data: {
      ...(entree.texte !== undefined ? { texte: entree.texte } : {}),
      ...(entree.etiquettes !== undefined ? { etiquettes: JSON.stringify([...new Set(entree.etiquettes)]) } : {}),
    },
  });
  return versVueNote(await refleterDansDossier(suite));
}

/** L'issue de fin d'appel s'inscrit sur la note de l'appel en cours (la plus récente, si elle date de moins de trois heures). */
export async function noterIssueSurNote(leadId: string, issue: string, maintenant: Date = new Date()): Promise<void> {
  const note = await prisma.noteAppel.findFirst({ where: { leadId, archiveLe: null, appelLe: { gte: new Date(maintenant.getTime() - 3 * 3_600_000) } }, orderBy: { appelLe: "desc" } });
  if (!note) return;
  await refleterDansDossier(await prisma.noteAppel.update({ where: { id: note.id }, data: { issue } }));
}

/** À l'ouverture du dossier : les notes du contact rejoignent son historique, à leur date. Rend le nombre de notes reprises. */
export async function reprendreNotesDansDossier(leadId: string, dossierId: string): Promise<number> {
  const notes = await prisma.noteAppel.findMany({ where: { leadId, archiveLe: null, dossierEvenementId: null }, orderBy: { appelLe: "asc" } });
  let reprises = 0;
  for (const note of notes) {
    if (vide(note)) continue;
    await refleterDansDossier(note, dossierId);
    reprises++;
  }
  return reprises;
}
