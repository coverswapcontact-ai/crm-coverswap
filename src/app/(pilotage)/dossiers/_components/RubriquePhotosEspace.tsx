"use client";

import { Pastille, TRANS } from "@/components/pilotage/ui";
import { Visionneuse } from "@/components/pilotage/Visionneuse";
import type { VueEspaceCrm } from "@/lib/espace/vue-crm";
import { jour } from "@/lib/commun/format";
import { cn } from "@/lib/utils";
import { Rubrique, type FaireGeste } from "./RubriqueEspace";

/** Mission 13 (lot 7) : la rubrique « Ses photos » de l'espace client vu du dossier — déposées, retirées par le client (à remettre), ouvertes dans la visionneuse. */
export function RubriquePhotosEspace({
  espace,
  occupe,
  geste,
  photoOuverte,
  setPhotoOuverte,
}: {
  espace: VueEspaceCrm;
  occupe: string | null;
  geste: FaireGeste;
  photoOuverte: number | null;
  setPhotoOuverte: (index: number | null) => void;
}) {
  const imagesEspace = [
    ...espace.photos.map((photo) => ({ id: photo.id, url: photo.url, legende: "Photo déposée par le client" })),
    ...espace.photosRetirees.map((photo) => ({ id: photo.id, url: photo.url, legende: `Photo retirée par le client le ${jour(photo.le)}` })),
  ];
  return (
    <>
      {photoOuverte !== null && imagesEspace[photoOuverte] ? <Visionneuse images={imagesEspace} index={photoOuverte} onIndex={setPhotoOuverte} onFermer={() => setPhotoOuverte(null)} /> : null}
      <Rubrique titre="Ses photos" etat={<Pastille ton={espace.photos.length ? "vert" : "neutre"}>{espace.photos.length} déposée{espace.photos.length > 1 ? "s" : ""}</Pastille>}>
        {espace.photos.length ? (
          <div className="flex flex-wrap gap-1.5">
            {espace.photos.map((photo, i) => (
              <button key={photo.id} type="button" onClick={() => setPhotoOuverte(i)} className="block h-12 w-12 overflow-hidden rounded-[6px] border-[0.5px] border-[#2A2D34]" aria-label="Agrandir la photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.vignette} alt="Photo du client" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-[#8B919C]">Aucune pour l&apos;instant.</p>
        )}
        {espace.photosRetirees.length ? (
          <div className="mt-2">
            <p className="mb-1 text-[11.5px] text-[#F5B454]">
              {espace.photosRetirees.length} photo{espace.photosRetirees.length > 1 ? "s" : ""} retirée{espace.photosRetirees.length > 1 ? "s" : ""} par le client (gardée{espace.photosRetirees.length > 1 ? "s" : ""}) :
            </p>
            <div className="flex flex-wrap gap-2">
              {espace.photosRetirees.map((photo, i) => (
                <div key={photo.id} className="flex items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-1 pr-2">
                  <button type="button" onClick={() => setPhotoOuverte(espace.photos.length + i)} className="block h-11 sm:h-9 w-11 sm:w-9 overflow-hidden rounded-[5px]" aria-label="Agrandir la photo retirée">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt="Photo retirée" loading="lazy" className="h-full w-full object-cover opacity-70" />
                  </button>
                  <span className="text-[11px] text-[#8B919C]">le {jour(photo.le)}</span>
                  <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "remettre-photo", photoId: photo.id }, "Photo remise dans le dossier et dans son espace")} className={cn("text-[11.5px] font-medium text-[#5DCAA5] hover:underline disabled:opacity-50", TRANS)}>
                    Remettre
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Rubrique>
    </>
  );
}
