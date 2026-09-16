import type { Metadata } from "next";
import EcranJournal from "./_components/EcranJournal";

export const metadata: Metadata = {
  title: "Journal — CoverSwap",
  description: "Qui a changé quoi, quand et d'où : toutes les écritures, jamais modifiées.",
};

export const dynamic = "force-dynamic";

// ?dossierId=… ou ?clientId=… : le journal d'un dossier ou d'une fiche ; ?modele=…&id=… : d'un enregistrement.
export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const lire = (nom: string) => (typeof parametres[nom] === "string" ? (parametres[nom] as string) : null);
  return <EcranJournal cibleInitiale={{ dossierId: lire("dossierId"), clientId: lire("clientId"), modele: lire("modele"), id: lire("id") }} />;
}
