import type { Metadata } from "next";
import { etatDesTaches } from "@/lib/taches/lecture";
import EtatTaches from "./_components/EtatTaches";

export const metadata: Metadata = {
  title: "Tâches de fond — CoverSwap",
  description: "File des envois, du miroir Drive et de la relève des mails.",
};

export const dynamic = "force-dynamic";

export default async function TachesPage() {
  return <EtatTaches initial={await etatDesTaches()} />;
}
