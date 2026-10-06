"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, History, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, EnTetePage, Pastille, TRANS } from "@/components/pilotage/ui";
import type { PromptVue } from "@/lib/simulateur/bibliotheque-types";
import { ZONES, type IdZone } from "@/lib/simulateur/types-surface";
import { cn } from "@/lib/utils";

/**
 * Simulateur → Prompts : la bibliothèque des prompts ChatGPT, un par type de
 * surface. Lire, modifier, vérifier (balises, variables, aperçu rendu), et
 * enregistrer : chaque enregistrement est une nouvelle version, jamais un
 * écrasement. Si une modification dégrade les rendus, on revient à une
 * version d'avant d'un clic. Les chiffres de chaque version (simulations,
 * publiées, masquées, choisies) disent, avec le temps, lesquelles rendent le mieux.
 */

type Verification = { erreurs: string[]; avertissements: string[]; apercu: string | null };

const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function EcranPrompts({ initial }: { initial: PromptVue[] }) {
  const [prompts, setPrompts] = useState(initial);
  const [actif, setActif] = useState<string>(initial[0]?.typeSurface ?? "cuisine");
  const prompt = prompts.find((p) => p.typeSurface === actif) ?? prompts[0];
  const [texte, setTexte] = useState(prompt?.texte ?? "");
  const [note, setNote] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [lecture, setLecture] = useState<{ numero: number; texte: string } | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const modifie = texte !== prompt?.texte;

  function choisir(type: string) {
    if (modifie && !window.confirm("Le prompt en cours de modification n'est pas enregistré. Changer quand même ?")) return;
    const suivant = prompts.find((p) => p.typeSurface === type);
    setActif(type);
    setTexte(suivant?.texte ?? "");
    setNote("");
    setVerification(null);
    setLecture(null);
  }

  function remplacer(vue: PromptVue) {
    setPrompts((liste) => liste.map((p) => (p.typeSurface === vue.typeSurface ? vue : p)));
    setTexte(vue.texte);
    setNote("");
    setVerification(null);
  }

  async function verifier() {
    setOccupe("verifier");
    try {
      setVerification(await envoyerJson<Verification>(`/api/simulateur/prompts/${actif}`, "POST", { action: "verifier", texte }));
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function enregistrer() {
    setOccupe("enregistrer");
    try {
      const { prompt: vue } = await envoyerJson<{ prompt: PromptVue }>(`/api/simulateur/prompts/${actif}`, "POST", { action: "enregistrer", texte, note: note || null });
      remplacer(vue);
      toast.success(`Version ${vue.versionCourante} enregistrée et mise en service`);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function restaurer(numero: number) {
    if (!window.confirm(`Revenir à la version ${numero} ? Elle redevient celle en service (sous un nouveau numéro) ; rien n'est effacé.`)) return;
    setOccupe(`restaurer-${numero}`);
    try {
      const { prompt: vue } = await envoyerJson<{ prompt: PromptVue }>(`/api/simulateur/prompts/${actif}`, "POST", { action: "restaurer", numero });
      remplacer(vue);
      setLecture(null);
      toast.success(`Retour à la version ${numero} (enregistré comme version ${vue.versionCourante})`);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function lire(numero: number) {
    try {
      setLecture(await appelApi<{ numero: number; texte: string }>(`/api/simulateur/prompts/${actif}?version=${numero}`));
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }

  if (!prompt) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Prompts ChatGPT"
        sousTitre="Un prompt par type de surface. Chaque modification est une nouvelle version : on revient en arrière d'un clic."
        actions={
          <Link href="/simulateur" className={cn("inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-trait bg-surface px-3 text-[13px] font-medium text-texte hover:border-trait-2 sm:h-8", TRANS)}>
            <ArrowLeft size={14} aria-hidden /> Simulateur
          </Link>
        }
      />

      <div className="mt-5 flex gap-1.5 overflow-x-auto pb-1">
        {prompts.map((p) => (
          <button key={p.typeSurface} type="button" onClick={() => choisir(p.typeSurface)} aria-pressed={actif === p.typeSurface} className={cn("h-11 shrink-0 rounded-full border-[0.5px] px-3 text-[13px] sm:h-8", actif === p.typeSurface ? "border-action/60 bg-action-fond text-action-clair" : "border-trait bg-fond text-texte-2 hover:border-trait-2", TRANS)}>
            {p.libelle} <span className="text-[11px] opacity-70">v{p.versionCourante}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-texte-3">
            <Pastille ton="vert">Version {prompt.versionCourante} en service</Pastille>
            <span>depuis le {date(prompt.misAJourLe)}</span>
            <span>· zones : {prompt.zones.map((z) => ZONES[z as IdZone]?.libelle ?? z).join(", ")}</span>
          </div>
          <details className="rounded-[10px] border-[0.5px] border-trait bg-surface px-3 py-2 text-[12.5px] text-texte-3">
            <summary className="cursor-pointer text-texte-2">Comment le prompt est rempli</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <code className="text-action-clair">[zone:…] … [/zone]</code> : section gardée seulement si la zone reçoit une teinte.
              </li>
              <li>
                <code className="text-action-clair">{"{{teinte}}"}</code> : la teinte en toutes lettres (référence, nom, couleur mesurée, veinage, finition) ; <code className="text-action-clair">{"{{etiquette}}"}</code> : son étiquette sur la planche (« A · Meubles hauts »).
              </li>
              <li>
                <code className="text-action-clair">{"{{nombre_echantillons}}"}</code>, <code className="text-action-clair">{"{{format}}"}</code> (landscape 3:2…), <code className="text-action-clair">{"{{zones_inchangees}}"}</code> (zones laissées telles quelles).
              </li>
              <li>En anglais : c&apos;est la langue que le générateur d&apos;images suit le plus fidèlement. Les étiquettes de la planche restent en français.</li>
            </ul>
          </details>
          <textarea
            value={lecture ? lecture.texte : texte}
            readOnly={Boolean(lecture)}
            onChange={(e) => {
              setTexte(e.target.value);
              setVerification(null);
            }}
            spellCheck={false}
            rows={24}
            aria-label={`Prompt ${prompt.libelle}`}
            className={cn("w-full rounded-[10px] border-[0.5px] bg-fond p-3 font-mono text-[12.5px] leading-relaxed text-texte focus:border-action/60 focus:outline-none", lecture ? "border-info/50" : "border-trait")}
          />
          {lecture ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] border-[0.5px] border-info/35 bg-info/[0.07] px-3 py-2 text-[12.5px] text-info-texte">
              Lecture de la version {lecture.numero} (non modifiable).
              <Bouton taille="sm" icone={<RotateCcw size={13} aria-hidden />} chargement={occupe === `restaurer-${lecture.numero}`} onClick={() => void restaurer(lecture.numero)}>
                Revenir à cette version
              </Bouton>
              <Bouton taille="sm" variante="fantome" onClick={() => setLecture(null)}>
                Fermer
              </Bouton>
            </div>
          ) : (
            <>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ce qui change, en une phrase (ex. « plus strict sur les poignées »)" className="h-11 w-full rounded-[8px] border-[0.5px] border-trait bg-fond px-3 text-[14px] text-texte placeholder:text-texte-3 sm:h-9 sm:text-[13px]" aria-label="Note de version" />
              <div className="flex flex-wrap gap-2">
                <Bouton icone={<ShieldCheck size={14} aria-hidden />} chargement={occupe === "verifier"} onClick={() => void verifier()}>
                  Vérifier et voir le rendu
                </Bouton>
                <Bouton variante="primaire" icone={<Save size={14} aria-hidden />} disabled={!modifie} chargement={occupe === "enregistrer"} onClick={() => void enregistrer()}>
                  Enregistrer la version {prompt.versions[0] ? prompt.versions[0].numero + 1 : 1}
                </Bouton>
                {modifie ? (
                  <Bouton variante="fantome" onClick={() => setTexte(prompt.texte)}>
                    Annuler mes modifications
                  </Bouton>
                ) : null}
              </div>
            </>
          )}
          {verification ? (
            <div className="space-y-2">
              {verification.erreurs.length === 0 && verification.avertissements.length === 0 ? (
                <p className="flex items-center gap-1.5 text-[12.5px] text-action-clair">
                  <Check size={13} aria-hidden /> Aucun problème. Aperçu rendu avec une teinte d&apos;exemple :
                </p>
              ) : null}
              {verification.erreurs.map((e) => (
                <p key={e} className="rounded-[8px] bg-retard/10 px-3 py-2 text-[12.5px] text-retard-texte">
                  {e}
                </p>
              ))}
              {verification.avertissements.map((a) => (
                <p key={a} className="rounded-[8px] bg-attention/10 px-3 py-2 text-[12.5px] text-attention-texte">
                  {a}
                </p>
              ))}
              {verification.apercu ? <pre className="max-h-96 overflow-auto rounded-[10px] border-[0.5px] border-trait bg-fond p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-texte-2">{verification.apercu}</pre> : null}
            </div>
          ) : null}
        </section>

        <aside>
          <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-texte-3 uppercase">
            <History size={13} aria-hidden /> Versions
          </h2>
          <ol className="space-y-2">
            {prompt.versions.map((v) => (
              <li key={v.numero} className={cn("rounded-[10px] border-[0.5px] bg-surface p-2.5", v.courante ? "border-action/50" : "border-trait")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-texte">
                    Version {v.numero}
                    {v.courante ? <span className="ml-1.5 text-[11px] text-action-clair">en service</span> : null}
                  </span>
                  <span className="text-[11px] text-texte-3">{date(v.le)}</span>
                </div>
                {v.note ? <p className="mt-1 text-[12px] text-texte-2">{v.note}</p> : null}
                <p className="mt-1 text-[11.5px] text-texte-3">
                  {v.stats.simulations} simulation{v.stats.simulations > 1 ? "s" : ""} · {v.stats.publiees} publiée{v.stats.publiees > 1 ? "s" : ""} · {v.stats.masquees} masquée{v.stats.masquees > 1 ? "s" : ""} · {v.stats.choisies} choisie{v.stats.choisies > 1 ? "s" : ""}
                  {v.auteur ? ` · ${v.auteur}` : ""}
                </p>
                {!v.courante ? (
                  <div className="mt-1.5 flex gap-1.5">
                    <Bouton taille="sm" variante="fantome" onClick={() => void lire(v.numero)}>
                      Lire
                    </Bouton>
                    <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={12} aria-hidden />} chargement={occupe === `restaurer-${v.numero}`} onClick={() => void restaurer(v.numero)}>
                      Revenir
                    </Bouton>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
