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
import { CalendarDays, Hammer, CheckCircle, Clock } from "lucide-react";

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
    { label: "Planifies", value: totalPlanifie, icon: Clock, color: "text-blue-400" },
    { label: "En Cours", value: totalEnCours, icon: Hammer, color: "text-orange-400" },
    { label: "Termines", value: totalTermine, icon: CheckCircle, color: "text-green-400" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Chantiers</h1>
          <p className="text-gray-400 mt-1">{chantiers.length} chantiers au total</p>
        </div>
        <Link href="/chantiers/calendrier">
          <Button variant="outline" className="border-white/20 text-gray-300 hover:text-white">
            <CalendarDays className="h-4 w-4 mr-2" /> Calendrier
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="bg-[#262626] border-white/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">{s.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{s.value}</p>
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
                <TableHead className="text-gray-400">Client</TableHead>
                <TableHead className="text-gray-400">Adresse</TableHead>
                <TableHead className="text-gray-400">Reference</TableHead>
                <TableHead className="text-gray-400">ML</TableHead>
                <TableHead className="text-gray-400">Marge</TableHead>
                <TableHead className="text-gray-400">Date Intervention</TableHead>
                <TableHead className="text-gray-400">Acompte</TableHead>
                <TableHead className="text-gray-400">Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chantiers.map((c) => (
                <TableRow key={c.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-white">
                    <Link href={`/leads/${c.leadId}`} className="hover:text-red-400 transition">
                      {c.lead.prenom} {c.lead.nom}
                    </Link>
                  </TableCell>
                  <TableCell className="text-gray-300 text-sm">{c.adresse}</TableCell>
                  <TableCell className="text-gray-300 font-mono text-sm">
                    {c.reference}
                  </TableCell>
                  <TableCell className="text-gray-300">{c.mlCommandes} ml</TableCell>
                  <TableCell className="text-green-400 font-bold">
                    {formatEuros(c.margeNette)}
                  </TableCell>
                  <TableCell className="text-gray-300 text-sm">
                    {formatDate(c.dateIntervention)}
                  </TableCell>
                  <TableCell>
                    {c.acompteRecu ? (
                      <span className="text-green-400 text-sm">Recu</span>
                    ) : (
                      <span className="text-yellow-400 text-sm">En attente</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={statutColor(c.statut)}>
                      {c.statut.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {chantiers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                    Aucun chantier
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
