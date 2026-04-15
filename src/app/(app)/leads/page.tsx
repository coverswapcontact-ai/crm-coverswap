import prisma from "@/lib/prisma";
import LeadsTable from "@/components/leads/LeadsTable";
import Link from "next/link";
import { Plus, Kanban } from "lucide-react";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const limit = 20;
  const search = params.search || "";
  const statut = params.statut || "";
  const source = params.source || "";

  const where: Record<string, unknown> = {};
  if (statut) where.statut = statut;
  if (source) where.source = source;
  if (search) {
    where.OR = [
      { nom: { contains: search } },
      { prenom: { contains: search } },
      { ville: { contains: search } },
      { email: { contains: search } },
      { telephone: { contains: search } },
    ];
  }

  const [leadsRaw, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        simulations: { select: { source: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  // Niveau d'intention : a-t-il demandé un devis (via sim ou directement) ?
  const leads = leadsRaw.map((l) => {
    const devisDemande =
      l.source === "SITE_DEVIS" ||
      l.statut === "DEVIS_DEMANDE" ||
      l.simulations.some((s) => s.source === "SITE_DEVIS");
    const aSimule = l.simulations.length > 0 || l.source === "SITE_SIMULATEUR";
    return { ...l, devisDemande, aSimule };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[24px] font-bold text-gray-900">Leads</h1>
          <p className="text-gray-400 mt-0.5 text-[14px]">{total} leads au total</p>
        </div>
        <div className="flex gap-2">
          <Link href="/leads/kanban">
            <button className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 text-[13px] font-medium transition-colors">
              <Kanban className="h-4 w-4" /> Kanban
            </button>
          </Link>
          <Link href="/leads/nouveau">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#CC0000] text-white text-[13px] font-semibold hover:bg-[#AA0000] transition-colors shadow-sm">
              <Plus className="h-4 w-4" /> Nouveau
            </button>
          </Link>
        </div>
      </div>
      <LeadsTable
        leads={JSON.parse(JSON.stringify(leads))}
        total={total}
        page={page}
        totalPages={Math.ceil(total / limit)}
      />
    </div>
  );
}
