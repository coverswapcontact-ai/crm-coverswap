import type { CodeIncoherence, Incoherence } from "@/lib/coherence/controle";
import { DUREES_DEPART, type Raccourci } from "@/lib/a-faire/types";
import { pluriel } from "@/lib/commun/format";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import type { BaseDonnees } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Mission 18 — mise en route de la partie B (docs/SYNCHRO.md § 7). La sauvegarde est faite par `executerMigrationsDonnees`
 * avant toute migration (une seule par démarrage, avant la première en attente). Dans l'ordre :
 *
 * 1. Base neuve : rien à faire.
 * 2. UN contrôle de cohérence étendu (`controlerCoherence({ etendu: true })`) : tous les dossiers, perdus et archivés
 *    compris.
 * 3. Les réparations sûres, appliquées par `appliquerCorrection` (la fonction du bouton « Corriger », sans rejouer le
 *    contrôle) : les codes qui ont une correction et qui ne sont pas dans `CORRECTIONS_SENSIBLES` (aucune ne change
 *    l'étape, ne touche un devis ni n'envoie de mail au client). `SIMULATIONS_HORS_DOSSIER` est laissé au filet des
 *    15 minutes (`rattraperSimulationsSansDossier`, la même fonction), qui range aussi dans l'espace et prévient Lucas.
 *    Jamais de mail au client, jamais de conversion Meta : aucune correction appliquée ne déplace l'étape.
 * 4. Le reste : un second contrôle, ordinaire (celui du détecteur de tâches), dit ce que le détecteur COHERENCE
 *    remontera de lui-même (« Corriger · Nom ») ; rien n'est écrit pour ceux-là. Ce qu'il ne voit pas (dossiers perdus
 *    ou archivés) devient une tâche à moi `MANUELLE:coherence-18-<clé>`, lot « coherence-18 », une fois (P2002 ignoré).
 * 5. Le détecteur oublie son rapport gardé (`invaliderCoherence`) et la liste des tâches est prévenue.
 *
 * Résumé : `dossiersControles`, totaux (`trouves`, `repares`, `taches`, `detecteur`, `echecs`) puis, par règle,
 * `trouves.<CODE>`, `repares.<CODE>`, `taches.<CODE>`, `detecteur.<CODE>`, `echecs.<CODE>` (seulement ceux qui ne sont
 * pas nuls). Les journaux disent les clients en initiales (dépôt public). Ne lève jamais : un contrôle ou une correction
 * en échec est compté, et le démarrage continue. Idempotente : rejouée, elle ne répare plus rien (ce qui est réparé a
 * disparu du contrôle) et ne recrée aucune tâche.
 */

export const NOM_MIGRATION_MR_18 = "mise-en-route-18";
export const LOT_COHERENCE_18 = { cle: "coherence-18", libelle: "incohérence d'un dossier perdu ou archivé|incohérences de dossiers perdus ou archivés" };
export const cleTacheCoherence18 = (cleIncoherence: string) => `MANUELLE:coherence-18-${cleIncoherence}`;

/** Laissé au filet des 15 minutes (même fonction, qui range aussi dans l'espace) : la mise en route n'y touche pas. */
export const CODES_LAISSES_AU_FILET: readonly CodeIncoherence[] = ["SIMULATIONS_HORS_DOSSIER"];

type Compteurs = Record<string, number>;

const journal = (texte: string) => console.info(`[migration ${NOM_MIGRATION_MR_18}] ${texte}`);

/** « Sixtine Essai » → « S. E. » : jamais un nom de client dans les journaux. */
export function initiales(nom: string): string {
  const mots = nom.split(/[\s-]+/).filter((m) => /\p{L}/u.test(m));
  return mots.length ? mots.map((m) => `${m.match(/\p{L}/u)![0].toUpperCase()}.`).join(" ") : "?";
}

/** Base neuve (aucun contact, dossier ni fiche client, même archivés) : rien à mettre en route. */
async function baseVide(client: BaseDonnees): Promise<boolean> {
  const [lead, dossier, fiche] = await Promise.all([
    client.lead.findFirst({ where: AVEC_ARCHIVES, select: { id: true } }),
    client.dossier.findFirst({ where: AVEC_ARCHIVES, select: { id: true } }),
    client.client.findFirst({ where: AVEC_ARCHIVES, select: { id: true } }),
  ]);
  return !lead && !dossier && !fiche;
}

