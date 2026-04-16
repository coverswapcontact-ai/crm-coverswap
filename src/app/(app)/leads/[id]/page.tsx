import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatEuros, formatDate, statutColor, sourceLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, FileText, Download, Image as ImageIcon, Mail, Phone, MessageSquare } from "lucide-react";
import { StatusChanger, InteractionForm } from "@/components/leads/LeadActions";
import LeadEditor from "@/components/leads/LeadEditor";
import { buildGmailComposeUrl, emailRelanceDevisTemplate } from "@/lib/gmail";

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
      simulations: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!lead) notFound();

  // Niveau d'intention : simple simulation ou vraie demande de devis ?
  const devisDemande =
    lead.source === "SITE_DEVIS" ||
    lead.statut === "DEVIS_DEMANDE" ||
    lead.simulations.some((s) => s.source === "SITE_DEVIS");
  const aSimule = lead.simulations.length > 0 || lead.source === "SITE_SIMULATEUR";

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
        {devisDemande ? (
          <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/15 border border-red-500/40 text-red-400 text-xs font-semibold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Devis demandé — chaud
          </span>
        ) : aSimule ? (
          <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 text-xs font-semibold uppercase tracking-wider">
            Simulation seule — à relancer
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Informations (éditable + suppression) */}
          <LeadEditor lead={lead} />

          {/* Source */}
          <div className="text-xs text-gray-400 flex items-center gap-2">
            <span>Source :</span>
            <Badge variant="outline" className="border-white/20">
              {sourceLabel(lead.source)}
            </Badge>
          </div>

          {/* Simulations */}
          {lead.simulations.length > 0 && (
            <Card className="bg-[#262626] border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Simulations ({lead.simulations.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {lead.simulations.map((s) => (
                  <div key={s.id} className="p-3 rounded-lg bg-white/5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white font-medium">
                            {s.referenceChoisie || "Simulation cuisine"}
                          </p>
                          {s.source === "SITE_DEVIS" ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-red-400">
                              Devis demandé
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400">
                              Simulation
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatDate(s.createdAt)}
                          {s.prixDevis ? ` — ${formatEuros(s.prixDevis)}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          href={`/devis/nouveau?leadId=${lead.id}${s.referenceChoisie ? `&reference=${encodeURIComponent(s.referenceChoisie)}` : ""}${s.mlEstimes ? `&ml=${s.mlEstimes}` : ""}`}
                        >
                          <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
                            <FileText className="h-3 w-3 mr-1" />
                            Créer devis
                          </Button>
                        </Link>
                        <a
                          href={`/api/simulations/${s.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                            <Download className="h-3 w-3 mr-1" />
                            PDF
                          </Button>
                        </a>
                      </div>
                    </div>
                    {(s.imageBeforePath || s.imageAfterPath) && (
                      <div className="grid grid-cols-2 gap-2">
                        {s.imageBeforePath && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Avant</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/uploads/${s.imageBeforePath}`}
                              alt="Avant"
                              className="w-full h-40 object-cover rounded border border-white/10"
                            />
                          </div>
                        )}
                        {s.imageAfterPath && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Après</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/uploads/${s.imageAfterPath}`}
                              alt="Après"
                              className="w-full h-40 object-cover rounded border border-white/10"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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

          {/* Actions rapides — hub central */}
          <Card className="bg-[#262626] border-white/10">
            <CardHeader>
              <CardTitle className="text-white text-sm">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href={`/devis/nouveau?leadId=${lead.id}`} className="block">
                <Button className="w-full bg-red-600 hover:bg-red-700 justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  Créer un devis
                </Button>
              </Link>
              {lead.email && (
                <a
                  href={buildGmailComposeUrl({
                    to: lead.email,
                    subject: `CoverSwap — ${lead.prenom} ${lead.nom}`,
                    body: `Bonjour ${lead.prenom},\n\n`,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10 justify-start">
                    <Mail className="h-4 w-4 mr-2" />
                    Email Gmail
                  </Button>
                </a>
              )}
              {lead.devis.length > 0 && lead.email && (
                <a
                  href={buildGmailComposeUrl({
                    to: lead.email,
                    ...emailRelanceDevisTemplate({
                      prenomClient: lead.prenom,
                      numero: lead.devis[0].numero,
                    }),
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10 justify-start">
                    <Mail className="h-4 w-4 mr-2" />
                    Relancer devis
                  </Button>
                </a>
              )}
              {lead.telephone && (
                <a href={`tel:${lead.telephone}`} className="block">
                  <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10 justify-start">
                    <Phone className="h-4 w-4 mr-2" />
                    {lead.telephone}
                  </Button>
                </a>
              )}
              {lead.telephone && (
                <a href={`sms:${lead.telephone}`} className="block">
                  <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10 justify-start">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    SMS
                  </Button>
                </a>
              )}
            </CardContent>
          </Card>

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
