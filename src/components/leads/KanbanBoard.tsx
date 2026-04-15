"use client";

import { useState } from "react";
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { formatEuros, statutColor, sourceLabel, LEAD_STATUTS } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";

interface Lead {
  id: string; nom: string; prenom: string; ville: string; source: string;
  statut: string; prixDevis: number | null; scoreSignature: number;
  referenceChoisie: string | null; createdAt: string;
}

function LeadCard({ lead, isDragging }: { lead: Lead; isDragging?: boolean }) {
  const daysSinceCreation = Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000);
  return (
    <div className={`p-3 rounded-lg bg-[#1a1a1a] border border-white/10 hover:border-white/20 transition ${isDragging ? "opacity-50 shadow-xl" : ""}`}>
      <Link href={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-white font-medium text-sm">{lead.prenom} {lead.nom}</p>
          {daysSinceCreation > 7 && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="Urgent" />}
        </div>
        <p className="text-gray-400 text-xs">{lead.ville}</p>
        {lead.prixDevis && <p className="text-red-400 font-bold text-sm mt-1">{formatEuros(lead.prixDevis)}</p>}
        <div className="flex items-center justify-between mt-2">
          <Badge variant="outline" className="border-white/20 text-gray-400 text-[10px]">{sourceLabel(lead.source)}</Badge>
          <div className="flex items-center gap-1">
            <div className="w-8 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 rounded-full" style={{ width: `${lead.scoreSignature}%` }} />
            </div>
            <span className="text-[10px] text-gray-500">{lead.scoreSignature}</span>
          </div>
        </div>
      </Link>
    </div>
  );
}

function DraggableCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LeadCard lead={lead} isDragging={isDragging} />
    </div>
  );
}

function DroppableColumn({ statut, leads }: { statut: string; leads: Lead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${statut}` });
  const totalCA = leads.reduce((s, l) => s + (l.prixDevis || 0), 0);

  return (
    <div className="flex-shrink-0 w-72">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Badge className={statutColor(statut) + " text-xs"}>{statut.replace(/_/g, " ")}</Badge>
          <span className="text-xs text-gray-500">{leads.length}</span>
        </div>
        {totalCA > 0 && <span className="text-xs text-gray-500">{formatEuros(totalCA)}</span>}
      </div>
      <div
        ref={setNodeRef}
        className={`space-y-2 min-h-[200px] p-2 rounded-lg transition-colors ${isOver ? "bg-red-500/10 border border-red-500/30" : "bg-white/5"}`}
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => <DraggableCard key={lead.id} lead={lead} />)}
        </SortableContext>
      </div>
    </div>
  );
}

export default function KanbanBoard({ initialLeads }: { initialLeads: Lead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    let targetStatut: string | null = null;

    // Check if dropped on a column
    if (overId.startsWith("column-")) {
      targetStatut = overId.replace("column-", "");
    } else {
      // Dropped on another card - find which column that card is in
      const targetLead = leads.find((l) => l.id === overId);
      if (targetLead) targetStatut = targetLead.statut;
    }

    if (!targetStatut) return;

    const leadId = String(active.id);
    const currentLead = leads.find((l) => l.id === leadId);
    if (!currentLead || currentLead.statut === targetStatut) return;

    // Optimistic update
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, statut: targetStatut! } : l));

    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut: targetStatut }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success(`${currentLead.prenom} ${currentLead.nom} → ${targetStatut.replace(/_/g, " ")}`);
    } catch {
      // Revert on error
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, statut: currentLead.statut } : l));
      toast.error("Erreur lors du changement de statut");
    }
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {LEAD_STATUTS.map((statut) => (
          <DroppableColumn key={statut} statut={statut} leads={leads.filter((l) => l.statut === statut)} />
        ))}
      </div>
      <DragOverlay>
        {activeLead && <LeadCard lead={activeLead} />}
      </DragOverlay>
    </DndContext>
  );
}
