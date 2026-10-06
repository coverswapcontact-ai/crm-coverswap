"use client";

import { Smartphone } from "lucide-react";
import { descriptionEspace, faitsEspace, signalPrincipal, visiteEspace } from "@/lib/espace/colonne-espace";
import { ETAPES_ESPACE, LIBELLES_ETAPE_ESPACE, type EtapeEspace } from "@/lib/espace/etapes";
import { FILTRES_ESPACE, LIBELLES_FILTRE_ESPACE, LIBELLES_TRI_ESPACE, TRIS_ESPACE, type CompteursEspaces, type EspaceResume, type FiltreEspace, type TriEspace } from "@/lib/espace/suivi-types";
import { cn } from "@/lib/utils";
import { TRANS } from "@/components/pilotage/ui";

/**
 * Mission 18 (A1) — l'ancien onglet Espaces clients, dans Dossiers : la colonne « Espace » (étape de l'espace, lien et
 * dernière visite, photos, simulations, devis relu, le signal qui demande un geste) et le filtre « Espaces » (À moi,
 * Chez le client, Signaux, Tous, Désactivés, étape, tri). Les gestes restent dans le bloc Espace du panneau du dossier,
 * et ceux du client (lien, projet de plus) dans sa fiche.
 */

const couleurSignal = (ton: "rouge" | "ambre" | "gris") => (ton === "rouge" ? "text-retard-texte" : ton === "ambre" ? "text-attention-texte" : "text-texte-3");

/**
 * L'icône de l'espace, teintée par le signal le plus pressant (rouge, ambre), grise sinon. Relecture de la partie A :
 * `libelle` — « detaille » (cellule du tableau : la description entière), « court » (carte compacte, où l'icône est seule :
 * « Espace : » et le signal ou l'étape, pour ne pas allonger le nom du bouton), « aucun » (un texte visible la suit).
 */
export function IconeEspace({ espace, maintenant, className, libelle = "detaille" }: { espace: EspaceResume; maintenant: Date; className?: string; libelle?: "detaille" | "court" | "aucun" }) {
  const signal = signalPrincipal(espace);
  const couleur = cn("inline-flex shrink-0", signal ? couleurSignal(signal.ton) : espace.revoque ? "text-texte-3" : "text-texte-3", className);
  if (libelle === "aucun") {
    return (
      <span aria-hidden className={couleur}>
        <Smartphone size={12} />
      </span>
    );
  }
  const texte = libelle === "court" ? `Espace : ${espace.revoque ? "lien désactivé" : (signal?.libelle ?? espace.etapeLibelle)}` : `Espace : ${descriptionEspace(espace, maintenant)}`;
  return (
    <span role="img" aria-label={texte} title={descriptionEspace(espace, maintenant)} className={couleur}>
      <Smartphone size={12} aria-hidden />
    </span>
  );
}

/** Le texte court : le signal s'il y en a un, sinon la visite et ce que le client a fait (lien désactivé : l'étape où il s'est arrêté). */
function ligneCourte(espace: EspaceResume, maintenant: Date): string {
  if (espace.revoque) return [espace.etapeLibelle, ...faitsEspace(espace)].join(" · ");
  return signalPrincipal(espace)?.libelle ?? [visiteEspace(espace, maintenant), ...faitsEspace(espace)].join(" · ");
}

