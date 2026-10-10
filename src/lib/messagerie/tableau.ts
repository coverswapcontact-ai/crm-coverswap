/**
 * Mission 25 (lot 7) — le tableau de bord de la messagerie, semaine par semaine (cahier, § Ce qu'on mesure) : taux de
 * réponse par message de la liste, délai moyen avant la réponse du client, messages préparés, envoyés, reportés,
 * refusés, relances retenues par la garde de silence (et pourquoi), taux de STOP (alerte au-dessus de 3 %), devis
 * signés après une relance, coût de l'IA du mois. Calculé à la demande sur ce qui est en base (rien n'est stocké) ;
 * l'alerte STOP part une fois par semaine, le lundi, par le moteur (`surveillerStop`).
 *
 * Une réponse du client = une ligne « Client » de son journal (SMS, espace, mail) dans les 7 jours qui suivent l'envoi.
 */
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { definitionMessage, estCodeMessage, estRelance, type CodeMessage } from "./catalogue";
import { instantParis, jourSuivant, momentParis, semaineDuJour } from "./horaires";
import { budgetMessagerie, depenseMessagerieDuMois } from "./ia";

export const SEUIL_STOP = 0.03;
const JOUR = 86_400_000;
const FENETRE_REPONSE = 7 * JOUR;

export type SemaineMessagerie = {
  debut: string;
  fin: string;
  prepares: number;
  envoyes: number;
  reportes: number;
  refuses: number;
  nonConfirmes: number;
  retenues: { motif: string; nombre: number }[];
  stop: { nombre: number; contactes: number; taux: number | null };
  reponses: { envoyes: number; repondus: number; taux: number | null; delaiMoyenHeures: number | null };
  signesApresRelance: number;
};

export type LigneParMessage = { code: string; libelle: string; envoyes: number; repondus: number; taux: number | null; delaiMoyenHeures: number | null };

export type TableauMessagerie = { semaines: SemaineMessagerie[]; parMessage: LigneParMessage[]; coutIaMois: number; budgetIa: number; alerteStop: boolean };

/** Le lundi 0 h (Paris) de la semaine d'un instant. */
export function debutDeSemaine(instant: Date): Date {
  let jour = momentParis(instant).jour;
  while (semaineDuJour(jour) !== 1) jour = new Date(Date.parse(`${jour}T12:00:00Z`) - JOUR).toISOString().slice(0, 10);
  return instantParis(jour, 0);
}

const finDeSemaine = (debut: Date) => {
  let jour = momentParis(debut).jour;
  for (let i = 0; i < 7; i++) jour = jourSuivant(jour);
  return instantParis(jour, 0);
};

