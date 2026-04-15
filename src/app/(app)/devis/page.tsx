import prisma from "@/lib/prisma";
import { formatEuros, formatDate, statutColor } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { FileText, Plus, Eye } from "lucide-react";
import DevisActions from "@/components/devis/DevisActions";

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

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Devis</h1>
          <p className="text-gray-400 mt-1">{total} devis au total</p>
        </div>
        <Link href="/devis/nouveau">
          <Button className="bg-red-600 hover:bg-red-700 text-white">
            <Plus className="h-4 w-4 mr-2" /> Nouveau Devis
          </Button>
        </Link>
      </div>

      <Card className="bg-[#262626] border-white/10">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Numero</TableHead>
                <TableHead className="text-gray-400">Client</TableHead>
                <TableHead className="text-gray-400">Reference</TableHead>
                <TableHead className="text-gray-400">ML</TableHead>
                <TableHead className="text-gray-400">Prix Vente</TableHead>
                <TableHead className="text-gray-400">Marge</TableHead>
                <TableHead className="text-gray-400">Statut</TableHead>
                <TableHead className="text-gray-400">Date</TableHead>
                <TableHead className="text-gray-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devisList.map((devis) => (
                <TableRow key={devis.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-white font-mono text-sm">
                    {devis.numero}
                  </TableCell>
                  <TableCell className="text-white">
                    {devis.lead.prenom} {devis.lead.nom}
                  </TableCell>
                  <TableCell className="text-gray-300 font-mono text-sm">
                    {devis.reference}
                  </TableCell>
                  <TableCell className="text-gray-300">{devis.mlTotal} ml</TableCell>
                  <TableCell className="text-red-400 font-bold">
                    {formatEuros(devis.prixVente)}
                  </TableCell>
                  <TableCell className="text-green-400">
                    {formatEuros(devis.margeNette)}
                  </TableCell>
                  <TableCell>
                    <Badge className={statutColor(devis.statut)}>
                      {devis.statut.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-400 text-sm">
                    {formatDate(devis.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Link href={`/leads/${devis.leadId}`}>
                        <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white h-8 w-8">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
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
              {devisList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                    Aucun devis
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link href={`/devis?page=${page - 1}${statut ? `&statut=${statut}` : ""}`}>
              <Button variant="outline" size="sm" className="border-white/20 text-gray-300">
                Precedent
              </Button>
            </Link>
          )}
          <span className="text-gray-400 text-sm flex items-center px-3">
            Page {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/devis?page=${page + 1}${statut ? `&statut=${statut}` : ""}`}>
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
