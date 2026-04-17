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
import { FileText, Plus, Eye } from "lucide-react";
import DevisActions from "@/components/devis/DevisActions";
import EmptyState from "@/components/ui/empty-state";

const STATUT_STYLES: Record<string, string> = {
  BROUILLON: "bg-gray-50 text-gray-500 border-gray-200",
  ENVOYE: "bg-blue-50 text-blue-600 border-blue-200",
  SIGNE: "bg-green-50 text-green-600 border-green-200",
  REFUSE: "bg-red-50 text-red-500 border-red-200",
  EXPIRE: "bg-gray-50 text-gray-400 border-gray-200",
};

export default async function DevisPage({
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

  const [devisList, total] = await Promise.all([
    prisma.devis.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { lead: true },
    }),
    prisma.devis.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">Devis</h1>
          <p className="text-gray-400 mt-0.5 text-[14px]">{total} devis au total</p>
        </div>
        <Link href="/devis/nouveau">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#CC0000] text-white text-[13px] font-semibold hover:bg-[#AA0000] transition-colors shadow-sm">
            <Plus className="h-4 w-4" /> Nouveau devis
          </button>
        </Link>
      </div>

      <div className="glass-card overflow-hidden">
        {devisList.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Aucun devis pour le moment"
            description="Les devis creees apparaitront ici. Commencez par un nouveau devis pour un de vos leads."
            actionLabel="Creer un devis"
            actionHref="/devis/nouveau"
            tone="brand"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Numero</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Client</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Reference</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">ML</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Prix vente</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Marge</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Statut</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Date</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devisList.map((devis) => (
                  <TableRow key={devis.id} className="border-gray-50 hover:bg-gray-50/60">
                    <TableCell className="text-gray-900 font-mono text-[12px]">
                      {devis.numero}
                    </TableCell>
                    <TableCell className="text-gray-900 text-[13px] font-medium">
                      {devis.lead.prenom} {devis.lead.nom}
                    </TableCell>
                    <TableCell className="text-gray-500 font-mono text-[12px]">
                      {devis.reference}
                    </TableCell>
                    <TableCell className="text-gray-500 text-[13px] text-right">
                      {devis.mlTotal} ml
                    </TableCell>
                    <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                      {formatEuros(devis.prixVente)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600 font-medium text-[13px]">
                      {formatEuros(devis.margeNette)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUT_STYLES[devis.statut] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
                        {devis.statut.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-400 text-[12px]">
                      {formatDate(devis.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Link href={`/leads/${devis.leadId}`}>
                          <button className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                            <Eye className="h-4 w-4" />
                          </button>
                        </Link>
                        <DevisActions
                          devisId={devis.id}
                          statut={devis.statut}
                          leadEmail={devis.lead.email}
                          numero={devis.numero}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-gray-400">
            Page {page} / {totalPages}
          </p>
          <div className="flex gap-1.5">
            {page > 1 && (
              <Link
                href={`/devis?page=${page - 1}${statut ? `&statut=${statut}` : ""}`}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[13px] hover:bg-gray-50"
              >
                Precedent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/devis?page=${page + 1}${statut ? `&statut=${statut}` : ""}`}
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
