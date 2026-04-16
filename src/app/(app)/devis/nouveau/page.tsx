import prisma from "@/lib/prisma";
import DevisCalculateur from "@/components/devis/DevisCalculateur";

export default async function NouveauDevisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const leadId = params.leadId;
  const prefillReference = params.reference || undefined;
  const prefillMl = params.ml ? parseFloat(params.ml) : undefined;
  const prefillObjet = params.objet || undefined;

  const leads = await prisma.lead.findMany({
    where: {
      statut: { notIn: ["PERDU", "TERMINE"] },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Nouveau Devis</h1>
      <DevisCalculateur
        leads={JSON.parse(JSON.stringify(leads))}
        preselectedLeadId={leadId || null}
        prefillReference={prefillReference}
        prefillMl={prefillMl}
        prefillObjet={prefillObjet}
      />
    </div>
  );
}
