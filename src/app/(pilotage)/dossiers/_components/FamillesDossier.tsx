"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { FAMILLES, famille, famillesDe, type IdFamille, type SelectionPrestations } from "@/lib/prestations/prestations";
import type { DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
import { TRANS, TitreSection } from "./ui";

/**
 * Les familles et sous-parties d'un dossier (fichier des prestations) : en
 * puces sur la carte du kanban et en tête du dossier ; modifiables ici par
 * Lucas — ce que le client coche dans son onglet Projet arrive au même endroit.
 */

/** Les familles en puces : « Cuisine 3 · Mobilier 1 » (le chiffre : sous-parties cochées). Rien : « Familles à préciser ». */
export function ChipsFamilles({ prestations, className, vide = true }: { prestations: SelectionPrestations; className?: string; vide?: boolean }) {
  const familles = famillesDe(prestations);
  if (familles.length === 0) return vide ? <span className={cn("block text-[12px] text-[#6B7280] italic", className)}>Familles à préciser</span> : null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {familles.map((id) => {
        const f = famille(id);
        const parties = (prestations[id] ?? []).map((sp) => f.sousParties.find((s) => s.id === sp)?.libelle).filter(Boolean);
        return (
          <span key={id} title={parties.length ? `${f.libelle} : ${parties.join(", ")}` : `${f.libelle} : sous-parties à préciser`} className="inline-flex items-center gap-1 rounded-full border-[0.5px] border-[#2F3B36] bg-[#15201C] px-2 py-0.5 text-[11.5px] text-[#9FD9C2]">
            {f.libelle}
            {parties.length ? <span className="text-[#5E8F7B] tabular-nums">{parties.length}</span> : null}
          </span>
        );
      })}
    </span>
  );
}

export function FamillesDossier({ detail, onEnregistre }: { detail: DossierDetail; onEnregistre?: () => void }) {
  const [selection, setSelection] = useState<SelectionPrestations>(detail.prestations ?? {});
  const [etat, setEtat] = useState<"" | "en-cours" | "ok">("");
  const minuterie = useRef<number | null>(null);
  const dernier = useRef(selection);

  async function enregistrer(valeur: SelectionPrestations) {
    setEtat("en-cours");
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/prestations`, "PATCH", { prestations: valeur });
      setEtat("ok");
      onEnregistre?.();
    } catch (erreur) {
      setEtat("");
      toast.error(messageErreur(erreur));
    }
  }

  function changer(suite: SelectionPrestations) {
    dernier.current = suite;
    setSelection(suite);
    if (minuterie.current) window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => {
      minuterie.current = null;
      void enregistrer(dernier.current);
    }, 700);
  }

  // Quitter le dossier avec un changement en attente : il part tout de suite.
  useEffect(
    () => () => {
      if (minuterie.current) {
        window.clearTimeout(minuterie.current);
        void envoyerJson(`/api/dossiers/${detail.id}/prestations`, "PATCH", { prestations: dernier.current }).catch(() => undefined);
      }
    },
    [detail.id]
  );

  useEffect(() => {
    if (etat !== "ok") return;
    const t = window.setTimeout(() => setEtat(""), 2200);
    return () => window.clearTimeout(t);
  }, [etat]);

  const basculerFamille = (id: IdFamille) => {
    const suite = { ...selection };
    if (id in suite) delete suite[id];
    else suite[id] = [];
    changer(suite);
  };
  const basculerPartie = (id: IdFamille, sp: string) => {
    const liste = selection[id] ?? [];
    changer({ ...selection, [id]: liste.includes(sp) ? liste.filter((x) => x !== sp) : [...liste, sp] });
  };

  return (
    <section aria-labelledby={`familles-${detail.id}`}>
      <TitreSection action={<span className="text-[11.5px] text-[#8B919C]" aria-live="polite">{etat === "en-cours" ? "Enregistrement…" : etat === "ok" ? "Enregistré" : "Le client coche les mêmes dans son espace"}</span>}>
        <span id={`familles-${detail.id}`}>Familles du projet</span>
      </TitreSection>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {FAMILLES.map((f) => {
          const cochee = f.id in selection;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={cochee}
              onClick={() => basculerFamille(f.id)}
              className={cn("flex min-h-11 sm:min-h-10 items-center justify-center gap-1.5 rounded-[10px] border-[0.5px] px-2 text-[13px] font-medium", cochee ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}
            >
              {cochee ? <Check size={13} aria-hidden /> : null}
              {f.libelle}
            </button>
          );
        })}
      </div>
      {famillesDe(selection).map((id) => {
        const f = famille(id);
        return (
          <div key={id} className="mt-3">
            <p className="text-[12px] font-medium text-[#9CA3AF]">{f.libelle}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {f.sousParties.map((sp) => {
                const cochee = (selection[id] ?? []).includes(sp.id);
                return (
                  <button
                    key={sp.id}
                    type="button"
                    role="checkbox"
                    aria-checked={cochee}
                    title={sp.aide}
                    onClick={() => basculerPartie(id, sp.id)}
                    className={cn("inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 rounded-full border-[0.5px] px-2.5 text-[12.5px]", cochee ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}
                  >
                    {cochee ? <Check size={12} aria-hidden /> : null}
                    {sp.libelle}
                    {cochee && detail.teintes?.[`${id}.${sp.id}`] ? <span className="text-[11px] text-[#9FD9C2]/80">· {detail.teintes[`${id}.${sp.id}`]}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {famillesDe(selection).length === 0 ? <p className="mt-2 text-[12.5px] text-[#8B919C]">Aucune famille encore : coche ce que le client veut rénover. Le devis prérempli, le simulateur et son espace suivent.</p> : null}
    </section>
  );
}
