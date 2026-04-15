import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import Sidebar from "@/components/layout/Sidebar";
import CommandCenter from "@/components/layout/CommandCenter";
import { ViewModeProvider } from "@/components/layout/ViewModeProvider";
import prisma from "@/lib/prisma";

// Toutes les pages CRM sont dynamiques (interrogent la DB à chaque requête)
export const dynamic = "force-dynamic";
export const revalidate = 0;

const getCachedCounts = unstable_cache(
  async () => {
    const [leadsCount, facturesCount] = await Promise.all([
      prisma.lead.count({ where: { statut: "NOUVEAU" } }),
      prisma.facture.count({ where: { statut: "ACOMPTE_EN_ATTENTE", acompteRecu: false } }),
    ]);
    return { leads: leadsCount, factures: facturesCount };
  },
  ["sidebar-counts"],
  { revalidate: 30 }
);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const counts = await getCachedCounts();
  return (
    <ViewModeProvider>
      <div className="flex min-h-screen bg-[#f5f5f7]">
        <Sidebar counts={counts} />
        <main className="flex-1 lg:pt-0 pt-14">
          <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
        <CommandCenter />
      </div>
    </ViewModeProvider>
  );
}