/** La tâche à moi d'une incohérence d'un dossier perdu ou archivé (le détecteur ne lit que les dossiers vivants). Rend true si créée. */
async function creerTache(client: BaseDonnees, i: Incoherence, dossier: { leadId: string | null; clientId: string | null }, maintenant: Date): Promise<boolean> {
  const cle = cleTacheCoherence18(i.cle);
  if (await client.tacheAFaire.findUnique({ where: { cle }, select: { id: true } })) return false;
  const { constatCourt } = await import("@/lib/a-faire/detecteurs/coherence");
  const { CORRECTIONS_SENSIBLES } = await import("@/lib/coherence/controle");
  const raccourci: Raccourci = { genre: "DOSSIER", libelle: "Ouvrir le dossier", dossierId: i.dossierId, href: `/dossiers?dossier=${i.dossierId}` };
  const proposee = i.correction ? ` Correction proposée : ${i.correction.replace(/\.$/, "")}${CORRECTIONS_SENSIBLES.has(i.code) ? " (à décider : jamais appliquée d'office)" : ""}.` : "";
  try {
    await client.tacheAFaire.create({
      data: {
        cle,
        type: "MANUELLE",
        source: "MANUELLE",
        sujetType: "DOSSIER",
        sujetId: i.dossierId,
        leadId: dossier.leadId ?? i.leadId,
        dossierId: i.dossierId,
        clientId: dossier.clientId,
        titre: `Corriger · ${i.client || "sans nom"}`,
        raison: `${constatCourt(i.constat)} (mise en route de la mission 18)`,
        niveau: 5,
        montant: null,
        depuis: maintenant,
        dureeMin: DUREES_DEPART.MANUELLE,
        raccourci: JSON.stringify(raccourci),
        donnees: JSON.stringify({ coherence18: i.cle, code: i.code, gravite: i.gravite, constat: `${i.constat}${proposee}` }),
        lot: LOT_COHERENCE_18.cle,
        lotLibelle: LOT_COHERENCE_18.libelle,
        statut: "A_FAIRE",
        detecteLe: maintenant,
      },
    });
    return true;
  } catch (erreur) {
    if ((erreur as { code?: string }).code !== "P2002") throw erreur;
    return false;
  }
}

