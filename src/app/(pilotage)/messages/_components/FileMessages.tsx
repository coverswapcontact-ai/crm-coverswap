"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowUpRight, Bot, FolderOpen, Inbox, Paperclip, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { LecteurMessage, TON_STATUT_MESSAGE } from "@/components/pilotage/messages/LecteurMessage";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, CLASSE_SAISIE, EnTetePage, EtatVide, Pastille, TRANS } from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { LIBELLES_STATUT_MESSAGE, type EtatAgentMail, type MessageResume, type StatutMessage } from "@/lib/messages/constantes";
import { cn } from "@/lib/utils";

type Onglet = StatutMessage | "TOUS";

const ONGLETS: { valeur: Onglet; libelle: string }[] = [
  { valeur: "A_TRIER", libelle: "À trier" },
  { valeur: "RATTACHE", libelle: "Rangés" },
  { valeur: "BRUIT", libelle: "Bruit" },
  { valeur: "IGNORE", libelle: "Hors clients" },
  { valeur: "TOUS", libelle: "Tous" },
];

const euros = (montant: number) => `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function EtatAgent({ agent }: { agent: EtatAgentMail }) {
  if (!agent.actif) {
    return (
      <span>
        Agent inactif : {agent.raison}{" "}
        <Link href="/parametres" className="text-[#5DCAA5] underline-offset-2 hover:underline">
          Paramètres
        </Link>
      </span>
    );
  }
  return (
    <span>
      Relevé de {agent.compte}
      {agent.dernierReleve ? ` · dernier passage le ${formatHorodatage(agent.dernierReleve)}` : ""}
      {" · "}
      {agent.ia.active ? `IA active (${euros(agent.ia.depenseMois)} ce mois${agent.ia.budget !== null ? ` sur ${euros(agent.ia.budget)}` : ""})` : `IA inactive : ${agent.ia.raison ?? "non réglée"}`}
    </span>
  );
}

function CarteMessage({ message, onOuvrir, onBruit }: { message: MessageResume; onOuvrir: () => void; onBruit: () => void }) {
  const auteur = message.sens === "SORTANT" ? `À ${message.a.join(", ")}` : (message.deNom ?? message.de);
  return (
    <article className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] transition-colors hover:border-[#3A3E47]">
      <button type="button" onClick={onOuvrir} className="block w-full px-4 pt-3 pb-2 text-left">
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-[#F2F3F5]">
            {message.sens === "SORTANT" ? <ArrowUpRight size={13} className="shrink-0 text-[#93C5FD]" aria-hidden /> : null}
            <span className="truncate">{auteur}</span>
          </p>
          <span className="shrink-0 text-[11.5px] text-[#6B7280]">{formatHorodatage(message.recuLe)}</span>
        </div>
        <p className="mt-0.5 truncate text-[13.5px] text-[#E5E7EB]">{message.objet ?? "(sans objet)"}</p>
        {message.extrait ? <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-[#9CA3AF]">{message.extrait}</p> : null}
      </button>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 pb-3 text-[11.5px] text-[#6B7280]">
        <Pastille ton={TON_STATUT_MESSAGE[message.statut]}>{LIBELLES_STATUT_MESSAGE[message.statut]}</Pastille>
        {message.client ? (
          <Link href={`/clients/${message.client.id}`} className={cn("inline-flex min-h-6 items-center text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
            {message.client.nom}
          </Link>
        ) : null}
        {message.dossier ? (
          <Link href={`/dossiers?dossier=${message.dossier.id}`} className={cn("inline-flex min-h-6 items-center gap-1 text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
            <FolderOpen size={11} aria-hidden /> {message.dossier.objet}
          </Link>
        ) : null}
        {message.pieces.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip size={11} aria-hidden /> {message.pieces.length}
          </span>
        ) : null}
        {message.analyse ? (
          <span className="inline-flex min-w-0 items-center gap-1" title={message.analyse.raisonnement ?? undefined}>
            <Bot size={11} aria-hidden className="shrink-0" />
            <span className="truncate">
              {message.analyse.erreur
                ? message.analyse.erreur
                : message.analyse.libelleCategorie
                  ? `${message.analyse.methode === "MODELE" ? "IA" : "Règles"} : ${message.analyse.libelleCategorie.toLowerCase()}`
                  : (message.analyse.raisonnement ?? "")}
            </span>
          </span>
        ) : null}
        {message.propositionsEnAttente > 0 ? (
          <Pastille ton="vert">
            {message.propositionsEnAttente} proposition{message.propositionsEnAttente > 1 ? "s" : ""}
          </Pastille>
        ) : null}
        {message.statut === "A_TRIER" ? (
          <Bouton variante="fantome" taille="sm" className="ml-auto" icone={<Archive size={12} aria-hidden />} onClick={onBruit}>
            Bruit
          </Bouton>
        ) : null}
      </div>
    </article>
  );
}

/** File des messages : ce que l'agent n'a pas pu ranger seul, et tout le reste, consultable. */
export default function FileMessages({ initiaux, agent, messageInitialId }: { initiaux: MessageResume[]; agent: EtatAgentMail; messageInitialId: string | null }) {
  const router = useRouter();
  const [onglet, setOnglet] = useState<Onglet>("A_TRIER");
  const [messages, setMessages] = useState(initiaux);
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(messageInitialId);
  const [releve, setReleve] = useState(false);

  const charger = useCallback(async (statut: Onglet, texte: string) => {
    setChargement(true);
    try {
      const { messages: lus } = await appelApi<{ messages: MessageResume[] }>(`/api/messages?statut=${statut}&limite=150${texte.trim() ? `&recherche=${encodeURIComponent(texte.trim())}` : ""}`);
      setMessages(lus);
    } catch (erreur) {
      toast.error("Lecture impossible", { description: messageErreur(erreur) });
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    const minuterie = window.setTimeout(() => void charger(onglet, recherche), recherche ? 300 : 0);
    return () => window.clearTimeout(minuterie);
  }, [charger, onglet, recherche]);

  async function archiver(message: MessageResume) {
    try {
      await envoyerJson(`/api/messages/${message.id}/archiver`, "POST");
      setMessages((actuels) => actuels.filter((autre) => autre.id !== message.id));
      toast.success("Archivé comme bruit", { description: "Retiré de la boîte de réception, jamais supprimé." });
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error("Archivage impossible", { description: messageErreur(erreur) });
    }
  }

  async function relever() {
    setReleve(true);
    try {
      await envoyerJson("/api/messages/relever", "POST");
      toast.success("Relevé lancé", { description: "Les nouveaux mails arrivent d'ici une minute." });
    } catch (erreur) {
      toast.error("Relevé impossible", { description: messageErreur(erreur) });
    } finally {
      setReleve(false);
    }
  }

  function fermer() {
    setOuvert(null);
    // L'adresse ?message=… ne rouvre pas le mail au rechargement.
    if (messageInitialId) router.replace("/messages");
  }

  const aTrier = onglet === "A_TRIER";

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Messages"
        sousTitre={<EtatAgent agent={agent} />}
        actions={
          agent.actif ? (
            <Bouton icone={<RefreshCw size={14} aria-hidden />} chargement={releve} onClick={() => void relever()}>
              Relever maintenant
            </Bouton>
          ) : null
        }
      />

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="tablist" aria-label="Messages" className="flex w-fit max-w-full items-center overflow-x-auto rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-[3px]">
          {ONGLETS.map(({ valeur, libelle }) => (
            <button
              key={valeur}
              type="button"
              role="tab"
              aria-selected={onglet === valeur}
              onClick={() => setOnglet(valeur)}
              className={cn("flex h-9 items-center rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap sm:h-7", onglet === valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
            >
              {libelle}
              {valeur === "A_TRIER" && agent.aTrier > 0 ? <span className="ml-1.5 text-[11px] text-[#F5B454] tabular-nums">{agent.aTrier}</span> : null}
            </button>
          ))}
        </div>
        <label className="relative block sm:ml-auto sm:w-64">
          <span className="sr-only">Rechercher un mail</span>
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
          <input type="search" value={recherche} onChange={(evenement) => setRecherche(evenement.target.value)} placeholder="Expéditeur, objet…" className={cn(CLASSE_SAISIE, "h-10 pl-9 sm:h-8")} />
        </label>
      </div>

      <section aria-busy={chargement} className={cn("mt-4 flex flex-col gap-2.5", chargement && "opacity-60")}>
        {messages.length === 0 ? (
          <EtatVide
            icone={<Inbox size={18} className="text-[#1D9E75]" aria-hidden />}
            titre={aTrier ? "Rien à trier" : "Aucun mail"}
            texte={
              aTrier
                ? agent.actif
                  ? "L'agent range seul ce qui est certain (clients connus, publicités) ; le reste arrive ici."
                  : "Une fois le compte Google connecté, les mails que l'agent ne peut pas ranger seul arrivent ici."
                : undefined
            }
          />
        ) : (
          messages.map((message) => <CarteMessage key={message.id} message={message} onOuvrir={() => setOuvert(message.id)} onBruit={() => void archiver(message)} />)
        )}
      </section>

      {ouvert ? <LecteurMessage key={ouvert} messageId={ouvert} onFermer={fermer} onModifie={() => void charger(onglet, recherche)} /> : null}
    </div>
  );
}
