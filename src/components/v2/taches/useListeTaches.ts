"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErreurApi, appelApi } from "@/components/pilotage/client";
import { EVENEMENT_APPEL_TERMINE, EVENEMENT_COMPTEURS, EVENEMENT_LEADS_MODIFIES } from "@/components/pilotage/evenements";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import type { ListeTaches } from "@/lib/a-faire/types";
import { ouvertes } from "@/lib/v2/aujourdhui";

/**
 * Mission 22 (A2) — la liste des tâches, relue comme en v1 (`taches/_components/EcranTaches.tsx`, intouché) : aux gestes
 * (`pilotage:compteurs`, `leads:modifies`), 4,5 s après une fin d'appel (le moteur repasse 3 s après une coche), au
 * retour sur l'onglet, au retour du réseau, et toutes les 20 s tant que l'écran est visible. Une seule requête serveur
 * (`GET /api/a-faire`). Hors ligne : la dernière liste connue, et le bandeau.
 *
 * `masquees` : les tâches répondues, cachées tout de suite (optimisme) et tant qu'une liste lue avant la réponse les
 * montre encore.
 */
export const RELEVE_MS = 20_000;
export const RELECTURE_APRES_MS = 4_500;

const ajouter = (ensemble: Set<string>, id: string) => new Set(ensemble).add(id);
const retirer = (ensemble: Set<string>, id: string) => {
  const suivant = new Set(ensemble);
  suivant.delete(id);
  return suivant;
};

export function useListeTaches(initiale: ListeTaches) {
  const [liste, setListe] = useState(initiale);
  // L'heure de la liste servie : le premier rendu est le même au serveur et au navigateur.
  const [maintenant, setMaintenant] = useState(() => Date.parse(initiale.genereLe));
  const [horsLigne, setHorsLigne] = useState(false);
  const [masquees, setMasquees] = useState<Set<string>>(new Set());

  const enVol = useRef<Promise<void> | null>(null);
  const encore = useRef(false);
  const relire = useCallback((): Promise<void> => {
    if (enVol.current) {
      encore.current = true;
      return enVol.current;
    }
    const tour = (async () => {
      try {
        do {
          encore.current = false;
          const lue = await appelApi<ListeTaches>("/api/a-faire");
          const encoreOuvertes = ouvertes(lue);
          setListe(lue);
          setMasquees((actuelles) => (actuelles.size ? new Set([...actuelles].filter((id) => encoreOuvertes.has(id))) : actuelles));
          setHorsLigne(vientDuCache());
          setMaintenant(Date.now());
        } while (encore.current);
      } catch (erreur) {
        if (!(erreur instanceof ErreurApi)) setHorsLigne(true);
      } finally {
        enVol.current = null;
      }
    })();
    enVol.current = tour;
    return tour;
  }, []);

  const minuteries = useRef<number[]>([]);
  const relireApres = useCallback(() => {
    void relire();
    minuteries.current.push(window.setTimeout(() => void relire(), RELECTURE_APRES_MS));
  }, [relire]);

  useEffect(() => {
    let rafale = 0;
    const bientot = () => {
      window.clearTimeout(rafale);
      rafale = window.setTimeout(() => void relire(), 200);
    };
    const surVisibilite = () => {
      if (document.visibilityState === "visible") bientot();
    };
    const releve = window.setInterval(() => {
      if (document.visibilityState === "visible") void relire();
    }, RELEVE_MS);
    const apresAppel = () => relireApres();
    window.addEventListener(EVENEMENT_COMPTEURS, bientot);
    window.addEventListener(EVENEMENT_LEADS_MODIFIES, bientot);
    window.addEventListener(EVENEMENT_APPEL_TERMINE, apresAppel);
    window.addEventListener("online", bientot);
    document.addEventListener("visibilitychange", surVisibilite);
    const oublier = ecouterLeCache(() => setHorsLigne(true));
    const enAttente = minuteries.current;
    return () => {
      window.clearTimeout(rafale);
      window.clearInterval(releve);
      for (const m of enAttente) window.clearTimeout(m);
      window.removeEventListener(EVENEMENT_COMPTEURS, bientot);
      window.removeEventListener(EVENEMENT_LEADS_MODIFIES, bientot);
      window.removeEventListener(EVENEMENT_APPEL_TERMINE, apresAppel);
      window.removeEventListener("online", bientot);
      document.removeEventListener("visibilitychange", surVisibilite);
      oublier();
    };
  }, [relire, relireApres]);

  const masquer = useCallback((id: string) => setMasquees((m) => ajouter(m, id)), []);
  const demasquer = useCallback((id: string) => setMasquees((m) => retirer(m, id)), []);
  /** Une liste reçue d'une écriture (« Actualiser ») remplace la liste courante. */
  const remplacer = useCallback((lue: ListeTaches) => {
    setListe(lue);
    setMaintenant(Date.now());
  }, []);

  return { liste, maintenant, horsLigne, masquees, masquer, demasquer, relire, relireApres, remplacer };
}
