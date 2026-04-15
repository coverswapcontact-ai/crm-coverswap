import prisma from "@/lib/prisma";
import DevisCalculateur from "@/components/devis/DevisCalculateur";

export default async function NouveauDevisPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  const leadId = params.leadId;

  let lead = null;
  if (leadId) {
    lead = await prisma.lead.findUnique({ where: { id: leadId } });
  }

  const leads = await prisma.lead.findMany({
    where: { statut: { in: ["CONTACTE", "DEVIS_ENVOYE", "NOUVEAU"] } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Nouveau Devis</h1>
      <DevisCalculateur
        leads={JSON.parse(JSON.stringify(leads))}
        preselectedLeadId={lead?.id || null}
      />
    </div>
  );
}
