"use client";

import { useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton } from "@/components/pilotage/ui";

/**
 * Paramètres → Espace client : la photo de Lucas, montrée au client en haut de
 * son espace (« qui je suis »). Sans photo, un monogramme la remplace. Une
 * nouvelle photo remplace l'ancienne, qui part dans les archives.
 */
export default function PortraitEspace() {
  const [version, setVersion] = useState(() => Date.now());
  const [absente, setAbsente] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const entree = useRef<HTMLInputElement>(null);

  async function envoyer(fichier: File) {
    setOccupe(true);
    try {
      const formulaire = new FormData();
      formulaire.append("photo", fichier);
      await appelApi("/api/parametres/portrait", { method: "POST", body: formulaire });
      setAbsente(false);
      setVersion(Date.now());
      toast.success("Photo enregistrée : vos clients la voient dans leur espace");
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">Espace client</h2>
      <div className="mt-3 flex items-center gap-4 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
        {absente ? (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#22262D] text-[22px] font-semibold text-[#9CA3AF]">L</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- photo servie derrière la session
          <img key={version} src={`/api/parametres/portrait?v=${version}`} alt="Votre photo" onError={() => setAbsente(true)} className="h-16 w-16 shrink-0 rounded-full object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] text-[#F2F3F5]">Votre photo, en haut de l&apos;espace de chaque client</p>
          <p className="mt-0.5 text-[12.5px] text-[#9CA3AF]">Un visage rassure : le client sait à qui il parle. Portrait de face, lumière du jour ; recadrée en rond automatiquement.</p>
          <input
            ref={entree}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const fichier = e.target.files?.[0];
              e.target.value = "";
              if (fichier) void envoyer(fichier);
            }}
          />
          <Bouton className="mt-2.5" taille="sm" icone={<ImageUp size={13} aria-hidden />} chargement={occupe} onClick={() => entree.current?.click()}>
            {absente ? "Ajouter ma photo" : "Changer de photo"}
          </Bouton>
        </div>
      </div>
    </section>
  );
}