/** La colonne « Espace » du tableau (bureau). */
export function CelluleEspace({ espace, maintenant }: { espace: EspaceResume | null | undefined; maintenant: Date }) {
  if (!espace) return <span className="text-[12px] text-texte-3">{espace === null ? "Pas d'espace" : "—"}</span>;
  const signal = signalPrincipal(espace);
  return (
    <span className="block min-w-0" title={descriptionEspace(espace, maintenant)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <IconeEspace espace={espace} maintenant={maintenant} />
        <span className={cn("truncate text-[12.5px]", espace.revoque ? "text-texte-3" : "text-texte")}>{espace.revoque ? "Lien désactivé" : espace.etapeLibelle}</span>
      </span>
      <span className={cn("mt-0.5 block truncate text-[11.5px]", signal ? couleurSignal(signal.ton) : "text-texte-3")}>{ligneCourte(espace, maintenant)}</span>
    </span>
  );
}

/** Une ligne pour le téléphone et la carte du kanban : l'icône, l'étape de l'espace, puis le signal ou la visite. */
export function LigneEspaceCourte({ espace, maintenant, className }: { espace: EspaceResume; maintenant: Date; className?: string }) {
  const signal = signalPrincipal(espace);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[12px]", className)} title={descriptionEspace(espace, maintenant)}>
      <IconeEspace espace={espace} maintenant={maintenant} libelle="aucun" />
      <span className="min-w-0 truncate text-texte-3">
        {espace.revoque ? "Lien désactivé" : espace.etapeLibelle}
        <span className={signal ? couleurSignal(signal.ton) : "text-texte-3"}> · {ligneCourte(espace, maintenant)}</span>
      </span>
    </span>
  );
}

const CLASSE_PASTILLE = "h-11 rounded-full border-[0.5px] px-3 text-[13px] sm:h-8 sm:text-[12.5px]";

/**
 * Le filtre « Espaces » : les pastilles de l'ancien onglet (compteurs exacts, sur tous les espaces), l'étape et le tri
 * (fait par le serveur : l'écran garde son ordre). Des boutons de filtre (`aria-pressed`), pas des onglets.
 */
export function FiltreEspaces({
  filtre,
  etape,
  tri,
  compteurs,
  onFiltre,
  onEtape,
  onTri,
}: {
  filtre: FiltreEspace;
  etape: EtapeEspace | null;
  tri: TriEspace;
  compteurs: CompteursEspaces | undefined;
  onFiltre: (filtre: FiltreEspace) => void;
  onEtape: (etape: EtapeEspace | null) => void;
  onTri: (tri: TriEspace) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtre des espaces">
        {FILTRES_ESPACE.map((valeur) => (
          <button
            key={valeur}
            type="button"
            aria-pressed={filtre === valeur}
            onClick={() => onFiltre(valeur)}
            className={cn(CLASSE_PASTILLE, filtre === valeur ? "border-action/60 bg-action-fond text-action-clair" : "border-trait bg-fond text-texte-2 hover:border-trait-2", TRANS)}
          >
            {LIBELLES_FILTRE_ESPACE[valeur]}
            {compteurs ? <span className="ml-1.5 text-[11.5px] opacity-70 tabular-nums">{compteurs[valeur]}</span> : null}
          </button>
        ))}
      </div>
      <select
        aria-label="Étape de l'espace"
        value={etape ?? "TOUTES"}
        onChange={(evenement) => onEtape(evenement.target.value === "TOUTES" ? null : (evenement.target.value as EtapeEspace))}
        className="h-11 rounded-[8px] border-[0.5px] border-trait bg-fond px-2 text-[13px] text-texte-2 [color-scheme:dark] sm:h-8"
      >
        <option value="TOUTES">Toutes les étapes de l&apos;espace</option>
        {ETAPES_ESPACE.map((e) => (
          <option key={e} value={e}>
            {LIBELLES_ETAPE_ESPACE[e]}
          </option>
        ))}
      </select>
      <select
        aria-label="Tri des espaces"
        value={tri}
        onChange={(evenement) => onTri(evenement.target.value as TriEspace)}
        className="h-11 rounded-[8px] border-[0.5px] border-trait bg-fond px-2 text-[13px] text-texte-2 [color-scheme:dark] sm:h-8"
      >
        {TRIS_ESPACE.map((t) => (
          <option key={t} value={t}>
            {LIBELLES_TRI_ESPACE[t]}
          </option>
        ))}
      </select>
    </div>
  );
}
