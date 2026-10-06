"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileText,
  FolderInput,
  FolderOpen,
  Paperclip,
  Reply,
  Search,
  Tags,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { CarteProposition, ModaleCorrection, ModaleRejet } from "@/components/pilotage/Propositions";
import { Bouton, Modale, Pastille, TRANS } from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import {
  LIBELLES_CATEGORIE_MESSAGE,
  LIBELLES_STATUT_MESSAGE,
  formatTaille,
  type AnalyseVue,
  type MessageDetail,
  type StatutMessage,
} from "@/lib/messages/constantes";
import { cn } from "@/lib/utils";
import type { PropositionVue } from "@/lib/validation/types";
import { euros } from "@/lib/commun/format";
import { expediteur } from "./expediteur";
import { ModaleClasser, ModaleNouvelleDemande, ModaleRattacher, ModaleReponse } from "./ModalesMessage";

// Mission 13 (lot 7) : `expediteur` vit dans expediteur.ts (partagé avec les fenêtres) ; réexporté pour qui l'importait d'ici.
export { expediteur };

export const TON_STATUT_MESSAGE: Record<StatutMessage, "neutre" | "vert" | "ambre" | "rouge" | "bleu"> = {
  A_ANALYSER: "bleu",
  A_TRIER: "ambre",
  RATTACHE: "vert",
  BRUIT: "neutre",
  IGNORE: "neutre",
};

/* ── Ce que l'agent en a compris ──────────────────────────────────── */

function Analyses({ analyses }: { analyses: AnalyseVue[] }) {
  const [tout, setTout] = useState(false);
  if (analyses.length === 0) return null;
  const visibles = tout ? analyses : analyses.slice(0, 2);
  return (
    <section className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-texte-3 uppercase">
        <Bot size={13} aria-hidden /> {"Ce que l'agent en a compris"}
      </p>
      <ul className="flex flex-col gap-2">
        {visibles.map((analyse) => (
          <li key={analyse.id} className="rounded-[8px] bg-fond px-3 py-2 text-[12.5px] leading-relaxed">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-texte-3">
              <span>{analyse.methode === "MODELE" ? "Lecture par l'IA" : "Règles sûres"}</span>
              <span aria-hidden>·</span>
              <span>{formatHorodatage(analyse.createdAt)}</span>
              {analyse.libelleCategorie ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-texte-2">{analyse.libelleCategorie}</span>
                </>
              ) : null}
              {analyse.confiance !== null ? (
                <>
                  <span aria-hidden>·</span>
                  <span title="Confiance calculée par le système">confiance {Math.round(analyse.confiance * 100)} %</span>
                </>
              ) : null}
              {analyse.coutEuros ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{euros(analyse.coutEuros, 2)}</span>
                </>
              ) : null}
            </p>
            {analyse.erreur ? (
              <p className="mt-1 flex items-start gap-1.5 text-attention-texte">
                <CircleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
                {analyse.erreur}
              </p>
            ) : null}
            {analyse.raisonnement ? <p className="mt-1 whitespace-pre-wrap text-texte-2">{analyse.raisonnement}</p> : null}
          </li>
        ))}
      </ul>
      {analyses.length > 2 && !tout ? (
        <Bouton variante="fantome" taille="sm" className="mt-1" onClick={() => setTout(true)}>
          Voir les {analyses.length - 2} analyses précédentes
        </Bouton>
      ) : null}
    </section>
  );
}

/* ── Lecteur ───────────────────────────────────────────────────────── */

type Vue = "lecture" | "rattacher" | "demande" | "reponse" | "classer";

const ORDRE_PROPOSITIONS = ["RATTACHER_MESSAGE", "NOUVELLE_DEMANDE", "ARCHIVER_MESSAGE", "CLASSER_MESSAGE", "CHANGEMENT_ETAPE", "PROCHAINE_ACTION", "NOTE_DOSSIER", "ENVOI_MAIL"];

