import type { Prisma, TacheAFaire } from "@prisma/client";
import prisma from "@/lib/prisma";
import { avecActeur } from "@/lib/journal/contexte";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { issueDeLAbsence, PREFIXE_COCHE, sujetDisparu, type IssueAbsence } from "./achevement";
import type { Achevement, ActionManuelle } from "./detecteurs/types";
import { dureeDe, dureeReelle, dureesMesurees } from "./durees";
import { dateOuNull, etatDe, lirePrecedent, type Precedent } from "./etat";
import { dernierEvenementClient, filDeLaCle } from "./evenements-client";
import { jsonStable, lireObjet, occurrenceDe } from "./json";
import { ACTEUR_TACHES, SOURCES_TACHE, type Detection, type NiveauTache, type ReponseTache, type SourceTache, type StatutTache, type TypeTache } from "./types";
import { actionsManuellesEnVigueur } from "./vigueur";

export { CLE_OCCURRENCE, occurrenceDe } from "./json";

/**
 * Mission 17 (partie A) : le moteur des tâches (docs/TACHES.md § 2). Les détecteurs voient ; `reconcilier` écrit :
 *
 * 0. Les détections sont normalisées (`dossierId`, `leadId`, `clientId` déduits du sujet quand le détecteur ne les
 *    donne pas), puis le filtre de vigueur (FAIT ICI, pas dans detection.ts : un appel direct de `reconcilier` y est
 *    soumis aussi) : une détection sur un dossier dont la prochaine action manuelle est en vigueur est écartée, sauf
 *    PROCHAINE_ACTION, ENVOYER_DEVIS (mission 18, B1) et les tâches de source SYSTEME ; les tâches déjà ouvertes de ce dossier sont cochées par le CRM
 *    (« prochaine action posée à la main ») et reviennent d'elles-mêmes quand la vigueur tombe (condition revenue).
 * 1. Fusion par clé : la source dont le `depuis` est le plus récent donne titre, raison, raccourci et données (§ 2.1 ;
 *    les données des autres sources complètent) ; le niveau le plus urgent, le montant le plus grand, le `depuis` le
 *    plus ancien (l'origine du besoin) et l'échéance la plus proche sont gardés. Toutes les sources qui voient la tâche
 *    sont rangées (`donnees.sourcesVues`, dès qu'il y en a deux) : une tâche n'est cochée par absence que si TOUTES ses
 *    sources ont été couvertes par le passage (une source en panne ne fait pas cocher ce qu'une autre ne voit plus).
 * 2. Règles apprises (`RegleTache` actives) : NE_PLUS_PROPOSER écarte le type (les tâches encore ouvertes de ce type
 *    passent « Pas à faire » par le CRM, la règle en raison ; elles reviennent si la règle est retirée) ; ATTENDRE n ne
 *    CRÉE la tâche que si `depuis + n jours ≤ maintenant`.
 * 3. Chaque détection : création ; mise à jour (seulement ce qui change, `detecteLe` rafraîchi au plus une fois par
 *    jour sans autre changement) ; retour d'un « Plus tard » échu, suivi d'un événement du client, ou posé par le CRM
 *    (mail reporté : détecté de nouveau, c'est que le report est levé) ; retour d'une tâche cochée par le CRM (la
 *    condition est revenue : la réponse est remise à zéro, ou le « Plus tard » de Lucas que la coche avait recouvert
 *    est rendu s'il court encore) ; retour d'une tâche répondue par Lucas ou Claude si le client s'est manifesté
 *    depuis, ou, pour un sujet SYSTEME, si la condition tient encore 24 h après la réponse.
 *    Mission 17 (partie A, relecture) : ou si le BESOIN a changé — `donnees.occurrence` (détecteurs : devis + rang de la
 *    relance, acompte ou solde + facture, date du rappel, instant où l'action a été posée à la main, envoi du lien…)
 *    diffère de celle que la tâche portait quand Lucas a répondu (une tâche d'avant les occurrences : le besoin est né
 *    après la réponse). Une même clé porte ainsi des besoins successifs sans qu'un « Fait » n'éteigne les suivants.
 *    Une seule tâche par besoin : une tâche reprise par une autre du même dossier (HESITE par RELANCER_DEVIS : la relance
 *    dit « relu N fois ») n'est pas créée, et celle qui était ouverte est cochée « reprise dans … ».
 * 4. Les tâches achevées par leur condition propre (`acheves` des détecteurs : tâches MANUELLE à condition) sont cochées.
 * 5. Absence : chaque tâche A_FAIRE/PLUS_TARD dont toutes les sources sont couvertes, non vue, reçoit l'issue de
 *    `achevement.ts` (sujet disparu → PAS_A_FAIRE SUJET_DISPARU ; mail reporté → PLUS_TARD ; sinon FAITE « coché par
 *    le CRM : … »). Les tâches MANUELLE ne sont jamais cochées par absence.
 * 6. Les « Plus tard » des sources non couvertes (et les MANUELLE) reviennent à leur date, ou au geste du client.
 *
 * Chaque écriture est conditionnée à la ligne lue (`updatedAt`) : une réponse de Lucas donnée pendant le passage
 * l'emporte, le passage suivant reprendra la tâche. Une coche du CRM range l'état d'avant (`precedent`, etat.ts).
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
/** Les sources qui voient une tâche, dans `donnees` (seulement quand il y en a plusieurs). */
export const CLE_SOURCES_VUES = "sourcesVues";

