import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dossiers — CoverSwap",
  description: "Pilotage des affaires en cours, de la qualification à l'encaissement.",
};

// Layout dédié au module Dossiers : même thème sombre que /prospection
// (la route vit hors du groupe (app), donc sans sidebar ni thème clair).
export default function DossiersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex-1 bg-[#16181D] text-[#F2F3F5] antialiased selection:bg-[#1D9E75]/30">
      {children}
    </div>
  );
}
