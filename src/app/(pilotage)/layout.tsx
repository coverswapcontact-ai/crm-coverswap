import type { Metadata, Viewport } from "next";
import { Navigation } from "@/components/pilotage/Navigation";
import { RetourAppel } from "@/components/pilotage/RetourAppel";
import { HoteEcranSms } from "@/components/pilotage/sms/EcranSms";
import { BandeauEssai } from "@/components/v2/BandeauEssai";
import { CoqueV2 } from "@/components/v2/CoqueV2";
import { PriseInterface } from "@/components/v2/PriseInterface";
import { VUE_APPLICATION, metadonneesApplication } from "@/lib/application/installation";
import { interfaceCourante } from "@/lib/interface/choix";

// Application installable « CoverSwap » : manifeste, icône et écrans de démarrage du CRM.
export const metadata: Metadata = metadonneesApplication("crm");
export const viewport: Viewport = VUE_APPLICATION;

// Gabarit des écrans de pilotage : charte sombre, barre du
// haut sur ordinateur, barre du bas au pouce sur téléphone.
// Mission 22 : le point de choix v1 / v2 (`CRM_INTERFACE`, cookie d'aperçu) — la v1 par défaut, inchangée ; la
// coque v2 (`components/v2/CoqueV2`) quand le drapeau le dit. Les pages choisiront leur écran de la même façon
// (`const v = await interfaceCourante()`). Dans les deux cas : le bandeau de l'essai local (une sécurité, pas un
// écran) et `PriseInterface` (`?interface=v2|v1` sur n'importe quelle adresse), qui ne rendent rien hors essai.
export default async function PilotageLayout({ children }: { children: React.ReactNode }) {
  const v = await interfaceCourante();
  if (v === "v2") return <CoqueV2>{children}</CoqueV2>;
  return (
    <div className="min-h-screen w-full flex-1 bg-fond text-texte antialiased selection:bg-action/30">
      <BandeauEssai />
      <Navigation />
      <PriseInterface />
      {/* Mission 13 (lot 4) : au retour d'un appel, « Comment ça s'est passé ? » sans passer par le panneau. */}
      <RetourAppel />
      {/* Mission 14 (partie 5) : l'écran SMS (copier vaut envoi), ouvert de n'importe où par ouvrirEcranSms. */}
      <HoteEcranSms />
      {/* Mission 13 (lot 5) : la zone sûre du haut (barre d'état de l'iPhone) dès le gabarit, plus de rustine par écran. */}
      <main className="pt-[env(safe-area-inset-top)] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
    </div>
  );
}