/** Mission 17 (partie A, relecture) : `dossierId`, `leadId`, `clientId` déduits du sujet quand la détection ne les donne pas. */
export function normaliserDetection(d: Detection): Detection {
  const id = d.sujet?.id ?? null;
  return {
    ...d,
    leadId: d.leadId ?? (d.sujet?.type === "LEAD" ? id : null),
    dossierId: d.dossierId ?? (d.sujet?.type === "DOSSIER" ? id : null),
    clientId: d.clientId ?? (d.sujet?.type === "CLIENT" ? id : null),
  };
}

/**
 * Les tâches jamais écartées par une action posée à la main : la sienne, et un devis généré mais pas encore envoyé
 * (mission 18, B1 : c'est mon propre geste resté en route, aucune action manuelle ne le couvre).
 */
const TYPES_HORS_VIGUEUR = ["PROCHAINE_ACTION", "ENVOYER_DEVIS"];

/** Une détection écartée par une prochaine action manuelle en vigueur sur son dossier (docs/TACHES.md § 2). */
export function ecarteeParVigueur(d: { type: string; source: string; dossierId?: string | null }, vigueur: ReadonlyMap<string, ActionManuelle>): boolean {
  return Boolean(d.dossierId && vigueur.has(d.dossierId) && !TYPES_HORS_VIGUEUR.includes(d.type) && d.source !== "SYSTEME");
}

const plusAncien = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

/**
 * Le besoin a-t-il changé depuis la réponse de Lucas ou de Claude ? Oui si la détection porte une occurrence différente
 * de celle de la tâche ; une tâche sans occurrence (écrite avant) : oui si le besoin est né après la réponse.
 */
export function besoinNouveau(ligne: Pick<TacheAFaire, "donnees" | "reponduLe">, d: Pick<Detection, "donnees" | "depuis">): boolean {
  const nouvelle = occurrenceDe(d.donnees);
  if (!nouvelle) return false;
  const ancienne = occurrenceDe(lireObjet(ligne.donnees));
  if (ancienne) return ancienne !== nouvelle;
  return Boolean(ligne.reponduLe && d.depuis.getTime() > ligne.reponduLe.getTime());
}

/** Une tâche reprise par une autre du même dossier : une seule tâche par besoin (le type repris → celui qui le reprend). */
export const REPRISES: readonly { reprise: TypeTache; par: TypeTache }[] = [{ reprise: "HESITE", par: "RELANCER_DEVIS" }];

