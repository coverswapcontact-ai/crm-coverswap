import prisma from "@/lib/prisma";
import Link from "next/link";
import { Phone, Mail, MapPin, CheckCircle2 } from "lucide-react";
import LeadFunnel from "@/components/leads/LeadFunnel";
import { formatEuros, sourceLabel } from "@/lib/utils";

/**
 * /clients — Section dediee aux clients finalises.
 * Critere : chantier existe ET soldeRecu = true (facture finale payee).
 * Affiche le tunnel complet pour visualiser le parcours entier.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const limit = 20;
  const search = params.search || "";

  const andClauses: Record<string, unknown>[] = [
    { chantier: { is: { soldeRecu: true } } },
  ];
  if (search) {
    andClauses.push({
      OR: [
        { nom: { contains: search } },
        { prenom: { contains: search } },
        { ville: { contains: search } },
        { email: { contains: search } },
        { telephone: { contains: search } },
      ],
    });
  }
  const where = { AND: andClauses };

  const [clientsRaw, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        chantier: {
          select: {
            soldeRecu: true,
            statut: true,
            dateIntervention: true,
            updatedAt: true,
          },
        },
        devis: {
          where: { statut: "SIGNE" },
          select: { prixVente: true, reference: true, nomReference: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Stats agregees
  const caTotal = clientsRaw.reduce((sum, c) => sum + (c.devis[0]?.prixVente || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[24px] font-bold text-gray-900">Clients</h1>
          <p className="text-gray-400 mt-0.5 text-[14px]">
            {total} client{total > 1 ? "s" : ""} finalise{total > 1 ? "s" : ""} · CA cumule{" "}
            <span className="text-gray-700 font-semibold">{formatEuros(caTotal)}</span>
          </p>
        </div>
      </div>

      {/* Liste des clients finalises */}
      <div className="glass-card overflow-hidden">
        {clientsRaw.length === 0 ? (
          <div className="text-center text-gray-400 py-16 text-[14px]">
            Aucun client finalise pour le moment.
            <p className="text-[12px] text-gray-300 mt-1">
              Les leads apparaitront ici apres encaissement de la facture finale.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {clientsRaw.map((c) => {
              const devisSigne = c.devis[0];
              const dateFin = c.chantier?.updatedAt;
              return (
                <Link
                  key={c.id}
                  href={`/leads/${c.id}`}
                  className="block px-5 py-4 hover:bg-gray-50/80 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[14px] font-semibold text-gray-900 truncate">
                            {c.prenom} {c.nom}
                          </p>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Paye
                          </span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            {sourceLabel(c.source)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[12px] text-gray-400 mt-0.5 flex-wrap">
                          {c.ville && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {c.ville}
                            </span>
                          )}
                          {c.telephone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {c.telephone}
                            </span>
                          )}
                          {c.email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="w-3 h-3" /> {c.email}
                            </span>
                          )}
                          {dateFin && (
                            <span className="text-gray-400">
                              Finalise le {new Date(dateFin).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {devisSigne?.prixVente ? (
                        <p className="text-[15px] font-bold text-[#CC0000]">
                          {formatEuros(devisSigne.prixVente)}
                        </p>
                      ) : null}
                      {devisSigne?.nomReference && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {devisSigne.nomReference}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Tunnel complet */}
                  <div className="pl-13 ml-13">
                    <LeadFunnel
                      statut={c.statut}
                      soldeRecu={c.chantier?.soldeRecu ?? true}
                      size="md"
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-gray-400">
            {total} clients · Page {page}/{totalPages}
          </p>
          <div className="flex gap-1.5">
            {page > 1 && (
              <Link
                href={`/clients?page=${page - 1}${search ? `&search=${search}` : ""}`}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-[13px] hover:bg-gray-50"
              >
                Precedent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/clients?page=${page + 1}${search ? `&search=${search}` : ""}`}
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
