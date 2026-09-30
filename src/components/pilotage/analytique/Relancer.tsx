"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton } from "@/components/pilotage/ui";
import type { SourceDonnees } from "@/lib/analytique/types";

export type ReponseRelance = { ok: boolean; message: string };

const NOMS: Record<SourceDonnees, string> = { CRM: "CRM", SITE: "mesure du site", META: "Meta", GOOGLE_ADS: "Google Ads", SEARCH_CONSOLE: "Search Console", FICHE_GOOGLE: "fiche Google" };

/** Relectures de l'écran après une relance : la file de tâches passe toutes les 15 s, une synchronisation dure de quelques secondes à quelques minutes. */
export const RELECTURES_MS = [20_000, 60_000, 150_000] as const;

/** Le message juste après « Relancer » : la synchronisation est mise en file, elle n'a pas encore tourné. */
export function messageRelance(source: SourceDonnees): string {
  return `Synchronisation ${NOMS[source]} mise en file : elle démarre dans les secondes qui viennent. L'écran se relit tout seul pendant quelques minutes ; l'heure de la source change quand elle a réussi.`;
}

/**
 * Mission 17 (partie B) — « Relancer » la synchronisation d'une source (POST /api/analytique/synchro) : une tâche neuve
 * dans la file (exécutée en arrière-plan, pas pendant la requête). L'écran se relit ensuite trois fois
 * (router.refresh : l'état des sources est relu à chaque ouverture, les chiffres dès que la synchronisation a vidé le
 * cache) ; le message le dit, sans promettre une durée.
 */
export function BoutonRelancer({ source, libelle = "Relancer", discret = false }: { source: SourceDonnees; libelle?: string; discret?: boolean }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const minuteurs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      for (const minuteur of minuteurs.current) clearTimeout(minuteur);
    },
    []
  );

  async function relancer() {
    setEnCours(true);
    try {
      const reponse = await envoyerJson<ReponseRelance>("/api/analytique/synchro", "POST", { source });
      if (!reponse.ok) {
        toast.error(reponse.message);
        return;
      }
      toast.success(messageRelance(source));
      for (const minuteur of minuteurs.current) clearTimeout(minuteur);
      minuteurs.current = RELECTURES_MS.map((delai) => setTimeout(() => router.refresh(), delai));
      router.refresh();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Bouton taille="sm" variante={discret ? "fantome" : "secondaire"} chargement={enCours} icone={<RefreshCw size={13} aria-hidden />} onClick={() => void relancer()}>
      {libelle}
    </Bouton>
  );
}
