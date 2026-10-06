import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Journal } from "@/components/v2/journal/Journal";
import { depuisDeLaVisite, journal } from "@/lib/chronologie/journal";
import { interfaceCourante } from "@/lib/interface/choix";

export const metadata: Metadata = {
  title: "Journal — CoverSwap",
  description: "Ce qui s'est passé depuis la dernière visite : messages, gestes des clients, argent, propositions, système.",
};

export const dynamic = "force-dynamic";

const JOURS_MAX = 30;

/**
 * Mission 22 (A1) — `/journal` : la page « Depuis ta dernière visite », v2 seulement (la v1 n'a pas de journal
 * global : elle renvoie vers /taches). `?jours=7` lit une période fixe (sept derniers jours, 30 au plus) sans
 * « Tout vu » : c'est « Tout le journal ». Le lot A2 importe le même composant, en `compact`, dans Aujourd'hui.
 */
export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = await interfaceCourante();
  if (v !== "v2") redirect("/taches");
  const brut = (await searchParams).jours;
  const jours = Math.min(JOURS_MAX, Math.max(0, Math.trunc(Number(Array.isArray(brut) ? brut[0] : brut) || 0)));
  const maintenant = new Date();
  const visite = await depuisDeLaVisite(maintenant);
  const depuis = jours > 0 ? new Date(maintenant.getTime() - jours * 86_400_000) : visite.depuis;
  const r = await journal({ depuis, jusqua: maintenant, parPage: 200 });
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:py-6">
      <Journal initiale={{ ...r, vuLe: jours > 0 ? null : (visite.vuLe?.toISOString() ?? null) }} titre={jours > 0 ? `Les ${jours} derniers jours` : "Depuis ta dernière visite"} />
    </div>
  );
}
