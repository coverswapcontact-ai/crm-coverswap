"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, CalendarClock, ExternalLink, FolderKanban, ImageIcon, Link2, MailOpen, Receipt, UserRound, UserRoundSearch } from "lucide-react";
import { toast } from "sonner";
import type { ContexteConversation } from "@/lib/sms/contexte";
import type { ConversationResume } from "@/lib/sms/conversations";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { LIBELLES_STATUT_LEAD, LIBELLES_TYPE_PROJET, libelleSourceLead, type StatutLead } from "@/lib/prospects/constantes";
import { LIBELLES_PRIORITE, type Priorite } from "@/lib/prospects/priorite";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

const jourLisible = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : null);
const euros = (montant: number) => `${montant.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;

function Bloc({ titre, icone, children }: { titre: string; icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[#6B7280] uppercase">
        {icone} {titre}
      </h3>
      {children}
    </section>
  );
}

function Ligne({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
      <span className="shrink-0 text-[#8B919C]">{libelle}</span>
      <span className="min-w-0 text-right text-[#E5E7EB]">{children}</span>
    </p>
  );
}

type Trouve = { genre: "lead" | "client"; id: string; nom: string; detail: string; telephone: string | null };

/**
 * Le contexte du dossier à côté du fil : où on en est, ce qu'on a reçu, le
 * devis en cours, la prochaine action — sans quitter la conversation.
 */
export function ContexteDossier({
  conversation,
  contexte,
  onChange,
}: {
  conversation: ConversationResume;
  contexte: ContexteConversation | null;
  onChange: () => void;
}) {
  const [recherche, setRecherche] = useState("");
  const [trouves, setTrouves] = useState<Trouve[] | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  async function chercher() {
    if (recherche.trim().length < 2) return;
    setOccupe("recherche");
    try {
      const { personnes } = await appelApi<{ personnes: Trouve[] }>(`/api/sms/recherche?q=${encodeURIComponent(recherche)}`);
      setTrouves(personnes);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function modifier(nom: string, donnees: unknown, succes: string) {
    setOccupe(nom);
    try {
      await envoyerJson(`/api/sms/conversations/${conversation.id}`, "PATCH", donnees);
      toast.success(succes);
      setTrouves(null);
      setRecherche("");
      onChange();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  const contact = contexte?.contact ?? null;
  const dossier = contexte?.dossier ?? null;
  const espace = contexte?.espace ?? null;

  return (
    <div className="space-y-3 p-3">
      {conversation.aRattacher ? (
        <Bloc titre="Numéro inconnu" icone={<UserRoundSearch size={13} aria-hidden />}>
          <p className="mb-2 text-[13px] text-[#D1D5DB]">Cette conversation n&apos;appartient encore à personne. La rattacher à un contact ou à un client la range avec son dossier.</p>
          <div className="flex gap-2">
            <Champ
              classeConteneur="min-w-0 flex-1"
              libelle="Chercher un contact ou un client"
              placeholder="Nom, ville…"
              value={recherche}
              onChange={(evenement) => setRecherche(evenement.target.value)}
              onKeyDown={(evenement) => evenement.key === "Enter" && void chercher()}
            />
            <Bouton className="self-end" chargement={occupe === "recherche"} onClick={() => void chercher()}>
              Chercher
            </Bouton>
          </div>
          {trouves ? (
            <ul className="mt-2 space-y-1">
              {trouves.length === 0 ? <li className="text-[12.5px] text-[#6B7280]">Personne à ce nom.</li> : null}
              {trouves.map((t) => (
                <li key={`${t.genre}-${t.id}`}>
                  <button
                    type="button"
                    onClick={() => void modifier("rattacher", { rattacher: t.genre === "lead" ? { leadId: t.id } : { clientId: t.id } }, "Conversation rattachée")}
                    className={cn("flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] hover:bg-[#22262D]", TRANS)}
                  >
                    <span className="min-w-0 truncate text-[#F2F3F5]">{t.nom}</span>
                    <span className="shrink-0 text-[11.5px] text-[#8B919C]">{t.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Bloc>
      ) : null}

      {contact ? (
        <Bloc titre="Contact" icone={<UserRound size={13} aria-hidden />}>
          <Ligne libelle="Projet">{[LIBELLES_TYPE_PROJET[contact.typeProjet] ?? contact.typeProjet, contact.ville].filter(Boolean).join(" · ")}</Ligne>
          {contact.priorite && !dossier ? <Ligne libelle="Priorité">{LIBELLES_PRIORITE[contact.priorite as Priorite] ?? contact.priorite}</Ligne> : null}
          {contact.prioriteMotif && !dossier ? <p className="py-0.5 text-[12px] text-[#8B919C]">{contact.prioriteMotif}</p> : null}
          {contact.tailleCuisine ? <Ligne libelle="Taille">{contact.tailleCuisine}</Ligne> : null}
          {!dossier ? <Ligne libelle="Statut">{LIBELLES_STATUT_LEAD[contact.statut as StatutLead] ?? contact.statut}</Ligne> : null}
          <Ligne libelle="Origine">{[libelleSourceLead(contact.source), contact.campagne].filter(Boolean).join(" · ")}</Ligne>
          {contact.rappelLe ? <Ligne libelle="Rappel prévu">{jourLisible(contact.rappelLe)}</Ligne> : null}
          <Link href={`/prospects?lead=${contact.id}`} className={cn("mt-2 inline-flex items-center gap-1 text-[12.5px] text-[#5DCAA5] hover:underline", TRANS)}>
            Ouvrir la fiche <ExternalLink size={11} aria-hidden />
          </Link>
        </Bloc>
      ) : contexte?.client ? (
        <Bloc titre="Client" icone={<UserRound size={13} aria-hidden />}>
          <Link href={`/clients/${contexte.client.id}`} className="text-[13.5px] text-[#5DCAA5] hover:underline">
            {contexte.client.nom}
          </Link>
        </Bloc>
      ) : null}

      {dossier ? (
        <Bloc titre="Dossier" icone={<FolderKanban size={13} aria-hidden />}>
          <p className="mb-1 text-[13.5px] font-medium text-[#F2F3F5]">{dossier.objet || "Dossier sans objet"}</p>
          <Ligne libelle="Étape">
            <span className="rounded-full bg-[#1D9E75]/15 px-2 py-[1px] text-[12px] text-[#5DCAA5]">{LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape}</span>
          </Ligne>
          <Ligne libelle="Prochaine action">
            {dossier.prochaineAction ? (
              <>
                {dossier.prochaineAction}
                {dossier.prochaineActionDate ? <span className="text-[#8B919C]"> · {jourLisible(dossier.prochaineActionDate)}</span> : null}
              </>
            ) : (
              <span className="text-[#F5B454]">aucune</span>
            )}
          </Ligne>
          <Ligne libelle="Photos reçues">
            <span className="inline-flex items-center gap-1">
              <ImageIcon size={12} aria-hidden /> {dossier.nbPhotos}
            </span>
          </Ligne>
          {dossier.devis ? (
            <Ligne libelle="Devis en cours">
              <span className="inline-flex items-center gap-1">
                <Receipt size={12} aria-hidden /> {dossier.devis.numero ?? "brouillon"} · {euros(dossier.devis.totalHt)}
              </span>
            </Ligne>
          ) : dossier.montantEstime ? (
            <Ligne libelle="Estimation">{euros(dossier.montantEstime)}</Ligne>
          ) : null}
          <Link href={`/dossiers?dossier=${dossier.id}`} className={cn("mt-2 inline-flex items-center gap-1 text-[12.5px] text-[#5DCAA5] hover:underline", TRANS)}>
            Ouvrir le dossier <ExternalLink size={11} aria-hidden />
          </Link>
        </Bloc>
      ) : null}

      {espace ? (
        <Bloc titre="Espace client" icone={<Link2 size={13} aria-hidden />}>
          <Ligne libelle="Lien">{espace.revoque ? <span className="text-[#F87171]">désactivé</span> : `valable jusqu'au ${jourLisible(espace.expireLe)}`}</Ligne>
          <Ligne libelle="Consulté">{espace.dernierAccesLe ? jourLisible(espace.dernierAccesLe) : <span className="text-[#F5B454]">pas encore ouvert</span>}</Ligne>
          <Ligne libelle="Souhaits">{espace.souhaits ? "renseignés" : "—"}</Ligne>
          <Ligne libelle="Simulations">{espace.nbSimulations > 0 ? `${espace.nbSimulations}${espace.simulationChoisie ? " · une choisie" : ""}` : "aucune déposée"}</Ligne>
          {espace.accordLe ? <Ligne libelle="Bon pour accord">{jourLisible(espace.accordLe)}</Ligne> : null}
        </Bloc>
      ) : null}

      {contexte && contexte.envoisSansReponse10j >= 4 ? (
        <p className={cn("rounded-[10px] border-[0.5px] p-3 text-[12.5px]", contexte.envoisSansReponse10j >= 5 ? "border-[#EF4444]/40 bg-[#EF4444]/10 text-[#F87171]" : "border-[#EF9F27]/40 bg-[#EF9F27]/10 text-[#F5B454]")}>
          <CalendarClock size={13} aria-hidden className="mr-1 inline" />
          {contexte.envoisSansReponse10j} messages envoyés en dix jours sans réponse. Au-delà de cinq, on passe pour un harceleur.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Bouton taille="sm" icone={<MailOpen size={13} aria-hidden />} chargement={occupe === "nonlue"} onClick={() => void modifier("nonlue", { nonLue: true }, "Marquée non lue")}>
          Marquer non lue
        </Bouton>
        {conversation.archivee ? (
          <Bouton taille="sm" chargement={occupe === "restaurer"} onClick={() => void modifier("restaurer", { restaurer: true }, "Conversation restaurée")}>
            Restaurer
          </Bouton>
        ) : (
          <Bouton taille="sm" icone={<Archive size={13} aria-hidden />} chargement={occupe === "archiver"} onClick={() => void modifier("archiver", { archiver: "Archivée depuis la messagerie" }, "Conversation archivée")}>
            Archiver
          </Bouton>
        )}
      </div>
    </div>
  );
}
