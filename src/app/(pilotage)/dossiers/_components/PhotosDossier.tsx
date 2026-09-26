"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, ImageOff, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail, PhotoVue } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur, photoTropLourde, preparerPhoto } from "./client";
import { Visionneuse } from "@/components/pilotage/Visionneuse";
import { Bouton, TitreSection, TRANS } from "./ui";

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
  sansTitre = false,
}: {
  detail: DossierDetail;
  onRecharger: () => Promise<void>;
  sansTitre?: boolean;
}) {
  const entree = useRef<HTMLInputElement>(null);
  const entreeApres = useRef<HTMLInputElement>(null);
  const entreeAppareil = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState<{ apres: boolean; texte: string } | null>(null);
  const [agrandie, setAgrandie] = useState<PhotoVue | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const avant = detail.photos.filter((photo) => !photo.apres);
  const apres = detail.photos.filter((photo) => photo.apres);
  // Mission 12 : la visionneuse parcourt toutes les photos du dossier (avant, puis après).
  const toutes = [...avant, ...apres];

  async function ajouter(fichiers: FileList | null, apres: boolean) {
    const liste = Array.from(fichiers ?? []);
    if (liste.length === 0) return;
    let ajoutees = 0;
    for (const [index, fichier] of liste.entries()) {
      setEnvoi({ apres, texte: liste.length > 1 ? `Envoi ${index + 1}/${liste.length}…` : "Envoi…" });
      try {
        const photo = await preparerPhoto(fichier);
        if (photoTropLourde(photo)) throw new Error(`« ${fichier.name} » dépasse 9 Mo.`);
        const formulaire = new FormData();
        formulaire.set("photo", photo);
        if (apres) formulaire.set("apres", "1");
        await appelApi(`/api/dossiers/${detail.id}/photos`, { method: "POST", body: formulaire });
        ajoutees++;
      } catch (probleme) {
        toast.error("Photo non ajoutée", { description: messageErreur(probleme) });
      }
    }
    setEnvoi(null);
    if (entree.current) entree.current.value = "";
    if (entreeApres.current) entreeApres.current.value = "";
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
      toast.success("Photo retirée", { description: "Elle reste aux archives." });
      await onRecharger();
    } catch (probleme) {
      toast.error("Photo non retirée", { description: messageErreur(probleme) });
    } finally {
      setSuppression(false);
      setConfirmation(false);
    }
  }

  const actions = (
          <>
            <input
              ref={entree}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Ajouter des photos"
              onChange={(evenement) => void ajouter(evenement.target.files, false)}
            />
            {/* Sur le téléphone : l'appareil photo s'ouvre directement, sans passer par la photothèque. */}
            <input
              ref={entreeAppareil}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Prendre une photo"
              onChange={(evenement) => void ajouter(evenement.target.files, false)}
            />
            <Bouton
              variante="secondaire"
              taille="sm"
              className="md:hidden"
              icone={<Camera size={13} aria-hidden />}
              disabled={envoi !== null}
              onClick={() => entreeAppareil.current?.click()}
            >
              Photo
            </Bouton>
            <Bouton
              variante="secondaire"
              taille="sm"
              icone={<ImagePlus size={13} aria-hidden />}
              chargement={envoi !== null && !envoi.apres}
              onClick={() => entree.current?.click()}
            >
              {envoi && !envoi.apres ? envoi.texte : "Ajouter"}
            </Bouton>
          </>
  );

  return (
    <section>
      {sansTitre ? <div className="mb-3 flex flex-wrap items-center justify-end gap-2">{actions}</div> : <TitreSection action={actions}>Photos du chantier ({avant.length})</TitreSection>}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {avant.map((photo) => (
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

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-[#9CA3AF]">Après chantier · portfolio ({apres.length})</p>
        <input
          ref={entreeApres}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Ajouter des photos après chantier"
          onChange={(evenement) => void ajouter(evenement.target.files, true)}
        />
        <Bouton
          variante="secondaire"
          taille="sm"
          icone={<Camera size={13} aria-hidden />}
          chargement={envoi !== null && envoi.apres}
          onClick={() => entreeApres.current?.click()}
        >
          {envoi && envoi.apres ? envoi.texte : "Photos après"}
        </Bouton>
      </div>
      {apres.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-[#6B7280]">Une fois la pose finie : les photos du résultat, pour le portfolio.</p>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {apres.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => {
                setConfirmation(false);
                setAgrandie(photo);
              }}
              className={cn(
                "relative aspect-square overflow-hidden rounded-[9px] border-[0.5px] border-[#1D9E75]/40 bg-[#1C1F25] hover:border-[#5DCAA5]",
                TRANS
              )}
              aria-label="Agrandir la photo après chantier"
            >
              <Vignette photo={photo} taille="(max-width: 640px) 33vw, 150px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {agrandie ? (
        <Visionneuse
          images={toutes.map((photo) => ({ id: photo.id, url: photo.url, legende: photo.apres ? "Photo après chantier" : "Photo du chantier" }))}
          index={Math.max(0, toutes.findIndex((photo) => photo.id === agrandie.id))}
          onIndex={(index) => {
            setConfirmation(false);
            setAgrandie(toutes[index] ?? null);
          }}
          onFermer={() => {
            setConfirmation(false);
            setAgrandie(null);
          }}
          actions={() =>
            confirmation ? (
              <div className="flex gap-2">
                <Bouton variante="fantome" onClick={() => setConfirmation(false)}>
                  Annuler
                </Bouton>
                <Bouton variante="danger" chargement={suppression} onClick={() => void supprimer(agrandie)}>
                  Retirer (reste aux archives)
                </Bouton>
              </div>
            ) : (
              <Bouton variante="danger" icone={<Trash2 size={14} aria-hidden />} onClick={() => setConfirmation(true)}>
                Retirer
              </Bouton>
            )
          }
        />
      ) : null}
    </section>
  );
}
