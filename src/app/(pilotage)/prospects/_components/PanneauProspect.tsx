"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, FolderPlus, Globe, MapPin, Phone, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Pastille, Puces, TitreSection, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatDateCourte, formatHorodatage } from "@/lib/dossiers/dates";
import { LIBELLES_STATUT_PROSPECT, STATUTS_PROSPECT_MANUELS, type StatutProspectManuel } from "@/lib/prospects/constantes";
import type { ProspectDetail } from "@/lib/prospects/types";
import { cn } from "@/lib/utils";
import { PastilleScore } from "./pastilles";

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5";
const LIEN_ACTION = cn(
  "inline-flex h-9 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-3 text-[13px] text-[#D1D5DB] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-8",
  TRANS
);

const LIBELLES_ACTIVITE: Record<string, string> = {
  SOURCING: "Sourcing",
  SCORING: "Scoring",
  NOTE: "Note",
  OPT_OUT: "Ne plus contacter",
  ENVOI: "Envoi",
  REPONSE: "Réponse",
};

/** Fiche d'un établissement démarché : pourquoi il est là (score, avis), où on en est, jusqu'au dossier. */
export function PanneauProspect({ id, onFermer, onModifie }: { id: string | null; onFermer: () => void; onModifie: () => void }) {
  const [detail, setDetail] = useState<ProspectDetail | null>(null);
  const [echec, setEchec] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let actif = true;
    appelApi<{ prospect: ProspectDetail }>(`/api/prospects/demarchage/${id}`)
      .then(({ prospect }) => actif && setDetail(prospect))
      .catch((probleme) => actif && setEchec({ id, message: messageErreur(probleme) }));
    return () => {
      actif = false;
    };
  }, [id]);

  const appliquer = useCallback(
    (prospect: ProspectDetail) => {
      setDetail(prospect);
      onModifie();
    },
    [onModifie]
  );

  const affiche = detail && detail.id === id ? detail : null;
  const erreur = echec && echec.id === id ? echec.message : null;

  return (
    <Sheet open={id !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 border-[#2A2D34] bg-[#16181D] p-0 text-[#F2F3F5] data-[side=right]:w-full data-[side=right]:sm:max-w-[620px]">
        {affiche ? (
          <Contenu detail={affiche} onFermer={onFermer} onMisAJour={appliquer} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-5 py-4">
              <SheetTitle className="text-[15px] font-medium text-[#F2F3F5]">{erreur ? "Prospect indisponible" : "Chargement du prospect…"}</SheetTitle>
              <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer">
                <X size={16} />
              </Bouton>
            </div>
            {erreur ? <p className="px-5 py-6 text-[13px] text-[#F87171]">{erreur}</p> : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Contenu({ detail, onFermer, onMisAJour }: { detail: ProspectDetail; onFermer: () => void; onMisAJour: (detail: ProspectDetail) => void }) {
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const telephone = detail.telephone?.replace(/[^\d+]/g, "") ?? "";
  const statutManuel = (STATUTS_PROSPECT_MANUELS as readonly string[]).includes(detail.statut) ? (detail.statut as StatutProspectManuel) : null;

  async function modifier(nom: string, donnees: Record<string, unknown>, succes: string) {
    setEnvoi(nom);
    try {
      const { prospect, avertissements } = await envoyerJson<{ prospect: ProspectDetail; avertissements: string[] }>(`/api/prospects/demarchage/${detail.id}`, "PATCH", donnees);
      onMisAJour(prospect);
      toast.success(succes, { description: avertissements.length ? avertissements.join(" ") : undefined });
      return true;
    } catch (probleme) {
      toast.error("Action impossible", { description: messageErreur(probleme) });
      return false;
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-5 py-4">
        <div className="min-w-0">
          <SheetTitle className="truncate text-[17px] font-medium text-[#F2F3F5]">{detail.nom}</SheetTitle>
          <SheetDescription className="mt-0.5 text-[12.5px] text-[#9CA3AF]">
            {[detail.agent.nom.replace(/^Agent /, ""), detail.ville, `sourcé le ${formatDateCourte(detail.sourceLe)}`].filter(Boolean).join(" · ")}
          </SheetDescription>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <PastilleScore score={detail.score} />
            <Pastille ton={detail.statut === "OPT_OUT" || detail.statut === "ECARTE" ? "rouge" : detail.statut === "CLIENT" ? "vert" : "neutre"}>{LIBELLES_STATUT_PROSPECT[detail.statut] ?? detail.statut}</Pastille>
            {detail.noteGoogle ? (
              <Pastille>
                {detail.noteGoogle.toLocaleString("fr-FR")} ★ · {detail.nbAvis ?? 0} avis
              </Pastille>
            ) : null}
          </p>
        </div>
        <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer">
          <X size={16} />
        </Bouton>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {detail.dossier ? (
            <Link href={`/dossiers?dossier=${detail.dossier.id}`} className={cn(LIEN_ACTION, "border-[#1D9E75]/50 text-[#5DCAA5]")}>
              <FolderPlus size={14} aria-hidden /> Dossier · {LIBELLES_ETAPE[detail.dossier.etape as EtapeDossier] ?? detail.dossier.etape}
            </Link>
          ) : (
            <Link
              href={`/dossiers?prospect=${detail.id}`}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-3.5 text-[13px] font-medium text-[#0B1612] hover:bg-[#5DCAA5] sm:h-8", TRANS)}
            >
              <FolderPlus size={14} aria-hidden /> Ouvrir un dossier
            </Link>
          )}
          {telephone ? (
            <a href={`tel:${telephone}`} className={LIEN_ACTION}>
              <Phone size={14} aria-hidden /> {detail.telephone}
            </a>
          ) : null}
          {detail.siteWeb ? (
            <a href={detail.siteWeb} target="_blank" rel="noopener noreferrer" className={LIEN_ACTION}>
              <Globe size={14} aria-hidden /> Site
            </a>
          ) : null}
          <a href={detail.lienGoogleMaps} target="_blank" rel="noopener noreferrer" className={LIEN_ACTION}>
            <MapPin size={14} aria-hidden /> Google Maps
          </a>
          {detail.client ? (
            <Link href={`/clients/${detail.client.id}`} className={LIEN_ACTION}>
              <UserRound size={14} aria-hidden /> Fiche client
            </Link>
          ) : null}
        </div>

        <section>
          <TitreSection>Où en est-on</TitreSection>
          <div className={cn(CARTE, "space-y-3")}>
            {detail.statut === "CLIENT" ? (
              <p className="text-[13px] text-[#9CA3AF]">Converti : un dossier a été ouvert. Le suivi continue dans le dossier.</p>
            ) : (
              <Puces
                libelle="Statut"
                options={STATUTS_PROSPECT_MANUELS.map((valeur) => ({ valeur, libelle: LIBELLES_STATUT_PROSPECT[valeur] }))}
                valeur={statutManuel}
                onChange={(valeur: StatutProspectManuel) => void modifier("statut", { statut: valeur }, "Statut enregistré")}
              />
            )}
            <ZoneTexte libelle="Noter" rows={2} maxLength={2000} placeholder="Appelé, gérant absent, rappeler lundi…" value={note} onChange={(evenement) => setNote(evenement.target.value)} />
            <div className="flex justify-end">
              <Bouton variante="primaire" disabled={note.trim().length < 2} chargement={envoi === "note"} onClick={() => void modifier("note", { note }, "Note enregistrée").then((ok) => ok && setNote(""))}>
                Enregistrer la note
              </Bouton>
            </div>
          </div>
        </section>

        <section>
          <TitreSection>Pourquoi ce prospect</TitreSection>
          <div className={cn(CARTE, "space-y-2 text-[13px]")}>
            {detail.signalPrincipal ? <p className="text-[#F2F3F5]">« {detail.signalPrincipal} »</p> : null}
            {detail.scoreDetails?.signaux.length ? (
              <ul className="space-y-0.5">
                {detail.scoreDetails.signaux.map((signal, index) => (
                  <li key={`${signal.label}-${index}`} className="flex justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate text-[#9CA3AF]">{signal.label}</span>
                    <span className="shrink-0 text-[#D1D5DB] tabular-nums">+{signal.points}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[#6B7280]">{detail.statut === "SOURCE" ? "Pas encore scoré : lance « Scorer » sur l'agent." : "Aucun signal d'usure retenu."}</p>
            )}
            {detail.angleSuggere ? <p className="border-t-[0.5px] border-[#2A2D34] pt-2 text-[#9CA3AF]">Angle : {detail.angleSuggere}</p> : null}
          </div>
        </section>

        {detail.avis.length > 0 ? (
          <section>
            <TitreSection>Avis Google · {detail.avis.length}</TitreSection>
            <ul className="space-y-2">
              {detail.avis.map((avis, index) => (
                <li key={index} className="rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2">
                  <p className="text-[11.5px] text-[#6B7280]">
                    {"★".repeat(Math.max(0, Math.min(5, Math.round(avis.note))))}
                    {avis.le ? ` · ${formatDateCourte(avis.le)}` : ""}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[#D1D5DB]">{avis.texte}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <TitreSection>Établissement</TitreSection>
          <div className={cn(CARTE, "space-y-1.5 text-[13px]")}>
            {[
              ["Adresse", detail.adresse],
              ["E-mail", detail.email],
              ["SIRET", detail.siret],
              ["Fermeture", detail.fermetureHebdo],
            ].map(([libelle, valeur]) =>
              valeur ? (
                <p key={libelle} className="flex justify-between gap-3">
                  <span className="text-[#9CA3AF]">{libelle}</span>
                  <span className="min-w-0 text-right">{valeur}</span>
                </p>
              ) : null
            )}
            {detail.siteWeb ? (
              <p className="flex justify-between gap-3">
                <span className="text-[#9CA3AF]">Site</span>
                <a href={detail.siteWeb} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-[#5DCAA5] hover:underline">
                  {detail.siteWeb.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink size={12} aria-hidden />
                </a>
              </p>
            ) : null}
          </div>
        </section>

        <section>
          <TitreSection>Historique</TitreSection>
          <ol className="space-y-1.5">
            {detail.activites.map((activite) => (
              <li key={activite.id} className="text-[12.5px] text-[#D1D5DB]">
                {LIBELLES_ACTIVITE[activite.type] ?? activite.type}
                {activite.message ? ` : ${activite.message}` : ""}
                <span className="block text-[11.5px] text-[#6B7280]">{formatHorodatage(activite.le)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
