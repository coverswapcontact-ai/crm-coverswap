import { redirect } from "next/navigation";

// Les devis se génèrent depuis un dossier (numérotation unique) : l'ancien
// calculateur n'est plus un chemin d'émission.
export default async function NouveauDevisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { leadId } = await searchParams;
  redirect(leadId ? `/dossiers?lead=${encodeURIComponent(leadId)}` : "/dossiers");
}
