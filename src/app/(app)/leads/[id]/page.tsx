import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatEuros, formatDate, statutColor, sourceLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Phone, Mail, MapPin, FileText } from "lucide-react";
import { StatusChanger, InteractionForm } from "@/components/leads/LeadActions";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      interactions: { orderBy: { createdAt: "desc" } },
      devis: true,
      chantier: true,
    },
  });

  if (!lead) notFound();

  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/leads">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">
            {lead.prenom} {lead.nom}
          </h1>
          <p className="text-gray-400">
            {lead.ville}
            {lead.codePostal ? ` (${lead.codePostal})` : ""}
          </p>
        </div>
        <StatusChanger leadId={lead.id} currentStatut={lead.statut} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Informations */}
          <Card className="bg-[#262626] border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Informations</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Telephone</span>
                <p className="text-white flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {lead.telephone}
                </p>
              </div>
              {lead.email && (
                <div>
                  <span className="text-gray-400">Email</span>
                  <p className="text-white flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {lead.email}
                  </p>
                </div>
              )}
              <div>
                <span className="text-gray-400">Source</span>
                <p className="text-white">
                  <Badge variant="outline" className="border-white/20">
                    {sourceLabel(lead.source)}
                  </Badge>
                </p>
              </div>
              <div>
                <span className="text-gray-400">Type projet</span>
                <p className="text-white">{lead.typeProjet}</p>
              </div>
              {lead.referenceChoisie && (
                <div>
                  <span className="text-gray-400">Reference</span>
                  <p className="text-white font-mono">{lead.referenceChoisie}</p>
                </div>
              )}
              {lead.mlEstimes && (
                <div>
                  <span className="text-gray-400">ML estimes</span>
                  <p className="text-white">{lead.mlEstimes} ml</p>
                </div>
              )}
              {lead.prixDevis && (
                <div>
                  <span className="text-gray-400">Prix devis</span>
                  <p className="text-red-400 font-bold text-lg">
                    {formatEuros(lead.prixDevis)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="bg-[#262626] border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Historique</CardTitle>
            </CardHeader>
            <CardContent>
              {lead.interactions.length === 0 ? (
                <p className="text-gray-500 text-sm">Aucune interaction</p>
              ) : (
                <div className="space-y-3">
                  {lead.interactions.map((i) => (
                    <div key={i.id} className="flex gap-3 p-3 rounded-lg bg-white/5">
                      <Badge variant="outline" className="border-white/20 h-fit">
                        {i.type}
                      </Badge>
                      <div>
                        <p className="text-sm text-white">{i.contenu}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDate(i.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Score */}
          <Card className="bg-[#262626] border-white/10">
            <CardHeader>
              <CardTitle className="text-white text-center">Score</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="relative w-24 h-24">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#333"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth="8"
                    strokeDasharray={`${(lead.scoreSignature / 100) * 251.2} 251.2`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white">
                  {lead.scoreSignature}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-2">Score de signature</p>
            </CardContent>
          </Card>

          {/* Interaction Form */}
          <InteractionForm leadId={lead.id} />

          {/* Actions */}
          <div className="space-y-2">
            <Link href={`/devis/nouveau?leadId=${lead.id}`} className="block">
              <Button className="w-full bg-red-600 hover:bg-red-700">
                <FileText className="h-4 w-4 mr-2" />
                Creer un devis
              </Button>
            </Link>
          </div>

          {/* Devis list */}
          {lead.devis.length > 0 && (
            <Card className="bg-[#262626] border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-sm">Devis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {lead.devis.map((d) => (
                  <Link
                    key={d.id}
                    href={`/devis/${d.id}`}
                    className="block p-2 rounded bg-white/5 hover:bg-white/10"
                  >
                    <p className="text-white text-sm font-mono">{d.numero}</p>
                    <p className="text-red-400 text-sm">{formatEuros(d.prixVente)}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Chantier */}
          {lead.chantier && (
            <Card className="bg-[#262626] border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-sm">Chantier</CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/chantiers`}
                  className="block p-2 rounded bg-white/5 hover:bg-white/10"
                >
                  <p className="text-white text-sm">{lead.chantier.adresse}</p>
                  <p className="text-gray-400 text-xs">
                    {formatDate(lead.chantier.dateIntervention)}
                  </p>
                  <Badge className={`mt-1 ${statutColor(lead.chantier.statut)}`}>
                    {lead.chantier.statut.replace(/_/g, " ")}
                  </Badge>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