/** La mise en route elle-même (les essais l'appellent directement). Ne lève pas. */
export async function miseEnRoute18(client: BaseDonnees, options: { maintenant?: Date } = {}): Promise<Compteurs> {
  const maintenant = options.maintenant ?? new Date();
  const c: Compteurs = { dossiersControles: 0, trouves: 0, repares: 0, taches: 0, detecteur: 0, echecs: 0 };
  const compter = (quoi: "trouves" | "repares" | "taches" | "detecteur" | "echecs", code: CodeIncoherence) => {
    c[quoi]++;
    c[`${quoi}.${code}`] = (c[`${quoi}.${code}`] ?? 0) + 1;
  };
  if (await baseVide(client)) {
    journal("base vide : rien à mettre en route");
    return c;
  }
  const { appliquerCorrection, controlerCoherence, CORRECTIONS_SENSIBLES } = await import("@/lib/coherence/controle");

  // 2. Un seul contrôle étendu.
  let incoherences: Incoherence[];
  try {
    const rapport = await controlerCoherence({ etendu: true });
    c.dossiersControles = rapport.dossiersControles;
    incoherences = rapport.incoherences;
  } catch (erreur) {
    c.echecs++;
    console.error(`[migration ${NOM_MIGRATION_MR_18}] contrôle étendu en échec (le démarrage continue, rien n'est réparé) :`, erreur);
    return c;
  }

  // 3. Les réparations sûres.
  const restes: Incoherence[] = [];
  for (const i of incoherences) {
    compter("trouves", i.code);
    const sure = i.correction !== null && !CORRECTIONS_SENSIBLES.has(i.code) && !CODES_LAISSES_AU_FILET.includes(i.code);
    if (!sure) {
      restes.push(i);
      continue;
    }
    try {
      await appliquerCorrection(i);
      compter("repares", i.code);
      journal(`${i.code} réparé (${initiales(i.client)})`);
    } catch (erreur) {
      compter("echecs", i.code);
      restes.push(i);
      console.warn(`[migration ${NOM_MIGRATION_MR_18}] ${i.code} (${initiales(i.client)}) non réparé : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
  }

  // 4. Le reste : au détecteur s'il le voit (contrôle ordinaire), sinon une tâche à moi pour un dossier perdu ou archivé.
  if (restes.length > 0) {
    let vusDuDetecteur: Set<string> | null = null;
    try {
      vusDuDetecteur = new Set((await controlerCoherence()).incoherences.map((i) => i.cle));
    } catch (erreur) {
      c.echecs++;
      console.error(`[migration ${NOM_MIGRATION_MR_18}] contrôle ordinaire en échec (aucune tâche créée, le démarrage continue) :`, erreur);
    }
    if (vusDuDetecteur) {
      const ids = [...new Set(restes.map((i) => i.dossierId).filter((id): id is string => Boolean(id)))];
      const dossiers = new Map(
        (await client.dossier.findMany({ where: { id: { in: ids }, ...AVEC_ARCHIVES }, select: { id: true, etape: true, archiveLe: true, leadId: true, clientId: true } })).map((d) => [d.id, d])
      );
      for (const i of restes) {
        if (vusDuDetecteur.has(i.cle)) {
          compter("detecteur", i.code);
          continue;
        }
        const dossier = i.dossierId ? dossiers.get(i.dossierId) : undefined;
        if (!dossier || (!dossier.archiveLe && dossier.etape !== "PERDU")) continue; // vivant et disparu entre-temps : plus rien à faire
        try {
          if (await creerTache(client, i, dossier, maintenant)) {
            compter("taches", i.code);
            journal(`${i.code} (${initiales(i.client)}, dossier ${dossier.archiveLe ? "archivé" : "perdu"}) : tâche à moi`);
          }
        } catch (erreur) {
          compter("echecs", i.code);
          console.error(`[migration ${NOM_MIGRATION_MR_18}] ${i.code} (${initiales(i.client)}) : tâche non créée :`, erreur);
        }
      }
    }
  }

  // 5. Le détecteur relit le contrôle au prochain passage ; la liste des tâches est prévenue.
  try {
    const [{ invaliderCoherence }, { signalerChangementTaches }] = await Promise.all([import("@/lib/a-faire/detecteurs/coherence"), import("@/lib/a-faire/signal")]);
    invaliderCoherence();
    await signalerChangementTaches();
  } catch (erreur) {
    console.error(`[migration ${NOM_MIGRATION_MR_18}] tâches non prévenues :`, erreur);
  }

  const parRegle = [...new Set(incoherences.map((i) => i.code))]
    .sort()
    .map((code) => `${code} : ${c[`trouves.${code}`]} trouvé${c[`trouves.${code}`] > 1 ? "s" : ""}, ${c[`repares.${code}`] ?? 0} réparé${(c[`repares.${code}`] ?? 0) > 1 ? "s" : ""}, ${c[`taches.${code}`] ?? 0} en tâche à moi, ${c[`detecteur.${code}`] ?? 0} au détecteur${c[`echecs.${code}`] ? `, ${c[`echecs.${code}`]} en échec` : ""}`);
  journal(`${pluriel(c.dossiersControles, "dossier contrôlé", "dossiers contrôlés")} (perdus et archivés compris) : ${pluriel(c.trouves, "écart trouvé", "écarts trouvés")}, ${pluriel(c.repares, "réparé", "réparés")}, ${pluriel(c.taches, "tâche à moi", "tâches à moi")}, ${c.detecteur} au détecteur, ${pluriel(c.echecs, "échec")}`);
  for (const ligne of parRegle) journal(ligne);
  return c;
}

export const migrationMiseEnRoute18: MigrationDonnees = {
  nom: NOM_MIGRATION_MR_18,
  description: "Mise en route de la mission 18 : contrôle de cohérence étendu (perdus et archivés compris), réparations sûres appliquées, le reste en tâches ; écarts trouvés et réparés par règle",
  executer: async (client) => miseEnRoute18(client),
};
