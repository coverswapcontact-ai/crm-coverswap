"use client";

import { useState } from "react";
import { ClipboardCopy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Bouton, Modale, Pastille } from "@/components/pilotage/ui";
import type { CasBancVue, RenduBancVue } from "@/lib/simulateur/banc/banc";
import type { DefinitionVariante, VarianteBanc } from "@/lib/simulateur/banc/cas";
import { cn } from "@/lib/utils";

/**
 * Un cas du banc : la photo, puis les trois rendus côte à côte (vignette →
 * plein écran, score du contrôle, coût réel, durée, « Voir le prompt »).
 */

export const dollars = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;
export const duree = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")} s` : `${Math.round(ms / 1000)} s`);

const ETAPES: Record<string, string> = { analyse: "Lecture de la photo", matieres: "Préparation des matières", rendu: "Rendu photographique" };

function PastilleStatut({ rendu, seuil }: { rendu: RenduBancVue; seuil: number }) {
  if (rendu.statut === "EN_ATTENTE") return <Pastille>en attente</Pastille>;
  if (rendu.statut === "EN_COURS")
    return (
      <Pastille ton="bleu">
        <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden /> {rendu.etape && ETAPES[rendu.etape] ? ETAPES[rendu.etape] : "en cours"}
      </Pastille>
    );
  if (rendu.statut === "ECHEC") return <Pastille ton="rouge">échec</Pastille>;
  if (typeof rendu.score === "number")
    return (
      <Pastille ton={rendu.score < seuil ? "ambre" : "vert"}>
        contrôle {rendu.score}/10{rendu.tentatives && rendu.tentatives > 1 ? ` · ${rendu.tentatives} essais` : ""}
      </Pastille>
    );
  return <Pastille ton="vert">prêt · sans contrôle</Pastille>;
}

function Prompt({ rendu, ouvert, onFermer }: { rendu: RenduBancVue; ouvert: boolean; onFermer: () => void }) {
  const [copie, setCopie] = useState(false);
  async function copier() {
    try {
      await navigator.clipboard.writeText(rendu.promptTexte ?? "");
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    } catch {
      toast.error("Copie refusée par le navigateur : sélectionne le texte.");
    }
  }
  return (
    <Modale
      ouverte={ouvert}
      onFermer={onFermer}
      titre={`Prompt · ${rendu.variante}`}
      description={`${(rendu.promptTexte ?? "").length} caractères · moteur ${rendu.moteur ?? "?"}${rendu.qualite ? ` · ${rendu.qualite}` : ""}`}
      largeur="lg"
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Fermer
          </Bouton>
          <Bouton variante="primaire" icone={copie ? <Check size={14} aria-hidden /> : <ClipboardCopy size={14} aria-hidden />} onClick={() => void copier()}>
            {copie ? "Copié" : "Copier le prompt"}
          </Bouton>
        </div>
      }
    >
      {rendu.directionArtistique ? <p className="mb-3 text-[12.5px] leading-relaxed text-texte-3">Direction artistique : {rendu.directionArtistique}</p> : null}
      <pre className="rounded-[8px] bg-fond p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-texte-2 select-all">{rendu.promptTexte}</pre>
    </Modale>
  );
}

function Rendu({ rendu, variante, seuil, anciens, onVoir }: { rendu: RenduBancVue | undefined; variante: DefinitionVariante; seuil: number; anciens: number; onVoir: (r: RenduBancVue) => void }) {
  const [prompt, setPrompt] = useState(false);
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-[12px] font-medium text-texte">{variante.libelle}</p>
      {rendu?.image ? (
        <button type="button" onClick={() => onVoir(rendu)} className="block aspect-[3/2] w-full overflow-hidden rounded-[8px] border-[0.5px] border-trait bg-fond" aria-label={`Voir le rendu ${variante.libelle} en plein écran`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- image privée servie derrière la session */}
          <img src={rendu.image} alt="" className="h-full w-full object-cover" loading="lazy" />
        </button>
      ) : (
        <div className={cn("flex aspect-[3/2] w-full items-center justify-center rounded-[8px] border-[0.5px] border-dashed border-trait px-2 text-center text-[11.5px] text-texte-3", rendu?.statut === "EN_COURS" && "border-info/40")}>
          {rendu ? (rendu.statut === "ECHEC" ? "Pas de rendu" : "En préparation…") : "Pas encore lancé"}
        </div>
      )}
      {rendu ? (
        <>
          <div className="flex flex-wrap gap-1">
            <PastilleStatut rendu={rendu} seuil={seuil} />
          </div>
          {rendu.statut === "ECHEC" && rendu.erreur ? <p className="text-[11.5px] leading-snug text-attention-texte">{rendu.erreur}</p> : null}
          {rendu.statut === "PRET" ? (
            <p className="text-[11.5px] text-texte-3 tabular-nums">
              {rendu.coutDollars !== null ? dollars(rendu.coutDollars) : "coût inconnu"}
              {rendu.dureeMs !== null ? ` · ${duree(rendu.dureeMs)}` : ""}
            </p>
          ) : null}
          {rendu.defauts.length ? <p className="text-[11.5px] leading-snug text-attention-texte">{rendu.defauts.map((d) => d.detail).join(" · ")}</p> : null}
          {rendu.promptTexte ? (
            <button type="button" onClick={() => setPrompt(true)} className="min-h-[44px] text-[12px] text-texte-3 underline underline-offset-2 sm:min-h-0">
              Voir le prompt
            </button>
          ) : null}
          {anciens > 0 ? <p className="text-[11px] text-texte-3">{anciens === 1 ? "1 rendu précédent" : `${anciens} rendus précédents`}</p> : null}
          {rendu.promptTexte ? <Prompt rendu={rendu} ouvert={prompt} onFermer={() => setPrompt(false)} /> : null}
        </>
      ) : null}
    </div>
  );
}

