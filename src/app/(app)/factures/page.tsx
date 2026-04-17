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
import { Eye, Receipt, CheckCircle, AlertCircle, Clock } from "lucide-react";
import FactureActions from "@/components/factures/FactureActions";
import EmptyState from "@/components/ui/empty-state";

const STATUT_STYLES: Record<string, string> = {
  ACOMPTE_EN_ATTENTE: "bg-amber-50 text-amber-600 border-amber-200",
  ACOMPTE_RECU: "bg-blue-50 text-blue-600 border-blue-200",
  SOLDEE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  IMPAYEE: "bg-red-50 text-red-600 border-red-200",
  ANNULEE: "bg-gray-50 text-gray-400 border-gray-200",
};

export default async function FacturesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const limit = 20;
  const statut = params.statut || "";

  const where: Record<string, unknown> = {};
  if (statut) where.statut = statut;

  const [factures, total, totalSoldee, totalImpayee, totalEnAttente] = await Promise.all([
    prisma.facture.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { devis: { include: { lead: true } } },
    }),
    prisma.facture.count({ where }),
    prisma.facture.aggregate({ where: { statut: "SOLDEE" }, _sum: { montantTotal: true } }),
    prisma.facture.aggregate({ where: { statut: "IMPAYEE" }, _sum: { montantTotal: true } }),
    prisma.facture.aggregate({
      where: { statut: { in: ["ACOMPTE_EN_ATTENTE", "ACOMPTE_RECU"] } },
      _sum: { montantTotal: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const stats = [
    {
      label: "Total solde",
      value: formatEuros(totalSoldee._sum.montantTotal || 0),
      icon: CheckCircle,
      color: "text-emerald-500",
      bg: "bg-emerald-50",
    },
    {
      label: "En attente",
      value: formatEuros(totalEnAttente._sum.montantTotal || 0),
      icon: Clock,
      color: "text-amber-500",
      bg: "bg-amber-50",
    },
    {
      label: "Impayes",
      value: formatEuros(totalImpayee._sum.montantTotal || 0),
      icon: AlertCircle,
      color: "text-red-500",
      bg: "bg-red-50",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">Factures</h1>
        <p className="text-gray-400 mt-0.5 text-[14px]">{total} facture{total > 1 ? "s" : ""} au total</p>
      </div>

      {/* Summary cards */}
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
        {factures.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Aucune facture emise"
            description="Les factures apparaissent apres signature d'un devis. Le CRM gere automatiquement acompte puis solde."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Numero</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Client</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Montant</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Acompte</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Solde</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Statut</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Date</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {factures.map((f) => (
                  <TableRow key={f.id} className="border-gray-50 hover:bg-gray-50/60">
                    <TableCell className="text-gray-900 font-mono text-[12px]">{f.numero}</TableCell>
                    <TableCell className="text-gray-900 text-[13px] font-medium">
                      {f.devis.lead.prenom} {f.devis.lead.nom}
                    </TableCell>
                    <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                      {formatEuros(f.montantTotal)}
                    </TableCell>
                    <TableCell>
                      {f.acompteRecu ? (
                        <span className="text-[12px] font-medium text-emerald-600">Recu</span>
                      ) : (
                        <span className="text-[12px] font-medium text-amber-500">En attente</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {f.soldeRecu ? (
                        <span className="text-[12px] font-medium text-emerald-600">Recu</span>
                      ) : (
                        <span className="text-[12px] font-medium text-amber-500">En attente</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUT_STYLES[f.statut] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
                        {f.statut.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-400 text-[12px]">
                      {formatDate(f.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Link href={`/leads/${f.devis.leadId}`}>
                          <button className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                            <Eye className="h-4 w-4" />
                          </button>
                        </Link>
                        <FactureActions
                          factureId={f.id}
                          statut={f.statut}
                          acompteRecu={f.acompteRecu}
                          soldeRecu={f.soldeRecu}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-gray-400">Page {page} / {totalPages}</p>
          <div className="flex gap-1.5">
            {page > 1 && (
              <Link
                href={`/factures?page=${page - 1}${statut ? `&statut=${statut}` : ""}`}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[13px] hover:bg-gray-50"
              >
                Precedent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/factures?page=${page + 1}${statut ? `&statut=${statut}` : ""}`}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[13px] hover:bg-gray-50"
              >
                Suivant
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
