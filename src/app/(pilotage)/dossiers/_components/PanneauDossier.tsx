"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  ChevronDown,
  ExternalLink,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  LIBELLES_ETAPE,
  LIBELLES_SOURCE,
  LIBELLES_TYPE_EVENEMENT,
  type TypeDocument,
  type TypeEvenement,
} from "@/lib/dossiers/constants";
import { formatDateCourte, formatHorodatage, jourParis } from "@/lib/dossiers/dates";
import { echeanceDe, mainDe } from "@/lib/dossiers/pilotage";
import type { DossierDetail, EvenementVue } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { PastilleRetard, ProchaineActionResume } from "./CarteDossier";
import { BadgeMain, BarreProgression, Lisere, couleurLisere } from "./Indicateurs";
import { ChangementEtape } from "./ChangementEtape";
import { CoordonneesClient } from "./CoordonneesClient";
import { DelaisEcarts } from "./DelaisEcarts";
import { DocumentsDossier } from "./DocumentsDossier";
import { GenerateurDocument } from "./GenerateurDocument";
import { PhotosDossier } from "./PhotosDossier";
import { TimelineEtapes } from "./TimelineEtapes";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Bouton, CLASSE_SAISIE, PastilleEtape, TRANS, TitreSection } from "./ui";

const CLASSE_PUCE_LIEN = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] text-[#D1D5DB] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-7",
  TRANS
);

