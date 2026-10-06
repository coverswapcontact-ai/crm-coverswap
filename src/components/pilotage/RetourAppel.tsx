"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneForwarded } from "lucide-react";
import { toast } from "sonner";
import type { SuiteAppel } from "@/lib/commercial/constantes";
import type { LeadSuivant } from "@/lib/prospects/leads";
import { cn } from "@/lib/utils";
import { appelApi } from "./client";
import { rafraichirCompteurs, signalerAppelTermine, signalerLeadsModifies } from "./evenements";
import { FeuilleFinAppel } from "./FinAppel";
import { appelEnCours, finAppel, marquerAppelPropose, noterDebutAppel, type AppelEnCours } from "./NotesAppel";
import { ouvrirEcranSms } from "./sms/EcranSms";
import { TRANS } from "./ui";

/**
 * Mission 13 (lot 4) — au retour dans l'application après un « Appeler »
 * (Leads, panneau du lead ou du dossier, mode appels), une feuille en bas de
 * l'écran : « Comment ça s'est passé ? ». « Plus tard » ne repose pas la
 * question pour cet appel.
 *
 * Mission 14 (29/09/2026), partie 4 — la feuille (`FinAppel.tsx`) est la seule
 * façon de noter l'issue d'un appel ; elle s'ouvre aussi à la main
 * (`noterUnAppel` : « Noter l'appel », « Noter sans appeler »). Après
 * Enregistrer : l'écran SMS avec le SMS proposé (copier ou passer), puis le lead
 * suivant — une carte « Suivant : … » (rappel en retard, sinon jamais appelé)
 * avec « Appeler » et « Plus tard ». Un appel lancé depuis « Appels à la suite »
 * rend la main à la file (`appel:termine`) au lieu de cette carte. Toujours : les
 * compteurs et l'écran Leads (`leads:modifies`) se rechargent.
 */

const DELAI_MIN_MS = 15_000;
const EVENEMENT_NOTER = "appel:noter";

/** Ouverture à la main : le lead (ou « dossier:<id> »), son nom, son dossier ; `onEnregistre` après l'écriture (fiche à relire). */
export type DemandeNoterAppel = { leadId: string; nom?: string; dossierId?: string | null; depuisFile?: boolean; onEnregistre?: () => void };

type AppelANoter = AppelEnCours & { manuel?: boolean; onEnregistre?: () => void };

/** Ouvre la feuille de fin d'appel sans être passé par un appel (mode appels, panneau du lead). */
export function noterUnAppel(demande: DemandeNoterAppel): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<DemandeNoterAppel>(EVENEMENT_NOTER, { detail: demande }));
}

function appelARaconter(): AppelEnCours | null {
  const appel = appelEnCours();
  if (!appel || appel.proposeLe) return null;
  return Date.now() - new Date(appel.le).getTime() >= DELAI_MIN_MS ? appel : null;
}

const numeroComposable = (telephone: string) => telephone.replace(/[^\d+]/g, "");

/** « Suivant : Marie Durand · Lattes — rappel en retard », avec « Appeler » (la feuille reviendra au retour) et « Plus tard ». */
function CarteSuivant({ suivant, onFermer }: { suivant: LeadSuivant; onFermer: () => void }) {
  const numero = suivant.telephone ? numeroComposable(suivant.telephone) : "";
  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6" role="dialog" aria-label="Lead suivant">
      <div className="w-full max-w-md rounded-[16px] border-[0.5px] border-trait bg-surface p-4 shadow-lg shadow-black/50">
        <p className="flex items-center gap-2 text-[15px] font-medium text-texte">
          <PhoneForwarded size={16} aria-hidden className="shrink-0 text-action-clair" />
          <span className="min-w-0 truncate">
            Suivant : {suivant.nom}
            {suivant.ville ? ` · ${suivant.ville}` : ""}
          </span>
        </p>
        <p className={cn("mt-0.5 pl-6 text-[12.5px]", suivant.raison === "RETARD" ? "font-medium text-retard-texte" : "text-texte-3")}>{suivant.raison === "RETARD" ? "Rappel en retard" : "Jamais appelé"}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onFermer} className={cn("min-h-[44px] rounded-[10px] border-[0.5px] border-trait text-[14px] text-texte-2 hover:border-trait-2", TRANS)}>
            Plus tard
          </button>
          {numero ? (
            <a
              href={`tel:${numero}`}
              onClick={() => {
                noterDebutAppel(suivant.id, { nom: suivant.nom, dossierId: suivant.dossierId });
                onFermer();
              }}
              className={cn("flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-action text-[14px] font-semibold text-action-texte hover:bg-action-clair", TRANS)}
            >
              <Phone size={15} aria-hidden /> Appeler
            </a>
          ) : (
            <p className="flex min-h-[44px] items-center justify-center rounded-[10px] bg-surface-2 px-2 text-center text-[12.5px] text-attention-texte">Numéro illisible</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RetourAppel() {
  const [appel, setAppel] = useState<AppelANoter | null>(null);
  const [suivant, setSuivant] = useState<LeadSuivant | null>(null);

  useEffect(() => {
    const verifier = () => {
      if (document.visibilityState !== "visible") return;
      const candidat = appelARaconter();
      if (!candidat) return;
      setSuivant(null);
      setAppel((actuel) => actuel ?? candidat);
    };
    const aLaMain = (evenement: Event) => {
      const demande = (evenement as CustomEvent<DemandeNoterAppel>).detail;
      if (!demande?.leadId) return;
      setSuivant(null);
      setAppel({ ...demande, le: new Date().toISOString(), manuel: true });
    };
    document.addEventListener("visibilitychange", verifier);
    window.addEventListener("pageshow", verifier);
    window.addEventListener("focus", verifier);
    window.addEventListener(EVENEMENT_NOTER, aLaMain);
    return () => {
      document.removeEventListener("visibilitychange", verifier);
      window.removeEventListener("pageshow", verifier);
      window.removeEventListener("focus", verifier);
      window.removeEventListener(EVENEMENT_NOTER, aLaMain);
    };
  }, []);

  /** Après l'écran SMS : la file reprend la main (mode appels), sinon le lead suivant est proposé (rien si personne). */
  function terminer(fini: AppelANoter) {
    if (fini.depuisFile) {
      signalerAppelTermine(fini.leadId);
      return;
    }
    appelApi<{ suivant: LeadSuivant | null }>(`/api/leads/suivant?apres=${encodeURIComponent(fini.leadId)}`)
      .then(({ suivant: lu }) => setSuivant(lu))
      .catch(() => undefined);
  }

  function enregistre(fini: AppelANoter, suite: SuiteAppel) {
    finAppel(fini.leadId);
    rafraichirCompteurs();
    signalerLeadsModifies();
    fini.onEnregistre?.();
    toast.success(suite.resume);
    setAppel(null);
    if (suite.sms) ouvrirEcranSms({ proposition: suite.sms, onFini: () => terminer(fini) });
    else terminer(fini);
  }

  if (appel) {
    return (
      <FeuilleFinAppel
        key={`${appel.leadId}|${appel.le}`}
        appel={appel}
        onPlusTard={() => {
          if (!appel.manuel) marquerAppelPropose();
          setAppel(null);
        }}
        onEnregistre={(suite) => enregistre(appel, suite)}
      />
    );
  }
  return suivant ? <CarteSuivant suivant={suivant} onFermer={() => setSuivant(null)} /> : null;
}
