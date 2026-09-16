"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, ExternalLink, ImageOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail, PhotoVue } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur, photoTropLourde, preparerPhoto } from "./client";
import { Bouton, Modale, TitreSection, TRANS } from "./ui";

// Les photos passent par une route qui exige la session : pas d'optimisation
// Next (elle chargerait l'image sans cookie).
function Vignette({ photo, taille, className }: { photo: PhotoVue; taille: string; className?: string }) {
  const [illisible, setIllisible] = useState(false);
  if (illisible) {
    return (
      <span className={cn("flex h-full w-full flex-col items-center justify-center gap-1 text-[#6B7280]", className)}>
        <ImageOff size={18} aria-hidden />
        <span className="text-[10px]">Aperçu indisponible</span>
      </span>
    );
  }
  return (
    <Image
      src={photo.url}
      alt="Photo du chantier"
      fill
      unoptimized
      sizes={taille}
      onError={() => setIllisible(true)}
      className={className}
    />
  );
}

export function PhotosDossier({
  detail,
  onRecharger,
}: {
  detail: DossierDetail;
  onRecharger: () => Promise<void>;
}) {
  const entree = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [agrandie, setAgrandie] = useState<PhotoVue | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [suppression, setSuppression] = useState(false);

  async function ajouter(fichiers: FileList | null) {
    const liste = Array.from(fichiers ?? []);
    if (liste.length === 0) return;
    let ajoutees = 0;
    for (const [index, fichier] of liste.entries()) {
      setEnvoi(liste.length > 1 ? `Envoi ${index + 1}/${liste.length}…` : "Envoi…");
      try {
        const photo = await preparerPhoto(fichier);
        if (photoTropLourde(photo)) throw new Error(`« ${fichier.name} » dépasse 9 Mo.`);
        const formulaire = new FormData();
        formulaire.set("photo", photo);
        await appelApi(`/api/dossiers/${detail.id}/photos`, { method: "POST", body: formulaire });
        ajoutees++;
      } catch (probleme) {
        toast.error("Photo non ajoutée", { description: messageErreur(probleme) });
      }
    }
    setEnvoi(null);
    if (entree.current) entree.current.value = "";
    if (ajoutees > 0) {
      toast.success(ajoutees > 1 ? `${ajoutees} photos ajoutées` : "Photo ajoutée");
      await onRecharger();
    }
  }

  async function supprimer(photo: PhotoVue) {
    setSuppression(true);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/photos/${photo.id}`, "DELETE");
      setAgrandie(null);
      toast.success("Photo supprimée");
      await onRecharger();
    } catch (probleme) {
      toast.error("Photo non supprimée", { description: messageErreur(probleme) });
    } finally {
      setSuppression(false);
      setConfirmation(false);
    }
  }

  return (
    <section>
      <TitreSection
        action={
          <>
            <input
              ref={entree}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Ajouter des photos"
              onChange={(evenement) => void ajouter(evenement.target.files)}
            />
            <Bouton
              variante="secondaire"
              taille="sm"
              icone={<Camera size={13} aria-hidden />}
              chargement={envoi !== null}
              onClick={() => entree.current?.click()}
            >
              {envoi ?? "Ajouter"}
            </Bouton>
          </>
        }
      >
        Photos du chantier ({detail.photos.length})
      </TitreSection>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {detail.photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => {
              setConfirmation(false);
              setAgrandie(photo);
            }}
            className={cn(
              "relative aspect-square overflow-hidden rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] hover:border-[#3A3E47]",
              TRANS
            )}
            aria-label="Agrandir la photo"
          >
            <Vignette photo={photo} taille="(max-width: 640px) 33vw, 150px" className="object-cover" />
          </button>
        ))}
      </div>

      {agrandie ? (
        <Modale
          ouverte
          onFermer={() => setAgrandie(null)}
          largeur="lg"
          titre="Photo du chantier"
          pied={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a
                href={agrandie.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]"
              >
                <ExternalLink size={13} aria-hidden />
                Ouvrir l&apos;original
              </a>
              {detail.photos.length > 1 ? (
                confirmation ? (
                  <div className="flex gap-2">
                    <Bouton variante="fantome" onClick={() => setConfirmation(false)}>
                      Annuler
                    </Bouton>
                    <Bouton variante="danger" chargement={suppression} onClick={() => void supprimer(agrandie)}>
                      Supprimer définitivement
                    </Bouton>
                  </div>
                ) : (
                  <Bouton variante="danger" icone={<Trash2 size={14} aria-hidden />} onClick={() => setConfirmation(true)}>
                    Supprimer
                  </Bouton>
                )
              ) : (
                <span className="text-[12px] text-[#6B7280]">Un dossier garde au moins une photo.</span>
              )}
            </div>
          }
        >
          <div className="relative h-[65dvh] w-full">
            <Vignette photo={agrandie} taille="(max-width: 896px) 100vw, 896px" className="object-contain" />
          </div>
        </Modale>
      ) : null}
    </section>
  );
}
