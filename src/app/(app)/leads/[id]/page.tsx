import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatEuros, formatDate, sourceLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { FileText, Download, Image as ImageIcon, Mail, Phone, MessageSquare } from "lucide-react";
import { StatusChanger, InteractionForm } from "@/components/leads/LeadActions";
import LeadEditor from "@/components/leads/LeadEditor";
import LeadFunnel from "@/components/leads/LeadFunnel";
import Breadcrumb from "@/components/ui/breadcrumb";
import { buildGmailComposeUrl, emailRelanceDevisTemplate } from "@/lib/gmail";

const CHANTIER_STATUT_STYLES: Record<string, string> = {
  COMMANDE_PASSEE: "bg-amber-50 text-amber-600 border-amber-200",
  MATIERE_RECUE: "bg-blue-50 text-blue-600 border-blue-200",
  EN_COURS: "bg-orange-50 text-orange-600 border-orange-200",
  TERMINE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FACTURE: "bg-purple-50 text-purple-600 border-purple-200",
};

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

  const devisDemande =
    lead.source === "SITE_DEVIS" ||
    lead.statut === "DEVIS_DEMANDE" ||
    lead.simulations.some((s) => s.source === "SITE_DEVIS");
  const aSimule = lead.simulations.length > 0 || lead.source === "SITE_SIMULATEUR";
  const soldeRecu = lead.chantier?.soldeRecu ?? false;

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Leads", href: "/leads" }, { label: `${lead.prenom} ${lead.nom}` }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">
            {lead.prenom} {lead.nom}
          </h1>
          <p className="text-gray-400 mt-0.5 text-[14px]">
            {lead.ville}
            {lead.codePostal ? ` (${lead.codePostal})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChanger leadId={lead.id} currentStatut={lead.statut} />
          {devisDemande ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-[#CC0000] text-[11px] font-semibold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-[#CC0000] animate-pulse" />
              Devis demande
            </span>
          ) : aSimule ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-600 text-[11px] font-semibold uppercase tracking-wider">
              Simulation seule
            </span>
          ) : null}
        </div>
      </div>

      {/* Tunnel progression */}
      <div className="glass-card p-5">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Parcours client</p>
        <LeadFunnel statut={lead.statut} soldeRecu={soldeRecu} size="md" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Informations (editable + suppression) */}
          <LeadEditor lead={lead} />

          {/* Source */}
          <div className="text-[12px] text-gray-400 flex items-center gap-2">
            <span>Source :</span>
            <span className="text-[11px] font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
              {sourceLabel(lead.source)}
            </span>
          </div>

          {/* Simulations */}
          {lead.simulations.length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-gray-400" />
                <h2 className="text-[14px] font-semibold text-gray-900">
                  Simulations ({lead.simulations.length})
                </h2>
              </div>
              <div className="p-5 space-y-4">
                {lead.simulations.map((s) => (
                  <div key={s.id} className="p-3 rounded-xl bg-gray-50 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] text-gray-900 font-medium">
                            {s.referenceChoisie || "Simulation cuisine"}
                          </p>
                          {s.source === "SITE_DEVIS" ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-[#CC0000]">
                              Devis demande
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600">
                              Simulation
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {formatDate(s.createdAt)}
                          {s.prixDevis ? ` — ${formatEuros(s.prixDevis)}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Link
                          href={`/devis/nouveau?leadId=${lead.id}${s.referenceChoisie ? `&reference=${encodeURIComponent(s.referenceChoisie)}` : ""}${s.mlEstimes ? `&ml=${s.mlEstimes}` : ""}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#CC0000] text-white text-[12px] font-semibold hover:bg-[#AA0000] transition-colors"
                        >
                          <FileText className="h-3 w-3" /> Creer devis
                        </Link>
                        <a
                          href={`/api/simulations/${s.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-[12px] font-medium hover:bg-gray-100 transition-colors"
                        >
                          <Download className="h-3 w-3" /> PDF
                        </a>
                      </div>
                    </div>
                    {(s.imageBeforePath || s.imageAfterPath) && (
                      <div className="grid grid-cols-2 gap-2">
                        {s.imageBeforePath && (
                          <div>
                            <p className="text-[11px] text-gray-400 mb-1">Avant</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/uploads/${s.imageBeforePath}`}
                              alt="Avant"
                              className="w-full h-40 object-cover rounded-lg border border-gray-200"
                            />
                          </div>
                        )}
                        {s.imageAfterPath && (
                          <div>
                            <p className="text-[11px] text-gray-400 mb-1">Apres</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/uploads/${s.imageAfterPath}`}
                              alt="Apres"
                              className="w-full h-40 object-cover rounded-lg border border-gray-200"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-[14px] font-semibold text-gray-900">Historique</h2>
            </div>
            <div className="p-5">
              {lead.interactions.length === 0 ? (
                <p className="text-gray-400 text-[13px]">Aucune interaction</p>
              ) : (
                <div className="space-y-3">
                  {lead.interactions.map((i) => (
                    <div key={i.id} className="flex gap-3 p-3 rounded-xl bg-gray-50">
                      <span className="text-[10px] font-medium text-gray-600 bg-white border border-gray-200 px-2 py-0.5 rounded-full h-fit">
                        {i.type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-gray-900">{i.contenu}</p>
                        <p className="text-[11px] text-gray-400 mt-1">
                          {formatDate(i.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Interaction Form */}
          <InteractionForm leadId={lead.id} />

          {/* Actions rapides */}
          <div className="glass-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Actions rapides</p>
            <div className="space-y-2">
              <Link
                href={`/devis/nouveau?leadId=${lead.id}`}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-[#CC0000] text-white text-[13px] font-semibold hover:bg-[#AA0000] transition-colors"
              >
                <FileText className="h-4 w-4" /> Creer un devis
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
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-[13px] font-medium hover:bg-gray-50 transition-colors"
                >
                  <Mail className="h-4 w-4" /> Email Gmail
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
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-[13px] font-medium hover:bg-gray-50 transition-colors"
                >
                  <Mail className="h-4 w-4" /> Relancer devis
                </a>
              )}
              {lead.telephone && (
                <a
                  href={`tel:${lead.telephone}`}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-[13px] font-medium hover:bg-gray-50 transition-colors"
                >
                  <Phone className="h-4 w-4" /> {lead.telephone}
                </a>
              )}
              {lead.telephone && (
                <a
                  href={`sms:${lead.telephone}`}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-[13px] font-medium hover:bg-gray-50 transition-colors"
                >
                  <MessageSquare className="h-4 w-4" /> SMS
                </a>
              )}
            </div>
          </div>

          {/* Devis list */}
          {lead.devis.length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-[14px] font-semibold text-gray-900">Devis</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {lead.devis.map((d) => (
                  <Link
                    key={d.id}
                    href={`/devis/${d.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/80 transition-colors"
                  >
                    <p className="text-gray-900 text-[13px] font-mono">{d.numero}</p>
                    <p className="text-[#CC0000] text-[13px] font-semibold">{formatEuros(d.prixVente)}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Chantier */}
          {lead.chantier && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-[14px] font-semibold text-gray-900">Chantier</h2>
              </div>
              <Link
                href="/chantiers"
                className="block px-5 py-3 hover:bg-gray-50/80 transition-colors"
              >
                <p className="text-gray-900 text-[13px] font-medium">{lead.chantier.adresse}</p>
                <p className="text-gray-400 text-[12px] mt-0.5">
                  {formatDate(lead.chantier.dateIntervention)}
                </p>
                <Badge className={`mt-2 text-[10px] font-medium px-2 py-0.5 rounded-full border ${CHANTIER_STATUT_STYLES[lead.chantier.statut] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
                  {lead.chantier.statut.replace(/_/g, " ")}
                </Badge>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