export function CarteCas({
  cas,
  variantes,
  rendus,
  anciens,
  seuil,
  couts,
  occupe,
  onLancer,
}: {
  cas: CasBancVue;
  variantes: readonly DefinitionVariante[];
  /** Le dernier rendu de chaque variante. */
  rendus: Partial<Record<VarianteBanc, RenduBancVue>>;
  /** Combien de rendus plus anciens par variante. */
  anciens: Partial<Record<VarianteBanc, number>>;
  seuil: number;
  couts: Record<VarianteBanc, number> | undefined;
  occupe: boolean;
  onLancer: (selection: { cas: string; variante?: VarianteBanc }) => void;
}) {
  const [pleinEcran, setPleinEcran] = useState<RenduBancVue | null>(null);
  const [photoGrande, setPhotoGrande] = useState(false);
  const coutCas = couts ? Object.values(couts).reduce((s, c) => s + c, 0) : 0;
  const enCours = Object.values(rendus).some((r) => r && (r.statut === "EN_ATTENTE" || r.statut === "EN_COURS"));
  const coutReel = Object.values(rendus).reduce((s, r) => s + (r?.coutDollars ?? 0), 0);
  return (
    <section className="rounded-[12px] border-[0.5px] border-trait bg-surface p-3.5" aria-labelledby={`cas-${cas.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`cas-${cas.id}`} className="text-[14px] font-medium text-texte">
            {cas.libelle}
          </h2>
          <p className="mt-0.5 text-[12px] text-texte-3">{cas.zonesLibelles.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {cas.photo ? (
            <>
              {coutReel > 0 ? <Pastille titre="Coût réel des rendus affichés">{dollars(coutReel)} réels</Pastille> : null}
              <Bouton taille="sm" disabled={occupe || enCours} onClick={() => onLancer({ cas: cas.id })}>
                Lancer ce cas{couts ? ` · ≈ ${dollars(coutCas)}` : ""}
              </Bouton>
            </>
          ) : (
            <Pastille ton="rouge">Photo introuvable</Pastille>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[12px] font-medium text-texte">Photo</p>
          {cas.photo ? (
            <button type="button" onClick={() => setPhotoGrande(true)} className="block aspect-[3/2] w-full overflow-hidden rounded-[8px] border-[0.5px] border-trait bg-fond" aria-label="Voir la photo en plein écran">
              {/* eslint-disable-next-line @next/next/no-img-element -- photo privée servie derrière la session */}
              <img src={cas.photo.vignette} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ) : (
            <div className="flex aspect-[3/2] w-full items-center justify-center rounded-[8px] border-[0.5px] border-dashed border-retard/40 px-2 text-center text-[11.5px] text-retard-texte">Photo introuvable : le cas n&apos;est pas lancé.</div>
          )}
          <p className="text-[11px] text-texte-3">{cas.films === 1 ? "1 film" : `${cas.films} films`}</p>
        </div>
        {variantes.map((v) => (
          <Rendu key={v.id} rendu={rendus[v.id]} variante={v} seuil={seuil} anciens={anciens[v.id] ?? 0} onVoir={setPleinEcran} />
        ))}
      </div>

      <Modale ouverte={pleinEcran !== null} onFermer={() => setPleinEcran(null)} titre={pleinEcran ? `${cas.libelle} · ${pleinEcran.variante}` : ""} largeur="lg" description={pleinEcran && pleinEcran.coutDollars !== null ? `${dollars(pleinEcran.coutDollars)}${pleinEcran.dureeMs !== null ? ` · ${duree(pleinEcran.dureeMs)}` : ""}${typeof pleinEcran.score === "number" ? ` · contrôle ${pleinEcran.score}/10` : ""}` : undefined}>
        {pleinEcran?.image ? (
          <div className="space-y-2">
            {/* Place réservée par les dimensions connues : la modale ne saute pas au chargement. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- image privée servie derrière la session */}
            <img src={pleinEcran.image} alt={`Rendu ${pleinEcran.variante}`} width={pleinEcran.largeur ?? undefined} height={pleinEcran.hauteur ?? undefined} className="h-auto w-full rounded-[8px] bg-fond" />
            <a href={`${pleinEcran.image}?telecharger=1`} download className="inline-flex min-h-[44px] items-center text-[12.5px] text-texte-3 underline underline-offset-2 sm:min-h-0">
              Télécharger le rendu
            </a>
          </div>
        ) : null}
      </Modale>
      <Modale ouverte={photoGrande} onFermer={() => setPhotoGrande(false)} titre={`${cas.libelle} · photo`} largeur="lg">
        {cas.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- photo privée servie derrière la session
          <img src={cas.photo.url} alt="Photo du dossier" width={cas.photo.largeur ?? undefined} height={cas.photo.hauteur ?? undefined} className="h-auto w-full rounded-[8px] bg-fond" />
        ) : null}
      </Modale>
    </section>
  );
}
