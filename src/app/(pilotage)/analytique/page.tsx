import type { Metadata } from "next";
import { EcranAnalytique } from "@/components/pilotage/analytique/EcranAnalytique";
import { lireRequete } from "@/components/pilotage/analytique/requete";
import { santeMeta } from "@/lib/meta/sante";
import { chargerEcran } from "./charger";

export const metadata: Metadata = {
  title: "Analytique — CoverSwap",
  description: "Tous les chiffres de CoverSwap au même endroit : publicité, SEO et Google, site, argent, comparés à la période précédente.",
};

export const dynamic = "force-dynamic";

// Mission 17 (partie B) : ?onglet=ensemble|publicite|seo|site|argent, ?p=7j|30j|90j|mois|12m ou ?du=&au=, ?source=.
// L'écran est calculé ici (cache mémoire, instantané du jour, sinon calcul) et rendu d'emblée.
export default async function AnalytiquePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requete = lireRequete(await searchParams);
  const maintenant = new Date();
  const [{ ecran, etats }, chaineMeta] = await Promise.all([
    chargerEcran(requete, maintenant),
    // L'outil de travail de l'ancien écran Publicité, lu en base seulement (sans appel à Meta) : « Vérifier » interroge Meta.
    requete.onglet === "publicite"
      ? santeMeta({ interrogerMeta: false, jours: 7 }).catch((erreur) => {
          console.error("[analytique] chaîne Meta illisible :", erreur);
          return null;
        })
      : null,
  ]);
  return <EcranAnalytique requete={requete} ecran={ecran} etats={etats} chaineMeta={chaineMeta} />;
}
