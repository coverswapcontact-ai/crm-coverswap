import prisma from "@/lib/prisma";
import type { LigneEspace, Signal } from "@/lib/espace/suivi-types";
import type { ActionManuelle } from "./detecteurs/types";
import { cleDuSignal, occurrenceDuSignal } from "./detecteurs/signaux-cles";
import { dernierEvenementClient, filDeLaCle } from "./evenements-client";
import { lireObjet, occurrenceDe } from "./json";
import { actionsManuellesEnVigueur } from "./vigueur";

/**
 * Mission 17 (partie A) : les signaux des espaces clients deviennent une VUE de la même source que les tâches
 * (espace/suivi.ts : colonne et filtre « Espaces » de Dossiers, « lister » ESPACES, espace du client dans le CRM). Deux règles :
 * 1. un dossier dont la prochaine action posée à la main est en vigueur (vigueur.ts, cas « j'attends sa modification
 *    visuelle ») n'a plus de signal rouge ni ambre, et il attend le client, sur le texte de cette action (plus de
 *    « Répondre à … », plus de « date du chantier à fixer ») ;
 * 2. un signal dont la tâche (même clé : detecteurs/signaux-cles.ts) a été écartée par Lucas ou Claude n'est plus
 *    affiché : « Pas à faire » ou « Fait » de leur main, ou « Plus tard » qui court encore — sauf si le client s'est
 *    manifesté depuis (le moteur rouvrira la tâche au passage suivant : la vue n'attend pas). Mission 17 (partie A,
 *    relecture) : « Fait » ou « Pas à faire » ne masque que le besoin auquel Lucas a répondu (même occurrence :
 *    detecteurs/signaux-cles.ts › occurrenceDuSignal) — un « Lien expiré » après « Envoyer le lien » reste affiché.
 * Quelques requêtes groupées pour toute la liste (tâches par clés, prochaines actions en vigueur, gestes du client),
 * jamais une par espace. Le détecteur SIGNAUX lit les signaux BRUTS (sinon il cocherait ces tâches à tort).
 */

export type VueTachesEspaces = {
  /**
   * Vrai si la tâche de cette clé a été écartée par Lucas ou Claude (son signal est masqué). `occurrence` : celle du
   * signal ; une tâche close sur une autre occurrence ne le masque pas (un « Plus tard » qui court masque toujours).
   */
  ecartee(cle: string, occurrence?: string | null): boolean;
  /** Les prochaines actions manuelles en vigueur, par dossier. */
  vigueur: ReadonlyMap<string, ActionManuelle>;
};

const PAQUET = 400;
const decideeALaMain = (acteur: string | null) => Boolean(acteur && (acteur.startsWith("HUMAIN:") || acteur.startsWith("ASSISTANT:")));

/** Lit, en une fois, ce que la vue doit savoir des tâches pour ces clés de signaux et ces dossiers. */
export async function lireVueDesTaches(maintenant: Date, cles: readonly string[], dossierIds: readonly string[]): Promise<VueTachesEspaces> {
  const uniques = [...new Set(cles)];
  const lignes: { cle: string; statut: string; reponduPar: string | null; reponduLe: Date | null; plusTardJusqua: Date | null; dossierId: string | null; leadId: string | null; clientId: string | null; donnees: string }[] = [];
  for (let i = 0; i < uniques.length; i += PAQUET) {
    lignes.push(
      ...(await prisma.tacheAFaire.findMany({
        where: { cle: { in: uniques.slice(i, i + PAQUET) }, statut: { in: ["PAS_A_FAIRE", "FAITE", "PLUS_TARD"] } },
        select: { cle: true, statut: true, reponduPar: true, reponduLe: true, plusTardJusqua: true, dossierId: true, leadId: true, clientId: true, donnees: true },
      }))
    );
  }
  const candidates = lignes.filter((t) => (t.statut === "PLUS_TARD" ? !t.plusTardJusqua || t.plusTardJusqua.getTime() > maintenant.getTime() : decideeALaMain(t.reponduPar)));
  const [gestes, vigueur] = await Promise.all([
    candidates.some((t) => t.dossierId || t.leadId || t.clientId || filDeLaCle(t.cle)) ? dernierEvenementClient(candidates) : Promise.resolve(() => null),
    dossierIds.length ? actionsManuellesEnVigueur(maintenant, dossierIds) : Promise.resolve(new Map<string, ActionManuelle>()),
  ]);
  // Par clé : null = masque toute occurrence (« Plus tard » qui court, tâche d'avant les occurrences) ; sinon, celles masquées.
  const ecartees = new Map<string, Set<string> | null>();
  for (const t of candidates) {
    const geste = gestes(t);
    if (geste && t.reponduLe && geste.getTime() > t.reponduLe.getTime() && geste.getTime() <= maintenant.getTime()) continue;
    const occurrence = t.statut === "PLUS_TARD" ? null : occurrenceDe(lireObjet(t.donnees));
    ecartees.set(t.cle, occurrence ? new Set(occurrence.split("|")) : null);
  }
  return {
    ecartee: (cle, occurrence) => {
      if (!ecartees.has(cle)) return false;
      const masquees = ecartees.get(cle);
      return !masquees || !occurrence || masquees.has(occurrence);
    },
    vigueur,
  };
}

/** Les clés de tâche des signaux de ces projets (pour `lireVueDesTaches`). */
export function clesDesProjets(projets: readonly Pick<LigneEspace, "dossierId" | "signaux">[]): string[] {
  return projets.flatMap((p) => p.signaux.map((s) => cleDuSignal(s.code, { dossierId: p.dossierId })).filter((c): c is string => Boolean(c)));
}

/** Un signal de projet encore affiché : sa tâche n'est pas écartée (pour cette occurrence du besoin). */
const signalVisible = (vue: VueTachesEspaces, projet: Pick<LigneEspace, "dossierId" | "creeLe" | "lienEnvoyeLe" | "expireLe">) => (s: Signal) => {
  const cle = cleDuSignal(s.code, { dossierId: projet.dossierId });
  return !cle || !vue.ecartee(cle, occurrenceDuSignal(s.code, projet));
};

/** Le projet tel que Dossiers le montre (colonne Espace) : signaux des tâches écartées masqués, prochaine action manuelle respectée. */
export function appliquerAuProjet<L extends Pick<LigneEspace, "dossierId" | "signaux" | "attente" | "creeLe" | "lienEnvoyeLe" | "expireLe">>(ligne: L, vue: VueTachesEspaces): L {
  const action = vue.vigueur.get(ligne.dossierId);
  const signaux = ligne.signaux.filter(signalVisible(vue, ligne)).filter((s) => !action || s.ton === "gris");
  return { ...ligne, signaux, attente: action ? { qui: "CLIENT", libelle: action.action } : ligne.attente };
}

/** Un signal du client (espace permanent) encore affiché : sa tâche n'est pas écartée. */
export function signalDuClientVisible(vue: VueTachesEspaces, clientId: string | null, signal: Signal): boolean {
  const cle = cleDuSignal(signal.code, { clientId });
  return !cle || !vue.ecartee(cle);
}
