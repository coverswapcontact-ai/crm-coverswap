import prisma from "@/lib/prisma";
import { formatEuros, formatDate, statutColor } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { Eye, Euro, CheckCircle, AlertCircle, Clock } from "lucide-react";
import FactureActions from "@/components/factures/FactureActions";

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

  const totalPages = Math.ceil(total / limit);

  const stats = [
    {
      label: "Total Solde",
      value: formatEuros(totalSoldee._sum.montantTotal || 0),
      icon: CheckCircle,
      color: "text-green-400",
    },
    {
      label: "En Attente",
      value: formatEuros(totalEnAttente._sum.montantTotal || 0),
      icon: Clock,
      color: "text-yellow-400",
    },
    {
      label: "Impayes",
      value: formatEuros(totalImpayee._sum.montantTotal || 0),
      icon: AlertCircle,
      color: "text-red-400",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Factures</h1>
        <p className="text-gray-400 mt-1">{total} factures au total</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="bg-[#262626] border-white/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">{s.label}</p>
                  <p className="text-xl font-bold text-white mt-1">{s.value}</p>
                </div>
                <s.icon className={`h-6 w-6 ${s.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-[#262626] border-white/10">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Numero</TableHead>
                <TableHead className="text-gray-400">Client</TableHead>
                <TableHead className="text-gray-400">Montant</TableHead>
                <TableHead className="text-gray-400">Acompte</TableHead>
                <TableHead className="text-gray-400">Solde</TableHead>
                <TableHead className="text-gray-400">Statut</TableHead>
                <TableHead className="text-gray-400">Date</TableHead>
                <TableHead className="text-gray-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factures.map((f) => (
                <TableRow key={f.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-white font-mono text-sm">{f.numero}</TableCell>
                  <TableCell className="text-white">
                    {f.devis.lead.prenom} {f.devis.lead.nom}
                  </TableCell>
                  <TableCell className="text-red-400 font-bold">
                    {formatEuros(f.montantTotal)}
                  </TableCell>
                  <TableCell>
                    {f.acompteRecu ? (
                      <span className="text-green-400 text-sm">Recu</span>
                    ) : (
                      <span className="text-yellow-400 text-sm">En attente</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {f.soldeRecu ? (
                      <span className="text-green-400 text-sm">Recu</span>
                    ) : (
                      <span className="text-yellow-400 text-sm">En attente</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={statutColor(f.statut)}>
                      {f.statut.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-400 text-sm">
                    {formatDate(f.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Link href={`/leads/${f.devis.leadId}`}>
                        <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white h-8 w-8">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
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
              {factures.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                    Aucune facture
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link href={`/factures?page=${page - 1}${statut ? `&statut=${statut}` : ""}`}>
              <Button variant="outline" size="sm" className="border-white/20 text-gray-300">
                Precedent
              </Button>
            </Link>
          )}
          <span className="text-gray-400 text-sm flex items-center px-3">
            Page {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/factures?page=${page + 1}${statut ? `&statut=${statut}` : ""}`}>
              <Button variant="outline" size="sm" className="border-white/20 text-gray-300">
                Suivant
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
