"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Globe, ImageOff, Loader2 } from "lucide-react";
import type { SimulationSiteLigne, SimulationsSiteRecentes } from "@/lib/simulations/site";
import type { TravailSiteLigne, TravauxSiteRecents } from "@/lib/simulations/travaux-lecture";
import { Visionneuse, type ImageVisionneuse } from "@/components/pilotage/Visionneuse";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import { pluriel, quand } from "@/lib/commun/format";

/**
 * Mission 13 (B19) — « Sur le site cette semaine » : les simulations faites sur
 * coverswap.fr, comptées jusqu'ici dans Synthèse (hors menu) et par l'assistant
 * seulement. Une ligne repliée avec les nombres ; ouverte, une ligne par
 * simulation : vignette (visionneuse au toucher), projet et teintes, quand, et
 * le lead rattaché (ouvre sa fiche) ou « anonyme ».
 *
 * Mission 15 (partie 1) : la génération est asynchrone ; les travaux encore en
 * cours ou en échec des 7 jours s'affichent au-dessus, avec la raison d'échec
 * et « à prévenir » quand le visiteur a laissé une adresse.
 *
 * Mission 15 (partie 4) : l'entonnoir du simulateur (pièce → photo →
 * génération → résultat vu → coordonnées), avec les abandons à chaque étape.
 * Mission 16 (partie 4) : visite en tête, estimation vue (facultative) avant le contact.
 * Mission 16 (partie 6) : un sélecteur « Toutes · Meta · Recherche · Direct » (famille de la source de la visite,
 * calculée à la lecture) ; les sources « autres » sont nommées sous « Toutes ».
 * Mission 17 (partie B) : l'entonnoir quitte cet écran (Analytique, onglet Site, « Entonnoir du simulateur » : les sept étapes, les
 * abandons et le choix de la source) ;
 * restent les outils de travail : générations en cours ou en échec (visiteur à prévenir) et simulations (lead à ouvrir).
 */

