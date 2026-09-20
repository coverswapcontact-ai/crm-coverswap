"use client";

import { MessageSquarePlus, Search, UserRoundX } from "lucide-react";
import type { ConversationResume, FiltreConversations } from "@/lib/sms/conversations";
import { cn } from "@/lib/utils";
import { TRANS } from "@/components/pilotage/ui";

/** Heure si c'est aujourd'hui, « hier », le jour de la semaine, puis la date. */
export function quandCourt(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const maintenant = new Date();
  const jours = Math.floor((new Date(maintenant.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000);
  if (jours <= 0) return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (jours === 1) return "hier";
  if (jours < 7) return date.toLocaleDateString("fr-FR", { weekday: "short" });
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

const FILTRES: { valeur: FiltreConversations; libelle: string }[] = [
  { valeur: "TOUTES", libelle: "Toutes" },
  { valeur: "A_REPONDRE", libelle: "À répondre" },
  { valeur: "NON_LUES", libelle: "Non lues" },
  { valeur: "A_RATTACHER", libelle: "À rattacher" },
  { valeur: "ARCHIVEES", libelle: "Archivées" },
];

export function ListeConversations({
  conversations,
  compteurs,
  filtre,
  onFiltre,
  recherche,
  onRecherche,
  idOuvert,
  onOuvrir,
  onNouvelle,
  bandeau,
}: {
  conversations: ConversationResume[];
  compteurs: { nonLues: number; aRepondre: number; aRattacher: number };
  filtre: FiltreConversations;
  onFiltre: (filtre: FiltreConversations) => void;
  recherche: string;
  onRecherche: (texte: string) => void;
  idOuvert: string | null;
  onOuvrir: (id: string) => void;
  onNouvelle: () => void;
  bandeau?: React.ReactNode;
}) {
  const compteurDe = (valeur: FiltreConversations) => (valeur === "A_REPONDRE" ? compteurs.aRepondre : valeur === "NON_LUES" ? compteurs.nonLues : valeur === "A_RATTACHER" ? compteurs.aRattacher : 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 border-b-[0.5px] border-[#2A2D34] px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Rechercher une conversation</span>
            <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="search"
              inputMode="search"
              value={recherche}
              onChange={(evenement) => onRecherche(evenement.target.value)}
              placeholder="Nom, numéro ou mot d'un message"
              className="h-11 w-full rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] pr-3 pl-9 text-[16px] text-[#F2F3F5] placeholder:text-[#6B7280] focus:border-[#1D9E75]/60 focus:outline-none md:h-9 md:text-[13px]"
            />
          </label>
          <button
            type="button"
            onClick={onNouvelle}
            aria-label="Nouvelle conversation"
            className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#1D9E75] text-[#0B1612] hover:bg-[#5DCAA5] md:h-9 md:w-9", TRANS)}
          >
            <MessageSquarePlus size={18} aria-hidden />
          </button>
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTRES.map(({ valeur, libelle }) => {
            const nombre = compteurDe(valeur);
            return (
              <button
                key={valeur}
                type="button"
                onClick={() => onFiltre(valeur)}
                aria-pressed={filtre === valeur}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] px-3 text-[12.5px] font-medium whitespace-nowrap",
                  TRANS,
                  filtre === valeur ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#9CA3AF] hover:text-[#F2F3F5]"
                )}
              >
                {libelle}
                {nombre > 0 ? <span className="rounded-full bg-[#1D9E75] px-1.5 text-[10.5px] leading-[16px] font-semibold text-[#0B1612] tabular-nums">{nombre}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {bandeau}

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {conversations.length === 0 ? (
          <li className="px-6 py-12 text-center text-[13px] text-[#6B7280]">
            {recherche ? "Aucune conversation ne correspond." : filtre === "TOUTES" ? "Aucune conversation pour l'instant. Le bouton vert en ouvre une." : "Rien dans cette liste."}
          </li>
        ) : null}
        {conversations.map((c) => {
          const nonLue = c.nonLus > 0;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOuvrir(c.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b-[0.5px] border-[#2A2D34]/70 px-3.5 py-3 text-left",
                  TRANS,
                  idOuvert === c.id ? "bg-[#1D9E75]/10" : "hover:bg-[#1C1F25] active:bg-[#22262D]"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold",
                    c.aRattacher ? "bg-[#EF9F27]/15 text-[#F5B454]" : "bg-[#22262D] text-[#D1D5DB]"
                  )}
                >
                  {c.aRattacher ? <UserRoundX size={17} /> : (c.nom ?? "?").trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-[14.5px]", nonLue ? "font-semibold text-[#F2F3F5]" : "font-medium text-[#E5E7EB]")}>{c.nom ?? c.numeroLisible}</span>
                    <span className={cn("shrink-0 text-[11.5px] tabular-nums", nonLue ? "font-semibold text-[#5DCAA5]" : "text-[#6B7280]")}>{quandCourt(c.dernierMessageLe)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className={cn("truncate text-[13px]", nonLue ? "text-[#E5E7EB]" : "text-[#8B919C]")}>
                      {c.brouillon ? <span className="text-[#F5B454]">Brouillon : </span> : c.dernierSens === "SORTANT" ? <span className="text-[#6B7280]">Vous : </span> : null}
                      {c.brouillon ?? c.dernierExtrait ?? "Aucun message"}
                    </span>
                    {nonLue ? (
                      <span className="shrink-0 rounded-full bg-[#1D9E75] px-1.5 text-[11px] leading-[18px] font-semibold text-[#0B1612] tabular-nums">{c.nonLus}</span>
                    ) : null}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {c.stop ? <Marque ton="rouge">STOP</Marque> : null}
                    {c.aRattacher ? <Marque ton="ambre">Numéro inconnu</Marque> : null}
                    {!c.stop && c.attente === "MOI" ? <Marque ton="vert">À vous de répondre</Marque> : null}
                    {!c.stop && c.attente === "CLIENT" ? <Marque ton="neutre">Attend le client</Marque> : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Marque({ ton, children }: { ton: "vert" | "ambre" | "rouge" | "neutre"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-[1px] text-[10.5px] font-medium",
        ton === "vert" && "bg-[#1D9E75]/15 text-[#5DCAA5]",
        ton === "ambre" && "bg-[#EF9F27]/15 text-[#F5B454]",
        ton === "rouge" && "bg-[#EF4444]/15 text-[#F87171]",
        ton === "neutre" && "bg-[#22262D] text-[#8B919C]"
      )}
    >
      {children}
    </span>
  );
}
