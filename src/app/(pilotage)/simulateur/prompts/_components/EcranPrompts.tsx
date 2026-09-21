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
          <Link href="/simulateur" className={cn("inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 text-[13px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-8", TRANS)}>
            <ArrowLeft size={14} aria-hidden /> Simulateur
          </Link>
        }
      />

      <div className="mt-5 flex gap-1.5 overflow-x-auto pb-1">
        {prompts.map((p) => (
          <button key={p.typeSurface} type="button" onClick={() => choisir(p.typeSurface)} aria-pressed={actif === p.typeSurface} className={cn("h-9 shrink-0 rounded-full border-[0.5px] px-3 text-[13px] sm:h-8", actif === p.typeSurface ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}>
            {p.libelle} <span className="text-[11px] opacity-70">v{p.versionCourante}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#9CA3AF]">
            <Pastille ton="vert">Version {prompt.versionCourante} en service</Pastille>
            <span>depuis le {date(prompt.misAJourLe)}</span>
            <span>· zones : {prompt.zones.map((z) => ZONES[z as IdZone]?.libelle ?? z).join(", ")}</span>
          </div>
          <details className="rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2 text-[12.5px] text-[#9CA3AF]">
            <summary className="cursor-pointer text-[#D1D5DB]">Comment le prompt est rempli</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <code className="text-[#5DCAA5]">[zone:…] … [/zone]</code> : section gardée seulement si la zone reçoit une teinte.
              </li>
              <li>
                <code className="text-[#5DCAA5]">{"{{teinte}}"}</code> : la teinte en toutes lettres (référence, nom, couleur mesurée, veinage, finition) ; <code className="text-[#5DCAA5]">{"{{etiquette}}"}</code> : son étiquette sur la planche (« A · Meubles hauts »).
              </li>
              <li>
                <code className="text-[#5DCAA5]">{"{{nombre_echantillons}}"}</code>, <code className="text-[#5DCAA5]">{"{{format}}"}</code> (landscape 3:2…), <code className="text-[#5DCAA5]">{"{{zones_inchangees}}"}</code> (zones laissées telles quelles).
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
            className={cn("w-full rounded-[10px] border-[0.5px] bg-[#16181D] p-3 font-mono text-[12.5px] leading-relaxed text-[#E5E7EB] focus:border-[#1D9E75]/60 focus:outline-none", lecture ? "border-[#60A5FA]/50" : "border-[#2A2D34]")}
          />
          {lecture ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] border-[0.5px] border-[#60A5FA]/35 bg-[#60A5FA]/[0.07] px-3 py-2 text-[12.5px] text-[#BFDBFE]">
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
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ce qui change, en une phrase (ex. « plus strict sur les poignées »)" className="h-10 w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 text-[14px] text-[#F2F3F5] placeholder:text-[#6B7280] sm:h-9 sm:text-[13px]" aria-label="Note de version" />
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
                <p className="flex items-center gap-1.5 text-[12.5px] text-[#5DCAA5]">
                  <Check size={13} aria-hidden /> Aucun problème. Aperçu rendu avec une teinte d&apos;exemple :
                </p>
              ) : null}
              {verification.erreurs.map((e) => (
                <p key={e} className="rounded-[8px] bg-[#EF4444]/10 px-3 py-2 text-[12.5px] text-[#FCA5A5]">
                  {e}
                </p>
              ))}
              {verification.avertissements.map((a) => (
                <p key={a} className="rounded-[8px] bg-[#EF9F27]/10 px-3 py-2 text-[12.5px] text-[#F5B454]">
                  {a}
                </p>
              ))}
              {verification.apercu ? <pre className="max-h-96 overflow-auto rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[#D1D5DB]">{verification.apercu}</pre> : null}
            </div>
          ) : null}
        </section>

        <aside>
          <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">
            <History size={13} aria-hidden /> Versions
          </h2>
          <ol className="space-y-2">
            {prompt.versions.map((v) => (
              <li key={v.numero} className={cn("rounded-[10px] border-[0.5px] bg-[#1C1F25] p-2.5", v.courante ? "border-[#1D9E75]/50" : "border-[#2A2D34]")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[#F2F3F5]">
                    Version {v.numero}
                    {v.courante ? <span className="ml-1.5 text-[11px] text-[#5DCAA5]">en service</span> : null}
                  </span>
                  <span className="text-[11px] text-[#6B7280]">{date(v.le)}</span>
                </div>
                {v.note ? <p className="mt-1 text-[12px] text-[#D1D5DB]">{v.note}</p> : null}
                <p className="mt-1 text-[11.5px] text-[#8B919C]">
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
