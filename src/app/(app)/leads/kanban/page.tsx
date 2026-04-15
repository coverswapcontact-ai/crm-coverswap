import prisma from "@/lib/prisma";
import KanbanBoard from "@/components/leads/KanbanBoard";

export default async function KanbanPage() {
  const leads = await prisma.lead.findMany({
    where: { statut: { notIn: ["TERMINE", "PERDU"] } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Pipeline Leads</h1>
      <KanbanBoard initialLeads={JSON.parse(JSON.stringify(leads))} />
    </div>
  );
}