function LigneSimulation({ ligne, maintenant, onImage, onLead }: { ligne: SimulationSiteLigne; maintenant: number; onImage: (() => void) | null; onLead: () => void }) {
  const vignette = ligne.image ? (
    <button type="button" onClick={onImage ?? undefined} aria-label={`Voir la simulation ${ligne.projetLibelle}`} className="h-12 w-12 shrink-0 overflow-hidden rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#22262D]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/simulations-site/${ligne.id}/image`} alt="" loading="lazy" className="h-full w-full object-cover" />
    </button>
  ) : (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-[0.5px] border-[#2A2D34] text-[#6B7280]" title="Image purgée">
      <ImageOff size={16} aria-hidden />
    </span>
  );
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      {vignette}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-[#F2F3F5]">
          {ligne.projetLibelle} <span className="text-[#9CA3AF]">· {ligne.teintes}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-[#9CA3AF]">
          <span>{quand(ligne.le, maintenant)}</span>
          <span aria-hidden>·</span>
          {ligne.leadId ? (
            <button type="button" onClick={onLead} className="min-h-[32px] font-medium text-[#5DCAA5] underline-offset-2 hover:underline">
              {ligne.leadNom ?? "lead"}
              {ligne.leadVille ? ` (${ligne.leadVille})` : ""}
            </button>
          ) : (
            <span>anonyme</span>
          )}
          {ligne.campagne ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{ligne.campagne}</span>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

const LIBELLE_STATUT: Record<TravailSiteLigne["statut"], string> = { EN_ATTENTE: "en file", EN_COURS: "en cours", PRETE: "prête", ECHEC: "en échec" };

/** Mission 15 (partie 1) : une génération encore en cours, ou en échec — avec la raison, et si le visiteur a demandé à être prévenu. */
function LigneTravail({ ligne, maintenant }: { ligne: TravailSiteLigne; maintenant: number }) {
  const enEchec = ligne.statut === "ECHEC";
  return (
    <li className="flex items-start gap-3 px-3.5 py-2.5">
      <span className={cn("mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-[0.5px] border-[#2A2D34]", enEchec ? "text-[#F87171]" : "text-[#9CA3AF]")} title={LIBELLE_STATUT[ligne.statut]}>
        {enEchec ? <AlertTriangle size={16} aria-hidden /> : <Loader2 size={16} aria-hidden className="motion-safe:animate-spin" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-[#F2F3F5]">
          {ligne.projetLibelle} <span className="text-[#9CA3AF]">· {ligne.teintes}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-[#9CA3AF]">
          <span>{quand(ligne.le, maintenant)}</span>
          <span aria-hidden>·</span>
          <span className={enEchec ? "text-[#F87171]" : undefined}>{LIBELLE_STATUT[ligne.statut]}{enEchec && ligne.erreurRaison ? ` (${ligne.erreurRaison})` : ""}</span>
          {ligne.prevenir ? (
            <>
              <span aria-hidden>·</span>
              <span>{ligne.notifie ? "prévenu par mail" : "à prévenir"}</span>
            </>
          ) : null}
        </p>
        {enEchec && ligne.erreurMessage ? <p className="mt-0.5 line-clamp-2 text-[12px] text-[#6B7280]">{ligne.erreurMessage}</p> : null}
      </div>
    </li>
  );
}

export function SurLeSite({ resume, travaux, onOuvrirLead }: { resume: SimulationsSiteRecentes; travaux?: TravauxSiteRecents; onOuvrirLead: (leadId: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [image, setImage] = useState<number | null>(null);
  const [maintenant] = useState(() => Date.now());
  const images: ImageVisionneuse[] = resume.lignes.filter((l) => l.image).map((l) => ({ id: l.id, url: `/api/simulations-site/${l.id}/image`, legende: `${l.projetLibelle} — ${l.teintes}` }));
  const indexImage = new Map(images.map((i, index) => [i.id, index]));
  const enCours = travaux?.enCours ?? 0;
  const enEchec = travaux?.enEchec ?? 0;
  const lignesTravaux = travaux?.lignes ?? [];

  return (
    <section className="mt-4 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D]">
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} className={cn("flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left", TRANS)}>
        <Globe size={15} aria-hidden className="shrink-0 text-[#9CA3AF]" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#F2F3F5]">
          Sur le site cette semaine · {pluriel(resume.total, "simulation")}
          {enCours > 0 ? <span className="text-[#9CA3AF]"> · {enCours} en cours</span> : null}
          {enEchec > 0 ? <span className="text-[#F87171]"> · {enEchec} en échec</span> : null}
        </span>
        {resume.total > 0 ? (
          <span className="hidden text-[12px] text-[#9CA3AF] sm:inline">
            {pluriel(resume.anonymes, "anonyme")} · {resume.rattachees} de leads
          </span>
        ) : null}
        <ChevronDown size={16} aria-hidden className={cn("shrink-0 text-[#9CA3AF] transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert && lignesTravaux.length > 0 ? (
        <ul className="divide-y-[0.5px] divide-[#2A2D34] border-t-[0.5px] border-[#2A2D34]" aria-label="Générations en cours ou en échec">
          {lignesTravaux.map((ligne) => (
            <LigneTravail key={ligne.id} ligne={ligne} maintenant={maintenant} />
          ))}
        </ul>
      ) : null}
      {ouvert ? (
        resume.lignes.length === 0 ? (
          <p className="border-t-[0.5px] border-[#2A2D34] px-3.5 py-3 text-[12.5px] text-[#9CA3AF]">Aucune simulation faite sur coverswap.fr ces 7 derniers jours.</p>
        ) : (
          <ul className="divide-y-[0.5px] divide-[#2A2D34] border-t-[0.5px] border-[#2A2D34]">
            {resume.lignes.map((ligne) => (
              <LigneSimulation key={ligne.id} ligne={ligne} maintenant={maintenant} onImage={indexImage.has(ligne.id) ? () => setImage(indexImage.get(ligne.id)!) : null} onLead={() => ligne.leadId && onOuvrirLead(ligne.leadId)} />
            ))}
            {resume.total > resume.lignes.length ? <li className="px-3.5 py-2 text-[12px] text-[#6B7280]">… et {resume.total - resume.lignes.length} de plus (l&apos;assistant les lit toutes : « simulations_site »).</li> : null}
          </ul>
        )
      ) : null}
      {image !== null && images[image] ? <Visionneuse images={images} index={image} onFermer={() => setImage(null)} onIndex={setImage} /> : null}
    </section>
  );
}