/**
 * Les reprises (pur) : une détection d'un type repris, sur un dossier où celle qui la reprend est vue (et sera visible :
 * `visible`), n'est pas gardée ; sa raison s'ajoute à celle qui la reprend. Rend les détections gardées et, par clé
 * reprise, le titre de celle qui la reprend.
 */
export function appliquerReprises(detections: readonly Detection[], visible: (cle: string) => boolean = () => true): { gardees: Detection[]; reprises: Map<string, string> } {
  const reprises = new Map<string, string>();
  const parCle = new Map(detections.map((d) => [d.cle, { ...d }]));
  for (const { reprise, par } of REPRISES) {
    for (const d of detections) {
      if (d.type !== reprise || !d.dossierId) continue;
      const tenante = [...parCle.values()].find((x) => x.type === par && x.dossierId === d.dossierId && visible(x.cle));
      if (!tenante) continue;
      tenante.raison = `${tenante.raison} · ${d.raison}`;
      tenante.niveau = Math.min(tenante.niveau, d.niveau) as NiveauTache;
      parCle.delete(d.cle);
      reprises.set(d.cle, tenante.titre);
    }
  }
  return { gardees: detections.filter((d) => parCle.has(d.cle)).map((d) => parCle.get(d.cle)!), reprises };
}

