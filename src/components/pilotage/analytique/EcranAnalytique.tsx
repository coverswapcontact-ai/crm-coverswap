/**
 * Mission 17 (partie B) — l'écran /analytique : en-tête commun (période, onglets, synchronisations) et l'onglet
 * demandé. Composant serveur : l'écran arrive calculé avec la page (aucune requête du navigateur au premier
 * affichage) ; seuls les graphiques, l'en-tête et les gestes (Relancer, chaîne Meta) sont des composants client.
 */
import type { EcranAnalytique as Ecran, EtatSource } from "@/lib/analytique/types";
import type { SanteMeta } from "@/lib/meta/sante";
import { EnTeteAnalytique, FournisseurAnalytique, ZoneContenu } from "./Controles";
import type { RequeteAnalytique } from "./requete";
import { VueArgent } from "./VueArgent";
import { VueEnsemble } from "./VueEnsemble";
import { VuePublicite } from "./VuePublicite";
import { VueSeo } from "./VueSeo";
import { VueSite } from "./VueSite";

function Vue({ ecran, chaineMeta }: { ecran: Ecran; chaineMeta: SanteMeta | null }) {
  switch (ecran.onglet) {
    case "publicite":
      return <VuePublicite ecran={ecran} chaineMeta={chaineMeta} />;
    case "seo":
      return <VueSeo ecran={ecran} />;
    case "site":
      return <VueSite ecran={ecran} />;
    case "argent":
      return <VueArgent ecran={ecran} />;
    default:
      return <VueEnsemble ecran={ecran} />;
  }
}

export function EcranAnalytique({ requete, ecran, etats, chaineMeta = null }: { requete: RequeteAnalytique; ecran: Ecran; etats: EtatSource[]; chaineMeta?: SanteMeta | null }) {
  // La période affichée est celle que le calcul a retenue (dates remises dans l'ordre, futur ramené à aujourd'hui).
  const courante: RequeteAnalytique = {
    ...requete,
    onglet: ecran.onglet,
    periode: ecran.periode.cle,
    du: ecran.periode.cle === "libre" ? ecran.periode.du : null,
    au: ecran.periode.cle === "libre" ? ecran.periode.au : null,
  };
  return (
    <FournisseurAnalytique>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 pt-5 pb-8 leading-[normal] md:gap-6 md:px-10 md:pt-8 md:pb-12" data-onglet={ecran.onglet}>
        <EnTeteAnalytique requete={courante} periode={ecran.periode} sources={etats} genereLe={ecran.genereLe} />
        <ZoneContenu>
          <Vue ecran={ecran} chaineMeta={chaineMeta} />
        </ZoneContenu>
      </div>
    </FournisseurAnalytique>
  );
}
