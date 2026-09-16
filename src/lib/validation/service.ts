import type { Proposition } from "@prisma/client";
import prisma, { type Transaction } from "@/lib/prisma";
import { analyser } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { resoudreContexte } from "@/lib/journal/acteur";
import { avecActeur, typeActeur } from "@/lib/journal/contexte";
import { mettreEnFile, relancerTache } from "@/lib/taches/file";
import { ErreurDefinitive, type ContexteTraitement } from "@/lib/taches/registre";
import { definitionDe } from "./catalogue";
import { estSensible, type DefinitionProposition, type ResultatExecution } from "./definitions";
import {
  LIBELLES_STATUT_PROPOSITION,
  MOTIFS_REJET_COMMUNS,
  STATUTS_PROPOSITION,
  type MotifRejet,
  type PropositionVue,
  type StatutProposition,
} from "./types";

export const TYPE_TACHE_EXECUTION = "EXECUTION_PROPOSITION";
export const TENTATIVES_EXECUTION = 5;

type Definition = DefinitionProposition<Record<string, unknown>>;

function lireJson(texte: string | null): Record<string, unknown> | null {
  if (!texte) return null;
  try {
    const valeur: unknown = JSON.parse(texte);
    return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function messageDe(erreur: unknown): string {
  return (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 2000);
}

function statutLu(statut: string): StatutProposition {
  return (STATUTS_PROPOSITION as readonly string[]).includes(statut) ? (statut as StatutProposition) : "EN_ATTENTE";
}

function definitionObligatoire(type: string): Definition {
  const definition = definitionDe(type);
  if (!definition) throw new Error(`Type de proposition inconnu : ${type}`);
  return definition;
}

function motifsDe(definition: Definition | undefined): MotifRejet[] {
  return [...(definition?.motifsRejet ?? []), ...MOTIFS_REJET_COMMUNS];
}

export function vueProposition(proposition: Proposition): PropositionVue {
  const definition = definitionDe(proposition.type);
  const contenu = lireJson(proposition.contenu) ?? {};
  return {
    id: proposition.id,
    type: proposition.type,
    libelleType: definition?.libelle ?? proposition.type,
    statut: statutLu(proposition.statut),
    auteur: proposition.auteur,
    titre: proposition.titre,
    resume: proposition.resume,
    raisonnement: proposition.raisonnement,
    confiance: proposition.confiance,
    contenu,
    contenuValide: lireJson(proposition.contenuValide),
    modifiee: proposition.modifiee,
    // Type inconnu : prudence, traité comme sensible.
    sensible: definition ? estSensible(definition, contenu) : true,
    validationGroupee: definition ? definition.validationGroupee && !estSensible(definition, contenu) : false,
    champs: definition?.champs ?? [],
    motifsRejet: motifsDe(definition),
    clientId: proposition.clientId,
    dossierId: proposition.dossierId,
    messageId: proposition.messageId,
    createdAt: proposition.createdAt.toISOString(),
    expireLe: proposition.expireLe?.toISOString() ?? null,
    decideLe: proposition.decideLe?.toISOString() ?? null,
    decidePar: proposition.decidePar,
    motifRejet: proposition.motifRejet,
    commentaireRejet: proposition.commentaireRejet,
    executeLe: proposition.executeLe?.toISOString() ?? null,
    erreurExecution: proposition.erreurExecution,
  };
}

async function charger(id: string): Promise<Proposition> {
  const proposition = await prisma.proposition.findUnique({ where: { id } });
  if (!proposition) throw new ErreurMetier("Proposition introuvable.", 404);
  return proposition;
}

/** Seule une personne décide : un agent, un script ou une tâche ne valide ni ne rejette jamais. */
async function decideur(): Promise<string> {
  const { acteur } = await resoudreContexte();
  if (typeActeur(acteur) !== "HUMAIN") {
    throw new ErreurMetier("Seule une personne connectée peut décider d'une proposition.", 403);
  }
  return acteur;
}

function dejaTraitee(proposition: Proposition): ErreurMetier {
  return new ErreurMetier(
    `Cette proposition a déjà été traitée (${LIBELLES_STATUT_PROPOSITION[statutLu(proposition.statut)].toLowerCase()}).`,
    409
  );
}

/* ── Proposer ──────────────────────────────────────────────────────── */

export type NouvelleProposition = {
  type: string;
  titre: string;
  resume?: string;
  raisonnement?: string;
  /** 0 à 1, calculée par le code appelant. */
  confiance?: number;
  contenu: unknown;
  /** Une même chose n'est proposée qu'une fois (rejetée ou non) : « rattachement:<message>:<dossier> ». */
  cleUnicite?: string;
  clientId?: string;
  dossierId?: string;
  messageId?: string;
  expireLe?: Date;
};

function donneesCreation(nouvelle: NouvelleProposition, contenu: Record<string, unknown>, auteur: string) {
  const confiance =
    typeof nouvelle.confiance === "number" && Number.isFinite(nouvelle.confiance)
      ? Math.min(1, Math.max(0, nouvelle.confiance))
      : null;
  return {
    type: nouvelle.type,
    auteur,
    titre: nouvelle.titre.slice(0, 300),
    resume: nouvelle.resume?.slice(0, 4000) ?? null,
    raisonnement: nouvelle.raisonnement?.slice(0, 8000) ?? null,
    confiance,
    contenu: JSON.stringify(contenu),
    cleUnicite: nouvelle.cleUnicite ?? null,
    clientId: nouvelle.clientId ?? null,
    dossierId: nouvelle.dossierId ?? null,
    messageId: nouvelle.messageId ?? null,
    expireLe: nouvelle.expireLe ?? null,
  };
}

async function existantePourCle(cleUnicite: string | undefined): Promise<string | null> {
  if (!cleUnicite) return null;
  const existante = await prisma.proposition.findUnique({ where: { cleUnicite }, select: { id: true } });
  return existante?.id ?? null;
}

function estConflitUnicite(erreur: unknown): boolean {
  return (erreur as { code?: string }).code === "P2002";
}

/** Dépose une proposition dans la file de validation. Rend son identifiant et si elle vient d'être créée. */
export async function proposer(nouvelle: NouvelleProposition): Promise<{ id: string; creee: boolean }> {
  const definition = definitionObligatoire(nouvelle.type);
  const contenu = analyser(definition.schema, nouvelle.contenu);
  const existante = await existantePourCle(nouvelle.cleUnicite);
  if (existante) return { id: existante, creee: false };

  const { acteur } = await resoudreContexte();
  try {
    const creee = await prisma.proposition.create({ data: donneesCreation(nouvelle, contenu, acteur) });
    return { id: creee.id, creee: true };
  } catch (erreur) {
    const concurrente = estConflitUnicite(erreur) ? await existantePourCle(nouvelle.cleUnicite) : null;
    if (concurrente) return { id: concurrente, creee: false };
    throw erreur;
  }
}

/**
 * Exécution sans validation, pour les seuls types déclarés automatisables et
 * jamais pour une proposition sensible (argent, client) : c'est le verrou du
 * principe « l'agent ne décide jamais seul ». Sous le seuil de confiance, la
 * proposition part simplement dans la file de validation.
 */
export async function executerSansValidation(
  nouvelle: NouvelleProposition & { confiance: number },
  seuilConfiance: number
): Promise<{ id: string; execution: "AUTOMATIQUE" | "PROPOSEE" | "DEJA_CONNUE" }> {
  const definition = definitionObligatoire(nouvelle.type);
  const contenu = analyser(definition.schema, nouvelle.contenu);
  if (!definition.automatisable || definition.execution !== "IMMEDIATE" || estSensible(definition, contenu)) {
    throw new Error(`Exécution sans validation interdite pour « ${definition.libelle} » : proposer plutôt.`);
  }
  if (!(nouvelle.confiance >= seuilConfiance)) {
    const { id, creee } = await proposer(nouvelle);
    return { id, execution: creee ? "PROPOSEE" : "DEJA_CONNUE" };
  }
  const existante = await existantePourCle(nouvelle.cleUnicite);
  if (existante) return { id: existante, execution: "DEJA_CONNUE" };

  const { acteur } = await resoudreContexte();
  let apres: ResultatExecution["apresValidation"];
  const id = await prisma.$transaction(async (tx) => {
    const creee = await tx.proposition.create({
      data: {
        ...donneesCreation(nouvelle, contenu, acteur),
        statut: "AUTOMATIQUE",
        decideLe: new Date(),
        decidePar: acteur,
        contenuValide: JSON.stringify(contenu),
      },
    });
    const sortie = await definition.executer(contenu, { propositionId: creee.id, decidePar: acteur, tx });
    apres = sortie?.apresValidation;
    await tx.proposition.update({
      where: { id: creee.id },
      data: { executeLe: new Date(), resultat: sortie?.resultat === undefined ? null : JSON.stringify(sortie.resultat) },
    });
    return creee.id;
  });
  if (apres) await apres().catch((erreur) => console.error("[validation] effets après exécution :", erreur));
  return { id, execution: "AUTOMATIQUE" };
}

/* ── Décider ───────────────────────────────────────────────────────── */

async function reclamer(tx: Transaction, id: string, data: Record<string, unknown>): Promise<void> {
  const { count } = await tx.proposition.updateMany({ where: { id, statut: "EN_ATTENTE" }, data });
  if (count !== 1) throw new ErreurMetier("Cette proposition vient d'être traitée ailleurs : recharge la file.", 409);
}

/**
 * Valide une proposition, telle quelle ou corrigée (`corrections` : seuls les
 * champs déclarés modifiables sont pris en compte), puis l'exécute :
 * - IMMEDIATE : dans la même transaction ; en cas d'échec, rien n'est écrit,
 *   la proposition reste à valider et l'erreur est affichée ;
 * - FILE : l'exécution part dans la file de tâches (envoi, service extérieur).
 */
export async function validerProposition(id: string, corrections?: Record<string, unknown>): Promise<PropositionVue> {
  const decidePar = await decideur();
  const proposition = await charger(id);
  if (proposition.statut !== "EN_ATTENTE") throw dejaTraitee(proposition);
  const definition = definitionObligatoire(proposition.type);

  const original = analyser(definition.schema, lireJson(proposition.contenu) ?? {});
  const modifiables = new Set((definition.champs ?? []).map((champ) => champ.cle));
  const retenues = Object.fromEntries(Object.entries(corrections ?? {}).filter(([cle]) => modifiables.has(cle)));
  const final = analyser(definition.schema, { ...original, ...retenues });
  const modifiee = JSON.stringify(final) !== JSON.stringify(original);

  const sansObjet = await definition.pertinente?.(final);
  if (sansObjet) {
    await annulerProposition(id, `Sans objet au moment de la validation : ${sansObjet}`);
    throw new ErreurMetier(`Proposition devenue sans objet : ${sansObjet}.`, 409);
  }

  const decision = {
    statut: "VALIDEE",
    decideLe: new Date(),
    decidePar,
    modifiee,
    contenuValide: JSON.stringify(final),
    erreurExecution: null,
  };

  if (definition.execution === "FILE") {
    await prisma.$transaction(async (tx) => {
      await reclamer(tx, id, decision);
      await mettreEnFile({ type: TYPE_TACHE_EXECUTION, cle: `proposition:${id}`, charge: { propositionId: id } }, tx);
    });
    return vueProposition(await charger(id));
  }

  let apres: ResultatExecution["apresValidation"];
  try {
    await prisma.$transaction(
      async (tx) => {
        await reclamer(tx, id, decision);
        const sortie = await definition.executer(final, { propositionId: id, decidePar, tx });
        apres = sortie?.apresValidation;
        await tx.proposition.update({
          where: { id },
          data: {
            statut: "EXECUTEE",
            executeLe: new Date(),
            resultat: sortie?.resultat === undefined ? null : JSON.stringify(sortie.resultat),
          },
        });
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
  } catch (erreur) {
    // Transaction annulée : la proposition reste à valider, avec la trace de l'échec.
    await prisma.proposition
      .updateMany({ where: { id, statut: "EN_ATTENTE" }, data: { erreurExecution: messageDe(erreur) } })
      .catch(() => {});
    if (erreur instanceof ErreurMetier) throw new ErreurMetier(`Exécution impossible : ${erreur.message}`, erreur.status);
    throw erreur;
  }
  if (apres) await apres().catch((erreur) => console.error("[validation] effets après validation :", erreur));
  return vueProposition(await charger(id));
}

/** Rejet : le motif est obligatoire (liste fermée), un commentaire l'est pour « Autre ». */
export async function rejeterProposition(
  id: string,
  rejet: { motif: string; commentaire?: string | null }
): Promise<PropositionVue> {
  const decidePar = await decideur();
  const proposition = await charger(id);
  if (proposition.statut !== "EN_ATTENTE") throw dejaTraitee(proposition);
  const motifs = motifsDe(definitionDe(proposition.type));
  if (!motifs.some((motif) => motif.code === rejet.motif)) throw new ErreurMetier("Choisis le motif du rejet.", 400);
  const commentaire = rejet.commentaire?.trim() || null;
  if (rejet.motif === "AUTRE" && (!commentaire || commentaire.length < 3)) {
    throw new ErreurMetier("Précise le motif du rejet en quelques mots.", 400);
  }
  await prisma.$transaction((tx) =>
    reclamer(tx, id, {
      statut: "REJETEE",
      decideLe: new Date(),
      decidePar,
      motifRejet: rejet.motif,
      commentaireRejet: commentaire?.slice(0, 1000) ?? null,
    })
  );
  return vueProposition(await charger(id));
}

/** Retire une proposition devenue sans objet (geste du système, jamais un rejet). */
export async function annulerProposition(id: string, motif: string): Promise<void> {
  const { acteur } = await resoudreContexte();
  await prisma.proposition.updateMany({
    where: { id, statut: "EN_ATTENTE" },
    data: { statut: "ANNULEE", decideLe: new Date(), decidePar: acteur, commentaireRejet: motif.slice(0, 1000) },
  });
}

/** Relance l'exécution d'une proposition validée dont l'envoi a échoué. */
export async function reessayerExecution(id: string): Promise<PropositionVue> {
  await decideur();
  const proposition = await charger(id);
  if (proposition.statut !== "ECHEC") throw new ErreurMetier("Seule une exécution en échec peut être relancée.", 409);
  const tache = await prisma.tache.findUnique({ where: { cle: `proposition:${id}` }, select: { id: true } });
  if (!tache) throw new ErreurMetier("Tâche d'exécution introuvable.", 404);
  await prisma.proposition.update({ where: { id }, data: { statut: "VALIDEE", erreurExecution: null } });
  await relancerTache(tache.id);
  return vueProposition(await charger(id));
}

/** Valide en lot les seules propositions qui le permettent (jamais une proposition sensible). */
export async function validerEnLot(ids: string[]): Promise<{ validees: string[]; ignorees: { id: string; raison: string }[] }> {
  await decideur();
  const validees: string[] = [];
  const ignorees: { id: string; raison: string }[] = [];
  for (const id of ids.slice(0, 100)) {
    const proposition = await prisma.proposition.findUnique({ where: { id } });
    if (!proposition) {
      ignorees.push({ id, raison: "introuvable" });
      continue;
    }
    const vue = vueProposition(proposition);
    if (!vue.validationGroupee) {
      ignorees.push({ id, raison: vue.sensible ? "à valider une par une (argent ou client)" : "validation en lot non permise" });
      continue;
    }
    try {
      await validerProposition(id);
      validees.push(id);
    } catch (erreur) {
      ignorees.push({ id, raison: messageDe(erreur) });
    }
  }
  return { validees, ignorees };
}

/* ── Exécution en file ─────────────────────────────────────────────── */

/** Traitement de la tâche EXECUTION_PROPOSITION : les écritures sont attribuées à la personne qui a validé. */
export async function executerPropositionValidee(charge: unknown, contexte: ContexteTraitement): Promise<unknown> {
  const propositionId = (charge as { propositionId?: unknown })?.propositionId;
  if (typeof propositionId !== "string") throw new ErreurDefinitive("Charge invalide : propositionId manquant");
  const proposition = await prisma.proposition.findUnique({ where: { id: propositionId } });
  if (!proposition) throw new ErreurDefinitive(`Proposition ${propositionId} introuvable`);
  if (proposition.statut === "EXECUTEE") return { dejaExecutee: true };
  if (proposition.statut !== "VALIDEE" || !proposition.decidePar) {
    throw new ErreurDefinitive(`Proposition à l'état ${proposition.statut} : exécution refusée`);
  }
  const definition = definitionDe(proposition.type);
  if (!definition) throw new ErreurDefinitive(`Type de proposition inconnu : ${proposition.type}`);
  const contenu = analyser(definition.schema, lireJson(proposition.contenuValide) ?? {});

  try {
    const sortie = await avecActeur(
      { acteur: proposition.decidePar, origine: `tache:${TYPE_TACHE_EXECUTION}`, requete: contexte.tacheId },
      () => definition.executer(contenu, { propositionId, decidePar: proposition.decidePar! })
    );
    await prisma.proposition.update({
      where: { id: propositionId },
      data: {
        statut: "EXECUTEE",
        executeLe: new Date(),
        erreurExecution: null,
        resultat: sortie?.resultat === undefined ? null : JSON.stringify(sortie.resultat),
      },
    });
    if (sortie?.apresValidation) {
      await sortie.apresValidation().catch((erreur) => console.error("[validation] effets après exécution :", erreur));
    }
    return sortie?.resultat;
  } catch (erreur) {
    const derniere = erreur instanceof ErreurDefinitive || contexte.tentative >= TENTATIVES_EXECUTION;
    await prisma.proposition.update({
      where: { id: propositionId },
      data: derniere ? { statut: "ECHEC", erreurExecution: messageDe(erreur) } : { erreurExecution: messageDe(erreur) },
    });
    throw erreur;
  }
}

/** Travail périodique : les propositions dont l'échéance est passée expirent. */
export async function expirerPropositions(maintenant = new Date()): Promise<number> {
  const { count } = await prisma.proposition.updateMany({
    where: { statut: "EN_ATTENTE", expireLe: { lte: maintenant } },
    data: { statut: "EXPIREE", decideLe: maintenant, decidePar: "SYSTEME:expiration" },
  });
  return count;
}

/* ── Lire ──────────────────────────────────────────────────────────── */

export type FiltresPropositions = {
  statuts?: StatutProposition[];
  type?: string;
  dossierId?: string;
  clientId?: string;
  messageId?: string;
  limite?: number;
};

export async function listerPropositions(filtres: FiltresPropositions = {}): Promise<PropositionVue[]> {
  const propositions = await prisma.proposition.findMany({
    where: {
      ...(filtres.statuts?.length ? { statut: { in: filtres.statuts } } : {}),
      ...(filtres.type ? { type: filtres.type } : {}),
      ...(filtres.dossierId ? { dossierId: filtres.dossierId } : {}),
      ...(filtres.clientId ? { clientId: filtres.clientId } : {}),
      ...(filtres.messageId ? { messageId: filtres.messageId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filtres.limite ?? 100, 500),
  });
  return propositions.map(vueProposition);
}

export async function compterPropositionsEnAttente(): Promise<number> {
  return prisma.proposition.count({ where: { statut: "EN_ATTENTE" } });
}
