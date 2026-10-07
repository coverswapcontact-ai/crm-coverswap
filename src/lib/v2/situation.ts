import type { Candidat } from "@/lib/assistant/recherche";
import type { EspaceResume } from "@/lib/espace/suivi-types";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { joursDeRetard } from "@/lib/dossiers/dates";
import { echeanceDe, mainDe } from "@/lib/dossiers/pilotage";
import { famille, famillesDe, type SelectionPrestations } from "@/lib/prestations/prestations";
import { depuisLisible, jourRelatif } from "./dates";

/**
 * Mission 22 (A3) — le format unique de la situation d'un dossier (règle 5 de docs/CRM-V2.md : même chose, même
 * place), en trois lignes de phrases, pur et importable par tous les écrans v2 (panneau, puis listes, recherche,
 * journal) :
 *  1. qui / quoi : « Nom, cuisine, salle de bain, Ville » (l'étape s'affiche à côté, en mots) ;
 *  2. où en est-on et depuis quand : « Chez le client depuis vendredi 9 h — devis envoyé, relu 2 fois » ;
 *  3. la prochaine action et sa date : « Relancer — lundi » ou « Aucune prochaine action ».
 */
export type DossierPourSituation = {
  clientNom: string;
  clientVille: string;
  etape: EtapeDossier;
  prestations: SelectionPrestations;
  main: "MOI" | "CLIENT" | null;
  mainLe: string | null;
  mainMotif: string | null;
  prochaineAction: string | null;
  prochaineActionDate: string | null;
};

/** « cuisine, salle de bain » : les familles du projet, en minuscules, séparées par des virgules ; vide sans famille. */
export function pieceLisible(prestations: SelectionPrestations | null | undefined): string {
  return famillesDe(prestations ?? {})
    .map((id) => famille(id).libelle.toLowerCase())
    .join(", ");
}

/** Ligne 1 : le nom, la pièce, la ville (les morceaux vides sautent). */
export function ligneQuiQuoi(detail: Pick<DossierPourSituation, "clientNom" | "clientVille" | "prestations">): string {
  return [detail.clientNom, pieceLisible(detail.prestations), detail.clientVille].filter((m) => m && m.trim()).join(", ");
}

/** Qui a la main, en phrase. */
export function phraseMain(detail: Pick<DossierPourSituation, "etape" | "prochaineActionDate" | "main">, maintenant: Date): string {
  switch (mainDe(detail, maintenant)) {
    case "MOI":
      return "À toi de jouer";
    case "CLIENT":
      return "Chez le client";
    case "A_RELANCER":
      return "Chez le client, à relancer";
    case "AUCUNE":
      return detail.etape === "PERDU" ? "Dossier perdu" : "Dossier terminé";
  }
}

/** Le fait qui justifie la main, en minuscule initiale ; rien quand le motif n'est que l'étape. */
export function faitDeLaMain(mainMotif: string | null | undefined): string | null {
  const motif = (mainMotif ?? "").trim();
  if (!motif || motif.startsWith("Étape «")) return null;
  return motif.charAt(0).toLowerCase() + motif.slice(1);
}

/** Ce que l'espace du client ajoute : « devis 2026-041 relu 3 fois », puis les signaux qui demandent un geste. */
export function signauxLisibles(espace: Pick<EspaceResume, "devis" | "accord" | "signaux"> | null | undefined): string[] {
  if (!espace) return [];
  const lignes: string[] = [];
  if (espace.devis && !espace.accord && espace.devis.consultations >= 2) lignes.push(`devis ${espace.devis.numero} relu ${espace.devis.consultations} fois`);
  for (const s of espace.signaux) {
    if (s.ton === "gris" || s.code === "HESITE") continue;
    lignes.push(s.libelle.charAt(0).toLowerCase() + s.libelle.slice(1));
  }
  return lignes;
}

