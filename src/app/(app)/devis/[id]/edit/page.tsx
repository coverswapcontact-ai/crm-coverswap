import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import DevisEditor from "@/components/devis/DevisEditor";

export default async function EditDevisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const devis = await prisma.devis.findUnique({
    where: { id },
    include: { lead: true },
  });
  if (!devis) notFound();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <DevisEditor devis={JSON.parse(JSON.stringify(devis))} />
    </div>
  );
}
