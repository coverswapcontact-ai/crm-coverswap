/**
 * Mission 25 (lot 7) — le brief de 8 h (cahier, § Les notifications et § L'IA, rôle 5) : « Aujourd'hui : 4 messages à
 * envoyer, 2 réponses à traiter, 1 rappel promis à 14 h », les propositions à valider et les signaux chauds de la
 * veille. Écrit par règles, à partir de ce que le CRM sait déjà (rien d'inventé) ; envoyé par la notification du matin
 * (`a-faire/matin.ts`), avant les tâches du jour. Lecture seule.
 */
import prisma from "@/lib/prisma";
import { aHeureParis } from "@/lib/commercial/quand";
import { pluriel } from "@/lib/commun/format";
import { estJourSeul, estRappel } from "@/lib/agenda/rappels";
import { rappelsDesLeads } from "@/lib/prospects/leads";

export type BriefDuJour = {
  messages: number;
  reponses: number;
  propositions: number;
  rappels: { le: string; nom: string; heure: boolean }[];
  chauds: string[];
  /** La phrase de la notification ; null quand la messagerie n'a rien pour aujourd'hui. */
  texte: string | null;
};

const heure = (date: Date) => date.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "2-digit" }).replace(":00", " h").replace(":", " h ");

export async function briefDuJour(maintenant: Date = new Date()): Promise<BriefDuJour> {
  const debut = aHeureParis(maintenant, 0, 0);
  const fin = aHeureParis(maintenant, 1, 0);
  const ouverts = await prisma.messagePrepare.findMany({
    where: { OR: [{ statut: { in: ["A_ENVOYER", "A_VALIDER"] } }, { statut: "PREVU", prevuLe: { lt: fin } }] },
    select: { statut: true, reponse: true, douceur: true },
  });
  const reponses = ouverts.filter((m) => m.reponse && m.statut !== "A_VALIDER").length;
  const propositions = ouverts.filter((m) => m.statut === "A_VALIDER").length;
  const messages = ouverts.length - reponses - propositions;

  // Les rappels promis aujourd'hui : ceux des leads et ceux des dossiers (« Rappeler… » daté du jour).
  const leads = (await rappelsDesLeads(maintenant, fin)).filter((r) => r.le.getTime() >= debut.getTime());
  const dossiers = await prisma.dossier.findMany({ where: { prochaineActionDate: { gte: debut, lt: fin } }, select: { clientNom: true, prochaineAction: true, prochaineActionDate: true, prochaineActionInstant: true } });
  const rappels = [
    ...leads.map((r) => ({ le: r.le, nom: r.nom, heure: true })),
    ...dossiers.filter((d) => estRappel(d.prochaineAction)).map((d) => ({ le: d.prochaineActionDate!, nom: d.clientNom, heure: !estJourSeul(d.prochaineActionDate!, d.prochaineActionInstant) })),
  ].sort((a, b) => a.le.getTime() - b.le.getTime());

  // Les signaux chauds des dernières 24 h (devis ouvert deux fois, journal « Signal chaud »).
  const chaudes = await prisma.ligneJournalSuivi.findMany({ where: { cle: { startsWith: "chaud:" }, le: { gte: new Date(maintenant.getTime() - 86_400_000) } }, select: { suiviId: true } });
  const suivisChauds = chaudes.length ? await prisma.suivi.findMany({ where: { id: { in: [...new Set(chaudes.map((l) => l.suiviId))] } }, select: { nom: true } }) : [];
  const chauds = [...new Set(suivisChauds.map((s) => s.nom))];

  const morceaux = [
    messages ? pluriel(messages, "message à envoyer", "messages à envoyer") : null,
    reponses ? pluriel(reponses, "réponse à traiter", "réponses à traiter") : null,
    rappels.length ? `${pluriel(rappels.length, "rappel promis", "rappels promis")}${rappels.length === 1 && rappels[0].heure ? ` à ${heure(rappels[0].le)}` : ""}` : null,
  ].filter(Boolean);
  const phrases = [
    morceaux.length ? `Aujourd'hui : ${morceaux.join(", ")}.` : null,
    propositions ? `${pluriel(propositions, "proposition à valider", "propositions à valider")}.` : null,
    chauds.length ? `Signal chaud : ${chauds.slice(0, 3).join(", ")}.` : null,
  ].filter(Boolean);
  return { messages, reponses, propositions, rappels: rappels.map((r) => ({ le: r.le.toISOString(), nom: r.nom, heure: r.heure })), chauds, texte: phrases.length ? phrases.join(" ") : null };
}
