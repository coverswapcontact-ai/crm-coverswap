"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Play, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, EnTetePage, Modale, Pastille, TRANS } from "@/components/pilotage/ui";
import type { EtatBanc, LancementBanc, RenduBancVue } from "@/lib/simulateur/banc/banc";
import type { VarianteBanc } from "@/lib/simulateur/banc/cas";
import { cn } from "@/lib/utils";
import { CarteCas, dollars } from "./CarteCas";

/**
 * Le banc de comparaison (mission 15, partie 3) : six cas × trois variantes,
 * coût estimé AVANT tout lancement, confirmation, puis la page se relit toutes
 * les 5 secondes pendant que les rendus arrivent (tâches de fond, deux à la
 * fois). Rien ne part sans le clic.
 */

type Selection = { cas?: string; variante?: VarianteBanc; libelle: string; rendus: number; cout: number };

const LIEN = cn("inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-trait bg-surface px-3 text-[13px] font-medium text-texte hover:border-trait-2 sm:h-8", TRANS);

export default function EcranBanc({ initial }: { initial: EtatBanc }) {
  const [etat, setEtat] = useState(initial);
  const [confirmation, setConfirmation] = useState<Selection | null>(null);
  const [occupe, setOccupe] = useState(false);

  const relire = useCallback(async () => {
    try {
      setEtat(await appelApi<EtatBanc>("/api/simulateur/banc"));
    } catch {
      // relevé suivant
    }
  }, []);

  // La page se relit toutes les 5 s (les rendus arrivent en tâches de fond).
  useEffect(() => {
    const releve = window.setInterval(() => void relire(), 5000);
    return () => window.clearInterval(releve);
  }, [relire]);

  // Le dernier rendu de chaque cas et de chaque variante, et le nombre de rendus plus anciens.
  const { derniers, anciens } = useMemo(() => {
    const derniers: Record<string, Partial<Record<VarianteBanc, RenduBancVue>>> = {};
    const anciens: Record<string, Partial<Record<VarianteBanc, number>>> = {};
    for (const r of etat.rendus) {
      derniers[r.cas] ??= {};
      anciens[r.cas] ??= {};
      if (!derniers[r.cas][r.variante]) derniers[r.cas][r.variante] = r;
      else anciens[r.cas][r.variante] = (anciens[r.cas][r.variante] ?? 0) + 1;
    }
    return { derniers, anciens };
  }, [etat.rendus]);

  const affiches = useMemo(() => Object.values(derniers).flatMap((v) => Object.values(v)).filter((r): r is RenduBancVue => Boolean(r)), [derniers]);
  const coutAffiche = affiches.reduce((s, r) => s + (r.coutDollars ?? 0), 0);
  const casLancables = etat.cas.filter((c) => c.photo);
  const { estimation, reglages } = etat;

  const coutVariante = (variante: VarianteBanc) => casLancables.reduce((s, c) => s + (estimation.parCas[c.id]?.[variante] ?? 0), 0);

  function demander(selection: Selection) {
    if (selection.rendus === 0) {
      toast.error("Aucun cas lançable : les photos sont introuvables.");
      return;
    }
    setConfirmation(selection);
  }

  async function lancer(selection: Selection) {
    setOccupe(true);
    try {
      const resultat = await envoyerJson<LancementBanc>("/api/simulateur/banc", "POST", { cas: selection.cas ?? null, variante: selection.variante ?? null });
      const ignores = resultat.ignores.length;
      toast.success(resultat.lances.length === 1 ? "1 rendu lancé" : `${resultat.lances.length} rendus lancés`, { description: ignores ? `${ignores === 1 ? "1 élément ignoré" : `${ignores} éléments ignorés`} : ${[...new Set(resultat.ignores.map((i) => i.raison))].join(", ")}.` : "Deux rendus à la fois ; la page se relit toute seule." });
      setConfirmation(null);
      await relire();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Banc de comparaison"
        sousTitre="Six photos de dossiers, trois variantes du moteur : score, coût réel, durée et prompt de chaque rendu. Rien ne part sans ton clic."
        actions={
          <Link href="/simulateur" className={LIEN}>
            <WandSparkles size={14} aria-hidden /> Simulateur
          </Link>
        }
      />

      {/* Le moteur en service : rappelé, jamais changé d'ici. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[12px] border-[0.5px] border-trait bg-surface px-3.5 py-2.5 text-[12.5px] text-texte-2">
        <span>Moteur en service pour le site, l&apos;espace et le CRM :</span>
        <Pastille ton={reglages.moteur === "V2" ? "vert" : "neutre"}>{reglages.moteur === "V2" ? "V2 — moteur studio" : "V1 — ancien prompt"}</Pastille>
        <span className="text-texte-3">
          planche {reglages.planche ? "oui" : "non"} · site {reglages.qualiteSite} · espace et CRM {reglages.qualiteEspace} · seuil {reglages.seuilControle}/10
        </span>
        <Link href="/parametres#simulateur" className="min-h-[44px] text-action-clair hover:underline sm:min-h-0 sm:leading-none">
          Paramètres → Simulateur
        </Link>
      </div>

      {/* Le coût, avant tout lancement. */}
      <section className="mt-4 rounded-[12px] border-[0.5px] border-trait bg-surface p-3.5" aria-labelledby="cout-campagne">
        <h2 id="cout-campagne" className="text-[14px] font-medium text-texte">
          Campagne complète : {estimation.rendus} rendus ({estimation.cas} cas × {etat.variantes.length} variantes)
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-texte-3">
          {estimation.rendus} × {dollars(estimation.renduMin)} à {dollars(estimation.renduMax)} selon le nombre de films et la qualité, + {estimation.analyses === 1 ? "1 analyse de photo" : `${estimation.analyses} analyses de photo`} et {estimation.controles === 1 ? "1 contrôle" : `${estimation.controles} contrôles`} (≈ 0,005 $ chacun) ≈{" "}
          <strong className="font-medium text-texte tabular-nums">{dollars(estimation.totalMin)}</strong>, jusqu&apos;à <strong className="font-medium text-texte tabular-nums">{dollars(estimation.totalMax)}</strong> si chaque rendu V2 demande une seconde tentative (contrôle sous le seuil). V1 en medium, V2 en {reglages.qualiteEspace}.
          {etat.cas.length !== casLancables.length ? ` ${etat.cas.length - casLancables.length === 1 ? "1 cas sans photo est ignoré." : `${etat.cas.length - casLancables.length} cas sans photo sont ignorés.`}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Bouton variante="primaire" icone={<Play size={14} aria-hidden />} disabled={occupe || casLancables.length === 0} onClick={() => demander({ libelle: "la campagne complète", rendus: estimation.rendus, cout: estimation.totalMin })}>
            Lancer la campagne
          </Bouton>
          {etat.variantes.map((v) => (
            <Bouton key={v.id} disabled={occupe || casLancables.length === 0} onClick={() => demander({ variante: v.id, libelle: `la variante ${v.libelle}`, rendus: casLancables.length, cout: coutVariante(v.id) })} title={v.description}>
              {v.libelle} · {casLancables.length === 1 ? "1 rendu" : `${casLancables.length} rendus`} · ≈ {dollars(coutVariante(v.id))}
            </Bouton>
          ))}
        </div>
        <ul className="mt-3 grid gap-1 text-[12px] text-texte-3 sm:grid-cols-3">
          {etat.variantes.map((v) => (
            <li key={v.id}>
              <span className="font-medium text-texte-2">{v.libelle}</span> — {v.description}
            </li>
          ))}
        </ul>
      </section>

      {/* Le total réel : tous les rendus (rendus + contrôles) et les analyses des photos, comptés en base. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-texte-2">
        <span>
          Total de la campagne : <strong className="font-medium text-texte tabular-nums">{dollars(etat.total.coutDollars)}</strong>{" "}
          <span className="text-texte-3">
            ({etat.total.rendus === 1 ? "1 rendu lancé" : `${etat.total.rendus} rendus lancés`} en tout, dont {dollars(etat.total.analysesDollars)} d&apos;analyses de photo · rendus affichés {dollars(coutAffiche)})
          </span>
        </span>
        <span aria-live="polite">{etat.total.enCours ? <Pastille ton="bleu">{etat.total.enCours} en cours</Pastille> : null}</span>
        {etat.total.prets ? <Pastille ton="vert">{etat.total.prets === 1 ? "1 prêt" : `${etat.total.prets} prêts`}</Pastille> : null}
        {etat.total.echecs ? <Pastille ton="rouge">{etat.total.echecs} en échec</Pastille> : null}
      </div>
      <p className="mt-1.5 text-[12px] text-texte-3">Les images du banc restent 30 jours sur le volume, puis sont effacées (score, coût et prompt gardés) : télécharge celles à garder.</p>

      <div className="mt-4 space-y-3">
        {etat.cas.map((c) => (
          <CarteCas
            key={c.id}
            cas={c}
            variantes={etat.variantes}
            rendus={derniers[c.id] ?? {}}
            anciens={anciens[c.id] ?? {}}
            seuil={reglages.seuilControle}
            couts={estimation.parCas[c.id]}
            occupe={occupe}
            onLancer={({ cas }) => {
              const couts = estimation.parCas[cas];
              demander({ cas, libelle: `le cas ${c.libelle}`, rendus: etat.variantes.length, cout: couts ? Object.values(couts).reduce((s, x) => s + x, 0) : 0 });
            }}
          />
        ))}
      </div>

      <Modale
        ouverte={confirmation !== null}
        onFermer={() => setConfirmation(null)}
        titre={confirmation ? `Lancer ${confirmation.libelle} ?` : ""}
        description="Chaque rendu est facturé par OpenAI. Deux rendus tournent à la fois ; la page se relit toute seule."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setConfirmation(null)}>
              Annuler
            </Bouton>
            <Bouton variante="primaire" chargement={occupe} onClick={() => confirmation && void lancer(confirmation)}>
              Lancer {confirmation?.rendus === 1 ? "1 rendu" : `${confirmation?.rendus ?? 0} rendus`}
            </Bouton>
          </div>
        }
      >
        {confirmation ? (
          <p className="text-[13px] leading-relaxed text-texte-2">
            {confirmation.rendus === 1 ? "1 rendu" : `${confirmation.rendus} rendus`}, coût estimé <strong className="font-medium text-texte tabular-nums">{dollars(confirmation.cout)}</strong> pour une tentative par rendu (analyses et contrôles en plus, environ un demi-centime chacun ; une seconde tentative double le rendu V2 concerné). Un cas dont la photo est introuvable, ou un rendu déjà en cours pour la même variante, est ignoré.
          </p>
        ) : null}
      </Modale>
    </div>
  );
}