export function PanneauDossier({
  dossierId,
  maintenant,
  onFermer,
  onMisAJour,
}: {
  dossierId: string | null;
  maintenant: Date;
  onFermer: () => void;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [echec, setEchec] = useState<{ dossierId: string; message: string } | null>(null);

  useEffect(() => {
    if (!dossierId) return;
    let actif = true;
    appelApi<DossierDetail>(`/api/dossiers/${dossierId}`)
      .then((charge) => {
        if (!actif) return;
        setDetail(charge);
        onMisAJour(charge);
      })
      .catch((probleme: unknown) => {
        if (actif) setEchec({ dossierId, message: messageErreur(probleme) });
      });
    return () => {
      actif = false;
    };
  }, [dossierId, onMisAJour]);

  const erreur = echec && echec.dossierId === dossierId ? echec.message : null;

  const appliquer = useCallback(
    (nouveau: DossierDetail) => {
      setDetail(nouveau);
      onMisAJour(nouveau);
    },
    [onMisAJour]
  );

  const recharger = useCallback(async () => {
    if (!dossierId) return;
    try {
      appliquer(await appelApi<DossierDetail>(`/api/dossiers/${dossierId}`));
    } catch (probleme) {
      toast.error("Dossier non rechargé", { description: messageErreur(probleme) });
    }
  }, [dossierId, appliquer]);

  // Pendant l'animation de fermeture, le dernier dossier reste affiché.
  const affiche = detail && (dossierId === null || detail.id === dossierId) ? detail : null;

  return (
    <Sheet open={dossierId !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 border-[#2A2D34] bg-[#16181D] p-0 text-[#F2F3F5] data-[side=right]:w-full data-[side=right]:sm:max-w-[620px]"
      >
        {affiche ? (
          <ContenuPanneau detail={affiche} maintenant={maintenant} onFermer={onFermer} onMisAJour={appliquer} onRecharger={recharger} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-5 py-4">
              <SheetTitle className="text-[15px] font-medium text-[#F2F3F5]">
                {erreur ? "Dossier indisponible" : "Chargement du dossier…"}
              </SheetTitle>
              <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer le dossier">
                <X size={16} />
              </Bouton>
            </div>
            {erreur ? (
              <p className="px-5 py-6 text-[13px] text-[#F87171]">{erreur}</p>
            ) : (
              <div className="space-y-3 px-5 py-6" aria-hidden>
                {[70, 45, 90, 60, 80].map((largeur) => (
                  <div key={largeur} className="h-4 animate-pulse rounded bg-[#22262D]" style={{ width: `${largeur}%` }} />
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ContenuPanneau({
  detail,
  maintenant,
  onFermer,
  onMisAJour,
  onRecharger,
}: {
  detail: DossierDetail;
  maintenant: Date;
  onFermer: () => void;
  onMisAJour: (detail: DossierDetail) => void;
  onRecharger: () => Promise<void>;
}) {
  const [generateur, setGenerateur] = useState<{ type: TypeDocument; cle: number } | null>(null);
  const telephone = detail.clientTelephone.replace(/[^\d+]/g, "");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative border-b-[0.5px] border-[#2A2D34] px-5 pt-4 pb-3">
        <Lisere couleur={couleurLisere(detail, maintenant)} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[17px] font-medium tracking-tight text-[#F2F3F5]">
              {detail.clientNom}
            </SheetTitle>
            <SheetDescription className="mt-0.5 text-[12px] text-[#9CA3AF]">
              {detail.clientVille} · {LIBELLES_SOURCE[detail.source]} · ouvert le {formatDateCourte(detail.createdAt)}
            </SheetDescription>
          </div>
          <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer le dossier" className="-mr-2">
            <X size={16} />
          </Bouton>
        </div>
        <p className="mt-2 truncate text-[13px] text-[#D1D5DB]">{detail.objet}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PastilleEtape etape={detail.etape} libelle={LIBELLES_ETAPE[detail.etape]} />
          <BadgeMain main={mainDe(detail, maintenant)} long />
          {echeanceDe(detail, maintenant) === "retard" ? <PastilleRetard className="ml-1" /> : null}
        </div>
        <BarreProgression etape={detail.etape} etapeAvantSortie={detail.etapeAvantSortie} className="mt-3 max-w-[420px]" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={`tel:${telephone}`} className={CLASSE_PUCE_LIEN}>
            <Phone size={12} aria-hidden />
            {detail.clientTelephone}
          </a>
          {detail.clientEmail ? (
            <a href={`mailto:${detail.clientEmail}`} className={CLASSE_PUCE_LIEN}>
              <Mail size={12} aria-hidden />
              E-mail
            </a>
          ) : null}
          {detail.origine ? (
            <Link
              href={detail.origine.type === "LEAD" ? `/leads/${detail.origine.id}` : "/prospection"}
              className={CLASSE_PUCE_LIEN}
            >
              <ExternalLink size={12} aria-hidden />
              {detail.origine.type === "LEAD" ? "Lead" : "Prospect"} : {detail.origine.nom}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-8 px-5 py-5">
          <ProchaineActionEditeur
            key={`${detail.id}:${detail.prochaineAction}:${detail.prochaineActionDate}`}
            detail={detail}
            maintenant={maintenant}
            onMisAJour={onMisAJour}
          />
          <ChangementEtape detail={detail} onMisAJour={onMisAJour} />
          <DelaisEcarts detail={detail} />
          <DocumentsDossier
            detail={detail}
            onGenerer={(type) => setGenerateur((actuel) => ({ type, cle: (actuel?.cle ?? 0) + 1 }))}
          />
          <section>
            <TitreSection>Étapes et notes</TitreSection>
            <TimelineEtapes detail={detail} onNoteAjoutee={onRecharger} />
          </section>
          <PhotosDossier detail={detail} onRecharger={onRecharger} />
          {/* Remonté quand les valeurs enregistrées changent, pas à chaque mise à
              jour du dossier : une saisie en cours survit à un changement d'étape. */}
          <CoordonneesClient
            key={[
              detail.id,
              detail.clientNom,
              detail.clientTelephone,
              detail.clientEmail,
              detail.clientAdresse,
              detail.clientCp,
              detail.clientVille,
              detail.objet,
              detail.source,
              detail.montantEstime,
              detail.dateChantier,
            ].join("|")}
            detail={detail}
            onMisAJour={onMisAJour}
          />
          <HistoriqueEvenements evenements={detail.evenements} />
        </div>
      </div>

      {generateur ? (
        <GenerateurDocument
          key={generateur.cle}
          detail={detail}
          typeInitial={generateur.type}
          onFermer={() => setGenerateur(null)}
          onGenere={onMisAJour}
        />
      ) : null}
    </div>
  );
}

/* ── Prochaine action ────────────────────────────────────────────── */

const RACCOURCIS_DATE = [
  { libelle: "Aujourd'hui", jours: 0 },
  { libelle: "Demain", jours: 1 },
  { libelle: "Dans 3 j", jours: 3 },
  { libelle: "Dans 1 sem.", jours: 7 },
] as const;

function ProchaineActionEditeur({
  detail,
  maintenant,
  onMisAJour,
}: {
  detail: DossierDetail;
  maintenant: Date;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const actionInitiale = detail.prochaineAction ?? "";
  const dateInitiale = detail.prochaineActionDate ? jourParis(detail.prochaineActionDate) : "";
  const [action, setAction] = useState(actionInitiale);
  const [date, setDate] = useState(dateInitiale);
  const [envoi, setEnvoi] = useState(false);
  const modifie = action.trim() !== actionInitiale || date !== dateInitiale;

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnvoi(true);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}`, "PATCH", {
        prochaineAction: action.trim() || null,
        prochaineActionDate: date || null,
      });
      onMisAJour(nouveau);
      toast.success("Prochaine action enregistrée");
    } catch (probleme) {
      toast.error("Prochaine action non enregistrée", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section>
      <TitreSection>Prochaine action</TitreSection>
      <ProchaineActionResume dossier={detail} maintenant={maintenant} className="mb-3" />
      <form onSubmit={enregistrer} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
        <input
          aria-label="Prochaine action"
          value={action}
          maxLength={140}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Ex. Relancer par téléphone"
          className={cn(CLASSE_SAISIE, "h-10 sm:h-9")}
        />
        <input
          type="date"
          aria-label="Date de la prochaine action"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={cn(CLASSE_SAISIE, "h-10 sm:h-9")}
        />
        <Bouton type="submit" variante={modifie ? "primaire" : "secondaire"} disabled={!modifie} chargement={envoi}>
          Enregistrer
        </Bouton>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {RACCOURCIS_DATE.map((raccourci) => (
          <button
            key={raccourci.jours}
            type="button"
            onClick={() => setDate(jourParis(new Date(Date.now() + raccourci.jours * 86_400_000)))}
            className={cn(
              "h-8 rounded-full border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-6 sm:text-[11px]",
              TRANS
            )}
          >
            {raccourci.libelle}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── Historique ──────────────────────────────────────────────────── */

const ICONES_EVENEMENT: Partial<Record<TypeEvenement, typeof FileText>> = {
  CHANGEMENT_ETAPE: ArrowRightLeft,
  DEVIS_GENERE: FileText,
  FACTURE_GENEREE: FileText,
  DEVIS_ENVOYE: FileText,
  NOTE_AJOUTEE: StickyNote,
  APPEL: Phone,
  MAIL_RECU: Mail,
  MAIL_ENVOYE: Mail,
};

function HistoriqueEvenements({ evenements }: { evenements: EvenementVue[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [tout, setTout] = useState(false);
  const liste = tout ? evenements : evenements.slice(0, 20);

  return (
    <section>
      <button
        type="button"
        aria-expanded={ouvert}
        onClick={() => setOuvert((valeur) => !valeur)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">
          Historique ({evenements.length})
        </span>
        <ChevronDown size={15} aria-hidden className={cn("text-[#6B7280] transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert ? (
        <ol className="mt-3 space-y-3">
          {liste.map((evenement) => {
            const Icone = ICONES_EVENEMENT[evenement.type] ?? MessageSquare;
            return (
              <li key={evenement.id} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
                  <Icone size={12} className="text-[#9CA3AF]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] break-words text-[#D1D5DB]">{evenement.contenu}</p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">
                    {LIBELLES_TYPE_EVENEMENT[evenement.type]} · {formatHorodatage(evenement.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
          {!tout && evenements.length > liste.length ? (
            <li>
              <Bouton variante="fantome" taille="sm" onClick={() => setTout(true)}>
                Voir les {evenements.length - liste.length} plus anciens
              </Bouton>
            </li>
          ) : null}
        </ol>
      ) : null}
    </section>
  );
}
