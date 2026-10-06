import type { Metadata } from "next";
import { EcranAnalytique } from "@/components/pilotage/analytique/EcranAnalytique";
import { lireRequete } from "@/components/pilotage/analytique/requete";
import { EnTeteEcran } from "@/components/v2/EnTeteEcran";
import { interfaceCourante } from "@/lib/interface/choix";
import { santeMeta } from "@/lib/meta/sante";
import { chargerEcran } from "./charger";

export const metadata: Metadata = {
  title: "Analytique — CoverSwap",
  description: "Tous les chiffres de CoverSwap au même endroit : publicité, SEO et Google, site, argent, comparés à la période précédente.",
};

export const dynamic = "force-dynamic";

// Mission 17 (partie B) : ?onglet=ensemble|publicite|seo|site|argent, ?p=7j|30j|90j|mois|12m ou ?du=&au=, ?source=.
// L'écran est calculé ici (cache mémoire, instantané du jour, sinon calcul) et rendu d'emblée.
// Mission 22 (A5) : en v2 (`interfaceCourante()`), le même écran v1 sous l'en-tête v2 « Bilan » ; en v1 rien ne change.
export default async function AnalytiquePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requete = lireRequete(await searchParams);
  const maintenant = new Date();
  const [{ ecran, etats }, chaineMeta, v] = await Promise.all([
    chargerEcran(requete, maintenant),
    // L'outil de travail de l'ancien écran Publicité, lu en base seulement (sans appel à Meta) : « Vérifier » interroge Meta.
    requete.onglet === "publicite"
      ? santeMeta({ interrogerMeta: false, jours: 7 }).catch((erreur) => {
          console.error("[analytique] chaîne Meta illisible :", erreur);
          return null;
        })
      : null,
    interfaceCourante(),
  ]);
  const vue = <EcranAnalytique requete={requete} ecran={ecran} etats={etats} chaineMeta={chaineMeta} />;
  if (v === "v2") {
    return (
      <EnTeteEcran titre="Bilan" aide="Publicité, Google, site et argent, comparés à la période d'avant." cadre="bilan">
        {vue}
      </EnTeteEcran>
    );
  }
  return vue;
}