/** Ligne 2 : « Chez le client depuis vendredi 9 h — devis envoyé : en attente de sa réponse, devis 2026-041 relu 2 fois ». */
export function ligneSituation(detail: Pick<DossierPourSituation, "etape" | "prochaineActionDate" | "main" | "mainLe" | "mainMotif">, espace: Pick<EspaceResume, "devis" | "accord" | "signaux"> | null | undefined, maintenant: Date): string {
  const main = phraseMain(detail, maintenant);
  const depuis = detail.mainLe && mainDe(detail, maintenant) !== "AUCUNE" ? ` ${depuisLisible(detail.mainLe, maintenant)}` : "";
  const faits = [faitDeLaMain(detail.mainMotif), ...signauxLisibles(espace)].filter((f): f is string => Boolean(f));
  return `${main}${depuis}${faits.length ? ` — ${faits.join(", ")}` : ""}`;
}

/** La date de la prochaine action, en phrase : « en retard de 3 jours », « aujourd'hui », « demain », « lundi », « le 12 oct. ». */
export function quandProchaineAction(detail: Pick<DossierPourSituation, "etape" | "prochaineActionDate">, maintenant: Date): string | null {
  if (!detail.prochaineActionDate) return null;
  const echeance = echeanceDe(detail, maintenant);
  if (echeance === "retard") {
    const jours = Math.max(1, joursDeRetard(detail.prochaineActionDate, maintenant));
    return `en retard de ${jours} jour${jours > 1 ? "s" : ""}`;
  }
  return jourRelatif(detail.prochaineActionDate, maintenant);
}

/** Ligne 3 : « Relancer — lundi », « Action à préciser — demain », « Aucune prochaine action ». */
export function ligneProchaineAction(detail: Pick<DossierPourSituation, "etape" | "prochaineAction" | "prochaineActionDate">, maintenant: Date): string {
  const quand = quandProchaineAction(detail, maintenant);
  if (!detail.prochaineAction && !quand) return "Aucune prochaine action";
  return [detail.prochaineAction ?? "Action à préciser", quand].filter(Boolean).join(" — ");
}

/**
 * Mission 22 (correctifs du 07/10) — la situation d'un résultat de recherche : pour un DOSSIER qui porte ses champs
 * (`lib/assistant/recherche.ts`, ajout de champs), les mêmes trois lignes que partout (sans la pièce : la recherche ne
 * lit pas les prestations ; sans l'espace) ; null pour un contact, un client, ou un dossier servi sans situation
 * (`etape` absent) — l'écran garde alors sa phrase courte. Dette : seuls les dossiers portent la situation complète.
 */
export function situationDeCandidat(candidat: Pick<Candidat, "type" | "nom" | "ville" | "etape" | "main" | "mainLe" | "mainMotif" | "prochaineAction" | "prochaineActionDate">, maintenant: Date): { quiQuoi: string; etape: string; situation: string; prochaineAction: string } | null {
  if (candidat.type !== "DOSSIER" || !candidat.etape) return null;
  return situationDe(
    {
      clientNom: candidat.nom,
      clientVille: candidat.ville ?? "",
      etape: candidat.etape,
      prestations: {},
      main: candidat.main ?? null,
      mainLe: candidat.mainLe ?? null,
      mainMotif: candidat.mainMotif ?? null,
      prochaineAction: candidat.prochaineAction ?? null,
      prochaineActionDate: candidat.prochaineActionDate ?? null,
    },
    null,
    maintenant
  );
}

/** Les trois lignes d'un coup, et l'étape en mots. */
export function situationDe(detail: DossierPourSituation, espace: Pick<EspaceResume, "devis" | "accord" | "signaux"> | null | undefined, maintenant: Date): { quiQuoi: string; etape: string; situation: string; prochaineAction: string } {
  return { quiQuoi: ligneQuiQuoi(detail), etape: LIBELLES_ETAPE[detail.etape], situation: ligneSituation(detail, espace, maintenant), prochaineAction: ligneProchaineAction(detail, maintenant) };
}