const libelle = (code: string) => (estCodeMessage(code) ? `${code} · ${definitionMessage(code as CodeMessage).libelle}` : code === "REPONSE" ? "Réponse proposée" : code === "LIBRE" ? "Message libre" : code);
/** « garde : client a écrit (…) » → « client a écrit » : le motif sans ses détails. */
const motifCourt = (motif: string | null) => (motif ?? "sans motif").replace(/\s*\(.*$/, "").replace(/\s*:.*$/, "").trim().slice(0, 80) || "sans motif";

type Envoi = { id: string; suiviId: string; code: string; envoyeLe: Date };

/** Pour chaque envoi : le client a-t-il écrit dans les 7 jours, et au bout de combien d'heures. */
async function reponsesAuxEnvois(envois: Envoi[]): Promise<Map<string, number | null>> {
  const resultat = new Map<string, number | null>();
  if (!envois.length) return resultat;
  const min = new Date(Math.min(...envois.map((e) => e.envoyeLe.getTime())));
  const max = new Date(Math.max(...envois.map((e) => e.envoyeLe.getTime())) + FENETRE_REPONSE);
  const lignes = await prisma.ligneJournalSuivi.findMany({ where: { ...AVEC_ARCHIVES, acteur: "CLIENT", suiviId: { in: [...new Set(envois.map((e) => e.suiviId))] }, le: { gt: min, lte: max } }, select: { suiviId: true, le: true }, orderBy: { le: "asc" } });
  const parSuivi = new Map<string, Date[]>();
  for (const l of lignes) parSuivi.set(l.suiviId, [...(parSuivi.get(l.suiviId) ?? []), l.le]);
  for (const e of envois) {
    const premiere = (parSuivi.get(e.suiviId) ?? []).find((le) => le.getTime() > e.envoyeLe.getTime() && le.getTime() <= e.envoyeLe.getTime() + FENETRE_REPONSE);
    resultat.set(e.id, premiere ? (premiere.getTime() - e.envoyeLe.getTime()) / 3_600_000 : null);
  }
  return resultat;
}

const moyenne = (valeurs: number[]) => (valeurs.length ? Math.round((valeurs.reduce((t, v) => t + v, 0) / valeurs.length) * 10) / 10 : null);
const taux = (n: number, sur: number) => (sur ? Math.round((n / sur) * 1000) / 1000 : null);

async function semaine(debut: Date, fin: Date): Promise<SemaineMessagerie & { envois: Envoi[]; delais: Map<string, number | null> }> {
  const periode = { gte: debut, lt: fin };
  const [prepares, envoisBruts, retenus, stops, lignes] = await Promise.all([
    prisma.messagePrepare.count({ where: { ...AVEC_ARCHIVES, createdAt: periode } }),
    prisma.messagePrepare.findMany({ where: { ...AVEC_ARCHIVES, statut: "ENVOYE", envoyeLe: periode }, select: { id: true, suiviId: true, code: true, envoyeLe: true, canal: true } }),
    prisma.messagePrepare.findMany({ where: { ...AVEC_ARCHIVES, statut: "RETENU", updatedAt: periode }, select: { motif: true } }),
    prisma.suivi.count({ where: { ...AVEC_ARCHIVES, stopLe: periode } }),
    prisma.ligneJournalSuivi.findMany({ where: { ...AVEC_ARCHIVES, le: periode, OR: [{ cle: { contains: ":plus-tard:" } }, { cle: { endsWith: ":non-envoye" } }, { cle: { endsWith: ":non-confirme" } }] }, select: { cle: true } }),
  ]);
  const envois = envoisBruts.map((e) => ({ id: e.id, suiviId: e.suiviId, code: e.code, envoyeLe: e.envoyeLe! }));
  const delais = await reponsesAuxEnvois(envois);
  const repondus = [...delais.values()].filter((d): d is number => d !== null);
  const contactes = new Set(envoisBruts.filter((e) => e.canal === "SMS").map((e) => e.suiviId)).size;
  const parMotif = new Map<string, number>();
  for (const r of retenus) parMotif.set(motifCourt(r.motif), (parMotif.get(motifCourt(r.motif)) ?? 0) + 1);

  // Devis signés cette semaine après une relance envoyée (D2–D5, P2–P3, S3–S5, F1, R1–R2, C4–C5 ou « comme convenu »).
  const accords = await prisma.accordDevis.findMany({ where: { createdAt: periode, retireLe: null }, select: { dossierId: true, createdAt: true } });
  let signesApresRelance = 0;
  for (const a of accords) {
    const suivi = await prisma.suivi.findFirst({ where: { ...AVEC_ARCHIVES, dossierId: a.dossierId }, select: { id: true } });
    if (!suivi) continue;
    const relance = await prisma.messagePrepare.findFirst({ where: { ...AVEC_ARCHIVES, statut: "ENVOYE", envoyeLe: { lt: a.createdAt }, suiviId: suivi.id }, select: { code: true }, orderBy: { envoyeLe: "desc" } });
    if (relance && (estRelance(relance.code) || relance.code === "CC")) signesApresRelance++;
  }

  return {
    debut: debut.toISOString(),
    fin: fin.toISOString(),
    prepares,
    envoyes: envois.length,
    reportes: lignes.filter((l) => l.cle.includes(":plus-tard:")).length,
    refuses: lignes.filter((l) => l.cle.endsWith(":non-envoye")).length,
    nonConfirmes: lignes.filter((l) => l.cle.endsWith(":non-confirme")).length,
    retenues: [...parMotif.entries()].map(([motif, nombre]) => ({ motif, nombre })).sort((a, b) => b.nombre - a.nombre),
    stop: { nombre: stops, contactes, taux: taux(stops, contactes) },
    reponses: { envoyes: envois.length, repondus: repondus.length, taux: taux(repondus.length, envois.length), delaiMoyenHeures: moyenne(repondus) },
    signesApresRelance,
    envois,
    delais,
  };
}

/** Les `nombre` dernières semaines (la semaine en cours d'abord), le détail par message sur toute la période, l'IA du mois. */
export async function tableauMessagerie(maintenant: Date = new Date(), nombre = 4): Promise<TableauMessagerie> {
  const semaines: Awaited<ReturnType<typeof semaine>>[] = [];
  let debut = debutDeSemaine(maintenant);
  for (let i = 0; i < Math.min(Math.max(nombre, 1), 12); i++) {
    semaines.push(await semaine(debut, finDeSemaine(debut)));
    debut = debutDeSemaine(new Date(debut.getTime() - 3 * JOUR));
  }
  const parCode = new Map<string, { envoyes: number; delais: number[] }>();
  for (const s of semaines) {
    for (const e of s.envois) {
      const ligne = parCode.get(e.code) ?? { envoyes: 0, delais: [] };
      ligne.envoyes++;
      const d = s.delais.get(e.id);
      if (typeof d === "number") ligne.delais.push(d);
      parCode.set(e.code, ligne);
    }
  }
  const parMessage = [...parCode.entries()]
    .map(([code, l]) => ({ code, libelle: libelle(code), envoyes: l.envoyes, repondus: l.delais.length, taux: taux(l.delais.length, l.envoyes), delaiMoyenHeures: moyenne(l.delais) }))
    .sort((a, b) => b.envoyes - a.envoyes || a.code.localeCompare(b.code));
  const [coutIaMois, budgetIa] = await Promise.all([depenseMessagerieDuMois(maintenant), budgetMessagerie(maintenant)]);
  const derniere = semaines[1] ?? semaines[0];
  return {
    semaines: semaines.map((s) => ({ debut: s.debut, fin: s.fin, prepares: s.prepares, envoyes: s.envoyes, reportes: s.reportes, refuses: s.refuses, nonConfirmes: s.nonConfirmes, retenues: s.retenues, stop: s.stop, reponses: s.reponses, signesApresRelance: s.signesApresRelance })),
    parMessage,
    coutIaMois: Math.round(coutIaMois * 100) / 100,
    budgetIa,
    alerteStop: Boolean(derniere?.stop.taux !== null && derniere.stop.taux > SEUIL_STOP),
  };
}

/**
 * L'alerte STOP de la semaine passée (plus de 3 % des clients contactés par SMS ont répondu STOP) : une fois, le lundi
 * à partir de 9 h, sur le téléphone. Gardée par le registre des alertes (origine « messagerie-stop », une par semaine).
 */
export async function surveillerStop(maintenant: Date = new Date()): Promise<boolean> {
  const { jour, minutes } = momentParis(maintenant);
  if (semaineDuJour(jour) !== 1 || minutes < 9 * 60) return false;
  const cetteSemaine = debutDeSemaine(maintenant);
  const deja = await prisma.alerteEnvoi.findFirst({ where: { origine: "messagerie-stop", createdAt: { gte: cetteSemaine } }, select: { id: true } });
  if (deja) return false;
  const passee = debutDeSemaine(new Date(cetteSemaine.getTime() - 3 * JOUR));
  const s = await semaine(passee, cetteSemaine);
  if (s.stop.taux === null || s.stop.taux <= SEUIL_STOP) return false;
  const { prevenirLucas } = await import("./alertes");
  await prevenirLucas({
    titre: "Messagerie : trop de STOP la semaine passée",
    texte: `${s.stop.nombre} STOP pour ${s.stop.contactes} clients contactés par SMS (${Math.round(s.stop.taux * 1000) / 10} %, seuil 3 %). Regarde quels messages les déclenchent.`,
    chemin: "/messagerie/tableau",
    libelleLien: "Voir le tableau",
    urgence: 4,
    etiquette: "messagerie-stop",
    origine: "messagerie-stop",
  });
  return true;
}
