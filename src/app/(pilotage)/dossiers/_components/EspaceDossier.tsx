"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, Copy, ExternalLink, ImagePlus, Link2, MessageSquare, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail } from "@/lib/dossiers/types";
import { appelApi, envoyerJson, messageErreur, preparerPhoto } from "./client";
import { Pastille } from "@/components/pilotage/ui";
import { Bouton, Champ, Modale, TitreSection } from "./ui";

type EspaceVu = {
  id: string;
  lien: string | null;
  expireLe: string;
  revoqueLe: string | null;
  premierAccesLe: string | null;
  dernierAccesLe: string | null;
  nbAcces: number;
  souhaits: { teintes?: string[]; style?: string | null; propositions?: boolean; precisions?: string } | null;
  simulations: { id: string; titre: string | null; description: string | null; url: string; choisie: boolean; commentaire: string | null; le: string }[];
  accord: { le: string; nom: string; numeroDevis: string | null; total: number } | null;
};

const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

/**
 * L'espace client vu du dossier : le lien (à copier, ou à envoyer par SMS depuis
 * la messagerie), ce que le client y a fait, et les simulations que Lucas y
 * dépose. C'est ici que le visuel validé devient un devis signé.
 */
export function EspaceDossier({ detail, onRecharger }: { detail: DossierDetail; onRecharger: () => Promise<void> }) {
  const [espace, setEspace] = useState<EspaceVu | null | undefined>(undefined);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [depot, setDepot] = useState<File | null>(null);
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const entree = useRef<HTMLInputElement>(null);

  const charger = useCallback(async () => {
    try {
      setEspace((await appelApi<{ espace: EspaceVu | null }>(`/api/dossiers/${detail.id}/espace`)).espace);
    } catch {
      setEspace(null);
    }
  }, [detail.id]);

  useEffect(() => {
    const premier = window.setTimeout(() => void charger(), 0);
    return () => window.clearTimeout(premier);
  }, [charger]);

  async function agir(action: "ouvrir" | "revoquer" | "renouveler", succes: string) {
    setOccupe(action);
    try {
      setEspace((await envoyerJson<{ espace: EspaceVu }>(`/api/dossiers/${detail.id}/espace`, "POST", { action })).espace);
      toast.success(succes);
      await onRecharger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function copier() {
    if (!espace?.lien) return;
    try {
      await navigator.clipboard.writeText(espace.lien);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      toast.error("Copie impossible : sélectionnez le lien à la main.");
    }
  }

  async function deposer() {
    if (!depot) return;
    setOccupe("depot");
    try {
      const formulaire = new FormData();
      formulaire.append("image", await preparerPhoto(depot));
      formulaire.append("titre", titre);
      formulaire.append("description", description);
      await appelApi(`/api/dossiers/${detail.id}/espace/simulations`, { method: "POST", body: formulaire });
      toast.success("Simulation déposée dans l'espace du client", { description: "Pensez à le prévenir : message type « Simulation déposée » dans la messagerie." });
      setDepot(null);
      setTitre("");
      setDescription("");
      await Promise.all([charger(), onRecharger()]);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function retirer(id: string) {
    setOccupe(`retirer-${id}`);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/espace/simulations/${id}`, "POST");
      toast.success("Simulation retirée de l'espace");
      await charger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  const souhaits = espace?.souhaits;
  const resumeSouhaits = souhaits ? [souhaits.propositions ? "veut des propositions" : null, souhaits.teintes?.length ? souhaits.teintes.join(", ") : null, souhaits.style, souhaits.precisions ? `« ${souhaits.precisions} »` : null].filter(Boolean).join(" · ") : "";

  return (
    <section>
      <TitreSection
        action={
          espace ? (
            <Bouton taille="sm" icone={<ImagePlus size={13} aria-hidden />} onClick={() => entree.current?.click()}>
              Déposer une simulation
            </Bouton>
          ) : undefined
        }
      >
        Espace client
      </TitreSection>
      <input
        ref={entree}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(evenement) => {
          setDepot(evenement.target.files?.[0] ?? null);
          evenement.target.value = "";
        }}
      />

      {espace === undefined ? (
        <p className="text-[13px] text-[#6B7280]">Chargement…</p>
      ) : espace === null ? (
        <div className="rounded-[12px] border-[0.5px] border-dashed border-[#2A2D34] p-4">
          <p className="text-[13px] text-[#9CA3AF]">Pas encore d&apos;espace pour ce dossier. Le client y déposera ses photos, choisira sa simulation et donnera son bon pour accord, sans compte ni mot de passe.</p>
          <Bouton className="mt-3" variante="primaire" icone={<Link2 size={14} aria-hidden />} chargement={occupe === "ouvrir"} onClick={() => void agir("ouvrir", "Espace client ouvert")}>
            Ouvrir l&apos;espace client
          </Bouton>
        </div>
      ) : (
        <div className="space-y-3 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {espace.revoqueLe ? <Pastille ton="rouge">Lien désactivé</Pastille> : <Pastille ton="vert">Lien actif jusqu&apos;au {jour(espace.expireLe)}</Pastille>}
            {espace.dernierAccesLe ? <Pastille>Consulté le {jour(espace.dernierAccesLe)} · {espace.nbAcces} visite{espace.nbAcces > 1 ? "s" : ""}</Pastille> : <Pastille ton="ambre">Pas encore ouvert par le client</Pastille>}
            {espace.accord ? <Pastille ton="vert">Bon pour accord le {jour(espace.accord.le)} — {espace.accord.nom}</Pastille> : null}
          </div>

          {espace.lien ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[8px] bg-[#16181D] px-2.5 py-2 text-[12px] text-[#D1D5DB]">{espace.lien}</code>
              <Bouton taille="sm" icone={copie ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copier()}>
                {copie ? "Copié" : "Copier"}
              </Bouton>
              <a href={espace.lien} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 px-1 text-[12px] text-[#5DCAA5] hover:underline sm:h-7">
                Voir <ExternalLink size={11} aria-hidden />
              </a>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {espace.lien ? (
              <Link href={`/sms?dossier=${detail.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7">
                <MessageSquare size={13} aria-hidden /> Envoyer par SMS
              </Link>
            ) : null}
            {espace.revoqueLe ? null : (
              <Bouton taille="sm" variante="fantome" icone={<ShieldOff size={13} aria-hidden />} chargement={occupe === "revoquer"} onClick={() => void agir("revoquer", "Lien désactivé")}>
                Désactiver le lien
              </Bouton>
            )}
            <Bouton taille="sm" variante="fantome" icone={<RefreshCw size={13} aria-hidden />} chargement={occupe === "renouveler"} onClick={() => void agir("renouveler", "Nouveau lien émis : l'ancien ne fonctionne plus")}>
              Nouveau lien
            </Bouton>
          </div>

          {resumeSouhaits ? (
            <p className="text-[13px] text-[#D1D5DB]">
              <span className="text-[#8B919C]">Ses envies : </span>
              {resumeSouhaits}
            </p>
          ) : null}

          {espace.simulations.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {espace.simulations.map((simulation) => (
                <li key={simulation.id} className={`overflow-hidden rounded-[10px] border-[0.5px] ${simulation.choisie ? "border-[#1D9E75]" : "border-[#2A2D34]"}`}>
                  <a href={simulation.url} target="_blank" rel="noopener noreferrer" className="relative block aspect-[4/3] bg-[#16181D]">
                    <Image src={simulation.url} alt={simulation.titre ?? "Simulation"} fill unoptimized sizes="200px" className="object-cover" />
                  </a>
                  <div className="space-y-1 p-2">
                    <p className="truncate text-[12px] text-[#F2F3F5]">{simulation.titre ?? "Sans titre"}</p>
                    {simulation.choisie ? <Pastille ton="vert">Choisie par le client</Pastille> : null}
                    {simulation.commentaire ? <p className="text-[11.5px] leading-snug text-[#9CA3AF]">« {simulation.commentaire} »</p> : null}
                    <button type="button" disabled={occupe === `retirer-${simulation.id}`} onClick={() => void retirer(simulation.id)} className="text-[11.5px] text-[#8B919C] underline-offset-2 hover:text-[#F87171] hover:underline">
                      Retirer de l&apos;espace
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-[#8B919C]">Aucune simulation déposée pour l&apos;instant.</p>
          )}
        </div>
      )}

      <Modale
        ouverte={depot !== null}
        onFermer={() => setDepot(null)}
        titre="Déposer une simulation"
        description="Le client la verra dans son espace, pourra la comparer aux autres, la choisir et la commenter."
        pied={
          <Bouton variante="primaire" className="h-12 w-full text-[15px] sm:h-9 sm:text-[13px]" chargement={occupe === "depot"} onClick={() => void deposer()}>
            Déposer dans l&apos;espace du client
          </Bouton>
        }
      >
        <div className="space-y-3">
          <p className="truncate text-[13px] text-[#9CA3AF]">{depot?.name}</p>
          <Champ libelle="Titre (facultatif)" placeholder="Chêne clair, plan de travail effet pierre" maxLength={80} value={titre} onChange={(evenement) => setTitre(evenement.target.value)} />
          <Champ libelle="Un mot pour le client (facultatif)" placeholder="La version la plus lumineuse" maxLength={400} value={description} onChange={(evenement) => setDescription(evenement.target.value)} />
        </div>
      </Modale>
    </section>
  );
}
