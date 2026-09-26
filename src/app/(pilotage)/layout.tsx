import type { Metadata, Viewport } from "next";
import { Navigation } from "@/components/pilotage/Navigation";
import { RetourAppel } from "@/components/pilotage/RetourAppel";
import { VUE_APPLICATION, metadonneesApplication } from "@/lib/application/installation";

// Application installable « CoverSwap » : manifeste, icône et écrans de démarrage du CRM.
export const metadata: Metadata = metadonneesApplication("crm");
export const viewport: Viewport = VUE_APPLICATION;

// Gabarit des écrans de pilotage : charte sombre, barre du
// haut sur ordinateur, barre du bas au pouce sur téléphone.
export default function PilotageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex-1 bg-[#16181D] text-[#F2F3F5] antialiased selection:bg-[#1D9E75]/30">
      <Navigation />
      {/* Mission 13 (lot 4) : au retour d'un appel, « Comment ça s'est passé ? » sans passer par le panneau. */}
      <RetourAppel />
      <main className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
    </div>
  );
}
