"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, PlusCircle, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Pastille, TRANS, TitreSection } from "@/components/pilotage/ui";
import { NouveauLien } from "@/components/pilotage/espace/NouveauLien";
import type { EspaceDuClient } from "@/lib/espace/gestion";
import { formatMontant } from "@/lib/dossiers/montants";
import { cn } from "@/lib/utils";
import { jourAvecAnnee } from "@/lib/commun/format";

const TYPES_DOCUMENT: Record<string, string> = { DEVIS: "Devis", FACTURE: "Facture", AVOIR: "Avoir" };

/**
 * La fiche client montre SON espace (mission 5) : le lien (un seul, pour
 * toujours), ses visites, ses projets et où il en est dans chacun, ses devis et
 * factures de tous les projets ; nouveau lien (avec son SMS relu), désactiver,
 * accorder un projet de plus.
 */
export function EspaceClientFiche({ clientId }: { clientId: string }) {
  const [donnees, setDonnees] = useState<EspaceDuClient | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  const charger = useCallback(async () => {
    try {
      setDonnees(await appelApi<EspaceDuClient>(`/api/clients/${clientId}/espace`));
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }, [clientId]);

  useEffect(() => {
    const premier = window.setTimeout(() => void charger(), 0);
    return () => window.clearTimeout(premier);
  }, [charger]);

  async function action(corps: Record<string, unknown>, succes: string) {
    if (!donnees?.espace) return;
    setOccupe(String(corps.action));
    try {
      setDonnees(await envoyerJson<EspaceDuClient>(`/api/espaces/${donnees.espace.permanentId}`, "POST", corps));
      toast.success(succes);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function copier(lien: string) {
    try {
      await navigator.clipboard.writeText(lien);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      toast.error("Copie impossible : sélectionnez le lien à la main.");
    }
  }

  const e = donnees?.espace ?? null;
  return (
    <section className="rounded-[11px] border-[0.5px] border-trait bg-surface p-4">
      <TitreSection>{e ? `Espace client · ${e.projets.length} projet${e.projets.length > 1 ? "s" : ""}` : "Espace client"}</TitreSection>
      {!donnees ? (
        <p className="text-[13px] text-texte-3">Chargement…</p>
      ) : !e ? (
        <p className="text-[13px] text-texte-3">Pas encore d&apos;espace : il s&apos;ouvre depuis un de ses dossiers (« Ouvrir l&apos;espace client »). Un client n&apos;en a qu&apos;un, pour toujours : ses projets suivants s&apos;y ajoutent.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {e.revoque ? <Pastille ton="rouge">Lien désactivé</Pastille> : <Pastille ton="vert">Lien actif · sans expiration</Pastille>}
            {e.dernierAccesLe ? (
              <Pastille>
                {e.nbAcces} visite{e.nbAcces > 1 ? "s" : ""} · dernière le {jourAvecAnnee(e.dernierAccesLe)}
              </Pastille>
            ) : (
              <Pastille ton="ambre">Jamais ouvert</Pastille>
            )}
            {e.confirmationRequise ? <Pastille titre="Plus de 90 jours sans visite : à la prochaine, il confirme les 4 derniers chiffres de son téléphone.">Téléphone à confirmer</Pastille> : null}
            <Pastille ton={e.projetsEnCours >= e.limite ? "ambre" : "neutre"}>
              {e.projetsEnCours} en cours sur {e.limite} permis
            </Pastille>
          </div>
          {e.projetDemandeLe ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border-[0.5px] border-attention/35 bg-attention/[0.07] px-3 py-2">
              <span className="text-[12.5px] text-attention-texte">Il demande à ouvrir un projet de plus (le {jourAvecAnnee(e.projetDemandeLe)}).</span>
              <Bouton taille="sm" icone={<PlusCircle size={13} aria-hidden />} chargement={occupe === "accorder-projet"} onClick={() => void action({ action: "accorder-projet", nombre: 1 }, "Un projet de plus accordé")}>
                Accorder un projet
              </Bouton>
            </div>
          ) : null}
          {e.lien ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[8px] bg-fond px-2.5 py-2 text-[12px] text-texte-2">{e.lien}</code>
              <Bouton taille="sm" icone={copie ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copier(e.lien!)}>
                {copie ? "Copié" : "Copier"}
              </Bouton>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {e.apercu ? (
              <a href={e.apercu} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-trait bg-surface px-2.5 text-[12px] font-medium text-texte hover:border-trait-2 sm:h-7">
                <Eye size={13} aria-hidden /> Voir comme le client
              </a>
            ) : null}
            <NouveauLien permanentId={e.permanentId} email={donnees.email} onFait={charger} />
            {e.revoque ? null : (
              <Bouton taille="sm" variante="fantome" icone={<ShieldOff size={13} aria-hidden />} chargement={occupe === "desactiver"} onClick={() => void action({ action: "desactiver" }, "Lien désactivé : il ne mène plus à rien")}>
                Désactiver le lien
              </Bouton>
            )}
            {!e.projetDemandeLe ? (
              <Bouton taille="sm" variante="fantome" icone={<PlusCircle size={13} aria-hidden />} chargement={occupe === "accorder-projet"} onClick={() => void action({ action: "accorder-projet", nombre: 1 }, "Un projet de plus accordé")}>
                Permettre un projet de plus
              </Bouton>
            ) : null}
          </div>

          <ul>
            {e.projets.map((p) => (
              <li key={p.espaceId} className="border-t-[0.5px] border-trait first:border-t-0">
                <Link href={`/dossiers?dossier=${p.dossierId}`} className={cn("flex items-start justify-between gap-3 py-2 hover:bg-surface-2", TRANS)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] text-texte">
                      {p.nomProjet}
                      {p.creeParLeClient ? <span className="ml-1.5 text-[11.5px] text-action-clair">ouvert par le client</span> : null}
                    </span>
                    <span className="text-[12px] text-texte-3">{p.familles.map((f) => f.libelle).join(", ") || "Familles à préciser"}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Pastille ton={p.fige === "TERMINE" ? "vert" : p.fige ? "neutre" : p.attente.qui === "MOI" ? "rouge" : "neutre"}>
                      {p.fige === "TERMINE" ? "Terminé" : p.fige === "NON_REALISE" ? "Non réalisé" : p.attente.qui === "MOI" ? `À moi : ${p.attente.libelle.toLowerCase()}` : p.etapeLibelle}
                    </Pastille>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {donnees.documents.length ? (
            <div>
              <p className="mb-1 text-[11px] font-medium tracking-[0.06em] text-texte-3 uppercase">Ses documents (ce qu&apos;il voit)</p>
              <ul className="space-y-0.5">
                {donnees.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                    <span className="min-w-0 truncate text-texte-2">
                      {TYPES_DOCUMENT[d.type] ?? d.type} {d.numero} <span className="text-texte-3">· {d.projet} · {jourAvecAnnee(d.le)}</span>
                    </span>
                    <span className="shrink-0 text-texte-3 tabular-nums">
                      {formatMontant(d.montant)} · {d.statut}
                      {d.pdf ? "" : " · sans PDF"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
