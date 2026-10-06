import type { Metadata } from "next";
import { ArgentV2 } from "@/components/v2/argent/ArgentV2";
import { depensesDeLaPeriode, encaissementsDeLaPeriode, totalEncaisse } from "@/lib/analytique/calculs";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { SECTION_DEPENSES } from "@/lib/depenses/constantes";
import { listerDepenses, suggestionsSaisie } from "@/lib/depenses/service";
import { anneeDemandee } from "@/lib/finances/annee";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import { interfaceCourante } from "@/lib/interface/choix";
import { libelleMoisCourant, plageDuMois, sommeMontants } from "@/lib/v2/argent";
import TableauFinances from "./_components/TableauFinances";

export const metadata: Metadata = {
  title: "Finances — CoverSwap",
  description: "Factures à encaisser et paiements, chèques à créditer, points à corriger, dépenses par chantier, livre des recettes et son export.",
};

export const dynamic = "force-dynamic";

// Mission 18 (A3) : l'écran Dépenses est une section de cet écran (même année) ; l'ancienne adresse /depenses redirige
// vers `?section=depenses` (next.config.ts), qui y descend. La saisie reste sur `/depenses/nouvelle`.
// Mission 22 (A4) : en v2 (`interfaceCourante()`), l'écran Argent (`components/v2/argent/ArgentV2`) reçoit en plus
// l'encaissé et le dépensé du mois courant (`encaissementsDeLaPeriode`, `depensesDeLaPeriode`) ; la v1 est servie telle quelle.
export default async function FinancesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { annee: brute, section } = await searchParams;
  const parametres = new URLSearchParams(typeof brute === "string" ? { annee: brute } : {});
  let annee: number;
  try {
    annee = anneeDemandee(parametres);
  } catch (erreur) {
    if (!(erreur instanceof ErreurMetier)) throw erreur;
    annee = anneeDemandee(new URLSearchParams());
  }
  const v = await interfaceCourante();
  const [tableau, depenses, { chantiers }] = await Promise.all([chargerTableauFinances(annee), listerDepenses(annee), suggestionsSaisie()]);
  const sectionDemandee = section === SECTION_DEPENSES ? SECTION_DEPENSES : null;
  if (v === "v2") {
    const maintenant = new Date();
    const plage = plageDuMois(maintenant);
    const [encaissements, depensesDuMois] = await Promise.all([encaissementsDeLaPeriode(plage), depensesDeLaPeriode(plage)]);
    return <ArgentV2 key={annee} initial={tableau} depenses={{ liste: depenses, chantiers }} mois={{ encaisse: totalEncaisse(encaissements), depense: sommeMontants(depensesDuMois), libelle: libelleMoisCourant(maintenant) }} section={sectionDemandee} />;
  }
  return (
    <TableauFinances
      key={annee}
      initial={tableau}
      depenses={{ liste: depenses, chantiers }}
      section={sectionDemandee}
    />
  );
}
