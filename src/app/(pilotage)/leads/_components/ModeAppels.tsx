"use client";

import Link from "next/link";
import { useState } from "react";
import { FolderOpen, FolderPlus, NotebookPen, Phone, SkipForward, X } from "lucide-react";
import { jourSemaineHeure, pluriel } from "@/lib/commun/format";
import type { LigneLead, SimulationLead } from "@/lib/prospects/leads";
import { NotesAppel, noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { noterUnAppel } from "@/components/pilotage/RetourAppel";
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
      <p className="mb-2 flex items-center justify-between text-[12px] font-medium text-texte-3">
        Ce qu&apos;il a vu
        {dossierId ? (
          <Link href={`/dossiers?dossier=${dossierId}&rubrique=photos`} className="inline-flex min-h-11 items-center font-normal text-action-clair hover:underline">
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
                <span className="block aspect-[4/3] overflow-hidden rounded-[10px] border-[0.5px] border-trait bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- image protégée par la session, servie telle quelle */}
                  {simulation.apres || simulation.avant ? <img src={simulation.apres ?? simulation.avant ?? ""} alt="Rendu de la simulation" loading="lazy" className="h-full w-full object-cover" /> : null}
                </span>
                <span className="mt-1 block truncate text-[11.5px] text-texte-3">
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

/**
 * Mission 14 (partie 4) — une seule façon de noter : la fiche du lead (nom, téléphone, source, tentatives, dernier
 * échange, notes) avec « Appeler », « Noter sans appeler » et « Passer ». L'issue se note dans la feuille de fin
 * d'appel (`RetourAppel`), puis le SMS proposé ; la feuille rend alors la main à la file (`appel:termine`), qui passe
 * au lead suivant.
 */
export function ModeAppels({ file, total, ecartes, maintenant, onQuitter, onPasser, onDossier, occupe }: { file: LigneLead[]; total: number; ecartes: number; maintenant: number; onQuitter: () => void; onPasser: (id: string) => void; onDossier: (lead: LigneLead) => void; occupe: boolean }) {
  const lead = file[0] ?? null;
  // Plein écran sur téléphone : le geste retour ou un glissement depuis le bord gauche en sort.
  useRetourFerme(true, onQuitter);
  const glisser = useGlisserPourFermer(onQuitter, "droite");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-fond" style={glisser.style} {...glisser.gestionnaires}>
      <header className="flex items-center justify-between gap-3 border-b-[0.5px] border-trait px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div>
          <p className="text-[15px] font-medium text-texte">Appels à la suite</p>
          <p className="text-[12px] text-texte-3">
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
          <p className="text-[17px] font-medium text-texte">Plus personne à appeler</p>
          <p className="max-w-sm text-[13.5px] leading-relaxed text-texte-3">Tous les leads ont été appelés ou ont un rappel prévu. Les prochains arriveront ici, avec une notification.</p>
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
              <h2 className="mt-2 text-[24px] leading-tight font-semibold tracking-tight text-texte">{lead.nom}</h2>
              <p className="mt-1 text-[13.5px] text-texte-3">
                {[lead.ville, lead.codePostal].filter(Boolean).join(" ")}
                {lead.ville ? " · " : ""}
                {lead.projet}
              </p>
              <p className="mt-0.5 text-[13px] text-texte-3">
                <Provenance lead={lead} /> · arrivé {heureArrivee(lead.recuLe)}
              </p>
              {lead.prioriteMotif ? <p className="mt-1 text-[12.5px] text-texte-3">{lead.prioriteMotif}</p> : null}
              {lead.tentatives > 0 || lead.rappelLe ? (
                <p className={cn("mt-1 text-[12.5px]", lead.enRetard ? "font-medium text-retard-texte" : "text-texte-3")}>
                  {[lead.tentatives > 0 ? `${pluriel(lead.tentatives, "appel", "appels")} sans réponse d'affilée` : null, lead.rappelLe ? `rappel ${lead.enRetard ? "en retard, prévu " : "prévu "}${jourSemaineHeure(lead.rappelLe)}` : null].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              <Reponses lead={lead} toutes />
              {lead.dernierAppel ? <p className="mt-2 text-[12.5px] text-texte-3">Dernier appel : {lead.dernierAppel.contenu}</p> : null}
              {lead.simulations.length > 0 ? <SesSimulations simulations={lead.simulations} dossierId={lead.dossierId} /> : null}

              {lead.telephoneLien ? (
                <a href={lead.telephoneLien} onClick={() => noterDebutAppel(lead.id, { nom: lead.nom, dossierId: lead.dossierId, depuisFile: true })} className={cn("mt-5 flex h-16 items-center justify-center gap-3 rounded-[16px] bg-action text-[19px] font-semibold tabular-nums text-action-texte active:bg-action-clair", TRANS)}>
                  <Phone size={22} aria-hidden /> {lead.telephone}
                </a>
              ) : (
                <p className="mt-5 rounded-[14px] bg-surface-2 px-4 py-4 text-center text-[14px] text-attention-texte">Numéro illisible{lead.telephone ? ` : ${lead.telephone}` : ""}. {lead.email ? `E-mail : ${lead.email}` : ""}</p>
              )}

              <NotesAppel key={lead.id} leadId={lead.id} notes={lead.notesAppel} variante="appels" />
            </div>
          </div>
          <footer className="border-t-[0.5px] border-trait px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto grid w-full max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-2">
              <button type="button" onClick={() => onPasser(lead.id)} className={cn("flex h-14 items-center justify-center gap-1.5 rounded-[14px] border-[0.5px] border-trait px-4 text-[14px] text-texte-2 hover:border-trait-2", TRANS)}>
                <SkipForward size={16} aria-hidden /> Passer
              </button>
              {/* L'issue se note dans la feuille de fin d'appel ; ici, sans être passé par « Appeler » (appel manqué, rappelé d'un autre téléphone…). */}
              <button type="button" onClick={() => noterUnAppel({ leadId: lead.id, nom: lead.nom, dossierId: lead.dossierId, depuisFile: true })} className={cn("flex h-14 items-center justify-center gap-2 rounded-[14px] border-[0.5px] border-action/50 bg-action/10 text-[15px] font-medium text-action-clair hover:bg-action/20", TRANS)}>
                <NotebookPen size={16} aria-hidden /> Noter sans appeler
              </button>
            </div>
            {lead.dossierId ? (
              // Mission 13 (lot 5) : même onglet — l'application installée ne s'ouvre plus dans Safari ; la file d'appels se retrouve depuis Leads.
              <Link href={`/dossiers?dossier=${lead.dossierId}`} className="mx-auto mt-2 flex min-h-11 w-fit items-center gap-1.5 text-[12.5px] text-action-clair hover:underline">
                <FolderOpen size={13} aria-hidden /> Voir le dossier
              </Link>
            ) : (
              <button type="button" onClick={() => onDossier(lead)} disabled={occupe} className="mx-auto mt-2 flex min-h-11 w-fit items-center gap-1.5 text-[12.5px] text-action-clair hover:underline disabled:opacity-50">
                <FolderPlus size={13} aria-hidden /> Ouvrir son dossier sans noter d&apos;appel
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
