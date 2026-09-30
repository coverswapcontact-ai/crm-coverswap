"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { CLASSE_SAISIE, TRANS } from "@/components/pilotage/ui";
import type { CreneauxLibres } from "@/lib/agenda/creneaux";
import { cn } from "@/lib/utils";

/**
 * Mission 17 (partie A) — « Fixer la date du chantier » : les jours libres des 10 prochains jours ouvrés (l'agenda
 * Google lu s'il est connecté, sinon tous les jours ouvrés, en le disant), ou une autre date. Un toucher pose la date
 * (`PATCH /api/dossiers/<id> { dateChantier }`) ; la tâche se coche seule (le CRM voit la date posée).
 */

type Reponse = CreneauxLibres & { dossier: { id: string; clientNom: string; dateChantier: string | null; dateSouhaitee: string | null } | null };

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const jourCourt = (jour: string) => {
  const [, m, j] = jour.split("-").map(Number);
  return `${j} ${MOIS[m - 1]}`;
};

function Contenu({ dossierId, onFini }: { dossierId: string; onFini: (pose: boolean) => void }) {
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [autre, setAutre] = useState("");
  const [pose, setPose] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    appelApi<Reponse>(`/api/a-faire/creneaux?dossierId=${encodeURIComponent(dossierId)}`)
      .then((lues) => actif && setDonnees(lues))
      .catch((probleme: unknown) => actif && setErreur(messageErreur(probleme)));
    return () => {
      actif = false;
    };
  }, [dossierId]);

  async function poser(jour: string, libelle: string) {
    setPose(jour);
    try {
      await envoyerJson(`/api/dossiers/${dossierId}`, "PATCH", { dateChantier: jour });
      toast.success(`Chantier fixé au ${libelle}`, { description: donnees?.dossier?.clientNom });
      onFini(true);
    } catch (probleme) {
      toast.error("Date non posée", { description: messageErreur(probleme) });
    } finally {
      setPose(null);
    }
  }

  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div className="border-b-[0.5px] border-[#2A2D34] px-4 pt-4 pb-3">
        <SheetTitle className="flex items-center gap-2 text-[15.5px] font-medium text-[#F2F3F5]">
          <CalendarDays size={16} aria-hidden className="text-[#5DCAA5]" /> Fixer la date du chantier
        </SheetTitle>
        <SheetDescription className="mt-0.5 text-[12.5px] text-[#9CA3AF]">
          {donnees?.dossier ? donnees.dossier.clientNom : "Les jours libres des deux prochaines semaines"}
          {donnees?.dossier?.dateSouhaitee ? ` · souhaitée : ${jourCourt(donnees.dossier.dateSouhaitee)}` : ""}
          {donnees?.dossier?.dateChantier ? ` · déjà posée : ${jourCourt(donnees.dossier.dateChantier)}` : ""}
        </SheetDescription>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {erreur ? <p className="text-[13px] text-[#F87171]">{erreur}</p> : null}
        {!donnees && !erreur ? <p className="text-[13px] text-[#8B919C]">Lecture de l&apos;agenda…</p> : null}
        {donnees ? (
          <>
            <p className="mb-2 text-[12px] text-[#8B919C]">
              {donnees.agenda
                ? donnees.occupes.length
                  ? `Agenda lu : ${donnees.occupes.length} ${donnees.occupes.length > 1 ? "jours occupés écartés" : "jour occupé écarté"}.`
                  : "Agenda lu : aucun jour occupé."
                : `Jours ouvrés proposés sans filtre (${donnees.message ?? "agenda non connecté"}).`}
            </p>
            {donnees.libres.length === 0 ? <p className="text-[13px] text-[#F5B454]">Aucun jour libre dans les deux prochaines semaines : choisis une autre date.</p> : null}
            <ul className="grid grid-cols-2 gap-2">
              {donnees.libres.map((j) => (
                <li key={j.jour}>
                  <button type="button" disabled={pose !== null} onClick={() => void poser(j.jour, j.libelle)} className={cn("flex min-h-12 w-full items-center justify-center rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-2 text-[14px] text-[#F2F3F5] first-letter:uppercase hover:border-[#1D9E75]/60 hover:bg-[#112B22] disabled:opacity-50 sm:min-h-10 sm:text-[13px]", pose === j.jour && "border-[#1D9E75]/60 bg-[#112B22]", TRANS)}>
                    {j.libelle}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(evenement) => {
                evenement.preventDefault();
                if (autre) void poser(autre, jourCourt(autre));
              }}
            >
              <input type="date" value={autre} onChange={(e) => setAutre(e.target.value)} aria-label="Une autre date" className={cn(CLASSE_SAISIE, "h-11 flex-1 sm:h-9")} />
              <button type="submit" disabled={!autre || pose !== null} className={cn("h-11 shrink-0 rounded-[10px] bg-[#1D9E75] px-4 text-[14px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#22262D] disabled:text-[#6B7280] sm:h-9 sm:text-[13px]", TRANS)}>
                Poser
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function FeuilleDateChantier({ dossierId, onFini }: { dossierId: string | null; onFini: (pose: boolean) => void }) {
  return (
    <Sheet open={dossierId !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFini(false))}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-0 rounded-t-[16px] border-[#2A2D34] bg-[#1C1F25] p-0 text-[#F2F3F5] sm:mx-auto sm:max-w-md">
        {dossierId ? <Contenu key={dossierId} dossierId={dossierId} onFini={onFini} /> : null}
      </SheetContent>
    </Sheet>
  );
}
