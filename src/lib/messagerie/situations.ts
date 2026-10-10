/**
 * Mission 25 (lot 6) — la ligne Situation de « Où on en est » dans les listes Leads et Dossiers (cahier : « dans les
 * listes, la ligne Situation seulement »). Celle du suivi quand la messagerie a lu le lead ou le dossier ; sinon, pour un
 * lead, la même règle que « Où on en est » (`situationDuLead`), calculée sans rien écrire. Deux requêtes par liste.
 */
import prisma from "@/lib/prisma";
import { situationDuLead } from "./ou-en-est";
import { lireOuEnEst } from "./types";

export type LeadDeListe = { id: string; dossierId: string | null; recuLe: string; source: string; statut: string; dernierAppelLe: string | null; dernierContactLe: string | null; rappelLe: string | null; tentatives: number };

const date = (iso: string | null) => (iso ? new Date(iso) : null);

export async function situationsDesLeads(lignes: readonly LeadDeListe[], maintenant: Date = new Date()): Promise<Map<string, string>> {
  if (!lignes.length) return new Map();
  const ids = lignes.map((l) => l.id);
  const dossierIds = lignes.map((l) => l.dossierId).filter((d): d is string => Boolean(d));
  const suivis = await prisma.suivi.findMany({ where: { OR: [{ leadId: { in: ids } }, ...(dossierIds.length ? [{ dossierId: { in: dossierIds } }] : [])] }, select: { leadId: true, dossierId: true, ouEnEst: true } });
  const parLead = new Map<string, string>();
  const parDossier = new Map<string, string>();
  for (const s of suivis) {
    const situation = lireOuEnEst(s.ouEnEst)?.situation;
    if (!situation) continue;
    if (s.leadId) parLead.set(s.leadId, situation);
    if (s.dossierId) parDossier.set(s.dossierId, situation);
  }
  return new Map(
    lignes.map((l) => {
      const lue = parLead.get(l.id) ?? (l.dossierId ? parDossier.get(l.dossierId) : undefined);
      if (lue) return [l.id, lue];
      // Sans suivi : la règle de « Où on en est » (sans la date de la perte, que la liste ne porte pas).
      if (l.statut === "PERDU") return [l.id, "Sans suite."];
      return [l.id, situationDuLead({ creeLe: new Date(l.recuLe), source: l.source, statut: l.statut, dernierAppelLe: date(l.dernierAppelLe), rappelLe: date(l.rappelLe), perteLe: null, motifPerte: null }, { envois: l.dernierContactLe ? 1 : 0, tentativesSansReponse: l.tentatives }, maintenant)];
    })
  );
}

/** La situation des dossiers que la messagerie a lus (les autres : rien, la ligne garde la prochaine action). */
export async function situationsDesDossiers(ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const suivis = await prisma.suivi.findMany({ where: { dossierId: { in: [...ids] } }, select: { dossierId: true, ouEnEst: true } });
  const parDossier = new Map<string, string>();
  for (const s of suivis) {
    const situation = lireOuEnEst(s.ouEnEst)?.situation;
    if (s.dossierId && situation) parDossier.set(s.dossierId, situation);
  }
  return parDossier;
}
