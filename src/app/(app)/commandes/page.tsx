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
import { Package, Truck, CheckCircle, ShoppingCart } from "lucide-react";
import CommandeActions from "@/components/commandes/CommandeActions";

export default async function CommandesPage() {
  const [commandes, aCommander, commandees, enTransit, recues] = await Promise.all([
    prisma.commande.findMany({
      orderBy: { createdAt: "desc" },
      include: { chantier: { include: { lead: true } } },
    }),
    prisma.commande.count({ where: { statut: "A_COMMANDER" } }),
    prisma.commande.count({ where: { statut: "COMMANDEE" } }),
    prisma.commande.count({ where: { statut: "EN_TRANSIT" } }),
    prisma.commande.count({ where: { statut: "RECUE" } }),
  ]);

  const stats = [
    { label: "A Commander", value: aCommander, icon: ShoppingCart, color: "text-yellow-400" },
    { label: "Commandees", value: commandees, icon: Package, color: "text-blue-400" },
    { label: "En Transit", value: enTransit, icon: Truck, color: "text-purple-400" },
    { label: "Recues", value: recues, icon: CheckCircle, color: "text-green-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Commandes Fournisseur</h1>
        <p className="text-gray-400 mt-1">{commandes.length} commandes au total</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <TableHead className="text-gray-400">Reference</TableHead>
                <TableHead className="text-gray-400">Client</TableHead>
                <TableHead className="text-gray-400">Fournisseur</TableHead>
                <TableHead className="text-gray-400">ML</TableHead>
                <TableHead className="text-gray-400">Prix Matiere</TableHead>
                <TableHead className="text-gray-400">Date Commande</TableHead>
                <TableHead className="text-gray-400">Reception Estimee</TableHead>
                <TableHead className="text-gray-400">Statut</TableHead>
                <TableHead className="text-gray-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commandes.map((cmd) => (
                <TableRow key={cmd.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-white font-mono text-sm">
                    {cmd.reference}
                  </TableCell>
                  <TableCell className="text-white">
                    {cmd.chantier.lead.prenom} {cmd.chantier.lead.nom}
                  </TableCell>
                  <TableCell className="text-gray-300 text-sm">{cmd.fournisseur}</TableCell>
                  <TableCell className="text-gray-300">{cmd.quantiteML} ml</TableCell>
                  <TableCell className="text-red-400 font-bold">
                    {formatEuros(cmd.prixMatiere)}
                  </TableCell>
                  <TableCell className="text-gray-400 text-sm">
                    {cmd.dateCommande ? formatDate(cmd.dateCommande) : "-"}
                  </TableCell>
                  <TableCell className="text-gray-400 text-sm">
                    {cmd.dateReceptionEstimee ? formatDate(cmd.dateReceptionEstimee) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge className={statutColor(cmd.statut)}>
                      {cmd.statut.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <CommandeActions
                      commandeId={cmd.id}
                      statut={cmd.statut}
                      reference={cmd.reference}
                      quantiteML={cmd.quantiteML}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {commandes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                    Aucune commande
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
