import prisma from "@/lib/prisma";
import { formatEuros, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { CalendarDays, Hammer, CheckCircle, Clock, HardHat } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";

const STATUT_STYLES: Record<string, string> = {
  COMMANDE_PASSEE: "bg-amber-50 text-amber-600 border-amber-200",
  MATIERE_RECUE: "bg-blue-50 text-blue-600 border-blue-200",
  EN_COURS: "bg-orange-50 text-orange-600 border-orange-200",
  TERMINE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FACTURE: "bg-purple-50 text-purple-600 border-purple-200",
};

export default async function ChantiersPage() {
  const [chantiers, totalEnCours, totalTermine, totalPlanifie] = await Promise.all([
    prisma.chantier.findMany({
      orderBy: { dateIntervention: "asc" },
      include: { lead: true },
    }),
    prisma.chantier.count({ where: { statut: "EN_COURS" } }),
    prisma.chantier.count({ where: { statut: "TERMINE" } }),
    prisma.chantier.count({ where: { statut: { in: ["COMMANDE_PASSEE", "MATIERE_RECUE"] } } }),
  ]);

  const stats = [
    { label: "Planifies", value: totalPlanifie, icon: Clock, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "En cours", value: totalEnCours, icon: Hammer, color: "text-orange-500", bg: "bg-orange-50" },
    { label: "Termines", value: totalTermine, icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">Chantiers</h1>
          <p className="text-gray-400 mt-0.5 text-[14px]">{chantiers.length} chantier{chantiers.length > 1 ? "s" : ""} au total</p>
        </div>
        <Link href="/chantiers/calendrier">
          <button className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 text-[13px] font-medium transition-colors">
            <CalendarDays className="h-4 w-4" /> Calendrier
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] text-gray-400 font-medium">{s.label}</p>
                <p className="text-[22px] font-bold text-gray-900 mt-1">{s.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        {chantiers.length === 0 ? (
          <EmptyState
            icon={HardHat}
            title="Aucun chantier planifie"
            description="Les chantiers se creent automatiquement apres signature d'un devis."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Client</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Adresse</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Reference</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">ML</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Marge</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Intervention</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Acompte</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chantiers.map((c) => (
                  <TableRow key={c.id} className="border-gray-50 hover:bg-gray-50/60">
                    <TableCell className="text-gray-900 text-[13px] font-medium">
                      <Link href={`/leads/${c.leadId}`} className="hover:text-[#CC0000] transition">
                        {c.lead.prenom} {c.lead.nom}
                      </Link>
                    </TableCell>
                    <TableCell className="text-gray-500 text-[13px]">{c.adresse}</TableCell>
                    <TableCell className="text-gray-500 font-mono text-[12px]">
                      {c.reference}
                    </TableCell>
                    <TableCell className="text-gray-500 text-[13px] text-right">{c.mlCommandes} ml</TableCell>
                    <TableCell className="text-right text-emerald-600 font-semibold text-[13px]">
                      {formatEuros(c.margeNette)}
                    </TableCell>
                    <TableCell className="text-gray-500 text-[12px]">
                      {formatDate(c.dateIntervention)}
                    </TableCell>
                    <TableCell>
                      {c.acompteRecu ? (
                        <span className="text-[12px] font-medium text-emerald-600">Recu</span>
                      ) : (
                        <span className="text-[12px] font-medium text-amber-500">En attente</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUT_STYLES[c.statut] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
                        {c.statut.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
