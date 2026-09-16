import { Navigation } from "@/components/pilotage/Navigation";

// Gabarit des écrans de pilotage : charte sombre de /prospection, barre du
// haut sur ordinateur, barre du bas au pouce sur téléphone.
export default function PilotageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex-1 bg-[#16181D] text-[#F2F3F5] antialiased selection:bg-[#1D9E75]/30">
      <Navigation />
      <main className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
    </div>
  );
}
