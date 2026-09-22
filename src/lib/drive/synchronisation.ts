import prisma from "@/lib/prisma";
import { PORTEES_GOOGLE, connexionActive } from "@/lib/google/connexion";
import { mettreEnFile } from "@/lib/taches/file";
import { AttenteExterne, ErreurDefinitive, enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { creerDossierDrive, deplacerDrive, envoyerFichierDrive, lireElementDrive, renommerDrive } from "./client";
import { CLE_ARCHIVES, planMiroir, type ElementPlan } from "./plan";

/**
 * Synchronisation du miroir Drive : la base est la source, Drive la copie.
 *
 * - Passage idempotent et rejouable : chaque élément du plan est créé s'il
 *   manque, renommé ou déplacé s'il a changé, renvoyé si son contenu a changé.
 *   Un élément en échec n'arrête pas les autres ; il sera repris au passage
 *   suivant.
 * - Rien ne se supprime : un élément qui n'est plus dans le plan (photo
 *   retirée, client fusionné…) est déplacé dans « Archives (retirés du CRM) ».
 * - Client anonymisé (RGPD) : ses photos sont marquées « à neutraliser » ; leur
 *   contenu est remplacé dans Drive (sans suppression) avant l'archivage.
 * - Vérification (quotidienne) : un élément supprimé, mis à la corbeille ou
 *   renommé à la main dans Drive est reconstruit ou renommé comme le CRM le dit.
 * - Rien ne bloque l'interface : tout passe par les tâches de fond.
 */

export type ResumeMiroir = { crees: number; renommes: number; deplaces: number; renvoyes: number; archives: number; reconstruits: number; erreurs: number };

export const TYPE_TACHE_SYNCHRO_DRIVE = "SYNCHRO_DRIVE";

/** États d'un élément à neutraliser (client anonymisé) : encore en place, ou déjà aux archives du miroir. */
export const A_NEUTRALISER = "A_NEUTRALISER";
export const ARCHIVE_A_NEUTRALISER = "ARCHIVE_A_NEUTRALISER";
const CONTENU_NEUTRALISE = "Contenu effacé au titre du RGPD : le CRM ne conserve plus cette photo.";

function message(erreur: unknown): string {
  return (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 500);
}

export async function synchroniserMiroir(options: { verifier?: boolean; signal?: AbortSignal } = {}): Promise<ResumeMiroir> {
  const resume: ResumeMiroir = { crees: 0, renommes: 0, deplaces: 0, renvoyes: 0, archives: 0, reconstruits: 0, erreurs: 0 };
  const plan = await planMiroir();
  const lignes = await prisma.miroirDrive.findMany();
  const parCle = new Map(lignes.map((ligne) => [ligne.cle, ligne]));
  const driveIdDe = (cle: string | null) => (cle ? (parCle.get(cle)?.driveId ?? null) : null);

  async function enregistrer(element: ElementPlan, donnees: { driveId: string; empreinte?: string | null }) {
    const ligne = await prisma.miroirDrive.upsert({
      where: { cle: element.cle },
      create: { cle: element.cle, nom: element.nom, parentCle: element.parentCle, driveId: donnees.driveId, empreinte: donnees.empreinte ?? null, etat: "A_JOUR", synchroniseLe: new Date() },
      update: { nom: element.nom, parentCle: element.parentCle, driveId: donnees.driveId, empreinte: donnees.empreinte ?? null, etat: "A_JOUR", synchroniseLe: new Date(), derniereErreur: null },
    });
    parCle.set(element.cle, ligne);
  }

  async function creer(element: ElementPlan, parentId: string | null): Promise<void> {
    if (element.dossier) {
      await enregistrer(element, { driveId: await creerDossierDrive(element.nom, parentId) });
    } else {
      const { type, octets } = await element.contenu!();
      await enregistrer(element, { driveId: await envoyerFichierDrive({ nom: element.nom, type, contenu: octets, parentId }), empreinte: element.empreinte });
    }
    resume.crees++;
  }

  for (const element of plan) {
    if (options.signal?.aborted) break;
    const parentId = driveIdDe(element.parentCle);
    // Parent pas encore dans Drive (il a échoué) : l'enfant attendra le prochain passage.
    if (element.parentCle && !parentId) continue;
    const ligne = parCle.get(element.cle);
    try {
      if (!ligne?.driveId || ligne.etat === "ARCHIVE") {
        await creer(element, parentId);
        continue;
      }
      if (options.verifier) {
        const distant = await lireElementDrive(ligne.driveId);
        if (!distant || distant.trashed) {
          await creer(element, parentId);
          resume.reconstruits++;
          continue;
        }
        if (distant.name !== element.nom) {
          await renommerDrive(ligne.driveId, element.nom);
          resume.renommes++;
        }
        if (parentId && !distant.parents.includes(parentId)) {
          await deplacerDrive(ligne.driveId, parentId, distant.parents);
          resume.deplaces++;
        }
      } else {
        if (ligne.nom !== element.nom) {
          await renommerDrive(ligne.driveId, element.nom);
          resume.renommes++;
        }
        if (ligne.parentCle !== element.parentCle && parentId) {
          const ancien = driveIdDe(ligne.parentCle);
          await deplacerDrive(ligne.driveId, parentId, ancien ? [ancien] : []);
          resume.deplaces++;
        }
      }
      if (!element.dossier && ligne.empreinte !== element.empreinte) {
        const { type, octets } = await element.contenu!();
        await envoyerFichierDrive({ nom: element.nom, type, contenu: octets, parentId, fichierId: ligne.driveId });
        resume.renvoyes++;
      }
      await enregistrer(element, { driveId: ligne.driveId, empreinte: element.dossier ? null : element.empreinte });
    } catch (erreur) {
      // Connexion perdue, accès retiré : inutile de continuer, la tâche le dira.
      if (erreur instanceof ErreurDefinitive || erreur instanceof AttenteExterne) throw erreur;
      resume.erreurs++;
      await prisma.miroirDrive.upsert({
        where: { cle: element.cle },
        create: { cle: element.cle, nom: element.nom, parentCle: element.parentCle, etat: "A_CREER", derniereErreur: message(erreur) },
        update: { derniereErreur: message(erreur) },
      });
    }
  }

  // Retirés du CRM : rangés aux archives du miroir, jamais supprimés.
  const dansLePlan = new Set(plan.map((element) => element.cle));
  const archivesId = driveIdDe(CLE_ARCHIVES);
  const retires = [...parCle.values()].filter((ligne) => !dansLePlan.has(ligne.cle) && ligne.etat !== "ARCHIVE");
  for (const ligne of retires) {
    if (options.signal?.aborted || !archivesId) break;
    try {
      // Anonymisation : le contenu de la copie est remplacé (Drive n'en garde que ses révisions, 30 jours).
      if (ligne.driveId && ligne.etat.endsWith(A_NEUTRALISER)) {
        await envoyerFichierDrive({ nom: "Photo effacée (RGPD).txt", type: "text/plain; charset=utf-8", contenu: Buffer.from(CONTENU_NEUTRALISE, "utf8"), parentId: null, fichierId: ligne.driveId });
        if (ligne.etat === ARCHIVE_A_NEUTRALISER) {
          await prisma.miroirDrive.update({ where: { id: ligne.id }, data: { etat: "ARCHIVE", nom: "Photo effacée (RGPD).txt", synchroniseLe: new Date(), derniereErreur: null } });
          resume.archives++;
          continue;
        }
      }
      // Un élément dont le parent part aussi aux archives y part avec lui.
      const parentRetire = ligne.parentCle !== null && retires.some((autre) => autre.cle === ligne.parentCle);
      if (ligne.driveId && !parentRetire) {
        const parent = driveIdDe(ligne.parentCle);
        await deplacerDrive(ligne.driveId, archivesId, parent ? [parent] : []);
      }
      await prisma.miroirDrive.update({ where: { id: ligne.id }, data: { etat: "ARCHIVE", synchroniseLe: new Date(), derniereErreur: null } });
      resume.archives++;
    } catch (erreur) {
      if (erreur instanceof ErreurDefinitive || erreur instanceof AttenteExterne) throw erreur;
      resume.erreurs++;
      await prisma.miroirDrive.update({ where: { id: ligne.id }, data: { derniereErreur: message(erreur) } });
    }
  }
  return resume;
}

export type EtatMiroir = {
  actif: boolean;
  compte: string | null;
  elements: number;
  aJour: number;
  enErreur: { cle: string; nom: string; erreur: string }[];
  dernierPassage: string | null;
};

export async function etatMiroir(): Promise<EtatMiroir> {
  const connexion = await connexionActive(PORTEES_GOOGLE.DRIVE);
  const [elements, aJour, enErreur, dernier] = await Promise.all([
    prisma.miroirDrive.count({ where: { etat: { not: "ARCHIVE" } } }),
    prisma.miroirDrive.count({ where: { etat: "A_JOUR" } }),
    prisma.miroirDrive.findMany({ where: { derniereErreur: { not: null } }, select: { cle: true, nom: true, derniereErreur: true }, take: 20 }),
    prisma.miroirDrive.findFirst({ where: { synchroniseLe: { not: null } }, orderBy: { synchroniseLe: "desc" }, select: { synchroniseLe: true } }),
  ]);
  return {
    actif: connexion !== null && process.env.MIROIR_DRIVE !== "0",
    compte: connexion?.compte ?? null,
    elements,
    aJour,
    enErreur: enErreur.map((ligne) => ({ cle: ligne.cle, nom: ligne.nom, erreur: ligne.derniereErreur! })),
    dernierPassage: dernier?.synchroniseLe?.toISOString() ?? null,
  };
}

/** « Synchroniser maintenant » : une tâche de fond, jamais un appel bloquant. */
export async function demanderSynchronisation(verifier = false): Promise<void> {
  await mettreEnFile({ type: TYPE_TACHE_SYNCHRO_DRIVE, cle: "synchro-drive", mode: "RECONCILIATION", charge: { verifier } });
}

async function miroirActif(): Promise<boolean> {
  return process.env.MIROIR_DRIVE !== "0" && (await connexionActive(PORTEES_GOOGLE.DRIVE)) !== null;
}

export function enregistrerTachesDrive(): void {
  enregistrerTraitement(TYPE_TACHE_SYNCHRO_DRIVE, {
    libelle: "Synchronisation du miroir Google Drive",
    acteur: "SYSTEME:drive",
    delaiMaxMs: 20 * 60_000,
    executer: async (charge, contexte) => {
      if (!(await miroirActif())) throw new ErreurDefinitive("Miroir Drive inactif : aucun compte Google connecté avec l'accès Drive.");
      return synchroniserMiroir({ verifier: (charge as { verifier?: boolean } | null)?.verifier === true, signal: contexte.signal });
    },
  });
  enregistrerTravailPeriodique({
    nom: "miroir-drive",
    libelle: "Miroir Google Drive (dossiers clients, comptabilité)",
    acteur: "SYSTEME:drive",
    intervalleMs: 30 * 60_000,
    estActif: miroirActif,
    executer: async (signal) => {
      await synchroniserMiroir({ signal });
    },
  });
  enregistrerTravailPeriodique({
    nom: "verification-drive",
    libelle: "Vérification du miroir Drive (éléments supprimés ou renommés à la main)",
    acteur: "SYSTEME:drive",
    intervalleMs: 24 * 60 * 60_000,
    estActif: miroirActif,
    executer: async (signal) => {
      await synchroniserMiroir({ verifier: true, signal });
    },
  });
}
