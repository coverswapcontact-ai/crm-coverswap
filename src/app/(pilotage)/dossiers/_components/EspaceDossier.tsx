"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, FileText, Link2, MessageSquare, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail } from "@/lib/dossiers/types";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Pastille } from "@/components/pilotage/ui";
import { Bouton, TitreSection } from "./ui";

type EspaceVu = {
  id: string;
  lien: string | null;
  apercu: string | null;
  expireLe: string;
  revoqueLe: string | null;
  premierAccesLe: string | null;
  dernierAccesLe: string | null;
  nbAcces: number;
  projet: { resume: string } | null;
  choix: { mode: string; simulationId?: string; zones?: { libelle: string; zone: string; nom: string; ref: string }[]; commentaire: string | null; le: string } | null;
  devis: { consultations: number; consulteLe: string | null; documentId: string | null };
  propositionDemandeeLe: string | null;
  avis: { note: number; texte: string } | null;
  simulations: { id: string; titre: string | null; choisie: boolean }[];
  accord: { le: string; nom: string; numeroDevis: string | null; total: number } | null;
  /** Espace v3 : les simulations que le client crée lui-même. */
  creation?: { faites: number; restantes: number; offertes: number; enCours: number; demandeesLe: string | null };
};

const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

/**
 * L'espace client vu du dossier : le lien (à copier, à envoyer par SMS, à
 * regarder « comme le client »), et ce que le client y a fait — son projet,
 * son choix, combien de fois il a relu son devis. Les simulations ont leur
 * propre section (brouillons, publication).
 */
