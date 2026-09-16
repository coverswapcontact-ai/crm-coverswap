import type { Metadata } from "next";
import { jourParis } from "@/lib/dossiers/dates";
import { dernierJourDuMois } from "@/lib/finances/periodes";
import { listerInstantanes } from "@/lib/synthese/instantanes";
import { lireSynthese } from "@/lib/synthese/requete";
import TableauSynthese from "./_components/TableauSynthese";

export const metadata: Metadata = {
  title: "Synthèse — CoverSwap",
  description: "Commercial, finances, clients, agent et qualité des données sur une période ; mois figés et alertes.",
};

export const dynamic = "force-dynamic";

export default async function SynthesePage() {
  const aujourdhui = jourParis(new Date());
  const annee = Number(aujourdhui.slice(0, 4));
  const mois = Number(aujourdhui.slice(5, 7));
  // Par défaut : le dernier mois complet.
  const precedent = mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 };
  const du = `${precedent.annee}-${String(precedent.mois).padStart(2, "0")}-01`;
  const au = dernierJourDuMois(precedent.annee, precedent.mois);
  const [initiale, instantanes] = await Promise.all([lireSynthese(du, au, false), listerInstantanes()]);
  return <TableauSynthese initiale={initiale} instantanes={instantanes} aujourdhui={aujourdhui} />;
}
