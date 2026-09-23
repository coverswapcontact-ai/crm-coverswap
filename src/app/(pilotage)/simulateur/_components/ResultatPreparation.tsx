"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy, Download, ExternalLink, ImagePlus, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton, Pastille } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Ce que le CRM rend après « Préparer pour ChatGPT » : trois choses, dans
 * l'ordre des gestes sur l'iPhone — enregistrer les deux images (une feuille
 * de partage : « Enregistrer 2 images »), copier le prompt, ouvrir ChatGPT —
 * puis, au retour, déposer l'image rendue : elle reprend tout.
 *
 * Et pour le mode API : le suivi jusqu'au brouillon.
 */

export type Preparation = {
  id: string;
  dossierId: string;
  mode: "CHATGPT" | "API";
  statut: string;
  typeSurface?: string;
  typeLibelle: string;
  photoId?: string;
  zones: { zone: string; libelle: string; etiquette: string; ref: string; nom: string; resume: string; hex: string | null }[];
  prompt: string | null;
  promptVersion: number | null;
  format: string | null;
  photo: string;
  planche: string;
  coutEstime: number | null;
  erreur: string | null;
  resultatId: string | null;
};

export function ResultatChatGPT({ preparation, onDepose }: { preparation: Preparation; onDepose: () => void }) {
  const [fichiers, setFichiers] = useState<File[] | null>(null);
  const [copie, setCopie] = useState(false);
  const [voirPrompt, setVoirPrompt] = useState(false);
  const [depot, setDepot] = useState<"" | "envoi" | "fait">("");
  const entree = useRef<HTMLInputElement>(null);

  // Les images sont chargées d'avance : sur iPhone, la feuille de partage doit s'ouvrir DANS le geste.
  useEffect(() => {
    let actif = true;
    void Promise.all([fetch(preparation.photo).then((r) => r.blob()), fetch(preparation.planche).then((r) => r.blob())])
      .then(([photo, planche]) => {
        if (actif) setFichiers([new File([photo], "1-photo-avant.jpg", { type: "image/jpeg" }), new File([planche], "2-planche-teintes.png", { type: "image/png" })]);
      })
      .catch(() => toast.error("Images non chargées : utilisez les liens de téléchargement."));
    return () => {
      actif = false;
    };
  }, [preparation.photo, preparation.planche]);

  // La feuille de partage sait-elle prendre des images ? (Safari iPhone : oui ; ordinateur : souvent non.)
  const partageOk = useMemo(() => Boolean(fichiers && typeof navigator !== "undefined" && navigator.canShare?.({ files: fichiers })), [fichiers]);

  async function copier() {
    try {
      await navigator.clipboard.writeText(preparation.prompt ?? "");
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    } catch {
      setVoirPrompt(true);
      toast.error("Copie refusée par le navigateur : sélectionnez le texte du prompt.");
    }
  }

  async function partager() {
    if (!fichiers) return;
    try {
      await navigator.share({ files: fichiers, title: "Simulation CoverSwap" });
    } catch (erreur) {
      if ((erreur as Error)?.name !== "AbortError") toast.error("Partage impossible : utilisez les téléchargements.");
    }
  }

  async function deposer(fichier: File) {
    setDepot("envoi");
    try {
      const formulaire = new FormData();
      formulaire.append("image", fichier);
      formulaire.append("preparation", preparation.id);
      formulaire.append("source", "CHATGPT");
      await appelApi(`/api/dossiers/${preparation.dossierId}/simulations`, { method: "POST", body: formulaire });
      setDepot("fait");
      toast.success("Rendu déposé en brouillon dans le dossier", { description: "Photo avant, teintes et version du prompt reprises." });
      onDepose();
    } catch (erreur) {
      setDepot("");
      toast.error(messageErreur(erreur));
    }
  }

  const etape = "flex gap-3 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5";
  const numero = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#112B22] text-[13px] font-semibold text-[#5DCAA5]";

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pastille ton="vert">Prêt pour ChatGPT</Pastille>
        <Pastille>{preparation.typeLibelle}</Pastille>
        {preparation.promptVersion ? <Pastille>prompt v{preparation.promptVersion}</Pastille> : null}
        {preparation.format ? <Pastille>{preparation.format}</Pastille> : null}
      </div>

      <ol className="space-y-2.5">
        <li className={etape}>
          <span className={numero}>1</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[14px] font-medium text-[#F2F3F5]">Enregistrer les deux images dans Photos</p>
            <p className="text-[12.5px] text-[#9CA3AF]">La photo avant (Image 1), cadrée au format de ChatGPT, et la planche des teintes (Image 2).</p>
            <div className="grid grid-cols-2 gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu privé */}
              <img src={preparation.photo} alt="Photo avant" className="aspect-[3/2] w-full rounded-[8px] object-cover" />
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu privé */}
              <img src={preparation.planche} alt="Planche des teintes" className="aspect-[3/2] w-full rounded-[8px] bg-[#E6E6E3] object-contain" />
            </div>
            {partageOk ? (
              <Bouton variante="primaire" className="h-11 w-full text-[14px] sm:h-9 sm:text-[13px]" icone={<Share2 size={15} aria-hidden />} onClick={() => void partager()}>
                Enregistrer les 2 images
              </Bouton>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <a href={`${preparation.photo}?telecharger=1`} download className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12.5px] text-[#D1D5DB] hover:border-[#3A3E47]">
                <Download size={13} aria-hidden /> Photo avant
              </a>
              <a href={`${preparation.planche}?telecharger=1`} download className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12.5px] text-[#D1D5DB] hover:border-[#3A3E47]">
                <Download size={13} aria-hidden /> Planche des teintes
              </a>
            </div>
          </div>
        </li>

        <li className={etape}>
          <span className={numero}>2</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[14px] font-medium text-[#F2F3F5]">Copier le prompt</p>
            <Bouton variante={copie ? "secondaire" : "primaire"} className="h-11 w-full text-[14px] sm:h-9 sm:text-[13px]" icone={copie ? <Check size={15} aria-hidden /> : <ClipboardCopy size={15} aria-hidden />} onClick={() => void copier()}>
              {copie ? "Prompt copié" : "Copier le prompt"}
            </Bouton>
            <button type="button" onClick={() => setVoirPrompt((v) => !v)} className="text-[12.5px] text-[#9CA3AF] underline underline-offset-2">
              {voirPrompt ? "Masquer le prompt" : `Lire le prompt (${(preparation.prompt ?? "").length} caractères)`}
            </button>
            {voirPrompt ? <pre className="max-h-72 overflow-auto rounded-[8px] bg-[#16181D] p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[#D1D5DB] select-all">{preparation.prompt}</pre> : null}
          </div>
        </li>

        <li className={etape}>
          <span className={numero}>3</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[14px] font-medium text-[#F2F3F5]">Dans ChatGPT : coller le prompt, joindre les 2 images, envoyer</p>
            <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] text-[14px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-9 sm:text-[13px]">
              <ExternalLink size={14} aria-hidden /> Ouvrir ChatGPT
            </a>
            <p className="text-[12px] leading-relaxed text-[#8B919C]">Dans l&apos;app : « + » → Photos → les deux dernières images, collez le prompt, envoyez. Quand l&apos;image est prête : appui long → « Enregistrer dans Photos ».</p>
          </div>
        </li>

        <li className={cn(etape, depot === "fait" && "border-[#1D9E75]/50")}>
          <span className={numero}>4</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[14px] font-medium text-[#F2F3F5]">Déposer l&apos;image rendue</p>
            <p className="text-[12.5px] text-[#9CA3AF]">Elle arrive en brouillon dans le dossier, avec la photo avant, les teintes par zone et la version du prompt.</p>
            <input
              ref={entree}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                e.target.value = "";
                if (fichier) void deposer(fichier);
              }}
            />
            {depot === "fait" ? (
              <Link href={`/dossiers?dossier=${preparation.dossierId}`} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#1D9E75] text-[14px] font-medium text-[#0B1612] sm:h-9 sm:text-[13px]">
                <Check size={15} aria-hidden /> Déposée : relire et publier dans le dossier
              </Link>
            ) : (
              <Bouton className="h-11 w-full text-[14px] sm:h-9 sm:text-[13px]" icone={depot === "envoi" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ImagePlus size={15} aria-hidden />} disabled={depot === "envoi"} onClick={() => entree.current?.click()}>
                Déposer l&apos;image de ChatGPT
              </Bouton>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}

export function SuiviApi({ preparation, onFini }: { preparation: Preparation; onFini: (p: Preparation) => void }) {
  const [courante, setCourante] = useState(preparation);
  const [secondes, setSecondes] = useState(0);

  useEffect(() => {
    if (courante.statut !== "EN_COURS") return;
    const debut = Date.now();
    const horloge = window.setInterval(() => setSecondes(Math.round((Date.now() - debut) / 1000)), 1000);
    const releve = window.setInterval(async () => {
      try {
        const { preparation: suite } = await appelApi<{ preparation: Preparation }>(`/api/simulateur/preparations/${courante.id}`);
        if (suite.statut !== "EN_COURS") {
          setCourante(suite);
          onFini(suite);
        }
      } catch {
        // relevé suivant
      }
    }, 4000);
    return () => {
      window.clearInterval(horloge);
      window.clearInterval(releve);
    };
  }, [courante.id, courante.statut, onFini]);

  if (courante.statut === "EN_COURS") {
    return (
      <div className="rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4 text-[13px] text-[#D1D5DB]">
        <p className="flex items-center gap-2 font-medium text-[#F2F3F5]">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Génération par l&apos;API… {secondes} s
        </p>
        <p className="mt-1.5 text-[12.5px] text-[#9CA3AF]">En général une minute. Vous pouvez quitter cet écran : l&apos;image arrive en brouillon dans le dossier, et je vous préviens.</p>
      </div>
    );
  }
  if (courante.statut === "ECHEC") {
    return <div className="rounded-[12px] border-[0.5px] border-[#EF4444]/35 bg-[#EF4444]/[0.07] p-4 text-[13px] text-[#FCA5A5]">Génération non aboutie : {courante.erreur}</div>;
  }
  return (
    <div className="space-y-2.5 rounded-[12px] border-[0.5px] border-[#1D9E75]/40 bg-[#1C1F25] p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-[#5DCAA5]">
        <Check size={15} aria-hidden /> Simulation générée, en brouillon dans le dossier
      </p>
      {courante.resultatId ? (
        // eslint-disable-next-line @next/next/no-img-element -- image privée servie derrière la session
        <img src={`/api/dossiers/${courante.dossierId}/simulations/${courante.resultatId}/image`} alt="Simulation générée" className="w-full rounded-[10px]" />
      ) : null}
      <Link href={`/dossiers?dossier=${courante.dossierId}`} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#1D9E75] text-[14px] font-medium text-[#0B1612] sm:h-9 sm:text-[13px]">
        Relire et publier dans le dossier
      </Link>
    </div>
  );
}
