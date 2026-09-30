import type { TacheAFaire } from "@prisma/client";
import prisma from "@/lib/prisma";
import { avecActeur } from "@/lib/journal/contexte";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { issueDeLAbsence, PREFIXE_COCHE, sujetDisparu, type IssueAbsence } from "./achevement";
import type { Achevement, ActionManuelle } from "./detecteurs/types";
import { dureeDe, dureeReelle, dureesMesurees } from "./durees";
import { dernierEvenementClient } from "./evenements-client";
import { jsonStable } from "./json";
import { ACTEUR_TACHES, type Detection, type NiveauTache, type ReponseTache, type SourceTache, type StatutTache } from "./types";
import { actionsManuellesEnVigueur } from "./vigueur";

/**
 * Mission 17 (partie A) : le moteur des tâches (docs/TACHES.md § 2). Les détecteurs voient ; `reconcilier` écrit :
 *
 * 0. Filtre de vigueur (FAIT ICI, pas dans detection.ts : un appel direct de `reconcilier` y est soumis aussi) : une
 *    détection sur un dossier dont la prochaine action manuelle est en vigueur est écartée, sauf PROCHAINE_ACTION et
 *    les tâches de source SYSTEME ; les tâches déjà ouvertes de ce dossier sont cochées par le CRM (« prochaine action
 *    posée à la main ») et reviennent d'elles-mêmes quand la vigueur tombe (condition revenue).
 * 1. Fusion par clé : la source ≠ DOSSIERS puis le `depuis` le plus récent donne titre, raison, raccourci et données
 *    (les données des autres sources complètent) ; le niveau le plus urgent, le montant le plus grand, le `depuis` le
 *    plus ancien (l'origine du besoin) et l'échéance la plus proche sont gardés.
 * 2. Règles apprises (`RegleTache` actives) : NE_PLUS_PROPOSER écarte le type (la tâche existante n'est plus touchée,
 *    ni cochée) ; ATTENDRE n ne CRÉE la tâche que si `depuis + n jours ≤ maintenant`.
 * 3. Chaque détection : création ; mise à jour (seulement ce qui change, `detecteLe` rafraîchi au plus une fois par
 *    jour sans autre changement) ; retour d'un « Plus tard » échu ou suivi d'un événement du client ; retour d'une tâche
 *    cochée par le CRM (la condition est revenue) ; retour d'une tâche répondue par Lucas ou Claude si le client s'est
 *    manifesté depuis, ou, pour un sujet SYSTEME, si la condition tient encore 24 h après la réponse.
 * 4. Les tâches achevées par leur condition propre (`acheves` des détecteurs : tâches MANUELLE à condition) sont cochées.
 * 5. Absence : chaque tâche A_FAIRE/PLUS_TARD d'une source couverte, non vue, reçoit l'issue de `achevement.ts`
 *    (sujet disparu → PAS_A_FAIRE SUJET_DISPARU ; mail reporté → PLUS_TARD ; sinon FAITE « coché par le CRM : … »).
 *    Les tâches MANUELLE ne sont jamais cochées par absence.
 * 6. Les « Plus tard » des sources non couvertes (et les MANUELLE) reviennent à leur date, ou au geste du client.
 *
 * Écritures sous `SYSTEME:taches-a-faire`. Idempotent : les mêmes détections au même instant n'écrivent rien.
 */

export type BilanReconciliation = { crees: number; misesAJour: number; cochees: number; rouvertes: number; ecartees: number };

export type OptionsReconciliation = {
  /** Les sources couvertes par ce passage : seules leurs tâches absentes sont cochées. */
  sources: readonly SourceTache[];
  maintenant: Date;
  /** Prochaines actions manuelles en vigueur (passeComplete les a déjà lues) ; à défaut, relues ici. */
  vigueur?: Map<string, ActionManuelle>;
  /** Tâches dont la condition propre est remplie (`Detecteur.acheves`). */
  acheves?: readonly Achevement[];
};

const JOUR = 86_400_000;
const PAQUET = 400;

/** Une détection écartée par une prochaine action manuelle en vigueur sur son dossier (docs/TACHES.md § 2). */
export function ecarteeParVigueur(d: { type: string; source: string; dossierId?: string | null }, vigueur: ReadonlyMap<string, ActionManuelle>): boolean {
  return Boolean(d.dossierId && vigueur.has(d.dossierId) && d.type !== "PROCHAINE_ACTION" && d.source !== "SYSTEME");
}

