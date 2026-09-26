import prisma from "@/lib/prisma";
import { STATUTS_TACHE, type StatutTache } from "./statuts";
import { traitementDe, travauxPeriodiques } from "./registre";
import { enregistrerTousLesTraitements } from "./traitements";

export type TacheVue = {
  id: string;
  type: string;
  libelle: string;
  statut: StatutTache;
  tentatives: number;
  prochainEssaiLe: string;
  createdAt: string;
  termineLe: string | null;
  derniereErreur: string | null;
  demandeePar: string;
  /** Mission 10 : le bilan lisible rendu par le traitement (`resultat.resume`), quand il y en a un. */
  resume: string | null;
  /** Mission 13 : annulée par le ménage (« Abandonnée le … ») — la raison est en tête de `derniereErreur`. */
  abandonnee: boolean;
};

export type PlanificationVue = {
  nom: string;
  libelle: string;
  actif: boolean;
  dernierDebut: string | null;
  dernierStatut: string | null;
  derniereErreur: string | null;
  echecsConsecutifs: number;
  prochainPassage: string | null;
};

export type EtatTaches = {
  compteurs: Record<StatutTache, number>;
  /** En échec d'abord, puis en cours et en attente ; les terminées récentes à la fin. */
  taches: TacheVue[];
  planifications: PlanificationVue[];
};

function resumeDe(resultat: string | null): string | null {
  if (!resultat) return null;
  try {
    const v = JSON.parse(resultat) as { resume?: unknown };
    return typeof v?.resume === "string" ? v.resume : null;
  } catch {
    return null;
  }
}

function statutLu(statut: string): StatutTache {
  return (STATUTS_TACHE as readonly string[]).includes(statut) ? (statut as StatutTache) : "EN_ATTENTE";
}

export async function etatDesTaches(): Promise<EtatTaches> {
  // Libellés et travaux connus même si l'exécuteur est coupé (TACHES_DESACTIVEES=1).
  enregistrerTousLesTraitements();
  const [groupes, actives, terminees, planifications] = await Promise.all([
    prisma.tache.groupBy({ by: ["statut"], _count: { _all: true } }),
    prisma.tache.findMany({
      where: { statut: { in: ["ECHEC_DEFINITIF", "EN_COURS", "EN_ATTENTE"] } },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }),
    prisma.tache.findMany({
      where: { statut: { in: ["TERMINEE", "ANNULEE"] } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.planification.findMany(),
  ]);

  const compteurs = Object.fromEntries(STATUTS_TACHE.map((statut) => [statut, 0])) as Record<StatutTache, number>;
  for (const groupe of groupes) compteurs[statutLu(groupe.statut)] = groupe._count._all;

  const ordre: Record<StatutTache, number> = { ECHEC_DEFINITIF: 0, EN_COURS: 1, EN_ATTENTE: 2, TERMINEE: 3, ANNULEE: 4 };
  const taches = [...actives, ...terminees]
    .map(
      (tache): TacheVue => ({
        id: tache.id,
        type: tache.type,
        libelle: traitementDe(tache.type)?.libelle ?? tache.type,
        statut: statutLu(tache.statut),
        tentatives: tache.tentatives,
        prochainEssaiLe: tache.prochainEssaiLe.toISOString(),
        createdAt: tache.createdAt.toISOString(),
        termineLe: tache.termineLe?.toISOString() ?? null,
        derniereErreur: tache.derniereErreur,
        demandeePar: tache.demandeePar,
        resume: resumeDe(tache.resultat),
        abandonnee: tache.statut === "ANNULEE" && /^Abandonnée/.test(tache.derniereErreur ?? ""),
      })
    )
    .sort((a, b) => ordre[a.statut] - ordre[b.statut]);

  const etats = new Map(planifications.map((planification) => [planification.nom, planification]));
  return {
    compteurs,
    taches,
    planifications: travauxPeriodiques().map((travail) => {
      const etat = etats.get(travail.nom);
      return {
        nom: travail.nom,
        libelle: travail.libelle,
        actif: etat?.actif ?? true,
        dernierDebut: etat?.dernierDebut?.toISOString() ?? null,
        dernierStatut: etat?.dernierStatut ?? null,
        derniereErreur: etat?.derniereErreur ?? null,
        echecsConsecutifs: etat?.echecsConsecutifs ?? 0,
        prochainPassage: etat?.prochainPassage.toISOString() ?? null,
      };
    }),
  };
}
