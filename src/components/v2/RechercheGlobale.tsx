"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { Candidat } from "@/lib/assistant/recherche";
import { cn } from "@/lib/utils";
import { appelApi } from "@/components/pilotage/client";
import { TRANS_V2 } from "./transitions";

/**
 * Mission 22 — la recherche globale de la coque v2 : une personne, un dossier, un devis ou une facture, par nom,
 * téléphone, e-mail, adresse, ville ou numéro (`GET /api/recherche?q=`, la même fonction que l'outil `chercher`).
 * Ouverte par la loupe de la barre du haut, par ⌘K / Ctrl K (variante `loupe`, bureau), ou par le champ du menu
 * « Plus » sur téléphone (variante `champ`). Entrée ouvre le premier résultat (ou celui choisi aux flèches).
 */
const ATTENTE_MS = 200;

export function RechercheGlobale({ variante }: { variante: "loupe" | "champ" }) {
  const routeur = useRouter();
  const identifiant = useId();
  const champ = useRef<HTMLInputElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState("");
  const [resultats, setResultats] = useState<Candidat[]>([]);
  const [choisi, setChoisi] = useState(0);
  const [etat, setEtat] = useState<"repos" | "cherche" | "erreur">("repos");

  const fermer = useCallback(() => {
    setOuvert(false);
    setTexte("");
    setResultats([]);
    setChoisi(0);
    setEtat("repos");
  }, []);

  // ⌘K / Ctrl K : une seule instance l'écoute (celle de la barre du haut), pour n'ouvrir qu'une fenêtre.
  useEffect(() => {
    if (variante !== "loupe") return;
    const surTouche = (evenement: KeyboardEvent) => {
      if ((evenement.metaKey || evenement.ctrlKey) && evenement.key.toLowerCase() === "k") {
        evenement.preventDefault();
        setOuvert(true);
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [variante]);

  useEffect(() => {
    if (ouvert) champ.current?.focus();
  }, [ouvert]);

  // Sous deux caractères, la liste se vide à la frappe ; sinon la recherche part 200 ms après la dernière frappe.
  const surSaisie = (valeur: string) => {
    setTexte(valeur);
    if (valeur.trim().length < 2) {
      setResultats([]);
      setChoisi(0);
      setEtat("repos");
    }
  };

  // Une réponse dépassée (frappe suivante partie entre-temps) est ignorée.
  useEffect(() => {
    const q = texte.trim();
    if (q.length < 2) return;
    let valide = true;
    const minuterie = window.setTimeout(() => {
      setEtat("cherche");
      appelApi<{ resultats: Candidat[] }>(`/api/recherche?q=${encodeURIComponent(q)}`)
        .then(({ resultats: trouves }) => {
          if (!valide) return;
          setResultats(trouves);
          setChoisi(0);
          setEtat("repos");
        })
        .catch(() => {
          if (valide) setEtat("erreur");
        });
    }, ATTENTE_MS);
    return () => {
      valide = false;
      window.clearTimeout(minuterie);
    };
  }, [texte]);

  const q = texte.trim();

  const ouvrir = (candidat: Candidat | undefined) => {
    if (!candidat) return;
    fermer();
    routeur.push(candidat.chemin);
  };

  const surClavier = (evenement: React.KeyboardEvent<HTMLInputElement>) => {
    if (evenement.key === "Escape") fermer();
    else if (evenement.key === "ArrowDown") {
      evenement.preventDefault();
      setChoisi((n) => Math.min(n + 1, Math.max(resultats.length - 1, 0)));
    } else if (evenement.key === "ArrowUp") {
      evenement.preventDefault();
      setChoisi((n) => Math.max(n - 1, 0));
    } else if (evenement.key === "Enter") {
      evenement.preventDefault();
      if (resultats[choisi]) ouvrir(resultats[choisi]);
      else if (q.length >= 2) versPersonnes();
    }
  };

  // Mission 22 (A4) : la recherche mène aussi à Personnes, où la même recherche s'affiche en liste (`/leads?q=`).
  const versPersonnes = () => {
    const texte = q;
    fermer();
    routeur.push(`/leads?q=${encodeURIComponent(texte)}`);
  };

  const aide = etat === "erreur" ? "La recherche n'a pas répondu : réessaie." : etat === "cherche" ? "Recherche en cours…" : q.length >= 2 && resultats.length === 0 ? "Personne ne correspond." : q.length < 2 ? "Un nom, un téléphone, une ville, un numéro de devis ou de facture." : null;

  return (
    <>
      {variante === "loupe" ? (
        <button
          type="button"
          onClick={() => setOuvert(true)}
          aria-label="Rechercher (Ctrl K)"
          title="Rechercher (Ctrl K)"
          className={cn("flex h-11 w-11 items-center justify-center rounded-[10px] text-texte-3 hover:bg-surface hover:text-texte", TRANS_V2)}
        >
          <Search size={20} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className={cn("flex h-12 w-full items-center gap-3 rounded-[10px] border-[0.5px] border-trait bg-fond px-4 text-left text-corps-tel text-texte-3 hover:border-trait-2", TRANS_V2)}
        >
          <Search size={20} aria-hidden />
          Rechercher une personne, un dossier
        </button>
      )}

      {ouvert ? (
        <div className="fixed inset-0 z-50 bg-fond/80 p-4 pt-[max(1rem,env(safe-area-inset-top))] md:pt-[10vh]" onClick={fermer}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Recherche"
            className="mx-auto w-full max-w-[640px] rounded-[14px] border-[0.5px] border-trait bg-surface p-3"
            onClick={(evenement) => evenement.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <input
                ref={champ}
                type="search"
                value={texte}
                onChange={(evenement) => surSaisie(evenement.target.value)}
                onKeyDown={surClavier}
                placeholder="Nom, téléphone, ville, numéro de devis…"
                aria-label="Rechercher"
                aria-controls={`${identifiant}-resultats`}
                aria-activedescendant={resultats[choisi] ? `${identifiant}-${choisi}` : undefined}
                autoComplete="off"
                spellCheck={false}
                className={cn("h-12 min-w-0 flex-1 rounded-[10px] border-[0.5px] border-trait bg-fond px-4 text-corps-tel text-texte outline-none placeholder:text-texte-3 focus:border-action md:text-corps", TRANS_V2)}
              />
              <button type="button" onClick={fermer} aria-label="Fermer" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-texte-3 hover:bg-surface-2 hover:text-texte", TRANS_V2)}>
                <X size={20} aria-hidden />
              </button>
            </div>
            {aide ? <p className="px-2 pt-3 text-petit text-texte-3">{aide}</p> : null}
            {q.length >= 2 ? (
              <button type="button" onClick={versPersonnes} className={cn("mt-2 flex min-h-[44px] w-full items-center rounded-[10px] px-3 text-left text-corps text-action-clair hover:bg-surface-2", TRANS_V2)}>
                Tout chercher dans Personnes
              </button>
            ) : null}
            {resultats.length > 0 ? (
              <ul id={`${identifiant}-resultats`} role="listbox" className="mt-2 flex flex-col">
                {resultats.map((candidat, n) => (
                  <li key={`${candidat.type}-${candidat.id}`} id={`${identifiant}-${n}`} role="option" aria-selected={n === choisi}>
                    <button
                      type="button"
                      onClick={() => ouvrir(candidat)}
                      onMouseEnter={() => setChoisi(n)}
                      className={cn("flex min-h-[44px] w-full flex-col justify-center rounded-[10px] px-3 py-2 text-left", n === choisi ? "bg-surface-2 text-texte" : "text-texte-2 hover:bg-surface-2", TRANS_V2)}
                    >
                      <span className="text-corps-tel md:text-corps">{candidat.nom}</span>
                      <span className="text-petit text-texte-3">{[candidat.ville, candidat.etat].filter(Boolean).join(", ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
