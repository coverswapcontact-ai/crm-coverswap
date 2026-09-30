"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { CLASSE_SAISIE, TRANS } from "@/components/pilotage/ui";
import type { TacheVue } from "@/lib/a-faire/types";
import { jourLisible } from "@/lib/a-faire/affichage";
import { cn } from "@/lib/utils";

/**
 * Mission 17 (partie A) — « Ajouter une tâche » : un texte, une date facultative, un client facultatif (recherche
 * simple parmi les dossiers, les contacts et les fiches clients, par les routes de liste existantes). La tâche est à
 * moi : jamais cochée par le CRM, elle attend « Fait ». Avec une date à venir, elle attend dans « Plus tard » jusqu'à
 * ce jour-là (mission 17, partie A, relecture).
 */

type Cible = { genre: "dossier" | "lead" | "client"; id: string; nom: string; detail: string };

const GENRES: Record<Cible["genre"], string> = { dossier: "dossier", lead: "contact", client: "client" };

async function chercher(texte: string): Promise<Cible[]> {
  const q = encodeURIComponent(texte);
  const [dossiers, aAppeler, aRappeler, clients] = await Promise.all([
    appelApi<{ dossiers: { id: string; clientNom: string; clientVille: string; objet: string }[] }>(`/api/dossiers?vue=TOUS&q=${q}&parPage=5`).catch(() => ({ dossiers: [] })),
    appelApi<{ lignes: { id: string; nom: string; ville: string | null }[] }>(`/api/leads?vue=A_APPELER&q=${q}`).catch(() => ({ lignes: [] })),
    appelApi<{ lignes: { id: string; nom: string; ville: string | null }[] }>(`/api/leads?vue=A_RAPPELER&q=${q}`).catch(() => ({ lignes: [] })),
    appelApi<{ clients: { id: string; nom: string; ville: string | null }[] }>(`/api/clients?recherche=${q}&limite=4`).catch(() => ({ clients: [] })),
  ]);
  const resultats: Cible[] = [
    ...dossiers.dossiers.slice(0, 4).map((d) => ({ genre: "dossier" as const, id: d.id, nom: d.clientNom, detail: [d.objet, d.clientVille].filter(Boolean).join(" · ") })),
    ...[...aRappeler.lignes, ...aAppeler.lignes].slice(0, 4).map((l) => ({ genre: "lead" as const, id: l.id, nom: l.nom, detail: l.ville ?? "" })),
    ...clients.clients.slice(0, 3).map((c) => ({ genre: "client" as const, id: c.id, nom: c.nom, detail: c.ville ?? "" })),
  ];
  const vus = new Set<string>();
  return resultats.filter((r) => (vus.has(`${r.genre}:${r.id}`) ? false : (vus.add(`${r.genre}:${r.id}`), true)));
}

export function AjoutTache({ onAjoutee }: { onAjoutee: (tache: TacheVue) => void }) {
  const [titre, setTitre] = useState("");
  const [echeance, setEcheance] = useState("");
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<Cible[]>([]);
  const [cible, setCible] = useState<Cible | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const ouvert = titre.trim().length > 0;

  useEffect(() => {
    const texte = recherche.trim();
    let actif = true;
    const minuterie = window.setTimeout(() => {
      if (texte.length < 2) {
        setResultats([]);
        return;
      }
      void chercher(texte).then((lus) => actif && setResultats(lus));
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [recherche]);

  async function ajouter() {
    const texte = titre.trim();
    if (texte.length < 2 || envoi) return;
    setEnvoi(true);
    try {
      const { tache } = await envoyerJson<{ tache: TacheVue }>("/api/a-faire/ajouter", "POST", {
        titre: texte,
        echeance: echeance || null,
        ...(cible ? { [`${cible.genre}Id`]: cible.id } : {}),
      });
      // Une échéance à venir : la tâche attend dans « Plus tard » jusqu'à son jour (docs/TACHES.md § 4).
      const pourPlusTard = tache.statut === "PLUS_TARD" && tache.plusTardJusqua ? jourLisible(tache.plusTardJusqua, new Date()) : null;
      toast.success(pourPlusTard ? `Tâche ajoutée pour ${pourPlusTard}` : "Tâche ajoutée", { description: pourPlusTard ? `${tache.titre} · dans « Plus tard » d'ici là` : tache.titre });
      setTitre("");
      setEcheance("");
      setRecherche("");
      setCible(null);
      onAjoutee(tache);
    } catch (erreur) {
      toast.error("Tâche non ajoutée", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      className="mt-4"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        void ajouter();
      }}
    >
      <label className="relative block">
        <Plus size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
        <input value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={200} placeholder="Ajouter une tâche" aria-label="Ajouter une tâche" enterKeyHint="done" className={cn(CLASSE_SAISIE, "h-11 rounded-[10px] pl-9 pointer-fine:h-9")} />
      </label>
      {ouvert ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
          <input type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} aria-label="Pour quand (facultatif)" title="Pour quand (facultatif)" className={cn(CLASSE_SAISIE, "h-11 pointer-fine:h-9")} />
          <div className="relative min-w-0">
            {cible ? (
              <p className="flex h-11 items-center gap-2 rounded-[8px] border-[0.5px] border-[#1D9E75]/40 bg-[#112B22]/60 px-3 text-[14px] text-[#D1D5DB] pointer-fine:h-9 sm:text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  Pour {cible.nom} <span className="text-[#8B919C]">· {GENRES[cible.genre]}</span>
                </span>
                <button type="button" onClick={() => setCible(null)} aria-label="Retirer le client" className="-mr-2 flex h-11 w-11 items-center justify-center text-[#9CA3AF] pointer-fine:h-8 pointer-fine:w-8">
                  <X size={14} aria-hidden />
                </button>
              </p>
            ) : (
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Pour qui ? (facultatif)" aria-label="Client, contact ou dossier (facultatif)" className={cn(CLASSE_SAISIE, "h-11 pointer-fine:h-9")} />
            )}
            {!cible && resultats.length > 0 ? (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#22262D] p-1 shadow-lg shadow-black/40">
                {resultats.map((r) => (
                  <li key={`${r.genre}:${r.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setCible(r);
                        setRecherche("");
                        setResultats([]);
                      }}
                      className={cn("flex min-h-11 w-full flex-col justify-center rounded-[8px] px-2.5 py-1.5 text-left hover:bg-[#2A2F37] pointer-fine:min-h-9", TRANS)}
                    >
                      <span className="truncate text-[13.5px] text-[#F2F3F5]">
                        {r.nom} <span className="text-[12px] text-[#8B919C]">· {GENRES[r.genre]}</span>
                      </span>
                      {r.detail ? <span className="truncate text-[12px] text-[#8B919C]">{r.detail}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button type="submit" disabled={titre.trim().length < 2 || envoi} className={cn("h-11 rounded-[10px] bg-[#1D9E75] px-4 text-[14px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#22262D] disabled:text-[#6B7280] pointer-fine:h-9 sm:text-[13px]", TRANS)}>
            Ajouter
          </button>
        </div>
      ) : null}
    </form>
  );
}
