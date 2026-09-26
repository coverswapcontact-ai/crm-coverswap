"use client";

import { useState } from "react";
import { Hash, Pencil } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CLASSE_SAISIE, Pastille, TitreSection } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import type { CompteurVue } from "@/lib/dossiers/compteurs";

/**
 * Numérotation des documents (mission 12) : le prochain numéro de chaque
 * série, lisible et modifiable. Un devis fait hors du CRM et inscrit avec un
 * numéro plus grand fait avancer le compteur tout seul ; ici, Lucas peut le
 * faire repartir plus loin (jamais derrière un numéro qui existe).
 */
export default function Numerotation({ initial }: { initial: CompteurVue[] }) {
  // Mission 13 (lot 3) : les compteurs arrivent du serveur avec la page.
  const [compteurs, setCompteurs] = useState<CompteurVue[]>(initial);
  // Mission 13 (lot 5) : le préfixe et l'année sont figés à l'écran (masque 2026-000), seul le rang se tape.
  const [edition, setEdition] = useState<{ serie: CompteurVue["serie"]; prefixe: string; annee: number; valeur: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer() {
    if (!edition) return;
    setEnvoi(true);
    try {
      const reponse = await envoyerJson<{ compteur: CompteurVue; compteurs: CompteurVue[] }>("/api/numeros/compteurs", "PATCH", { serie: edition.serie, prochain: `${edition.prefixe}${edition.annee}-${edition.valeur.padStart(3, "0")}` });
      setCompteurs(reponse.compteurs);
      setEdition(null);
      toast.success(`${reponse.compteur.libelle} : prochain numéro ${reponse.compteur.prochain}`);
    } catch (erreur) {
      toast.error("Compteur non modifié", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section className="mt-8">
      <TitreSection>Numérotation des documents</TitreSection>
      <p className="mb-3 text-[12.5px] text-[#8B919C]">
        Le prochain numéro de chaque série. Un devis fait ailleurs et enregistré avec un numéro plus grand fait avancer le compteur ; un numéro déjà inscrit au registre n&apos;est jamais réattribué.
      </p>
      {(
        <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          {compteurs.map((c) => (
            <li key={c.serie} className="border-t-[0.5px] border-[#2A2D34] px-3 py-3 first:border-t-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13.5px] font-medium text-[#F2F3F5]">
                    <Hash size={14} aria-hidden className="text-[#8B919C]" />
                    {c.libelle} {c.annee}
                    <Pastille ton="vert">prochain : {c.prochain}</Pastille>
                  </p>
                  <p className="mt-0.5 text-[12px] text-[#8B919C]">
                    Dernier numéro attribué par le CRM : {c.valeur !== null ? `${c.prefixe}${c.annee}-${String(c.valeur).padStart(3, "0")}` : "aucun cette année"} · plus haut inscrit au registre : {c.plusHautRegistre ? `${c.prefixe}${c.annee}-${String(c.plusHautRegistre).padStart(3, "0")}` : "aucun"}
                  </p>
                </div>
                {edition?.serie === c.serie ? null : (
                  <Bouton taille="sm" variante="fantome" icone={<Pencil size={13} aria-hidden />} onClick={() => setEdition({ serie: c.serie, prefixe: c.prefixe, annee: c.annee, valeur: c.prochain.replace(/^.*-/, "") })}>
                    Faire repartir à…
                  </Bouton>
                )}
              </div>
              {edition?.serie === c.serie ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="w-[190px]">
                    <label htmlFor={`prochain-${c.serie}`} className="mb-1 block text-[12px] text-[#9CA3AF]">
                      Prochain numéro
                    </label>
                    <div className={cn(CLASSE_SAISIE, "flex h-11 items-center gap-0.5 sm:h-9")}>
                      <span className="shrink-0 text-[#8B919C] tabular-nums" aria-hidden>
                        {c.prefixe}
                        {c.annee}-
                      </span>
                      <input
                        id={`prochain-${c.serie}`}
                        value={edition.valeur}
                        onChange={(evenement) => setEdition({ ...edition, valeur: evenement.target.value.replace(/\D/g, "").slice(0, 5) })}
                        onBlur={() => setEdition((e) => (e && e.valeur ? { ...e, valeur: e.valeur.padStart(3, "0") } : e))}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="000"
                        aria-label={`Prochain numéro : rang après ${c.prefixe}${c.annee}-`}
                        className="w-full min-w-0 bg-transparent tabular-nums outline-none placeholder:text-[#4B5563]"
                      />
                    </div>
                    <p className="mt-1 text-[12px] text-[#6B7280]">Au plus tôt {c.prefixe}{c.annee}-{String(c.plusHautRegistre + 1).padStart(3, "0")}.</p>
                  </div>
                  <Bouton variante="primaire" chargement={envoi} disabled={!edition.valeur} onClick={() => void enregistrer()}>
                    Enregistrer
                  </Bouton>
                  <Bouton variante="fantome" onClick={() => setEdition(null)}>
                    Annuler
                  </Bouton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
