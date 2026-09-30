import prisma from "@/lib/prisma";
import type { LigneEspace, Signal } from "@/lib/espace/suivi-types";
import type { ActionManuelle } from "./detecteurs/types";
import { cleDuSignal } from "./detecteurs/signaux-cles";
import { dernierEvenementClient, filDeLaCle } from "./evenements-client";
import { actionsManuellesEnVigueur } from "./vigueur";

/**
 * Mission 17 (partie A) : les signaux des espaces clients deviennent une VUE de la même source que les tâches
 * (espace/suivi.ts : écran Espaces, outil « espaces_clients », espace du client dans le CRM). Deux règles :
 * 1. un dossier dont la prochaine action posée à la main est en vigueur (vigueur.ts, cas « j'attends sa modification
 *    visuelle ») n'a plus de signal rouge ni ambre, et il attend le client, sur le texte de cette action (plus de
 *    « Répondre à … », plus de « date du chantier à fixer ») ;
 * 2. un signal dont la tâche (même clé : detecteurs/signaux-cles.ts) a été écartée par Lucas ou Claude n'est plus
 *    affiché : « Pas à faire » ou « Fait » de leur main, ou « Plus tard » qui court encore — sauf si le client s'est
 *    manifesté depuis (le moteur rouvrira la tâche au passage suivant : la vue n'attend pas).
 * Quelques requêtes groupées pour toute la liste (tâches par clés, prochaines actions en vigueur, gestes du client),
 * jamais une par espace. Le détecteur SIGNAUX lit les signaux BRUTS (sinon il cocherait ces tâches à tort).
 */

export type VueTachesEspaces = {
  /** Vrai si la tâche de cette clé a été écartée par Lucas ou Claude (son signal est masqué). */
  ecartee(cle: string): boolean;
  /** Les prochaines actions manuelles en vigueur, par dossier. */
  vigueur: ReadonlyMap<string, ActionManuelle>;
};

const PAQUET = 400;
const decideeALaMain = (acteur: string | null) => Boolean(acteur && (acteur.startsWith("HUMAIN:") || acteur.startsWith("ASSISTANT:")));

/** Lit, en une fois, ce que la vue doit savoir des tâches pour ces clés de signaux et ces dossiers. */
export async function lireVueDesTaches(maintenant: Date, cles: readonly string[], dossierIds: readonly string[]): Promise<VueTachesEspaces> {
  const uniques = [...new Set(cles)];
  const lignes: { cle: string; statut: string; reponduPar: string | null; reponduLe: Date | null; plusTardJusqua: Date | null; dossierId: string | null; leadId: string | null; clientId: string | null }[] = [];
  for (let i = 0; i < uniques.length; i += PAQUET) {
    lignes.push(
      ...(await prisma.tacheAFaire.findMany({
        where: { cle: { in: uniques.slice(i, i + PAQUET) }, statut: { in: ["PAS_A_FAIRE", "FAITE", "PLUS_TARD"] } },
        select: { cle: true, statut: true, reponduPar: true, reponduLe: true, plusTardJusqua: true, dossierId: true, leadId: true, clientId: true },
      }))
    );
  }
  const candidates = lignes.filter((t) => (t.statut === "PLUS_TARD" ? !t.plusTardJusqua || t.plusTardJusqua.getTime() > maintenant.getTime() : decideeALaMain(t.reponduPar)));
  const [gestes, vigueur] = await Promise.all([
    candidates.some((t) => t.dossierId || t.leadId || t.clientId || filDeLaCle(t.cle)) ? dernierEvenementClient(candidates) : Promise.resolve(() => null),
    dossierIds.length ? actionsManuellesEnVigueur(maintenant, dossierIds) : Promise.resolve(new Map<string, ActionManuelle>()),
  ]);
  const ecartees = new Set(
    candidates
      .filter((t) => {
        const geste = gestes(t);
        return !(geste && t.reponduLe && geste.getTime() > t.reponduLe.getTime() && geste.getTime() <= maintenant.getTime());
      })
      .map((t) => t.cle)
  );
  return { ecartee: (cle) => ecartees.has(cle), vigueur };
}

/** Les clés de tâche des signaux de ces projets (pour `lireVueDesTaches`). */
export function clesDesProjets(projets: readonly Pick<LigneEspace, "dossierId" | "signaux">[]): string[] {
  return projets.flatMap((p) => p.signaux.map((s) => cleDuSignal(s.code, { dossierId: p.dossierId })).filter((c): c is string => Boolean(c)));
}

/** Un signal de projet encore affiché : sa tâche n'est pas écartée. */
const signalVisible = (vue: VueTachesEspaces, dossierId: string) => (s: Signal) => {
  const cle = cleDuSignal(s.code, { dossierId });
  return !cle || !vue.ecartee(cle);
};

/** Le projet tel que l'écran Espaces le montre : signaux des tâches écartées masqués, prochaine action manuelle respectée. */
export function appliquerAuProjet<L extends Pick<LigneEspace, "dossierId" | "signaux" | "attente">>(ligne: L, vue: VueTachesEspaces): L {
  const action = vue.vigueur.get(ligne.dossierId);
  const signaux = ligne.signaux.filter(signalVisible(vue, ligne.dossierId)).filter((s) => !action || s.ton === "gris");
  return { ...ligne, signaux, attente: action ? { qui: "CLIENT", libelle: action.action } : ligne.attente };
}

/** Un signal du client (espace permanent) encore affiché : sa tâche n'est pas écartée. */
export function signalDuClientVisible(vue: VueTachesEspaces, clientId: string | null, signal: Signal): boolean {
  const cle = cleDuSignal(signal.code, { clientId });
  return !cle || !vue.ecartee(cle);
}