/** Fusion par clé (étape 1). Pur : l'ordre des détections reçues ne change pas le résultat. */
export function fusionnerDetections(detections: readonly Detection[]): Detection[] {
  const parCle = new Map<string, Detection[]>();
  for (const d of detections.map(normaliserDetection)) parCle.set(d.cle, [...(parCle.get(d.cle) ?? []), d]);
  return [...parCle.values()].map((groupe) => {
    if (groupe.length === 1) return groupe[0];
    // § 2.1 : la source la plus récente fournit le raccourci (à égalité, l'ordre des noms de source : stable).
    const tries = [...groupe].sort((a, b) => b.depuis.getTime() - a.depuis.getTime() || a.source.localeCompare(b.source));
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

const SOURCES = SOURCES_TACHE as readonly string[];

/** Les sources qui voient une tâche : la sienne, et celles rangées dans `donnees.sourcesVues`. */
export function sourcesDeLaTache(ligne: Pick<TacheAFaire, "source" | "donnees">): string[] {
  const rangees = lireObjet(ligne.donnees)[CLE_SOURCES_VUES];
  const liste = Array.isArray(rangees) ? rangees.filter((s): s is string => typeof s === "string" && SOURCES.includes(s)) : [];
  return [...new Set([ligne.source, ...liste])];
}

/** Les colonnes qu'une détection donne à sa tâche. */
function colonnesDe(d: Detection, dureeMin: number, sourcesVues: readonly string[]) {
  const sujetId = d.sujet.id ?? null;
  const donnees = { ...(d.donnees ?? {}) };
  delete donnees[CLE_SOURCES_VUES];
  if (sourcesVues.length > 1) donnees[CLE_SOURCES_VUES] = [...sourcesVues].sort();
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
    donnees: jsonStable(donnees),
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

/** Une réponse remise à zéro (tâche rouverte : la réponse d'avant ne vaut plus). */
const REPONSE_EFFACEE = { reponse: null, reponseRaison: null, reponseTexte: null, reponduLe: null, reponduPar: null, plusTardJusqua: null, revenueLe: null, precedent: null } as const;

const parLeCrm = (acteur: string | null | undefined) => acteur?.startsWith("SYSTEME:") ?? false;

async function lireParCles(cles: string[]): Promise<Map<string, TacheAFaire>> {
  const carte = new Map<string, TacheAFaire>();
  for (let i = 0; i < cles.length; i += PAQUET) {
    const lignes = await prisma.tacheAFaire.findMany({ where: { cle: { in: cles.slice(i, i + PAQUET) }, ...AVEC_ARCHIVES } });
    for (const l of lignes) carte.set(l.cle, l);
  }
  return carte;
}

/**
 * Écrit sur la ligne telle qu'elle a été lue : si elle a changé depuis (réponse de Lucas pendant le passage), rien
 * n'est écrit et le passage suivant la reprendra. Rend vrai si l'écriture a eu lieu.
 */
async function ecrireSiInchangee(ligne: TacheAFaire, data: Prisma.TacheAFaireUpdateManyMutationInput): Promise<boolean> {
  const { count } = await prisma.tacheAFaire.updateMany({ where: { id: ligne.id, updatedAt: ligne.updatedAt }, data });
  return count === 1;
}

export async function reconcilier(detections: readonly Detection[], options: OptionsReconciliation): Promise<BilanReconciliation> {
  const { maintenant } = options;
  const bilan: BilanReconciliation = { crees: 0, misesAJour: 0, cochees: 0, rouvertes: 0, ecartees: 0 };
  const couvertes = new Set<string>(options.sources);
  const vigueur = options.vigueur ?? (await actionsManuellesEnVigueur(maintenant));

  // 0. Normalisation (sujet → dossierId, leadId, clientId), puis filtre de vigueur.
  const retenues = detections.map(normaliserDetection).filter((d) => {
    if (!ecarteeParVigueur(d, vigueur)) return true;
    bilan.ecartees++;
    return false;
  });
  // 1. Fusion par clé ; les sources qui voient chaque tâche.
  const fusionnees = fusionnerDetections(retenues);
  const sourcesParCle = new Map<string, Set<string>>();
  for (const d of retenues) sourcesParCle.set(d.cle, (sourcesParCle.get(d.cle) ?? new Set<string>()).add(d.source));
  // 2. Règles apprises.
  const regles = await prisma.regleTache.findMany({ select: { type: true, effet: true, delaiJours: true, libelle: true } });
  const nePlusProposer = new Map(regles.filter((r) => r.effet === "NE_PLUS_PROPOSER").map((r) => [r.type, r.libelle]));
  const attendre = new Map<string, number>();
  for (const r of regles) if (r.effet === "ATTENDRE" && r.delaiJours) attendre.set(r.type, Math.max(attendre.get(r.type) ?? 0, r.delaiJours));

  const acheves = options.acheves ?? [];
  const [existantes, plusTard, mesurees] = await Promise.all([
    lireParCles(fusionnees.map((d) => d.cle)),
    prisma.tacheAFaire.findMany({ where: { statut: "PLUS_TARD" } }),
    dureesMesurees(),
  ]);
  // Une seule tâche par besoin : ce qui est repris par une autre tâche du dossier (visible : ouverte, à créer, ou
  // cochée par le CRM — elle revient) n'est pas écrit à part.
  const { gardees, reprises } = appliquerReprises(fusionnees, (cle) => {
    const l = existantes.get(cle);
    return !l || l.statut === "A_FAIRE" || l.statut === "PLUS_TARD" || parLeCrm(l.reponduPar);
  });
  // Les gestes du client, lus une fois pour tous les sujets qui peuvent en dépendre (retours, réouvertures).
  const aLire = [...existantes.values(), ...plusTard].filter((l) => l.statut !== "A_FAIRE" && (l.dossierId || l.leadId || l.clientId || filDeLaCle(l.cle)));
  const gesteDuClient = aLire.length ? await dernierEvenementClient(aLire) : () => null;
  const clientSEstManifesteDepuis = (ligne: TacheAFaire, depuis: Date | null) => {
    if (!depuis) return false;
    const geste = gesteDuClient(ligne);
    return Boolean(geste && geste.getTime() > depuis.getTime() && geste.getTime() <= maintenant.getTime());
  };
  const clientSEstManifeste = (ligne: TacheAFaire) => clientSEstManifesteDepuis(ligne, ligne.reponduLe);

  /**
   * Une tâche cochée par le CRM dont la condition revient. Si la coche avait recouvert un « Plus tard » de Lucas ou de
   * Claude qui court encore (et que le client ne s'est pas manifesté depuis), ce « Plus tard » est rendu ; sinon la
   * tâche revient « à faire », réponse remise à zéro.
   */
  const reouverture = (ligne: TacheAFaire): Prisma.TacheAFaireUpdateManyMutationInput => {
    const avant = lirePrecedent(ligne.precedent)?.avant;
    const jusqua = dateOuNull(avant?.plusTardJusqua);
    if (avant && avant.statut === "PLUS_TARD" && !parLeCrm(avant.reponduPar) && jusqua && jusqua.getTime() > maintenant.getTime() && !clientSEstManifesteDepuis(ligne, dateOuNull(avant.reponduLe))) {
      return {
        statut: "PLUS_TARD",
        reponse: avant.reponse,
        reponseRaison: avant.reponseRaison,
        reponseTexte: avant.reponseTexte,
        reponduLe: dateOuNull(avant.reponduLe),
        reponduPar: avant.reponduPar,
        plusTardJusqua: jusqua,
        revenueLe: null,
        precedent: null,
      };
    }
    return { statut: "A_FAIRE", ...REPONSE_EFFACEE };
  };

  const vues = new Set<string>();
  const traitees = new Set<string>();

  /** La coche du CRM (achèvement, absence, vigueur, règle) : l'état d'avant est rangé (`precedent`). */
  const cocher = async (ligne: TacheAFaire, issue: IssueAbsence) => {
    traitees.add(ligne.id);
    if (ligne.statut === issue.statut && (issue.statut !== "PLUS_TARD" || egal(ligne.plusTardJusqua, issue.jusqua ?? null))) return;
    const faite = issue.statut === "FAITE";
    const precedent: Precedent = { avant: etatDe(ligne), reponse: REPONSE_DU_STATUT[issue.statut], le: maintenant.toISOString(), effet: null };
    const ecrite = await ecrireSiInchangee(ligne, {
      statut: issue.statut,
      reponse: REPONSE_DU_STATUT[issue.statut],
      reponseRaison: issue.raison ?? null,
      reponseTexte: issue.texte.slice(0, 500),
      reponduLe: maintenant,
      reponduPar: ACTEUR_TACHES,
      revenueLe: null,
      precedent: JSON.stringify(precedent),
      ...(issue.statut === "PLUS_TARD" ? { plusTardJusqua: issue.jusqua ?? null } : {}),
      ...(faite ? { dureeReelleSec: dureeReelle(ligne.commenceLe, maintenant) ?? ligne.dureeReelleSec } : {}),
    });
    if (!ecrite) return;
    if (issue.statut === "PLUS_TARD") bilan.misesAJour++;
    else bilan.cochees++;
  };

  await avecActeur({ acteur: ACTEUR_TACHES, origine: "a-faire:reconciliation" }, async () => {
    // 3. Les détections.
    for (const d of gardees) {
      vues.add(d.cle);
      const ligne = existantes.get(d.cle);
      if (ligne) traitees.add(ligne.id);
      // Une tâche archivée (retirée) : on n'y touche plus.
      if (ligne?.archiveLe) {
        bilan.ecartees++;
        continue;
      }
      // Un type que Lucas ne veut plus voir : pas de création ; une tâche encore ouverte est écartée par le CRM.
      const regle = nePlusProposer.get(d.type);
      if (regle !== undefined && d.type !== "MANUELLE") {
        if (ligne && (ligne.statut === "A_FAIRE" || ligne.statut === "PLUS_TARD")) await cocher(ligne, { statut: "PAS_A_FAIRE", texte: `${PREFIXE_COCHE}règle « ${regle} »` });
        else bilan.ecartees++;
        continue;
      }
      // Les sources qui la voient : celles de ce passage, et celles d'avant qui n'ont pas tourné (non couvertes).
      const gardees = ligne ? sourcesDeLaTache(ligne).filter((s) => !couvertes.has(s)) : [];
      const sourcesVues = [...new Set([...(sourcesParCle.get(d.cle) ?? [d.source]), ...gardees])];
      const colonnes = colonnesDe(d, dureeDe(d.type, mesurees, d.dureeMin), sourcesVues);
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
      let retour: Prisma.TacheAFaireUpdateManyMutationInput | null = null;
      if (ligne.statut === "PLUS_TARD") {
        const echu = ligne.plusTardJusqua !== null && ligne.plusTardJusqua.getTime() <= maintenant.getTime();
        // Posé par le CRM (mail reporté, que le détecteur ne rend pas) et vu de nouveau : le report est levé.
        if (echu || parLeCrm(ligne.reponduPar) || clientSEstManifeste(ligne)) retour = { statut: "A_FAIRE", revenueLe: maintenant };
      } else if (ligne.statut === "FAITE" || ligne.statut === "PAS_A_FAIRE") {
        const systemeToujoursLa = ligne.sujetType === "SYSTEME" && ligne.reponduLe !== null && ligne.reponduLe.getTime() + JOUR <= maintenant.getTime();
        if (parLeCrm(ligne.reponduPar)) retour = reouverture(ligne);
        else if (clientSEstManifeste(ligne) || systemeToujoursLa || besoinNouveau(ligne, d)) retour = { statut: "A_FAIRE", ...REPONSE_EFFACEE };
        // Répondue par Lucas ou Claude, rien de neuf : on n'y touche pas.
        else continue;
      }
      const changees = differences(ligne, colonnes);
      const rafraichir = maintenant.getTime() - ligne.detecteLe.getTime() >= JOUR;
      if (!retour && Object.keys(changees).length === 0 && !rafraichir) continue;
      if (!(await ecrireSiInchangee(ligne, { ...changees, ...(retour ?? {}), detecteLe: maintenant }))) continue;
      if (retour) bilan.rouvertes++;
      else bilan.misesAJour++;
    }

    // 4. Achevées par leur condition propre (lues maintenant : l'étape 3 a pu les écrire).
    const parAchevement = acheves.length ? await lireParCles([...new Set(acheves.map((a) => a.cle))]) : new Map<string, TacheAFaire>();
    for (const a of acheves) {
      const ligne = parAchevement.get(a.cle);
      if (!ligne || ligne.archiveLe || (ligne.statut !== "A_FAIRE" && ligne.statut !== "PLUS_TARD")) continue;
      const texte = a.texte.startsWith(PREFIXE_COCHE) ? a.texte : `${PREFIXE_COCHE}${a.texte}`;
      await cocher(ligne, { statut: "FAITE", texte });
    }

    // 5. Absence : les tâches ouvertes dont toutes les sources sont couvertes et que personne n'a vues.
    const sources = [...couvertes].filter((s) => s !== "MANUELLE");
    const ouvertes = sources.length ? await prisma.tacheAFaire.findMany({ where: { statut: { in: ["A_FAIRE", "PLUS_TARD"] }, source: { in: sources } } }) : [];
    for (const ligne of ouvertes) {
      if (vues.has(ligne.cle) || traitees.has(ligne.id) || ligne.type === "MANUELLE") continue;
      // Une autre source la voyait et n'a pas tourné ce passage : on ne sait pas, on n'y touche pas.
      if (sourcesDeLaTache(ligne).some((s) => !couvertes.has(s))) continue;
      const reprisePar = reprises.get(ligne.cle);
      if (reprisePar) {
        await cocher(ligne, { statut: "FAITE", texte: `${PREFIXE_COCHE}reprise dans « ${reprisePar} »` });
        continue;
      }
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
      if (await ecrireSiInchangee(ligne, { statut: "A_FAIRE", revenueLe: maintenant })) bilan.rouvertes++;
    }
  });
  return bilan;
}
