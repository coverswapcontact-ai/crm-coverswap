import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prospection — CoverSwap",
  description: "Agent IA de prospection B2B : hôtels et restaurants de l'Hérault.",
};

export default function ProspectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
