"use client";

import { type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ACompleter } from "@/app/(pilotage)/dossiers/_components/ACompleter";
import { ArchivageDossier } from "@/app/(pilotage)/dossiers/_components/ArchivageDossier";
import { ChangementEtape } from "@/app/(pilotage)/dossiers/_components/ChangementEtape";
import { CoordonneesClient } from "@/app/(pilotage)/dossiers/_components/CoordonneesClient";
import { DelaisEcarts } from "@/app/(pilotage)/dossiers/_components/DelaisEcarts";
import { DepensesDossier } from "@/app/(pilotage)/dossiers/_components/DepensesDossier";
import { DocumentsDossier } from "@/app/(pilotage)/dossiers/_components/DocumentsDossier";
import { EspaceDossier } from "@/app/(pilotage)/dossiers/_components/EspaceDossier";
import { FamillesDossier } from "@/app/(pilotage)/dossiers/_components/FamillesDossier";
import { HistoriqueEvenements } from "@/app/(pilotage)/dossiers/_components/HistoriqueEvenements";
import { PaiementsDossier } from "@/app/(pilotage)/dossiers/_components/PaiementsDossier";
import { PhotosDossier } from "@/app/(pilotage)/dossiers/_components/PhotosDossier";
import { SimulationsDossier } from "@/app/(pilotage)/dossiers/_components/SimulationsDossier";
import { TimelineEtapes } from "@/app/(pilotage)/dossiers/_components/TimelineEtapes";
import type { EtapeDossier, TypeDocument } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import type { DocumentVue, DossierDetail } from "@/lib/dossiers/types";
import { pluriel } from "@/lib/commun/format";
import { RUBRIQUES_V2, TITRES_RUBRIQUES, type RubriqueV2 } from "@/lib/v2/rubriques-dossier";
import { cn } from "@/lib/utils";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A3) — les rubriques du dossier : les sections de la v1, réutilisées telles quelles (aucune n'est
 * réécrite), rangées dans l'ordre et toutes fermées sauf celle de l'étape (`lib/v2/rubriques-dossier.ts`). Chaque
 * rubrique est une ligne de 44 px, son titre en phrase, un résumé quand elle est fermée, le contenu au toucher.
 * Les identifiants `rubrique-<x>` restent ceux que les raccourcis `?rubrique=` visent.
 */
export type GestesRubriques = {
  onMisAJour: (detail: DossierDetail) => void;
  onRecharger: () => Promise<void>;
  onArchive?: (dossierId: string) => void;
  onGenerer: (type: TypeDocument) => void;
  onRefaire: (devis: DocumentVue) => void;
  onFaireDevis: () => void;
  onAjouterDevis: () => void;
  onDeposerPdf: () => void;
};

function Rubrique({ id, titre, resume, ouvert, onBasculer, children }: { id: string; titre: string; resume?: ReactNode; ouvert: boolean; onBasculer: () => void; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-trait first:border-t-0">
      <button type="button" aria-expanded={ouvert} onClick={onBasculer} className={cn("flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", TRANS_V2)}>
        <span className="shrink-0 text-corps-tel font-medium text-texte md:text-corps">{titre}</span>
        {!ouvert && resume ? <span className="min-w-0 flex-1 truncate text-petit text-texte-3">{resume}</span> : <span className="flex-1" />}
        <ChevronDown size={18} aria-hidden className={cn("shrink-0 text-texte-3", ouvert && "rotate-180")} />
      </button>
      {ouvert ? <div className="px-4 pt-1 pb-4">{children}</div> : null}
    </section>
  );
}