const plusAncien = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

/** Fusion par clé (étape 1). Pur : l'ordre des détections reçues ne change pas le résultat. */
export function fusionnerDetections(detections: readonly Detection[]): Detection[] {
  const parCle = new Map<string, Detection[]>();
  for (const d of detections) parCle.set(d.cle, [...(parCle.get(d.cle) ?? []), d]);
  return [...parCle.values()].map((groupe) => {
    if (groupe.length === 1) return groupe[0];
    const tries = [...groupe].sort(
      (a, b) => Number(a.source === "DOSSIERS") - Number(b.source === "DOSSIERS") || b.depuis.getTime() - a.depuis.getTime() || a.source.localeCompare(b.source)
    );
    const principale = tries[0];
    const montants = groupe.map((d) => d.montant).filter((m): m is number => typeof m === "number" && Number.isFinite(m));
    const echeances = groupe.map((d) => d.echeance).filter((e): e is Date => e instanceof Date);
    const premier = <K extends "leadId" | "dossierId" | "clientId">(cle: K) => tries.map((d) => d[cle]).find((v) => Boolean(v)) ?? null;
    return {
      ...principale,
      niveau: Math.min(...groupe.map((d) => d.niveau)) as NiveauTache,
      montant: montants.length ? Math.max(...montants) : null,
      depuis: groupe.map((d) => d.depuis).reduce(plusAncien),
      echeance: echeances.length ? echeances.reduce(plusAncien) : null,
      leadId: premier("leadId"),
      dossierId: premier("dossierId"),
      clientId: premier("clientId"),
      // Les données des autres sources complètent (messageIds du mail, espaceDossierId de l'espace) ; la principale l'emporte.
      donnees: Object.assign({}, ...[...tries].reverse().map((d) => d.donnees ?? {})),
    };
  });
}

/** Les colonnes qu'une détection donne à sa tâche. */
function colonnesDe(d: Detection, dureeMin: number) {
  const sujetId = d.sujet.id ?? null;
  return {
    type: d.type,
    source: d.source,
    sujetType: d.sujet.type,
    sujetId,
    leadId: d.leadId ?? (d.sujet.type === "LEAD" ? sujetId : null),
    dossierId: d.dossierId ?? (d.sujet.type === "DOSSIER" ? sujetId : null),
    clientId: d.clientId ?? (d.sujet.type === "CLIENT" ? sujetId : null),
    titre: d.titre.slice(0, 300),
    raison: d.raison.slice(0, 500),
    niveau: d.niveau,
    montant: typeof d.montant === "number" && Number.isFinite(d.montant) ? d.montant : null,
    depuis: d.depuis,
    echeance: d.echeance ?? null,
    dureeMin,
    raccourci: jsonStable(d.raccourci),
    donnees: jsonStable(d.donnees ?? {}),
    lot: d.lot?.cle ?? null,
    lotLibelle: d.lot?.libelle ?? null,
  };
}
type Colonnes = ReturnType<typeof colonnesDe>;

const egal = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime() : a === b);

/** Seules les colonnes qui changent (comparer avant d'écrire : un passage qui ne voit rien de neuf n'écrit rien). */
function differences(ligne: TacheAFaire, colonnes: Colonnes): Partial<Colonnes> {
  const sortie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(colonnes)) {
    if (!egal(ligne[cle as keyof TacheAFaire], valeur)) sortie[cle] = valeur;
  }
  return sortie as Partial<Colonnes>;
}

const REPONSE_DU_STATUT: Record<Exclude<StatutTache, "A_FAIRE">, ReponseTache> = { FAITE: "FAIT", PLUS_TARD: "PLUS_TARD", PAS_A_FAIRE: "PAS_A_FAIRE" };

async function lireParCles(cles: string[]): Promise<Map<string, TacheAFaire>> {
  const carte = new Map<string, TacheAFaire>();
  for (let i = 0; i < cles.length; i += PAQUET) {
    const lignes = await prisma.tacheAFaire.findMany({ where: { cle: { in: cles.slice(i, i + PAQUET) }, ...AVEC_ARCHIVES } });
    for (const l of lignes) carte.set(l.cle, l);
  }
  return carte;
}

