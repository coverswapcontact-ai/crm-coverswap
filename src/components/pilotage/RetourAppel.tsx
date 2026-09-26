"use client";

import { useEffect, useState } from "react";
import { PhoneIncoming } from "lucide-react";
import { toast } from "sonner";
import { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel, type SuiteAppel } from "@/lib/commercial/constantes";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
import { appelEnCours, finAppel, marquerAppelPropose, type AppelEnCours } from "./NotesAppel";
import { rafraichirCompteurs } from "./Navigation";
import { TRANS } from "./ui";

/**
 * Mission 13 (lot 4) — au retour dans l'application après un « Appeler »
 * (Leads, panneau du lead ou du dossier), une feuille en bas de l'écran :
 * « Comment ça s'est passé ? », quatre issues, une précision, Enregistrer.
 * Sans passer par le panneau. « Plus tard » ne repose pas la question pour cet
 * appel ; la note du contact reste ouverte comme avant.
 */

const DELAI_MIN_MS = 15_000;

function appelARaconter(): AppelEnCours | null {
  const appel = appelEnCours();
  if (!appel || appel.proposeLe) return null;
  return Date.now() - new Date(appel.le).getTime() >= DELAI_MIN_MS ? appel : null;
}

export function RetourAppel() {
  const [appel, setAppel] = useState<AppelEnCours | null>(null);
  const [issue, setIssue] = useState<IssueAppel | null>(null);
  const [note, setNote] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    const verifier = () => {
      if (document.visibilityState !== "visible") return;
      const candidat = appelARaconter();
      if (candidat) setAppel((actuel) => actuel ?? candidat);
    };
    document.addEventListener("visibilitychange", verifier);
    window.addEventListener("pageshow", verifier);
    window.addEventListener("focus", verifier);
    return () => {
      document.removeEventListener("visibilitychange", verifier);
      window.removeEventListener("pageshow", verifier);
      window.removeEventListener("focus", verifier);
    };
  }, []);

  if (!appel) return null;

  const fermer = () => {
    setAppel(null);
    setIssue(null);
    setNote("");
  };

  async function enregistrer() {
    if (!appel || !issue) return;
    setEnvoi(true);
    try {
      const { suite } = await envoyerJson<{ suite: SuiteAppel }>("/api/commercial/appels", "POST", {
        ...(appel.dossierId ? { dossierId: appel.dossierId } : { leadId: appel.leadId }),
        issue,
        note: note.trim(),
      });
      finAppel(appel.leadId);
      toast.success(suite.resume, { description: suite.messagePropose ? "Un mail est prêt à relire dans l'onglet Mail." : undefined });
      rafraichirCompteurs();
      fermer();
    } catch (erreur) {
      toast.error("Appel non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6" role="dialog" aria-label="Comment s'est passé l'appel ?">
      <div className="w-full max-w-md rounded-[16px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4 shadow-lg shadow-black/50">
        <p className="flex items-center gap-2 text-[15px] font-medium text-[#F2F3F5]">
          <PhoneIncoming size={16} aria-hidden className="text-[#5DCAA5]" />
          Comment ça s&apos;est passé{appel.nom ? ` avec ${appel.nom}` : ""} ?
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {ISSUES_APPEL.map((valeur) => (
            <button
              key={valeur}
              type="button"
              aria-pressed={issue === valeur}
              onClick={() => setIssue(valeur)}
              className={cn("min-h-[44px] rounded-[10px] border-[0.5px] px-3 text-[13.5px] font-medium", issue === valeur ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}
            >
              {LIBELLES_ISSUE[valeur]}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Précision (facultatif) : ce qu'il a dit, ce qu'il veut…"
          aria-label="Précision"
          rows={2}
          className="mt-2 w-full resize-none rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 py-2 text-[16px] text-[#F2F3F5] placeholder:text-[#6B7280] focus:border-[#1D9E75]/60 focus:outline-none sm:text-[14px]"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              marquerAppelPropose();
              fermer();
            }}
            className={cn("min-h-[44px] rounded-[10px] border-[0.5px] border-[#2A2D34] text-[14px] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}
          >
            Plus tard
          </button>
          <button
            type="button"
            disabled={!issue || envoi}
            onClick={() => void enregistrer()}
            className={cn("min-h-[44px] rounded-[10px] bg-[#1D9E75] text-[14px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#22262D] disabled:text-[#6B7280]", TRANS)}
          >
            {envoi ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