export function RubriquesDossier({ detail, ouvertes, onBasculer, gestes, etapeDemandee }: { detail: DossierDetail; ouvertes: ReadonlySet<RubriqueV2>; onBasculer: (rubrique: RubriqueV2) => void; gestes: GestesRubriques; /** Un passage d'étape demandé (bouton principal, autres gestes, `?rubrique=etape`) : sa fenêtre s'ouvre dans « Étapes et notes ». */ etapeDemandee: { etape: EtapeDossier; cle: number } | null }) {
  const nbDevis = detail.documents.filter((d) => d.type === "DEVIS" && d.numero).length;
  const nbFactures = detail.documents.filter((d) => d.type === "FACTURE" && d.numero).length;
  const resumes: Partial<Record<RubriqueV2, ReactNode>> = {
    completer: pluriel(detail.completude.length, "point"),
    photos: pluriel(detail.photos.length, "photo"),
    devis: `${pluriel(nbDevis, "devis", "devis")} · ${pluriel(nbFactures, "facture")}`,
    paiements: detail.paiements.resteDu > 0 ? `reste dû ${formatMontant(detail.paiements.resteDu)}` : detail.paiements.acompteEnregistre ? "acompte reçu" : "aucun paiement",
    historique: detail.evenements[0]?.contenu,
    coordonnees: [detail.clientTelephone, detail.clientEmail].filter(Boolean).join(" · "),
    delais: detail.dateChantier ? "chantier daté" : undefined,
  };
  const contenu: Record<RubriqueV2, ReactNode | null> = {
    completer: detail.completude.length > 0 ? <ACompleter detail={detail} onMisAJour={gestes.onMisAJour} /> : null,
    photos: <PhotosDossier detail={detail} onRecharger={gestes.onRecharger} sansTitre />,
    simulations: <SimulationsDossier key={`simulations-${detail.id}`} detail={detail} onRecharger={gestes.onRecharger} sansTitre />,
    espace: <EspaceDossier key={detail.id} detail={detail} onRecharger={gestes.onRecharger} onFaireDevis={gestes.onFaireDevis} onAjouterDevis={gestes.onAjouterDevis} onDeposerPdf={gestes.onDeposerPdf} sansTitre />,
    devis: <DocumentsDossier detail={detail} onGenerer={gestes.onGenerer} onRefaire={gestes.onRefaire} onMisAJour={gestes.onMisAJour} onRecharger={gestes.onRecharger} sansTitre />,
    paiements: <PaiementsDossier detail={detail} onMisAJour={gestes.onMisAJour} sansTitre />,
    etapes: (
      <div className="space-y-6">
        <ChangementEtape key={etapeDemandee ? `etape-${etapeDemandee.cle}` : "etape"} detail={detail} onMisAJour={gestes.onMisAJour} demandeInitiale={etapeDemandee?.etape ?? null} />
        <TimelineEtapes detail={detail} onNoteAjoutee={gestes.onRecharger} />
      </div>
    ),
    historique: <HistoriqueEvenements evenements={detail.evenements} onRecharger={gestes.onRecharger} />,
    // Remonté quand les valeurs enregistrées changent, pas à chaque mise à jour : une saisie en cours survit à un changement d'étape.
    coordonnees: <CoordonneesClient key={[detail.id, detail.clientNom, detail.clientTelephone, detail.clientEmail, detail.clientAdresse, detail.clientCp, detail.clientVille, detail.objet, detail.source, detail.montantEstime, detail.dateChantier].join("|")} detail={detail} onMisAJour={gestes.onMisAJour} />,
    familles: <FamillesDossier key={`familles-${detail.id}`} detail={detail} onEnregistre={gestes.onRecharger} />,
    delais: <DelaisEcarts detail={detail} onMisAJour={gestes.onMisAJour} />,
    depenses: <DepensesDossier detail={detail} />,
    archivage: gestes.onArchive ? <ArchivageDossier detail={detail} onArchive={gestes.onArchive} /> : null,
  };
  return (
    <div className="overflow-hidden rounded-[11px] border border-trait bg-surface">
      {RUBRIQUES_V2.filter((r) => contenu[r] !== null).map((r) => (
        <Rubrique key={r} id={`rubrique-${r}`} titre={TITRES_RUBRIQUES[r]} resume={resumes[r]} ouvert={ouvertes.has(r)} onBasculer={() => onBasculer(r)}>
          {contenu[r]}
        </Rubrique>
      ))}
    </div>
  );
}
