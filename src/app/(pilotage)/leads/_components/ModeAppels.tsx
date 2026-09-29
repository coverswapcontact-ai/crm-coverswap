"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FolderOpen, FolderPlus, Phone, SkipForward, X } from "lucide-react";
import { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel } from "@/lib/commercial/constantes";
import type { LigneLead, SimulationLead } from "@/lib/prospects/leads";
import { NotesAppel, finAppel, noterDebutAppel, type NotesAppelRef } from "@/components/pilotage/NotesAppel";
import { useGlisserPourFermer, useRetourFerme } from "@/components/pilotage/fermeture-mobile";
import { Visionneuse, imagesDesSimulations, indexDeVue } from "@/components/pilotage/Visionneuse";
import { Bouton, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import { PastillePriorite, PastilleSimulation } from "./pastilles";
import { Attente, Provenance, Reponses, heureArrivee } from "./LigneLead";

/** Mission 13 (lot 7) — le mode « enchaîner les appels » et les simulations du contact ; extrait d'EcranLeads. */

/* ── Ses simulations, pour en parler pendant l'appel ─────────────────── */

/** Mission 13 (lot 5, B8) : la visionneuse commune (après puis avant, balayage), un lien ordinaire vers le dossier. */
export function SesSimulations({ simulations, dossierId }: { simulations: SimulationLead[]; dossierId: string | null }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  const images = imagesDesSimulations(simulations);
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center justify-between text-[12px] font-medium text-[#9CA3AF]">
        Ce qu&apos;il a vu
        {dossierId ? (
          <Link href={`/dossiers?dossier=${dossierId}&rubrique=photos`} className="inline-flex min-h-11 items-center font-normal text-[#5DCAA5] hover:underline">
            Toutes les photos du dossier
          </Link>
        ) : null}
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {simulations.map((simulation) => {
          const index = indexDeVue(simulations, simulation.id, simulation.apres ? "apres" : "avant");
          return (
            <li key={simulation.id}>
              <button type="button" disabled={index < 0} onClick={() => setOuverte(index)} className="block w-full text-left disabled:opacity-60" aria-label={`Agrandir la simulation${simulation.reference ? ` ${simulation.reference}` : ""}`}>
                <span className="block aspect-[4/3] overflow-hidden rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#22262D]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- image protégée par la session, servie telle quelle */}
                  {simulation.apres || simulation.avant ? <img src={simulation.apres ?? simulation.avant ?? ""} alt="Rendu de la simulation" loading="lazy" className="h-full w-full object-cover" /> : null}
                </span>
                <span className="mt-1 block truncate text-[11.5px] text-[#8B919C]">
                  {[simulation.reference, simulation.prix ? `${Math.round(simulation.prix)} €` : null].filter(Boolean).join(" · ") || new Date(simulation.le).toLocaleDateString("fr-FR")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {ouverte !== null && images[ouverte] ? <Visionneuse images={images} index={ouverte} onIndex={setOuverte} onFermer={() => setOuverte(null)} /> : null}
    </div>
  );
}

/* ── Enchaîner les appels ──────────────────────────────────────────── */

export function ModeAppels({ file, total, ecartes, maintenant, onQuitter, onPasser, onNote, onDossier, occupe }: { file: LigneLead[]; total: number; ecartes: number; maintenant: number; onQuitter: () => void; onPasser: (id: string) => void; onNote: (lead: LigneLead, issue: IssueAppel, note: string, ouvrirDossier: boolean) => Promise<void>; onDossier: (lead: LigneLead) => void; occupe: boolean }) {
  const lead = file[0] ?? null;
  const [issue, setIssue] = useState<IssueAppel | null>(null);
  const [avecDossier, setAvecDossier] = useState(true);
  const notes = useRef<NotesAppelRef>(null);
  const [envoi, setEnvoi] = useState(false);
  const idCourant = lead?.id ?? null;
  const [idSuivi, setIdSuivi] = useState(idCourant);
  // Plein écran sur téléphone : le geste retour ou un glissement depuis le bord gauche en sort.
  useRetourFerme(true, onQuitter);
  const glisser = useGlisserPourFermer(onQuitter, "droite");
  if (idSuivi !== idCourant) {
    // Un nouveau lead s'affiche : la feuille repart vide.
    setIdSuivi(idCourant);
    setIssue(null);
    setAvecDossier(true);
  }

  async function enregistrer() {
    if (!lead || !issue) return;
    setEnvoi(true);
    try {
      // La note part d'abord (l'issue s'y accroche), puis l'appel est enregistré.
      await notes.current?.vider();
      finAppel(lead.id);
      await onNote(lead, issue, "", issue === "INTERESSE" && avecDossier);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#16181D]" style={glisser.style} {...glisser.gestionnaires}>
      <header className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div>
          <p className="text-[15px] font-medium text-[#F2F3F5]">Appels à la suite</p>
          <p className="text-[12px] text-[#8B919C]">
            {file.length > 0 ? `${total - file.length + 1} sur ${total}` : "Terminé"}
            {ecartes > 0 ? ` · ${ecartes} « à écarter » laissé${ecartes > 1 ? "s" : ""} de côté` : ""}
          </p>
        </div>
        <Bouton variante="fantome" icone={<X size={16} aria-hidden />} onClick={onQuitter}>
          Quitter
        </Bouton>
      </header>

      {!lead ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[17px] font-medium text-[#F2F3F5]">Plus personne à appeler</p>
          <p className="max-w-sm text-[13.5px] leading-relaxed text-[#9CA3AF]">Tous les leads ont été appelés ou ont un rappel prévu. Les prochains arriveront ici, avec une notification.</p>
          <Bouton variante="primaire" onClick={onQuitter}>
            Revenir à la liste
          </Bouton>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto w-full max-w-xl">
              <p className="flex flex-wrap items-center gap-2">
                <PastillePriorite priorite={lead.priorite} motif={lead.prioriteMotif} />
                {lead.simulation ? <PastilleSimulation nombre={lead.simulations.length} /> : null}
                <span className="text-[12.5px]">
                  <Attente lead={lead} maintenant={maintenant} />
                </span>
              </p>
              <h2 className="mt-2 text-[24px] leading-tight font-semibold tracking-tight text-[#F2F3F5]">{lead.nom}</h2>
              <p className="mt-1 text-[13.5px] text-[#9CA3AF]">
                {[lead.ville, lead.codePostal].filter(Boolean).join(" ")}
                {lead.ville ? " · " : ""}
                {lead.projet}
              </p>
              <p className="mt-0.5 text-[13px] text-[#8B919C]">
                <Provenance lead={lead} /> · arrivé {heureArrivee(lead.recuLe)}
              </p>
              {lead.prioriteMotif ? <p className="mt-1 text-[12.5px] text-[#8B919C]">{lead.prioriteMotif}</p> : null}
              <Reponses lead={lead} toutes />
              {lead.dernierAppel ? <p className="mt-2 text-[12.5px] text-[#8B919C]">Dernier appel : {lead.dernierAppel.contenu}</p> : null}
              {lead.simulations.length > 0 ? <SesSimulations simulations={lead.simulations} dossierId={lead.dossierId} /> : null}

              {lead.telephoneLien ? (
                <a href={lead.telephoneLien} onClick={() => noterDebutAppel(lead.id, { nom: lead.nom, dossierId: lead.dossierId })} className={cn("mt-5 flex h-16 items-center justify-center gap-3 rounded-[16px] bg-[#1D9E75] text-[19px] font-semibold tabular-nums text-[#06140F] active:bg-[#5DCAA5]", TRANS)}>
                  <Phone size={22} aria-hidden /> {lead.telephone}
                </a>
              ) : (
                <p className="mt-5 rounded-[14px] bg-[#22262D] px-4 py-4 text-center text-[14px] text-[#F5B454]">Numéro illisible{lead.telephone ? ` : ${lead.telephone}` : ""}. {lead.email ? `E-mail : ${lead.email}` : ""}</p>
              )}

              <NotesAppel key={lead.id} ref={notes} leadId={lead.id} notes={lead.notesAppel} variante="appels" />

              <p className="mt-5 mb-2 text-[12px] font-medium text-[#9CA3AF]">Issue de l&apos;appel</p>
              <div className="grid grid-cols-2 gap-2">
                {ISSUES_APPEL.map((valeur) => (
                  <button key={valeur} type="button" aria-pressed={issue === valeur} onClick={() => setIssue(valeur)} className={cn("h-14 rounded-[12px] border-[0.5px] text-[15px] font-medium", issue === valeur ? "border-[#1D9E75] bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#E5E7EB] hover:border-[#3A3E47]", TRANS)}>
                    {LIBELLES_ISSUE[valeur]}
                  </button>
                ))}
              </div>
              {issue === "INTERESSE" && lead.dossierId ? <p className="mt-3 text-[12.5px] text-[#8B919C]">Son dossier est déjà ouvert : l&apos;appel s&apos;y écrit, puis le mail avec le lien de son espace vous sera proposé.</p> : null}
              {issue === "INTERESSE" && !lead.dossierId ? (
                <label className="mt-3 flex items-start gap-2.5 text-[13.5px] leading-snug text-[#D1D5DB]">
                  <input type="checkbox" checked={avecDossier} onChange={(evenement) => setAvecDossier(evenement.target.checked)} className="mt-0.5 h-5 w-5 accent-[#1D9E75]" />
                  <span>
                    Ouvrir son dossier tout de suite
                    <span className="block text-[12px] text-[#8B919C]">Tout est repris ; il sort de Leads. Le mail avec le lien de son espace sera proposé ensuite.</span>
                  </span>
                </label>
              ) : null}
              {issue === "PAS_DE_REPONSE" ? <p className="mt-3 text-[12.5px] text-[#8B919C]">Rappel posé à demain 10 h ; le mail « j&apos;ai essayé de vous joindre » vous sera proposé.</p> : null}
              {issue === "A_RAPPELER" ? <p className="mt-3 text-[12.5px] text-[#8B919C]">Rappel posé à demain 10 h (modifiable depuis sa fiche).</p> : null}
            </div>
          </div>
          <footer className="border-t-[0.5px] border-[#2A2D34] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto grid w-full max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-2">
              <button type="button" onClick={() => onPasser(lead.id)} className={cn("flex h-14 items-center justify-center gap-1.5 rounded-[14px] border-[0.5px] border-[#2A2D34] px-4 text-[14px] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}>
                <SkipForward size={16} aria-hidden /> Passer
              </button>
              <button type="button" disabled={!issue || envoi || occupe} onClick={() => void enregistrer()} className={cn("flex h-14 items-center justify-center gap-2 rounded-[14px] bg-[#1D9E75] text-[16px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:opacity-40", TRANS)}>
                {envoi ? "Enregistrement…" : "Enregistrer · suivant"}
              </button>
            </div>
            {lead.dossierId ? (
              // Mission 13 (lot 5) : même onglet — l'application installée ne s'ouvre plus dans Safari ; la file d'appels se retrouve depuis Leads.
              <Link href={`/dossiers?dossier=${lead.dossierId}`} className="mx-auto mt-2 flex min-h-11 w-fit items-center gap-1.5 text-[12.5px] text-[#5DCAA5] hover:underline">
                <FolderOpen size={13} aria-hidden /> Voir le dossier
              </Link>
            ) : (
              <button type="button" onClick={() => onDossier(lead)} disabled={occupe} className="mx-auto mt-2 flex items-center gap-1.5 text-[12.5px] text-[#5DCAA5] hover:underline disabled:opacity-50">
                <FolderPlus size={13} aria-hidden /> Ouvrir son dossier sans noter d&apos;appel
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
