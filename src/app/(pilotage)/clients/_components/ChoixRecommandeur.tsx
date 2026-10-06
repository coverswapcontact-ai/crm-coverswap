"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { appelApi } from "@/components/pilotage/client";
import { Champ, TRANS } from "@/components/pilotage/ui";
import type { ClientResume } from "@/lib/clients/types";
import { cn } from "@/lib/utils";
import { pluriel } from "@/lib/commun/format";

export type Recommandeur = { id: string | null; nom: string | null; texte: string | null };

/**
 * Qui a recommandé ce client : une fiche existante (lien chiffrable), ou, à
 * défaut, un nom libre pour quelqu'un qui n'est pas client.
 */
export function ChoixRecommandeur({
  valeur,
  onChange,
  exclureId,
}: {
  valeur: Recommandeur;
  onChange: (valeur: Recommandeur) => void;
  exclureId?: string;
}) {
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<ClientResume[]>([]);

  useEffect(() => {
    if (recherche.trim().length < 2) return;
    let actif = true;
    const minuterie = window.setTimeout(() => {
      appelApi<{ clients: ClientResume[] }>(`/api/clients?recherche=${encodeURIComponent(recherche.trim())}&limite=6`)
        .then(({ clients }) => {
          if (actif) setResultats(clients.filter((client) => client.id !== exclureId));
        })
        .catch(() => {
          if (actif) setResultats([]);
        });
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [recherche, exclureId]);

  if (valeur.id) {
    return (
      <div>
        <p className="mb-1.5 text-[12px] font-medium text-texte-3">Recommandé par</p>
        <div className="flex h-10 items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-action/40 bg-action-fond/60 px-3 sm:h-9">
          <span className="truncate text-[13px] text-texte">{valeur.nom}</span>
          <button
            type="button"
            aria-label="Retirer le recommandeur"
            onClick={() => onChange({ id: null, nom: null, texte: null })}
            className={cn("flex h-11 sm:h-8 w-11 sm:w-8 items-center justify-center rounded-[6px] text-texte-3 hover:text-texte", TRANS)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  const listeVisible = recherche.trim().length >= 2 && resultats.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-texte-3" htmlFor="recherche-recommandeur">
          Recommandé par un client
        </label>
        <div className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-texte-3" />
          <input
            id="recherche-recommandeur"
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Chercher sa fiche…"
            className={cn(
              "h-11 w-full rounded-[8px] border-[0.5px] border-trait bg-fond pr-3 pl-8 text-[16px] text-texte placeholder:text-texte-3 sm:h-9 sm:text-[13px]",
              "hover:border-trait-2 focus:border-action/60 focus:outline-none",
              TRANS
            )}
          />
        </div>
        {listeVisible ? (
          <ul className="mt-1 overflow-hidden rounded-[8px] border-[0.5px] border-trait bg-fond">
            {resultats.map((client) => (
              <li key={client.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ id: client.id, nom: client.nom, texte: null });
                    setRecherche("");
                  }}
                  className={cn("flex min-h-11 sm:min-h-10 w-full flex-col items-start px-3 py-1.5 text-left hover:bg-surface-2", TRANS)}
                >
                  <span className="text-[13px] text-texte">{client.nom}</span>
                  <span className="text-[11.5px] text-texte-3">{[client.ville, `${pluriel(client.nbDossiers, "dossier")}`].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Champ
        libelle="Ou quelqu'un qui n'est pas client"
        placeholder="Nom, lien (voisin, architecte…)"
        maxLength={160}
        value={valeur.texte ?? ""}
        onChange={(evenement) => onChange({ id: null, nom: null, texte: evenement.target.value || null })}
      />
    </div>
  );
}