export function EspaceDossier({ detail, onRecharger, onFaireDevis }: { detail: DossierDetail; onRecharger: () => Promise<void>; onFaireDevis?: () => void }) {
  const [espace, setEspace] = useState<EspaceVu | null | undefined>(undefined);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

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

  async function agir(action: "ouvrir" | "revoquer" | "renouveler" | "accorder", succes: string) {
    setOccupe(action);
    try {
      setEspace((await envoyerJson<{ espace: EspaceVu }>(`/api/dossiers/${detail.id}/espace`, "POST", action === "accorder" ? { action, nombre: 3 } : { action })).espace);
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

  const choix = espace?.choix
    ? espace.choix.mode === "COMPOSITE"
      ? `Mélange : ${(espace.choix.zones ?? []).map((z) => `${z.libelle || z.zone} ${z.nom || z.ref}`).join(" · ")}`
      : `« ${espace.simulations.find((s) => s.id === espace.choix?.simulationId)?.titre ?? "une simulation"} »`
    : null;

  return (
    <section>
      <TitreSection>Espace client</TitreSection>
      {espace === undefined ? (
        <p className="text-[13px] text-[#6B7280]">Chargement…</p>
      ) : espace === null ? (
        <div className="rounded-[12px] border-[0.5px] border-dashed border-[#2A2D34] p-4">
          <p className="text-[13px] text-[#9CA3AF]">Pas encore d&apos;espace pour ce dossier. Le client y déposera ses photos, précisera son projet, choisira sa simulation et donnera son bon pour accord, sans compte ni mot de passe.</p>
          <Bouton className="mt-3" variante="primaire" icone={<Link2 size={14} aria-hidden />} chargement={occupe === "ouvrir"} onClick={() => void agir("ouvrir", "Espace client ouvert")}>
            Ouvrir l&apos;espace client
          </Bouton>
        </div>
      ) : (
        <div className="space-y-3 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {espace.revoqueLe ? <Pastille ton="rouge">Lien désactivé</Pastille> : <Pastille ton="vert">Lien actif jusqu&apos;au {jour(espace.expireLe)}</Pastille>}
            {espace.dernierAccesLe ? <Pastille>Vu le {jour(espace.dernierAccesLe)} · {espace.nbAcces} visite{espace.nbAcces > 1 ? "s" : ""}</Pastille> : <Pastille ton="ambre">Pas encore ouvert par le client</Pastille>}
            {espace.devis.consultations > 0 && !espace.accord ? <Pastille ton={espace.devis.consultations >= 3 ? "rouge" : "ambre"}>Devis relu {espace.devis.consultations} fois</Pastille> : null}
            {espace.accord ? <Pastille ton="vert">Bon pour accord le {jour(espace.accord.le)} — {espace.accord.nom}</Pastille> : null}
          </div>

          {espace.lien ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[8px] bg-[#16181D] px-2.5 py-2 text-[12px] text-[#D1D5DB]">{espace.lien}</code>
              <Bouton taille="sm" icone={copie ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copier()}>
                {copie ? "Copié" : "Copier"}
              </Bouton>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {espace.apercu ? (
              <a href={espace.apercu} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7">
                <Eye size={13} aria-hidden /> Voir comme le client
              </a>
            ) : null}
            {espace.lien ? (
              <Link href={`/sms?dossier=${detail.id}&proposer=${espace.projet || espace.simulations.length || espace.devis.documentId || espace.accord ? "LIEN_ESPACE_RAPPEL" : "LIEN_ESPACE"}`} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7">
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

          <dl className="space-y-1.5 text-[13px]">
            <div>
              <dt className="inline text-[#8B919C]">Son projet : </dt>
              <dd className="inline text-[#D1D5DB]">{espace.projet?.resume || "pas encore précisé"}</dd>
            </div>
            {choix ? (
              <div>
                <dt className="inline text-[#8B919C]">Son choix : </dt>
                <dd className="inline text-[#5DCAA5]">
                  {choix}
                  {espace.choix?.commentaire ? <span className="text-[#D1D5DB]"> — « {espace.choix.commentaire} »</span> : null}
                </dd>
              </div>
            ) : null}
            {espace.creation ? (
              <div>
                <dt className="inline text-[#8B919C]">Ses simulations : </dt>
                <dd className="inline text-[#D1D5DB]">
                  {espace.creation.faites} faite{espace.creation.faites > 1 ? "s" : ""} sur {espace.creation.offertes} · {espace.creation.restantes} restante{espace.creation.restantes > 1 ? "s" : ""}
                  {espace.creation.enCours ? ` · ${espace.creation.enCours} en cours` : ""}
                  {espace.creation.demandeesLe ? <span className="text-[#F5B454]"> · en demande d&apos;autres depuis le {jour(espace.creation.demandeesLe)}</span> : null}
                </dd>
              </div>
            ) : null}
            {espace.propositionDemandeeLe ? (
              <div>
                <dt className="inline text-[#8B919C]">Autre proposition demandée : </dt>
                <dd className="inline text-[#F5B454]">le {jour(espace.propositionDemandeeLe)}</dd>
              </div>
            ) : null}
            {espace.avis ? (
              <div>
                <dt className="inline text-[#8B919C]">Son avis : </dt>
                <dd className="inline text-[#D1D5DB]">
                  {espace.avis.note}/5{espace.avis.texte ? ` — « ${espace.avis.texte} »` : ""}
                </dd>
              </div>
            ) : null}
          </dl>

          {espace.creation && (espace.creation.demandeesLe || espace.creation.restantes === 0) && !espace.revoqueLe ? (
            <Bouton variante={espace.creation.demandeesLe ? "primaire" : "secondaire"} chargement={occupe === "accorder"} onClick={() => void agir("accorder", "3 simulations accordées : le client peut en refaire")}>
              Accorder 3 simulations
            </Bouton>
          ) : null}

          {/* Il a choisi (ou dit ce qu'il veut) et aucun devis n'existe : le devis part de là, prérempli. */}
          {onFaireDevis && (espace.choix || espace.projet) && !detail.documents.some((d) => d.type === "DEVIS" && d.numero) ? (
            <Bouton variante={espace.choix ? "primaire" : "secondaire"} icone={<FileText size={14} aria-hidden />} onClick={onFaireDevis}>
              {espace.choix ? "Faire le devis depuis son choix" : "Faire le devis depuis son projet"}
            </Bouton>
          ) : null}
        </div>
      )}
    </section>
  );
}
