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
import { Package, Truck, CheckCircle, ShoppingCart } from "lucide-react";
import CommandeActions from "@/components/commandes/CommandeActions";
import EmptyState from "@/components/ui/empty-state";

const STATUT_STYLES: Record<string, string> = {
  A_COMMANDER: "bg-amber-50 text-amber-600 border-amber-200",
  COMMANDEE: "bg-blue-50 text-blue-600 border-blue-200",
  EN_TRANSIT: "bg-purple-50 text-purple-600 border-purple-200",
  RECUE: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

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
    { label: "A commander", value: aCommander, icon: ShoppingCart, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "Commandees", value: commandees, icon: Package, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "En transit", value: enTransit, icon: Truck, color: "text-purple-500", bg: "bg-purple-50" },
    { label: "Recues", value: recues, icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-50" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">Commandes fournisseur</h1>
        <p className="text-gray-400 mt-0.5 text-[14px]">{commandes.length} commande{commandes.length > 1 ? "s" : ""} au total</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] text-gray-400 font-medium">{s.label}</p>
                <p className="text-[22px] font-bold text-gray-900 mt-0.5">{s.value}</p>
              </div>
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center shrink-0`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        {commandes.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Aucune commande fournisseur"
            description="Les commandes matiere se creent depuis un chantier apres signature du devis."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Reference</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Client</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Fournisseur</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">ML</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Prix matiere</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Date commande</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Reception estimee</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Statut</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commandes.map((cmd) => (
                  <TableRow key={cmd.id} className="border-gray-50 hover:bg-gray-50/60">
                    <TableCell className="text-gray-900 font-mono text-[12px]">{cmd.reference}</TableCell>
                    <TableCell className="text-gray-900 text-[13px] font-medium">
                      {cmd.chantier.lead.prenom} {cmd.chantier.lead.nom}
                    </TableCell>
                    <TableCell className="text-gray-500 text-[13px]">{cmd.fournisseur}</TableCell>
                    <TableCell className="text-gray-500 text-[13px] text-right">{cmd.quantiteML} ml</TableCell>
                    <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                      {formatEuros(cmd.prixMatiere)}
                    </TableCell>
                    <TableCell className="text-gray-400 text-[12px]">
                      {cmd.dateCommande ? formatDate(cmd.dateCommande) : "—"}
                    </TableCell>
                    <TableCell className="text-gray-400 text-[12px]">
                      {cmd.dateReceptionEstimee ? formatDate(cmd.dateReceptionEstimee) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUT_STYLES[cmd.statut] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
                        {cmd.statut.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <CommandeActions
                          commandeId={cmd.id}
                          statut={cmd.statut}
                          reference={cmd.reference}
                          quantiteML={cmd.quantiteML}
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
    </div>
  );
}
