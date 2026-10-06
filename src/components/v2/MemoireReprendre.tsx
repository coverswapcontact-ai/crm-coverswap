"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { contexteDepuisAdresse } from "@/lib/v2/reprendre";
import { memoriserReprendre } from "./reprendre-client";

/**
 * Mission 22 (A2) — monté par la coque v2 (dans un `Suspense`, pour `useSearchParams`) : à chaque adresse qui ouvre
 * un dossier (`/dossiers?dossier=`), un contact (`/leads?lead=`), une fiche client (`/clients/<id>`) ou un mail
 * (`/mail?mail=`), la mémoire « Reprendre » se met à jour. Ne rend rien.
 */
export function MemoireReprendre() {
  const pathname = usePathname();
  const recherche = useSearchParams();
  const chaine = recherche.toString();
  useEffect(() => {
    const contexte = contexteDepuisAdresse(pathname, chaine);
    if (contexte) memoriserReprendre(contexte);
  }, [pathname, chaine]);
  return null;
}