export async function reconcilier(detections: readonly Detection[], options: OptionsReconciliation): Promise<BilanReconciliation> {
  const { maintenant } = options;
  const bilan: BilanReconciliation = { crees: 0, misesAJour: 0, cochees: 0, rouvertes: 0, ecartees: 0 };
  const couvertes = new Set(options.sources);
  const vigueur = options.vigueur ?? (await actionsManuellesEnVigueur(maintenant));

  // 0. Filtre de vigueur.
  const retenues = detections.filter((d) => {
    if (!ecarteeParVigueur(d, vigueur)) return true;
    bilan.ecartees++;
    return false;
  });
  // 1. Fusion par clé.
  const fusionnees = fusionnerDetections(retenues);
  // 2. Règles apprises.
  const regles = await prisma.regleTache.findMany({ select: { type: true, effet: true, delaiJours: true } });
  const nePlusProposer = new Set(regles.filter((r) => r.effet === "NE_PLUS_PROPOSER").map((r) => r.type));
  const attendre = new Map<string, number>();
  for (const r of regles) if (r.effet === "ATTENDRE" && r.delaiJours) attendre.set(r.type, Math.max(attendre.get(r.type) ?? 0, r.delaiJours));

  const acheves = options.acheves ?? [];
  const [existantes, parAchevement, plusTard, mesurees] = await Promise.all([
    lireParCles(fusionnees.map((d) => d.cle)),
    lireParCles([...new Set(acheves.map((a) => a.cle))]),
    prisma.tacheAFaire.findMany({ where: { statut: "PLUS_TARD" } }),
    dureesMesurees(),
  ]);
  // Les gestes du client, lus une fois pour tous les sujets qui peuvent en dépendre (retours, réouvertures).
  const aLire = [...existantes.values(), ...plusTard].filter((l) => l.statut !== "A_FAIRE" && (l.dossierId || l.leadId));
  const gesteDuClient = aLire.length ? await dernierEvenementClient(aLire) : () => null;
  const clientSEstManifeste = (ligne: TacheAFaire) => {
    if (!ligne.reponduLe) return false;
    const geste = gesteDuClient(ligne);
    return Boolean(geste && geste.getTime() > ligne.reponduLe.getTime() && geste.getTime() <= maintenant.getTime());
  };

  const vues = new Set<string>();
  const traitees = new Set<string>();

  await avecActeur({ acteur: ACTEUR_TACHES, origine: "a-faire:reconciliation" }, async () => {
    // 3. Les détections.
    for (const d of fusionnees) {
      vues.add(d.cle);
      const ligne = existantes.get(d.cle);
      if (ligne) traitees.add(ligne.id);
      // Une tâche archivée (retirée) ou un type que Lucas ne veut plus voir : on n'y touche plus.
      if (ligne?.archiveLe || nePlusProposer.has(d.type)) {
        bilan.ecartees++;
        continue;
      }
      const colonnes = colonnesDe(d, dureeDe(d.type, mesurees, d.dureeMin));
      if (!ligne) {
        const delai = attendre.get(d.type);
        if (delai && d.depuis.getTime() + delai * JOUR > maintenant.getTime()) {
          bilan.ecartees++;
          continue;
        }
        try {
          await prisma.tacheAFaire.create({ data: { cle: d.cle, ...colonnes, statut: "A_FAIRE", detecteLe: maintenant } });
          bilan.crees++;
        } catch (erreur) {
          // Deux passages simultanés : l'autre l'a créée, le prochain passage la mettra à jour.
          if ((erreur as { code?: string }).code !== "P2002") throw erreur;
        }
        continue;
      }
      let retour: { statut: "A_FAIRE"; revenueLe?: Date } | null = null;
      if (ligne.statut === "PLUS_TARD") {
        const echu = ligne.plusTardJusqua !== null && ligne.plusTardJusqua.getTime() <= maintenant.getTime();
        if (echu || clientSEstManifeste(ligne)) retour = { statut: "A_FAIRE", revenueLe: maintenant };
      } else if (ligne.statut === "FAITE" || ligne.statut === "PAS_A_FAIRE") {
        const parLeCrm = ligne.reponduPar?.startsWith("SYSTEME:") ?? false;
        const systemeToujoursLa = ligne.sujetType === "SYSTEME" && ligne.reponduLe !== null && ligne.reponduLe.getTime() + JOUR <= maintenant.getTime();
        if (parLeCrm || clientSEstManifeste(ligne) || systemeToujoursLa) retour = { statut: "A_FAIRE" };
        // Répondue par Lucas ou Claude, rien de neuf : on n'y touche pas.
        else continue;
      }
      const changees = differences(ligne, colonnes);
      const rafraichir = maintenant.getTime() - ligne.detecteLe.getTime() >= JOUR;
      if (!retour && Object.keys(changees).length === 0 && !rafraichir) continue;
      await prisma.tacheAFaire.update({ where: { id: ligne.id }, data: { ...changees, ...(retour ?? {}), detecteLe: maintenant } });
      if (retour) bilan.rouvertes++;
      else bilan.misesAJour++;
    }

    const cocher = async (ligne: TacheAFaire, issue: IssueAbsence) => {
      traitees.add(ligne.id);
      if (ligne.statut === issue.statut && (issue.statut !== "PLUS_TARD" || egal(ligne.plusTardJusqua, issue.jusqua ?? null))) return;
      const faite = issue.statut === "FAITE";
      await prisma.tacheAFaire.update({
        where: { id: ligne.id },
        data: {
          statut: issue.statut,
          reponse: REPONSE_DU_STATUT[issue.statut],
          reponseRaison: issue.raison ?? null,
          reponseTexte: issue.texte.slice(0, 500),
          reponduLe: maintenant,
          reponduPar: ACTEUR_TACHES,
          ...(issue.statut === "PLUS_TARD" ? { plusTardJusqua: issue.jusqua ?? null } : {}),
          ...(faite ? { dureeReelleSec: dureeReelle(ligne.commenceLe, maintenant) ?? ligne.dureeReelleSec } : {}),
        },
      });
      if (issue.statut === "PLUS_TARD") bilan.misesAJour++;
      else bilan.cochees++;
    };

    // 4. Achevées par leur condition propre.
    for (const a of acheves) {
      const ligne = parAchevement.get(a.cle);
      if (!ligne || ligne.archiveLe || (ligne.statut !== "A_FAIRE" && ligne.statut !== "PLUS_TARD")) continue;
      const texte = a.texte.startsWith(PREFIXE_COCHE) ? a.texte : `${PREFIXE_COCHE}${a.texte}`;
      await cocher(ligne, { statut: "FAITE", texte });
    }

    // 5. Absence : les tâches ouvertes des sources couvertes que personne n'a vues.
    const sources = [...couvertes].filter((s) => s !== "MANUELLE");
    const ouvertes = sources.length ? await prisma.tacheAFaire.findMany({ where: { statut: { in: ["A_FAIRE", "PLUS_TARD"] }, source: { in: sources } } }) : [];
    for (const ligne of ouvertes) {
      if (vues.has(ligne.cle) || traitees.has(ligne.id) || ligne.type === "MANUELLE") continue;
      const action = ligne.dossierId ? vigueur.get(ligne.dossierId) : undefined;
      if (action && ecarteeParVigueur(ligne, vigueur) && !(await sujetDisparu(ligne))) {
        await cocher(ligne, { statut: "FAITE", texte: `${PREFIXE_COCHE}prochaine action posée à la main (« ${action.action} »)` });
        continue;
      }
      await cocher(ligne, await issueDeLAbsence(ligne, maintenant));
    }

    // 6. Les « Plus tard » que ce passage n'a pas vus : retour à leur date, ou au geste du client.
    for (const ligne of plusTard) {
      if (traitees.has(ligne.id) || vues.has(ligne.cle)) continue;
      const echu = ligne.plusTardJusqua !== null && ligne.plusTardJusqua.getTime() <= maintenant.getTime();
      if (!echu && !clientSEstManifeste(ligne)) continue;
      await prisma.tacheAFaire.update({ where: { id: ligne.id }, data: { statut: "A_FAIRE", revenueLe: maintenant } });
      bilan.rouvertes++;
    }
  });
  return bilan;
}
