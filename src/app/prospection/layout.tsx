import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prospection — CoverSwap",
  description:
    "Agent IA de prospection B2B : hôtels et restaurants de l'Hérault.",
};

// Layout dédié au module Prospection : thème sombre indépendant du CRM
// (la route vit hors du groupe (app), donc sans sidebar ni thème clair).
export default function ProspectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex-1 bg-[#16181D] text-[#F2F3F5] antialiased selection:bg-[#1D9E75]/30">
      {children}
    </div>
  );
}
