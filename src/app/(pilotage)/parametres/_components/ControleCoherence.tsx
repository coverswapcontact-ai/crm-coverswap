"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert, CircleCheck, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { RapportCoherence } from "@/lib/coherence/controle";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, TitreSection } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Contrôle de cohérence : l'étape du dossier, l'état de l'espace client, les
 * documents, les encaissements et le lead disent-ils la même chose ? Rejoué au
 * démarrage et chaque jour ; ici, à la demande. Chaque incohérence dit ce
 * qu'elle est ; « Corriger » fait le geste sans risque (tracé dans le dossier),
 * les autres se règlent depuis le dossier.
 */
export default function ControleCoherence({ initial }: { initial: RapportCoherence }) {
  const [rapport, setRapport] = useState(initial);
  const [charge, setCharge] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);

  async function relancer() {
    setCharge(true);
    try {
      setRapport(await appelApi<RapportCoherence>("/api/coherence"));
    } catch (erreur) {
      toast.error("Contrôle impossible", { description: messageErreur(erreur) });
    } finally {
      setCharge(false);
    }
  }

  async function corriger(cle: string) {
    setOccupe(cle);
    try {
      const reponse = await envoyerJson<{ corrigee: boolean; message: string; rapport: RapportCoherence }>("/api/coherence/corriger", "POST", { cle });
      setRapport(reponse.rapport);
      if (reponse.corrigee) toast.success(reponse.message);
      else toast.info(reponse.message);
    } catch (erreur) {
      toast.error("Correction impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  const n = rapport.incoherences.length;
  return (
    <section id="coherence" className="mb-10 scroll-mt-20">
      <TitreSection
        action={
          <Bouton taille="sm" icone={<RefreshCw size={13} aria-hidden />} chargement={charge} onClick={() => void relancer()}>
            Recontrôler
          </Bouton>
        }
      >
        Cohérence — {n === 0 ? "toutes les sections disent la même chose" : `${n} incohérence${n > 1 ? "s" : ""} à régler`}
      </TitreSection>
      {n === 0 ? (
        <div className="flex items-start gap-3 rounded-[11px] border-[0.5px] border-trait bg-surface px-4 py-3">
          <CircleCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-action-clair" />
          <p className="text-[13px] leading-relaxed text-texte-3">
            {rapport.dossiersControles} dossier{rapport.dossiersControles > 1 ? "s" : ""} contrôlé{rapport.dossiersControles > 1 ? "s" : ""} : étape du dossier, espace client, documents, encaissements et lead sont d&apos;accord.
          </p>
        </div>
      ) : (
        <ul className="divide-y-[0.5px] divide-trait rounded-[11px] border-[0.5px] border-trait bg-surface">
          {rapport.incoherences.map((i) => (
            <li key={i.cle} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
              <CircleAlert size={16} aria-hidden className={cn("mt-0.5 hidden shrink-0 sm:block", i.gravite === "HAUTE" ? "text-retard-texte" : "text-attention-texte")} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-texte">
                  {i.dossierId ? (
                    <Link href={`/dossiers?dossier=${i.dossierId}`} className="underline-offset-2 hover:underline">
                      {i.client}
                    </Link>
                  ) : (
                    i.client
                  )}
                  <span className={cn("ml-2 text-[11px] font-normal", i.gravite === "HAUTE" ? "text-retard-texte" : "text-attention-texte")}>{i.gravite === "HAUTE" ? "à régler vite" : "à regarder"}</span>
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-texte-3">{i.constat}</p>
              </div>
              {i.correction ? (
                <Bouton taille="sm" icone={<Wrench size={13} aria-hidden />} chargement={occupe === i.cle} disabled={occupe !== null && occupe !== i.cle} onClick={() => void corriger(i.cle)} title={i.correction} className="self-start">
                  Corriger
                </Bouton>
              ) : i.dossierId ? (
                <Link href={`/dossiers?dossier=${i.dossierId}`} className="inline-flex h-11 items-center self-start rounded-[8px] border-[0.5px] border-trait px-2.5 text-[12px] font-medium text-texte hover:border-trait-2 sm:h-7">
                  Ouvrir le dossier
                </Link>
              ) : null}
              {i.correction ? <p className="text-[11.5px] text-texte-3 sm:hidden">Corriger : {i.correction.charAt(0).toLowerCase() + i.correction.slice(1)}.</p> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-texte-3">
        Contrôlé le {new Date(rapport.le).toLocaleString("fr-FR")} en {rapport.dureeMs} ms · rejoué à chaque démarrage et une fois par jour. La matrice complète : docs/COHERENCE.md.
      </p>
    </section>
  );
}
