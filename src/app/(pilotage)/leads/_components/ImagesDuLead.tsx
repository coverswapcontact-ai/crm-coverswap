"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { TitreSection } from "@/components/pilotage/ui";
import { Visionneuse, imagesDesSimulations, indexDeVue } from "@/components/pilotage/Visionneuse";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import type { EntrantDetail } from "@/lib/prospects/types";
import { CARTE_REMPLIE, LIEN_ACTION } from "./styles-entrant";

/** Mission 13 (lot 7) — photos jointes et simulations du contact, avec la visionneuse commune ; extrait de PanneauEntrant. */

export function ImagesDuLead({ detail }: { detail: EntrantDetail }) {
  const [photoOuverte, setPhotoOuverte] = useState<number | null>(null);
  const [imageOuverte, setImageOuverte] = useState<number | null>(null);
  return (
    <>
          {detail.photos.length > 0 ? (
            <section>
              <TitreSection>Photos jointes · {detail.photos.length}</TitreSection>
              {photoOuverte !== null ? <Visionneuse images={detail.photos.map((photo, index) => ({ id: photo.id, url: photo.url, legende: `Photo ${index + 1} · ${detail.nom}` }))} index={photoOuverte} onIndex={setPhotoOuverte} onFermer={() => setPhotoOuverte(null)} /> : null}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {detail.photos.map((photo, index) => (
                  <button key={photo.id} type="button" onClick={() => setPhotoOuverte(index)} className="block w-full" aria-label={`Agrandir la photo ${index + 1}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.vignette} alt={`Photo ${index + 1} : ${detail.nom}`} loading="lazy" className="h-24 w-full rounded-[8px] border-[0.5px] border-trait object-cover" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {detail.simulations.length > 0 ? (
            <section>
              <TitreSection>Simulations · {detail.simulations.length}</TitreSection>
              {imageOuverte !== null ? <Visionneuse images={imagesDesSimulations(detail.simulations)} index={imageOuverte} onIndex={setImageOuverte} onFermer={() => setImageOuverte(null)} /> : null}
              <div className="space-y-3">
                {detail.simulations.map((simulation) => (
                  <div key={simulation.id} className={CARTE_REMPLIE}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[13.5px] text-texte">{simulation.reference ?? "Simulation"}</p>
                        <p className="text-[12px] text-texte-3">
                          {[
                            formatDateCourte(simulation.le),
                            simulation.metresLineaires ? `${simulation.metresLineaires.toLocaleString("fr-FR")} ml` : null,
                            simulation.prix ? formatMontant(simulation.prix) : null,
                            simulation.source === "SITE_DEVIS" ? "devis demandé" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <a href={simulation.pdf} target="_blank" rel="noopener noreferrer" className={LIEN_ACTION}>
                        <FileText size={14} aria-hidden /> PDF
                      </a>
                    </div>
                    {simulation.avant || simulation.apres ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {[
                          { src: simulation.avant, libelle: "Avant" },
                          { src: simulation.apres, libelle: "Après" },
                        ].map(({ src, libelle }) =>
                          src ? (
                            <button key={libelle} type="button" onClick={() => setImageOuverte(indexDeVue(detail.simulations, simulation.id, libelle === "Avant" ? "avant" : "apres"))} className="block w-full text-left" aria-label={`Agrandir : ${libelle}`}>
                              <span className="mb-1 block text-[11.5px] text-texte-3">{libelle}</span>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={src}
                                alt={`${libelle} : ${detail.nom}`}
                                loading="lazy"
                                className="h-32 w-full rounded-[8px] border-[0.5px] border-trait object-cover"
                              />
                            </button>
                          ) : (
                            <span key={libelle} />
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
    </>
  );
}
