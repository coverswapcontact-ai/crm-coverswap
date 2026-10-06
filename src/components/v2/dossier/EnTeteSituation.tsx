"use client";

import { X } from "lucide-react";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { COULEURS_ETAPE } from "@/components/pilotage/ui";
import type { DossierDetail } from "@/lib/dossiers/types";
import type { EspaceResume } from "@/lib/espace/suivi-types";
import { dateExacte } from "@/lib/v2/dates";
import { situationDe } from "@/lib/v2/situation";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A3) — l'en-tête de situation d'un dossier, le même format partout (règle 5 de docs/CRM-V2.md), en
 * trois lignes de phrases (`lib/v2/situation.ts`) :
 *  1. qui / quoi : le client, la pièce, la ville ; l'étape en mots à côté, avec le point de couleur de l'étape ;
 *  2. où en est-on et depuis quand, avec le fait qui le justifie et ce que dit l'espace du client ;
 *  3. la prochaine action et sa date, et « Modifier ».
 * Deux tailles de texte (titre, corps) ; la date exacte au survol ; aucun badge, aucune capitale espacée.
 */
export function EnTeteSituation({ detail, espace, maintenant, onModifierAction, onFermer }: { detail: DossierDetail; espace: EspaceResume | null; maintenant: Date; onModifierAction: () => void; onFermer: () => void }) {
  const lignes = situationDe(detail, espace, maintenant);
  return (
    <header className="border-b border-trait px-4 pt-4 pb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-titre leading-tight font-semibold break-words text-texte">{lignes.quiQuoi}</SheetTitle>
          <p className="mt-1 flex items-center gap-2 text-corps-tel text-texte-2 md:text-corps">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COULEURS_ETAPE[detail.etape] }} />
            {lignes.etape}
          </p>
        </div>
        <button type="button" onClick={onFermer} aria-label="Fermer le dossier" className={cn("-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-texte-3 hover:bg-surface hover:text-texte focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2)}>
          <X size={20} aria-hidden />
        </button>
      </div>
      <SheetDescription title={detail.mainLe ? dateExacte(detail.mainLe) : undefined} className="mt-2 text-corps-tel leading-snug break-words text-texte md:text-corps">
        {lignes.situation}
      </SheetDescription>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p title={detail.prochaineActionDate ? dateExacte(detail.prochaineActionDate) : undefined} className="min-w-0 flex-1 text-corps-tel leading-snug break-words text-texte-2 md:text-corps">
          {lignes.prochaineAction}
        </p>
        <button type="button" onClick={onModifierAction} className={cn(BOUTON_SECONDAIRE, "shrink-0 px-3")}>
          Modifier
        </button>
      </div>
    </header>
  );
}
