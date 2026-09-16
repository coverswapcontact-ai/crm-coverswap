"use client";

import { useEffect, useId, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { CLASSE_SAISIE, Pastille, TRANS } from "@/components/pilotage/ui";
import { formaterSiret } from "@/lib/clients/normalisation";
import type { EntrepriseAnnuaire } from "@/lib/clients/types";
import { cn } from "@/lib/utils";

/**
 * Recherche dans l'annuaire public des entreprises (Insee) : un clic remplit
 * raison sociale, SIRET et adresse. Rien n'est enregistré avant la fiche.
 */
export function RechercheAnnuaire({ onChoisir }: { onChoisir: (entreprise: EntrepriseAnnuaire) => void }) {
  const id = useId();
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<EntrepriseAnnuaire[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [choisie, setChoisie] = useState<string | null>(null);

  const cherchable = terme.trim().length >= 3;

  useEffect(() => {
    if (!cherchable) return;
    let actif = true;
    const minuterie = window.setTimeout(() => {
      setEnCours(true);
      appelApi<{ resultats: EntrepriseAnnuaire[] }>(`/api/clients/annuaire?q=${encodeURIComponent(terme.trim())}`)
        .then((reponse) => {
          if (!actif) return;
          setResultats(reponse.resultats);
          setErreur(null);
        })
        .catch((probleme: unknown) => {
          if (!actif) return;
          setResultats(null);
          setErreur(messageErreur(probleme));
        })
        .finally(() => {
          if (actif) setEnCours(false);
        });
    }, 400);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [terme, cherchable]);

  function saisir(valeur: string) {
    setTerme(valeur);
    if (valeur.trim().length < 3) {
      setResultats(null);
      setErreur(null);
      setEnCours(false);
    }
  }

  function choisir(entreprise: EntrepriseAnnuaire) {
    onChoisir(entreprise);
    setChoisie(entreprise.raisonSociale ?? (entreprise.siret ? formaterSiret(entreprise.siret) : entreprise.siren));
    saisir("");
  }

  return (
    <div className="rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3">
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]">
        Chercher dans l&apos;annuaire des entreprises
      </label>
      <div className="relative">
        <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
        <input
          id={id}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={terme}
          maxLength={120}
          placeholder="Nom de l'entreprise, SIREN ou SIRET"
          onChange={(evenement) => saisir(evenement.target.value)}
          className={cn(CLASSE_SAISIE, "h-10 pr-9 pl-8 sm:h-9")}
        />
        {enCours ? <Loader2 size={14} aria-label="Recherche en cours" className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-[#6B7280]" /> : null}
      </div>

      {erreur ? <p className="mt-1.5 text-[12px] text-[#F87171]">{erreur}</p> : null}

      {cherchable && resultats ? (
        resultats.length === 0 ? (
          <p className="mt-2 text-[12px] text-[#9CA3AF]">Aucune entreprise trouvée : essaie le SIRET, ou remplis la fiche à la main.</p>
        ) : (
          <ul aria-label="Entreprises trouvées" className="mt-2 max-h-72 overflow-y-auto rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
            {resultats.map((entreprise) => (
              <li key={entreprise.siret ?? entreprise.siren} className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
                <button
                  type="button"
                  onClick={() => choisir(entreprise)}
                  className={cn("flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-[#22262D] focus-visible:bg-[#22262D] focus-visible:outline-none", TRANS)}
                >
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-medium text-[#F2F3F5]">
                    <span>{entreprise.raisonSociale ?? "Identité non diffusible"}</span>
                    {entreprise.siege ? <Pastille>Siège</Pastille> : null}
                    {entreprise.ferme ? <Pastille ton="ambre">Fermé</Pastille> : null}
                  </span>
                  {entreprise.enseigne ? <span className="text-[12px] text-[#D1D5DB]">{entreprise.enseigne}</span> : null}
                  <span className="text-[12px] text-[#9CA3AF]">
                    {[entreprise.adresse, [entreprise.codePostal, entreprise.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Adresse non diffusible"}
                  </span>
                  <span className="text-[11.5px] text-[#6B7280] tabular-nums">
                    {entreprise.siret ? `SIRET ${formaterSiret(entreprise.siret)}` : `SIREN ${entreprise.siren}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : choisie ? (
        <p className="mt-1.5 flex items-center gap-1 text-[12px] text-[#5DCAA5]">
          <Check size={12} aria-hidden className="shrink-0" />
          <span>Rempli avec {choisie} : vérifie l&apos;adresse de facturation.</span>
        </p>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-[#6B7280]">Annuaire public de l&apos;État (Insee) : un clic remplit raison sociale, SIRET et adresse.</p>
      )}
    </div>
  );
}
