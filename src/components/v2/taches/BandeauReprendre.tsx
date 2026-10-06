"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Undo2, X } from "lucide-react";
import { dateExacte, dateRelative } from "@/lib/v2/dates";
import { CLE_REPRENDRE_FERME, choisirReprendre, type ContexteReprendre } from "@/lib/v2/reprendre";
import { cn } from "@/lib/utils";
import { lireMemoireReprendre } from "../reprendre-client";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A2) — « Reprendre : dossier Martin · cuisine — il y a 2 h » : une ligne, en tête d'Aujourd'hui, seulement
 * s'il y a quelque chose à reprendre (moins de 48 h), fermable. Le premier rendu suit la mémoire serveur (identique au
 * serveur et au navigateur) ; la mémoire de l'appareil, lue après, l'emporte si elle est plus récente.
 */
export function BandeauReprendre({ serveur, genereLe }: { serveur: ContexteReprendre | null; genereLe: string }) {
  const [contexte, setContexte] = useState<ContexteReprendre | null>(serveur);
  // L'heure du rendu serveur d'abord (même phrase au serveur et au navigateur), puis l'heure de l'appareil.
  const [maintenant, setMaintenant] = useState<Date>(() => new Date(genereLe));

  // Après le premier rendu (la mémoire de l'appareil n'existe pas au serveur) : l'heure de l'appareil, et le choix.
  useEffect(() => {
    const minuterie = window.setTimeout(() => {
      let ferme: string | null = null;
      try {
        ferme = window.localStorage.getItem(CLE_REPRENDRE_FERME);
      } catch {
        ferme = null;
      }
      const instant = new Date();
      setMaintenant(instant);
      setContexte(choisirReprendre(lireMemoireReprendre(), serveur, instant, ferme));
    }, 0);
    return () => window.clearTimeout(minuterie);
  }, [serveur]);

  if (!contexte) return null;

  const fermer = () => {
    try {
      window.localStorage.setItem(CLE_REPRENDRE_FERME, contexte.le);
    } catch {
      // stockage indisponible : le bandeau se referme pour cet affichage
    }
    setContexte(null);
  };

  return (
    <section aria-label="Reprendre" className="flex min-h-11 items-center gap-2 rounded-[11px] border border-trait bg-surface pr-1 pl-4">
      <Undo2 size={18} aria-hidden className="shrink-0 text-texte-3" />
      <Link href={contexte.chemin} className={cn("flex min-h-11 min-w-0 flex-1 items-center py-2 text-corps-tel text-texte hover:text-action-clair focus-visible:outline-none md:text-corps", TRANS_V2)}>
        <span className="line-clamp-2">
          Reprendre : {contexte.titre}
          <span className="text-texte-3">
            {" — "}
            <time dateTime={contexte.le} title={dateExacte(contexte.le)}>
              {dateRelative(contexte.le, maintenant)}
            </time>
          </span>
        </span>
      </Link>
      <button type="button" onClick={fermer} aria-label="Fermer « Reprendre »" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-texte-3 hover:bg-surface-2 hover:text-texte focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2)}>
        <X size={18} aria-hidden />
      </button>
    </section>
  );
}
