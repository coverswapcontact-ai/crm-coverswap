import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { dernierJourDuMois } from "@/lib/finances/periodes";
import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { calculerSynthese } from "./calcul";
import type { Synthese } from "./types";

/**
 * Instantanés mensuels : chaque mois écoulé est figé une fois (synthèse sans nom
 * de personne), puis jamais recalculé ni modifié (la base le refuse). Un mois
 * dont les encaissements ne se calculent pas encore (paramètre manquant) n'est
 * pas figé : il le sera au passage suivant, une fois le paramètre saisi.
 */

export type InstantaneResume = { mois: string; figeLe: string; encaisse: number | null; signatures: number; dossiersOuverts: number };

export type Ecart = { indicateur: string; fige: number | null; recalcule: number | null };

function bornesDuMois(mois: string): { du: string; au: string } {
  const [annee, numero] = mois.split("-").map(Number);
  return { du: `${mois}-01`, au: dernierJourDuMois(annee, numero) };
}

function moisSuivant(mois: string): string {
  const [annee, numero] = mois.split("-").map(Number);
  return numero === 12 ? `${annee + 1}-01` : `${annee}-${String(numero + 1).padStart(2, "0")}`;
}

/** Fige les mois écoulés qui ne le sont pas encore, depuis le premier mois d'activité. */
export async function figerMoisEcoules(maintenant: Date = new Date()): Promise<{ figes: string[]; reportes: string[] }> {
  const [premierDossier, premierEncaissement] = await Promise.all([
    prisma.dossier.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.encaissement.findFirst({ orderBy: { recuLe: "asc" }, select: { recuLe: true } }),
  ]);
  const debuts = [premierDossier?.createdAt, premierEncaissement?.recuLe].filter((date): date is Date => Boolean(date));
  if (debuts.length === 0) return { figes: [], reportes: [] };

  const moisCourant = jourParis(maintenant).slice(0, 7);
  const existants = new Set((await prisma.instantaneMensuel.findMany({ select: { mois: true } })).map((ligne) => ligne.mois));
  const figes: string[] = [];
  const reportes: string[] = [];
  for (let mois = jourParis(new Date(Math.min(...debuts.map((date) => date.getTime())))).slice(0, 7); mois < moisCourant; mois = moisSuivant(mois)) {
    if (existants.has(mois)) continue;
    const { du, au } = bornesDuMois(mois);
    const synthese = await calculerSynthese(du, au, maintenant);
    if (synthese.finances.parametresManquants.length > 0) {
      reportes.push(mois);
      continue;
    }
    const contenu = JSON.stringify(synthese);
    try {
      await prisma.instantaneMensuel.create({
        data: { mois, version: synthese.version, contenu, empreinte: createHash("sha256").update(contenu).digest("hex") },
      });
      figes.push(mois);
    } catch (erreur) {
      // Figé entre-temps par un autre passage : le premier gel fait foi.
      if ((erreur as { code?: string }).code !== "P2002") throw erreur;
    }
  }
  return { figes, reportes };
}

export async function listerInstantanes(): Promise<InstantaneResume[]> {
  const lignes = await prisma.instantaneMensuel.findMany({ orderBy: { mois: "desc" } });
  return lignes.map((ligne) => {
    const synthese = JSON.parse(ligne.contenu) as Synthese;
    return {
      mois: ligne.mois,
      figeLe: ligne.createdAt.toISOString(),
      encaisse: synthese.finances.encaisse,
      signatures: synthese.commercial.activite.signatures,
      dossiersOuverts: synthese.commercial.cohorte.ouverts,
    };
  });
}

/** L'instantané figé d'un mois, et ce qui a changé depuis (saisies en retard, corrections). */
export async function lireInstantane(mois: string, maintenant: Date = new Date()): Promise<{ synthese: Synthese; figeLe: string; integre: boolean; ecarts: Ecart[] } | null> {
  const ligne = await prisma.instantaneMensuel.findUnique({ where: { mois } });
  if (!ligne) return null;
  const synthese = JSON.parse(ligne.contenu) as Synthese;
  const integre = createHash("sha256").update(ligne.contenu).digest("hex") === ligne.empreinte;
  const { du, au } = bornesDuMois(mois);
  const recalcule = await calculerSynthese(du, au, maintenant);
  const comparer = (indicateur: string, lire: (s: Synthese) => number | null): Ecart[] => {
    const fige = lire(synthese);
    const actuel = lire(recalcule);
    return fige === actuel ? [] : [{ indicateur, fige, recalcule: actuel }];
  };
  const ecarts = [
    ...comparer("Encaissé", (s) => s.finances.encaisse),
    ...comparer("Dépenses", (s) => s.finances.depenses),
    ...comparer("Devis émis", (s) => s.commercial.activite.devisEmis),
    ...comparer("Signatures", (s) => s.commercial.activite.signatures),
    ...comparer("Montant signé", (s) => s.commercial.activite.montantSigne),
    ...comparer("Factures émises", (s) => s.commercial.activite.facturesEmises),
    ...comparer("Montant facturé", (s) => s.commercial.activite.montantFacture),
    ...comparer("Pertes", (s) => s.commercial.activite.pertes),
    ...comparer("Nouveaux clients", (s) => s.clients.nouveaux),
  ];
  return { synthese, figeLe: ligne.createdAt.toISOString(), integre, ecarts };
}

export function enregistrerTachesSynthese(): void {
  enregistrerTravailPeriodique({
    nom: "instantanes-mensuels",
    libelle: "Gel des synthèses des mois écoulés",
    acteur: "SYSTEME:synthese",
    intervalleMs: 24 * 60 * 60_000,
    executer: async () => {
      const { figes, reportes } = await figerMoisEcoules();
      if (figes.length || reportes.length) console.info("[synthese] instantanés :", { figes, reportes });
    },
  });
}
