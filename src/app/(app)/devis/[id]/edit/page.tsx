import prisma from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import DevisEditor from "@/components/devis/DevisEditor";
import BandeauLectureSeule from "@/components/devis/BandeauLectureSeule";

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
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <BandeauLectureSeule objet="devis" />
      <a
        href={`/api/pdf/devis/${devis.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
      >
        <Download className="h-4 w-4" /> Télécharger le PDF du devis {devis.numero}
      </a>
      <Link href="/devis" className="ml-3 text-[13px] text-gray-500 hover:text-gray-900">
        Retour aux devis
      </Link>
      {/* Consultation seule : tous les champs et boutons de l'éditeur sont désactivés. */}
      <fieldset disabled className="pointer-events-none opacity-70">
        <DevisEditor devis={JSON.parse(JSON.stringify(devis))} />
      </fieldset>
    </div>
  );
}
