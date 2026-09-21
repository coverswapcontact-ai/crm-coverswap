"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CLASSE_SAISIE, TRANS } from "@/components/pilotage/ui";
import { correspondRecherche } from "@/lib/simulateur/recherche-teintes";
import { LIBELLES_STYLE, type StyleClient } from "@/lib/simulateur/types-surface";
import { cn } from "@/lib/utils";

/**
 * Le catalogue Cover Styl', pour choisir la teinte d'une zone. Ce que le
 * client a dit aimer (dans son espace) et ce qu'il a essayé sur le site passe
 * en premier ; ensuite, recherche par nom ou référence et familles.
 */

export type ReferenceCatalogue = { ref: string; nom: string; famille: string; profil: string; resume: string; hex: string | null; couleur: string | null; image: string; styles: string[] };

const FAMILLES = [
  { id: "", libelle: "Tout" },
  { id: "bois", libelle: "Bois" },
  { id: "couleur", libelle: "Unis" },
  { id: "pierre", libelle: "Pierre, marbre" },
  { id: "beton", libelle: "Béton" },
  { id: "metal", libelle: "Métal" },
  { id: "textile", libelle: "Textile, cuir" },
  { id: "paillettes", libelle: "Paillettes" },
];

export function SelecteurTeinte({
  references,
  zone,
  styles,
  refsSite,
  onChoisir,
  onFermer,
}: {
  references: ReferenceCatalogue[];
  zone: string;
  styles: StyleClient[];
  refsSite: string[];
  onChoisir: (reference: ReferenceCatalogue) => void;
  onFermer: () => void;
}) {
  const [recherche, setRecherche] = useState("");
  const [famille, setFamille] = useState("");
  const [gout, setGout] = useState<StyleClient | "site" | null>(styles[0] ?? (refsSite.length ? "site" : null));

  const liste = useMemo(() => {
    const q = recherche.trim();
    return references.filter((r) => {
      if (q && !correspondRecherche(r, q)) return false;
      if (famille && r.famille !== famille) return false;
      if (!q && !famille && gout === "site") return refsSite.includes(r.ref);
      if (!q && !famille && gout) return r.styles.includes(gout);
      return true;
    });
  }, [references, recherche, famille, gout, refsSite]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#16181D]" role="dialog" aria-modal="true" aria-label={`Teinte : ${zone}`}>
      <div className="border-b-[0.5px] border-[#2A2D34] px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-medium text-[#F2F3F5]">
            Teinte · <span className="text-[#5DCAA5]">{zone}</span>
          </p>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="flex h-10 w-10 items-center justify-center rounded-full text-[#9CA3AF] hover:bg-[#22262D]">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="relative mt-2">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" aria-hidden />
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chêne, noyer, béton gris, AA01…" className={cn(CLASSE_SAISIE, "h-11 pl-9 sm:h-9")} aria-label="Rechercher une teinte" />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {styles.map((s) => (
            <button key={s} type="button" onClick={() => { setGout(s); setFamille(""); setRecherche(""); }} className={cn("h-8 shrink-0 rounded-full border-[0.5px] px-3 text-[12.5px]", gout === s && !famille && !recherche ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] text-[#D1D5DB]", TRANS)}>
              ♥ {LIBELLES_STYLE[s]}
            </button>
          ))}
          {refsSite.length ? (
            <button type="button" onClick={() => { setGout("site"); setFamille(""); setRecherche(""); }} className={cn("h-8 shrink-0 rounded-full border-[0.5px] px-3 text-[12.5px]", gout === "site" && !famille && !recherche ? "border-[#60A5FA]/60 bg-[#60A5FA]/10 text-[#93C5FD]" : "border-[#2A2D34] text-[#D1D5DB]", TRANS)}>
              Essayées sur le site
            </button>
          ) : null}
          {FAMILLES.map((f) => (
            <button key={f.id || "tout"} type="button" onClick={() => { setFamille(f.id); if (!f.id) setGout(null); }} className={cn("h-8 shrink-0 rounded-full border-[0.5px] px-3 text-[12.5px]", famille === f.id && (f.id || !gout) ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] text-[#D1D5DB]", TRANS)}>
              {f.libelle}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {liste.length === 0 ? <p className="py-10 text-center text-[13px] text-[#9CA3AF]">Aucune teinte ici. Essayez une autre recherche.</p> : null}
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {liste.slice(0, 240).map((r) => (
            <li key={r.ref}>
              <button type="button" onClick={() => onChoisir(r)} className="block w-full overflow-hidden rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] text-left hover:border-[#5DCAA5]/60">
                {/* eslint-disable-next-line @next/next/no-img-element -- échantillon servi par le CRM */}
                <img src={r.image} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                <span className="block px-1.5 pt-1 text-[11px] font-medium text-[#F2F3F5]">{r.ref}</span>
                <span className="block truncate px-1.5 pb-1.5 text-[11px] text-[#9CA3AF]">{r.nom}</span>
              </button>
            </li>
          ))}
        </ul>
        {liste.length > 240 ? <p className="py-3 text-center text-[12px] text-[#6B7280]">{liste.length - 240} autres : affinez la recherche.</p> : null}
      </div>
    </div>
  );
}