/**
 * Un mail, tel que l'agent l'a lu : texte (sans l'historique cité), pièces
 * jointes, conversation, analyses et propositions en attente ; et les gestes
 * de tri. Une seule fenêtre à la fois (pas de fenêtres empilées au téléphone).
 */
export function LecteurMessage({ messageId, onFermer, onModifie }: { messageId: string; onFermer: () => void; onModifie?: () => void }) {
  const [courant, setCourant] = useState(messageId);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [propositions, setPropositions] = useState<PropositionVue[]>([]);
  const [complet, setComplet] = useState(false);
  const [vue, setVue] = useState<Vue>("lecture");
  const [occupe, setOccupe] = useState<string | null>(null);
  const [enCorrection, setEnCorrection] = useState<PropositionVue | null>(null);
  const [enRejet, setEnRejet] = useState<PropositionVue | null>(null);

  const charger = useCallback(async (id: string) => {
    try {
      const [lu, { propositions: enAttente }] = await Promise.all([
        appelApi<MessageDetail>(`/api/messages/${id}`),
        appelApi<{ propositions: PropositionVue[] }>(`/api/validation?messageId=${id}&statut=EN_ATTENTE`),
      ]);
      setDetail(lu);
      setPropositions(enAttente);
    } catch (erreur) {
      toast.error("Mail illisible", { description: messageErreur(erreur) });
    }
  }, []);

  useEffect(() => {
    void charger(courant);
  }, [charger, courant]);

  const apresAction = useCallback(() => {
    setVue("lecture");
    setEnCorrection(null);
    setEnRejet(null);
    rafraichirCompteurs();
    onModifie?.();
    void charger(courant);
  }, [charger, courant, onModifie]);

  async function geste(nom: string, appel: () => Promise<unknown>, reussite: string, description?: string) {
    setOccupe(nom);
    try {
      await appel();
      toast.success(reussite, { description });
      apresAction();
    } catch (erreur) {
      toast.error("Action refusée", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function validerProposition(proposition: PropositionVue, corrections?: Record<string, unknown>) {
    setOccupe(proposition.id);
    try {
      const { proposition: resultat } = await envoyerJson<{ proposition: PropositionVue }>(`/api/validation/${proposition.id}/valider`, "POST", { corrections });
      toast.success(resultat.statut === "VALIDEE" ? "Validée : exécution en cours" : "Validée et exécutée", { description: proposition.titre });
      apresAction();
    } catch (erreur) {
      toast.error("Validation impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function rejeterProposition(proposition: PropositionVue, motif: string, commentaire: string) {
    setOccupe(proposition.id);
    try {
      await envoyerJson(`/api/validation/${proposition.id}/rejeter`, "POST", { motif, commentaire: commentaire || null });
      toast("Proposition rejetée", { description: proposition.titre });
      apresAction();
    } catch (erreur) {
      toast.error("Rejet impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  const aTrier = detail ? ["A_TRIER", "IGNORE"].includes(detail.statut) : false;
  const entrant = detail?.sens === "ENTRANT";
  const texte = detail ? (complet ? detail.texte : detail.texteUtile) : null;

  return (
    <>
      <Modale
        ouverte={vue === "lecture" && !enCorrection && !enRejet}
        onFermer={onFermer}
        largeur="lg"
        titre={detail ? (detail.objet ?? "(sans objet)") : "Chargement du mail…"}
        description={detail ? `${expediteur(detail)} · ${formatHorodatage(detail.recuLe)}` : undefined}
        pied={
          detail ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {detail.lienBoite ? (
                <a
                  href={detail.lienBoite}
                  target="_blank"
                  rel="noreferrer"
                  className={cn("mr-auto inline-flex min-h-8 items-center gap-1 text-[12px] text-texte-3 hover:text-texte", TRANS)}
                >
                  <ExternalLink size={12} aria-hidden /> Ouvrir dans Gmail
                </a>
              ) : null}
              {detail.statut === "BRUIT" ? (
                <Bouton icone={<ArchiveRestore size={14} aria-hidden />} chargement={occupe === "bruit"} onClick={() => void geste("bruit", () => envoyerJson(`/api/messages/${detail.id}/pas-du-bruit`, "POST"), "Remis à trier", "Il revient aussi dans la boîte de réception.")}>
                  Ce n&apos;est pas du bruit
                </Bouton>
              ) : null}
              {aTrier ? (
                <>
                  <Bouton variante="fantome" icone={<Archive size={14} aria-hidden />} chargement={occupe === "archiver"} onClick={() => void geste("archiver", () => envoyerJson(`/api/messages/${detail.id}/archiver`, "POST"), "Archivé comme bruit", "Retiré de la boîte de réception, jamais supprimé.")}>
                    Bruit
                  </Bouton>
                  <Bouton variante="fantome" icone={<Tags size={14} aria-hidden />} onClick={() => setVue("classer")}>
                    Hors clients
                  </Bouton>
                </>
              ) : null}
              {entrant && detail.statut !== "BRUIT" ? (
                <Bouton icone={<Reply size={14} aria-hidden />} onClick={() => setVue("reponse")}>
                  Répondre
                </Bouton>
              ) : null}
              {entrant && (aTrier || (detail.statut === "RATTACHE" && !detail.dossier)) ? (
                <Bouton icone={<UserPlus size={14} aria-hidden />} onClick={() => setVue("demande")}>
                  Nouvelle demande
                </Bouton>
              ) : null}
              {detail.statut !== "A_ANALYSER" ? (
                <Bouton variante={aTrier ? "primaire" : "secondaire"} icone={<FolderInput size={14} aria-hidden />} onClick={() => setVue("rattacher")}>
                  {detail.statut === "RATTACHE" ? "Changer de dossier" : "Ranger chez un client"}
                </Bouton>
              ) : null}
            </div>
          ) : null
        }
      >
        {detail ? (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Pastille ton={TON_STATUT_MESSAGE[detail.statut]}>{LIBELLES_STATUT_MESSAGE[detail.statut]}</Pastille>
              {detail.categorie && detail.categorie !== "CLIENT" ? <Pastille>{LIBELLES_CATEGORIE_MESSAGE[detail.categorie]}</Pastille> : null}
              {detail.sens === "SORTANT" ? (
                <Pastille ton="bleu">
                  <ArrowUpRight size={11} aria-hidden /> Envoyé
                </Pastille>
              ) : null}
              {detail.boiteArchiveLe ? <Pastille titre="Retiré de la boîte de réception, sous le libellé « CoverSwap CRM/Bruit archivé »">Hors de la boîte de réception</Pastille> : null}
              {detail.client ? (
                <Link href={`/clients/${detail.client.id}`} className={cn("inline-flex min-h-7 items-center gap-1 text-[12px] text-texte-3 hover:text-texte", TRANS)}>
                  {detail.client.nom}
                </Link>
              ) : null}
              {detail.dossier ? (
                <Link href={`/dossiers?dossier=${detail.dossier.id}`} className={cn("inline-flex min-h-7 items-center gap-1 text-[12px] text-texte-3 hover:text-texte", TRANS)}>
                  <FolderOpen size={12} aria-hidden /> {detail.dossier.objet}
                </Link>
              ) : null}
            </div>

            {propositions.length > 0 ? (
              <section className="mt-4">
                <p className="mb-2 text-[12px] font-medium tracking-wide text-texte-3 uppercase">À valider pour ce mail</p>
                <div className="flex flex-col gap-2">
                  {[...propositions].sort((a, b) => ORDRE_PROPOSITIONS.indexOf(a.type) - ORDRE_PROPOSITIONS.indexOf(b.type)).map((proposition) => (
                    <CarteProposition
                      key={proposition.id}
                      proposition={{ ...proposition, liens: proposition.liens.filter((lien) => !lien.href.includes(`message=${detail.id}`)) }}
                      occupee={occupe === proposition.id}
                      onValider={() => void validerProposition(proposition)}
                      onCorriger={() => setEnCorrection(proposition)}
                      onRejeter={() => setEnRejet(proposition)}
                      onReessayer={() => undefined}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-4">
              {texte ? (
                <p className="rounded-[8px] border-[0.5px] border-trait bg-fond px-3.5 py-3 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-texte">{texte}</p>
              ) : (
                <p className="text-[13px] text-texte-3">{detail.extrait ?? "Texte indisponible (mail sans texte, ou effacé au titre du RGPD)."}</p>
              )}
              {detail.texte && detail.texteUtile && detail.texte.length > detail.texteUtile.length + 20 ? (
                <Bouton variante="fantome" taille="sm" className="mt-1" icone={<ChevronDown size={13} aria-hidden className={cn("transition-transform", complet && "rotate-180")} />} onClick={() => setComplet((valeur) => !valeur)}>
                  {complet ? "Masquer l'historique cité" : "Afficher tout le mail (historique cité)"}
                </Bouton>
              ) : null}
            </section>

            {detail.pieces.length > 0 ? (
              <section className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-texte-3 uppercase">
                  <Paperclip size={13} aria-hidden /> Pièces jointes
                </p>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {detail.pieces.map((piece) => (
                    <li key={piece.id} className="overflow-hidden rounded-[8px] border-[0.5px] border-trait bg-fond">
                      {piece.url && piece.estImage ? (
                        <a href={piece.url} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-fond">
                          {/* eslint-disable-next-line @next/next/no-img-element -- pièce servie par l'API authentifiée */}
                          <img src={piece.url} alt={piece.nom} loading="lazy" className="h-full w-full object-cover" />
                        </a>
                      ) : null}
                      <div className="px-2.5 py-2 text-[12px]">
                        {piece.url ? (
                          <a href={piece.url} target="_blank" rel="noreferrer" className={cn("flex items-center gap-1 truncate text-texte-2 hover:text-texte", TRANS)}>
                            {piece.estImage ? null : <FileText size={12} aria-hidden className="shrink-0" />}
                            <span className="truncate">{piece.nom}</span>
                          </a>
                        ) : (
                          <p className="truncate text-texte-2">{piece.nom}</p>
                        )}
                        <p className="mt-0.5 text-[11px] text-texte-3">{piece.statut === "CONSERVEE" ? formatTaille(piece.taille) : (piece.raison ?? "En attente de téléchargement")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Analyses analyses={detail.analyses} />

            {detail.fil.length > 0 ? (
              <section className="mt-4">
                <p className="mb-2 text-[12px] font-medium tracking-wide text-texte-3 uppercase">Même conversation</p>
                <ul className="flex flex-col gap-1">
                  {detail.fil.map((autre) => (
                    <li key={autre.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDetail(null);
                          setComplet(false);
                          setCourant(autre.id);
                        }}
                        className={cn("flex min-h-10 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[12.5px] hover:bg-surface-2", TRANS)}
                      >
                        {autre.sens === "SORTANT" ? <ArrowUpRight size={13} className="shrink-0 text-info-texte" aria-hidden /> : <ArrowDownLeft size={13} className="shrink-0 text-texte-3" aria-hidden />}
                        <span className="shrink-0 text-texte-3">{formatHorodatage(autre.recuLe)}</span>
                        <span className="truncate text-texte-2">{autre.extrait ?? autre.objet ?? ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-texte-3">
            <Search size={14} aria-hidden /> Lecture…
          </p>
        )}
      </Modale>

      {detail && vue === "rattacher" ? <ModaleRattacher detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {detail && vue === "demande" ? <ModaleNouvelleDemande detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {detail && vue === "reponse" ? <ModaleReponse detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {detail && vue === "classer" ? <ModaleClasser detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {enCorrection ? <ModaleCorrection proposition={enCorrection} onFermer={() => setEnCorrection(null)} onValider={(corrections) => validerProposition(enCorrection, corrections)} /> : null}
      {enRejet ? <ModaleRejet proposition={enRejet} onFermer={() => setEnRejet(null)} onRejeter={(motif, commentaire) => rejeterProposition(enRejet, motif, commentaire)} /> : null}
    </>
  );
}
