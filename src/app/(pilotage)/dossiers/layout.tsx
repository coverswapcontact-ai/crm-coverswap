import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dossiers — CoverSwap",
  description: "Pilotage des affaires en cours, de la qualification à l'encaissement.",
};

export default function DossiersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
