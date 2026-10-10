"use client";

import { useRef, useState } from "react";
import { Archive, MailOpen, Search } from "lucide-react";
import type { FiltreConversations, LigneConversation } from "@/lib/messagerie/vues";
import { cn } from "@/lib/utils";
import { TRANS } from "@/components/pilotage/ui";

/**
 * Mission 25 — la liste des conversations : une ligne par client (pastille d'initiales, nom, ligne « Situation »,
 * heure, point bleu si non lu, étiquette d'étape, badge « À envoyer »), filtres en haut, recherche par nom, ville ou
 * numéro. Glisser vers la gauche : archiver ; vers la droite : lu ou non lu.
 */

export const FILTRES: { cle: FiltreConversations; libelle: string }[] = [
  { cle: "TOUS", libelle: "Tous" },
  { cle: "NON_LUS", libelle: "Non lus" },
  { cle: "A_ENVOYER", libelle: "À envoyer" },
  { cle: "A_TOI", libelle: "À toi" },
  { cle: "ATTENTE_CLIENT", libelle: "En attente du client" },
  { cle: "ARCHIVES", libelle: "Archivés" },
];

export function heureCourte(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const jour = (x: Date) => x.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  if (jour(d) === jour(new Date())) return d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  if (jour(d) === jour(new Date(Date.now() - 86_400_000))) return "hier";
  return d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });
}

const SEUIL = 72;

function Ligne({ ligne, active, onOuvrir, onArchiver, onLu }: { ligne: LigneConversation; active: boolean; onOuvrir: () => void; onArchiver: () => void; onLu: () => void }) {
  const [dx, setDx] = useState(0);
  const depart = useRef<{ x: number; y: number } | null>(null);
  const glisse = useRef(false);
  return (
    <li className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-between px-4 text-[13px]" aria-hidden>
        <span className="flex items-center gap-1.5 text-info-texte">
          <MailOpen size={16} /> {ligne.nonLu ? "Lu" : "Non lu"}
        </span>
        <span className="flex items-center gap-1.5 text-attention-texte">
          {ligne.archive ? "Désarchiver" : "Archiver"} <Archive size={16} />
        </span>
      </div>
      <button
        type="button"
        onClick={() => (glisse.current ? null : onOuvrir())}
        onPointerDown={(e) => {
          depart.current = { x: e.clientX, y: e.clientY };
          glisse.current = false;
        }}
        onPointerMove={(e) => {
          if (!depart.current) return;
          const ecartX = e.clientX - depart.current.x;
          if (!glisse.current && Math.abs(ecartX) > 12 && Math.abs(ecartX) > Math.abs(e.clientY - depart.current.y)) glisse.current = true;
          if (glisse.current) setDx(Math.max(-120, Math.min(120, ecartX)));
        }}
        onPointerUp={() => {
          if (dx <= -SEUIL) onArchiver();
          else if (dx >= SEUIL) onLu();
          depart.current = null;
          setDx(0);
          window.setTimeout(() => (glisse.current = false), 0);
        }}
        onPointerCancel={() => {
          depart.current = null;
          setDx(0);
        }}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        className={cn("relative flex min-h-[72px] w-full touch-pan-y items-center gap-3 border-b-[0.5px] border-trait bg-fond px-3 py-2 text-left", active ? "bg-surface" : "hover:bg-surface", dx === 0 && TRANS)}
      >
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[15px] font-semibold text-texte-2">
          {ligne.initiales}
          {ligne.nonLu ? <span className="absolute -top-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-fond bg-info" aria-label="Non lu" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[16px]", ligne.nonLu ? "font-semibold text-texte" : "text-texte")}>{ligne.nom}</span>
            <span className="shrink-0 text-[12.5px] text-texte-3 tabular-nums">{heureCourte(ligne.dernierLe)}</span>
          </span>
          <span className="mt-0.5 block truncate text-[14px] text-texte-3">{ligne.situation || ligne.dernierExtrait || "—"}</span>
          <span className="mt-1 flex items-center gap-1.5">
            <span className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-texte-2">{ligne.etape}</span>
            {ligne.aEnvoyer ? <span className="rounded-[6px] bg-action-fond px-1.5 py-0.5 text-[11.5px] font-medium text-action-clair">À envoyer{ligne.aEnvoyer > 1 ? ` · ${ligne.aEnvoyer}` : ""}</span> : null}
            {ligne.main === "A_TOI" ? <span className="text-[11.5px] text-attention-texte">À toi</span> : null}
            {ligne.stop ? <span className="text-[11.5px] text-retard-texte">STOP</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ListeConversations({
  lignes,
  compteurs,
  filtre,
  recherche,
  actif,
  onFiltre,
  onRecherche,
  onOuvrir,
  onArchiver,
  onLu,
}: {
  lignes: LigneConversation[];
  compteurs: Partial<Record<FiltreConversations, number>>;
  filtre: FiltreConversations;
  recherche: string;
  actif: string | null;
  onFiltre: (filtre: FiltreConversations) => void;
  onRecherche: (q: string) => void;
  onOuvrir: (suiviId: string) => void;
  onArchiver: (ligne: LigneConversation) => void;
  onLu: (ligne: LigneConversation) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-3 pt-1 pb-2">
        <label className="relative block">
          <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-texte-3" />
          <input value={recherche} onChange={(e) => onRecherche(e.target.value)} placeholder="Nom, ville ou numéro" aria-label="Rechercher" className="h-11 w-full rounded-[10px] border-[0.5px] border-trait bg-surface pr-3 pl-9 text-[16px] text-texte focus:border-action focus:outline-none" />
        </label>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3">
          {FILTRES.map((f) => (
            <button key={f.cle} type="button" onClick={() => onFiltre(f.cle)} aria-pressed={filtre === f.cle} className={cn("min-h-[36px] shrink-0 rounded-full border-[0.5px] px-3 text-[13px]", TRANS, filtre === f.cle ? "border-action bg-action-fond text-texte" : "border-trait text-texte-2")}>
              {f.libelle}
              {compteurs[f.cle] ? <span className="ml-1 text-texte-3 tabular-nums">{compteurs[f.cle]}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversations">
        {lignes.length === 0 ? <li className="p-6 text-center text-[14px] text-texte-3">Aucune conversation ici.</li> : null}
        {lignes.map((l) => (
          <Ligne key={l.suiviId} ligne={l} active={actif === l.suiviId} onOuvrir={() => onOuvrir(l.suiviId)} onArchiver={() => onArchiver(l)} onLu={() => onLu(l)} />
        ))}
      </ul>
    </div>
  );
}
