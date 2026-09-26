"use client";

import { useEffect, useState } from "react";
import { Hash, Pencil } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, Pastille, TitreSection } from "@/components/pilotage/ui";
import type { CompteurVue } from "@/lib/dossiers/compteurs";

/**
 * Numérotation des documents (mission 12) : le prochain numéro de chaque
 * série, lisible et modifiable. Un devis fait hors du CRM et inscrit avec un
 * numéro plus grand fait avancer le compteur tout seul ; ici, Lucas peut le
 * faire repartir plus loin (jamais derrière un numéro qui existe).
 */
export default function Numerotation() {
  const [compteurs, setCompteurs] = useState<CompteurVue[] | null>(null);
  const [edition, setEdition] = useState<{ serie: CompteurVue["serie"]; valeur: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let actif = true;
    appelApi<{ compteurs: CompteurVue[] }>("/api/numeros/compteurs")
      .then((reponse) => actif && setCompteurs(reponse.compteurs))
      .catch((erreur) => toast.error("Numérotation illisible", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, []);

  async function enregistrer() {
    if (!edition) return;
    setEnvoi(true);
    try {
      const reponse = await envoyerJson<{ compteur: CompteurVue; compteurs: CompteurVue[] }>("/api/numeros/compteurs", "PATCH", { serie: edition.serie, prochain: edition.valeur.trim() });
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
      {compteurs === null ? (
        <p className="text-[13px] text-[#6B7280]">Chargement…</p>
      ) : (
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
                  <Bouton taille="sm" variante="fantome" icone={<Pencil size={13} aria-hidden />} onClick={() => setEdition({ serie: c.serie, valeur: c.prochain })}>
                    Faire repartir à…
                  </Bouton>
                )}
              </div>
              {edition?.serie === c.serie ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Champ
                    classeConteneur="w-[170px]"
                    libelle="Prochain numéro"
                    value={edition.valeur}
                    onChange={(evenement) => setEdition({ serie: c.serie, valeur: evenement.target.value })}
                    placeholder={c.prochain}
                    aide={`Au plus tôt ${c.prefixe}${c.annee}-${String(c.plusHautRegistre + 1).padStart(3, "0")}.`}
                  />
                  <Bouton variante="primaire" chargement={envoi} disabled={!edition.valeur.trim()} onClick={() => void enregistrer()}>
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
