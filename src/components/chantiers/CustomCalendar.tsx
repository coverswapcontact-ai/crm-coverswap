"use client";

import { useState } from "react";
import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameMonth, isSameDay, addMonths, subMonths, getDay } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { statutColor, formatEuros } from "@/lib/utils";

interface Chantier {
  id: string; dateIntervention: string; adresse: string; reference: string;
  mlCommandes: number; prixMatiere: number; margeNette: number;
  statut: string; acompteRecu: boolean; soldeRecu: boolean;
  lead: { id: string; nom: string; prenom: string; ville: string };
}

export default function CustomCalendar({ chantiers }: { chantiers: Chantier[] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selected, setSelected] = useState<Chantier | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);
  const paddingDays = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  return (
    <>
      <div className="bg-[#262626] border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="text-gray-400 hover:text-white">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-lg font-semibold text-white capitalize">
            {format(currentMonth, "MMMM yyyy", { locale: fr })}
          </h2>
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="text-gray-400 hover:text-white">
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((d) => (
            <div key={d} className="text-center text-xs text-gray-500 font-medium py-2">{d}</div>
          ))}
          {Array.from({ length: paddingDays }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map((day) => {
            const dayChantiers = chantiers.filter((c) => isSameDay(new Date(c.dateIntervention), day));
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()}
                className={`min-h-[80px] p-1.5 rounded-lg border transition cursor-pointer
                  ${isToday ? "border-red-500/50 bg-red-500/5" : "border-white/5 hover:border-white/20"}
                  ${!isSameMonth(day, currentMonth) ? "opacity-30" : ""}`}
              >
                <span className={`text-xs font-medium ${isToday ? "text-red-400" : "text-gray-400"}`}>
                  {format(day, "d")}
                </span>
                <div className="mt-1 space-y-1">
                  {dayChantiers.map((c) => (
                    <button key={c.id} onClick={() => setSelected(c)}
                      className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate ${statutColor(c.statut)}`}>
                      {c.lead.nom}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="bg-[#1a1a1a] border-white/10 text-white">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-white">{selected.lead.prenom} {selected.lead.nom}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="flex items-center gap-2 text-gray-400">
                  <MapPin className="h-4 w-4" />
                  <span className="text-sm">{selected.adresse}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-500">Référence</span><p className="font-mono text-white">{selected.reference}</p></div>
                  <div><span className="text-gray-500">ML</span><p className="text-white">{selected.mlCommandes} ml</p></div>
                  <div><span className="text-gray-500">Marge</span><p className="text-red-400 font-bold">{formatEuros(selected.margeNette)}</p></div>
                  <div><span className="text-gray-500">Statut</span><Badge className={statutColor(selected.statut)}>{selected.statut.replace(/_/g, " ")}</Badge></div>
                </div>
                <div className="border-t border-white/10 pt-4">
                  <h4 className="text-sm font-medium text-white mb-3">Checklist</h4>
                  <div className="space-y-2 text-sm">
                    {[
                      { label: "Acompte reçu", done: selected.acompteRecu },
                      { label: "Commande matière", done: selected.statut !== "COMMANDE_PASSEE" },
                      { label: "Matière reçue", done: ["MATIERE_RECUE", "EN_COURS", "TERMINE", "FACTURE"].includes(selected.statut) },
                      { label: "Chantier réalisé", done: ["TERMINE", "FACTURE"].includes(selected.statut) },
                      { label: "Solde encaissé", done: selected.soldeRecu },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded border ${item.done ? "bg-green-500 border-green-500" : "border-white/20"} flex items-center justify-center`}>
                          {item.done && <span className="text-white text-xs">✓</span>}
                        </div>
                        <span className={item.done ? "text-gray-300" : "text-gray-500"}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(selected.adresse)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="block"
                >
                  <Button className="w-full bg-red-600 hover:bg-red-700 text-white mt-4">
                    <MapPin className="h-4 w-4 mr-2" /> Ouvrir dans Maps
                  </Button>
                </a>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
