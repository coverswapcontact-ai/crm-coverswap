"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, BellOff, ChevronDown, Mail, MailOpen, Paperclip, RefreshCw, Search, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, CLASSE_SAISIE, EnTetePage, EtatVide, Modale, TRANS } from "@/components/pilotage/ui";
import type { CompteursMail, LigneMail, VueMail } from "@/lib/mail/vues";
import { cn } from "@/lib/utils";
import { PanneauMail } from "./PanneauMail";

/**
 * L'onglet Mail (mission 7), pensé pour le pouce : trois vues — À traiter,
 * Clients, Administratif —, le rangé replié en bas. Chaque ligne se lit d'un
 * coup d'œil (qui, pourquoi elle est là) et se traite sans l'ouvrir : lu,
 * archiver, ne plus voir cet expéditeur.
 */

type Liste = { lignes: LigneMail[]; compteurs: CompteursMail };

const VUES: { vue: Exclude<VueMail, "RANGES">; libelle: string; aide: string }[] = [
  { vue: "A_TRAITER", libelle: "À traiter", aide: "Ce qui attend une réponse ou une action de votre part." },
  { vue: "CLIENTS", libelle: "Clients", aide: "Tous les échanges avec un client, un lead ou un prospect connu." },
  { vue: "ADMINISTRATIF", libelle: "Administratif", aide: "URSSAF, impôts, banque, assurance, fournisseurs, partenaires." },
];

function quand(iso: string): string {
  const date = new Date(iso);
  const maintenant = new Date();
  const memeJour = date.toDateString() === maintenant.toDateString();
  if (memeJour) return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const hier = new Date(maintenant.getTime() - 86_400_000);
  if (date.toDateString() === hier.toDateString()) return "hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function Mention({ ligne }: { ligne: LigneMail }) {
  if (!ligne.mention) return null;
  const ton = ligne.mention.startsWith("Sans réponse") ? "border-[#EF9F27]/40 bg-[#EF9F27]/10 text-[#F5B454]" : ligne.mention === "Nouvelle demande" ? "border-[#1D9E75]/40 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#B4BAC4]";
  return <span className={cn("inline-flex items-center rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", ton)}>{ligne.mention}</span>;
}

function LigneConversation({ ligne, occupe, onOuvrir, onGeste }: { ligne: LigneMail; occupe: boolean; onOuvrir: () => void; onGeste: (geste: "LU" | "NON_LU" | "ARCHIVER" | "DESARCHIVER" | "REMONTER" | "NE_PLUS_MONTRER") => void }) {
  const [plus, setPlus] = useState(false);
  const nom = ligne.correspondant.nom || ligne.correspondant.adresse;
  return (
    <li className={cn("rounded-[12px] border-[0.5px] bg-[#1C1F25]", ligne.nonLu ? "border-[#3A3E47]" : "border-[#2A2D34]")}>
      <button type="button" onClick={onOuvrir} className={cn("block w-full rounded-t-[12px] px-3.5 pt-3 pb-2 text-left hover:bg-[#20232A] focus-visible:ring-2 focus-visible:ring-[#1D9E75]/50 focus-visible:outline-none", TRANS)}>
        <span className="flex items-center gap-2">
          {ligne.nonLu ? <span aria-label="Non lu" className="h-2 w-2 shrink-0 rounded-full bg-[#1D9E75]" /> : null}
          <span className={cn("min-w-0 flex-1 truncate text-[14.5px]", ligne.nonLu ? "font-semibold text-[#F2F3F5]" : "font-medium text-[#D1D5DB]")}>
            {ligne.sens === "SORTANT" && !ligne.automatique ? <span className="font-normal text-[#8B919C]">À : </span> : null}
            {nom}
          </span>
          {ligne.nombre > 1 ? <span className="text-[11.5px] text-[#8B919C] tabular-nums">{ligne.nombre}</span> : null}
          {ligne.pieces > 0 ? <Paperclip size={13} className="text-[#8B919C]" aria-label="Pièces jointes" /> : null}
          <span className="shrink-0 text-[12px] text-[#8B919C] tabular-nums">{quand(ligne.recuLe)}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Mention ligne={ligne} />
          {ligne.contact ? <span className="rounded-full border-[0.5px] border-[#2A2D34] px-2 py-0.5 text-[11px] text-[#9CA3AF]">{ligne.contact.type === "CLIENT" ? "Client" : "Lead"} · {ligne.contact.nom}</span> : null}
          {ligne.automatique ? <span className="rounded-full border-[0.5px] border-[#2A2D34] px-2 py-0.5 text-[11px] text-[#8B919C]">Automatique</span> : null}
        </span>
        <span className={cn("mt-1.5 block truncate text-[13.5px]", ligne.nonLu ? "text-[#E5E7EB]" : "text-[#B4BAC4]")}>{ligne.objet || "(sans objet)"}</span>
        {ligne.extrait ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-[#8B919C]">{ligne.extrait}</span> : null}
        {ligne.range && ligne.motif ? <span className="mt-1 block text-[12px] text-[#6B7280]">Rangé : {ligne.motif}</span> : null}
      </button>
      {/* Les gestes, au pouce : sans ouvrir le mail. */}
      <div className="flex items-center gap-1 border-t-[0.5px] border-[#2A2D34] px-1.5 py-1">
        {ligne.range ? (
          <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste("REMONTER")} icone={<ArchiveRestore size={14} aria-hidden />} className="h-10 sm:h-8">
            Remonter
          </Bouton>
        ) : (
          <>
            <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste(ligne.nonLu ? "LU" : "NON_LU")} icone={ligne.nonLu ? <MailOpen size={14} aria-hidden /> : <Mail size={14} aria-hidden />} className="h-10 sm:h-8" aria-label={ligne.nonLu ? "Marquer comme lu" : "Marquer comme non lu"}>
              {ligne.nonLu ? "Lu" : "Non lu"}
            </Bouton>
            <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste(ligne.traite ? "DESARCHIVER" : "ARCHIVER")} icone={ligne.traite ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />} className="h-10 sm:h-8">
              {ligne.traite ? "Désarchiver" : "Archiver"}
            </Bouton>
            {ligne.sens === "ENTRANT" && ligne.contact?.type !== "CLIENT" ? (
              plus ? (
                <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste("NE_PLUS_MONTRER")} icone={<BellOff size={14} aria-hidden />} className="ml-auto h-10 text-[#F5B454] sm:h-8">
                  Ne plus me montrer cet expéditeur
                </Bouton>
              ) : (
                <Bouton taille="sm" variante="fantome" onClick={() => setPlus(true)} className="ml-auto h-10 sm:h-8" aria-label="Plus de gestes">
                  ···
                </Bouton>
              )
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export default function EcranMail({ initial, mailInitial, contactInitial, consigneInitiale }: { initial: Liste; mailInitial: string | null; contactInitial: string | null; consigneInitiale: string | null }) {
  const [vue, setVue] = useState<VueMail>("A_TRAITER");
  const [liste, setListe] = useState<Liste>(initial);
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(mailInitial);
  // « client:<id> » ou « lead:<id> » : un nouveau mail pour ce contact.
  const [nouveauPour, setNouveauPour] = useState<string | null>(contactInitial);
  const [nettoyage, setNettoyage] = useState(false);
  const minuterie = useRef<number | null>(null);

  const charger = useCallback(async (cible: VueMail, texte: string) => {
    setChargement(true);
    try {
      setListe(await appelApi<Liste>(`/api/mail?vue=${cible}${texte ? `&recherche=${encodeURIComponent(texte)}` : ""}`));
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setChargement(false);
    }
  }, []);

  // À l'ouverture de l'onglet : la boîte est relue tout de suite, puis la liste.
  const synchroniser = useCallback(async () => {
    setChargement(true);
    try {
      await envoyerJson("/api/mail/synchroniser", "POST");
    } catch {
      // la synchronisation de la minute prendra le relais
    }
    await charger(vue, recherche);
    rafraichirCompteurs();
  }, [charger, vue, recherche]);

  useEffect(() => {
    void synchroniser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rafraîchi toutes les minutes tant que l'onglet est ouvert (la boîte est relue côté serveur).
  useEffect(() => {
    const id = window.setInterval(() => void charger(vue, recherche), 60_000);
    return () => window.clearInterval(id);
  }, [charger, vue, recherche]);

  function changerVue(cible: VueMail) {
    setVue(cible);
    void charger(cible, recherche);
  }

  function chercher(texte: string) {
    setRecherche(texte);
    if (minuterie.current) window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => void charger(vue, texte), 300);
  }

  async function geste(ligne: LigneMail, action: "LU" | "NON_LU" | "ARCHIVER" | "DESARCHIVER" | "REMONTER" | "NE_PLUS_MONTRER") {
    setOccupe(ligne.messageId);
    try {
      const resultat = await envoyerJson<{ ranges?: number }>(`/api/mail/${ligne.messageId}/action`, "POST", { action });
      if (action === "NE_PLUS_MONTRER") toast.success("Expéditeur masqué pour toujours", { description: `${resultat.ranges ?? 0} mail(s) rangé(s), dans Gmail aussi. Réversible depuis Rangés ou Paramètres.` });
      if (action === "REMONTER") toast.success("Remonté", { description: "Cet expéditeur ne sera plus jamais rangé." });
      if (action === "ARCHIVER") toast.success("Archivé", { description: "Sorti de la boîte de réception, dans Gmail aussi. Rien n'est supprimé." });
      await charger(vue, recherche);
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  async function toutNettoyer() {
    setNettoyage(false);
    setChargement(true);
    try {
      const { archives } = await envoyerJson<{ archives: number }>("/api/mail/nettoyer", "POST");
      toast.success(archives ? `${archives} conversation(s) rangée(s)` : "Rien à nettoyer", { description: archives ? "Archivées et marquées lues, dans Gmail aussi. Rien n'est supprimé ; ce qui est à traiter n'a pas bougé." : undefined });
      await charger(vue, recherche);
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setChargement(false);
    }
  }

  const compteurs = liste.compteurs;
  const aide = vue === "RANGES" ? "Rangé d'office : notifications, plateformes, newsletters, promotions. « Remonter » le fait revenir, et son expéditeur ne sera plus rangé." : VUES.find((v) => v.vue === vue)?.aide;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Mail"
        sousTitre="coverswap.contact@gmail.com, triée d'office. Le bruit est rangé, jamais supprimé."
        actions={
          <>
            <Bouton taille="md" variante="fantome" onClick={() => void synchroniser()} chargement={chargement} icone={<RefreshCw size={14} aria-hidden />} aria-label="Relire la boîte">
              <span className="hidden sm:inline">Relire</span>
            </Bouton>
            <Link href="/mail/sequences" className={cn("inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-3 text-[13px] font-medium text-[#D1D5DB] hover:border-[#3A3E47] sm:h-8", TRANS)}>
              <Workflow size={14} aria-hidden /> Séquences
            </Link>
            <Bouton taille="md" variante="secondaire" onClick={() => setNettoyage(true)} icone={<Sparkles size={14} aria-hidden />}>
              Tout nettoyer
            </Bouton>
          </>
        }
      />

      <div role="tablist" aria-label="Vues de la boîte" className="grid grid-cols-3 gap-1 rounded-[10px] bg-[#16181D] p-1">
        {VUES.map((v) => (
          <button
            key={v.vue}
            type="button"
            role="tab"
            aria-selected={vue === v.vue}
            onClick={() => changerVue(v.vue)}
            className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-[8px] px-1 text-[13.5px] font-medium sm:min-h-9", vue === v.vue ? "bg-[#23272F] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#D1D5DB]", TRANS)}
          >
            {v.libelle}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", v.vue === "A_TRAITER" && compteurs.A_TRAITER > 0 ? "bg-[#1D9E75] font-semibold text-[#0B1612]" : "text-[#8B919C]")}>{compteurs[v.vue]}</span>
          </button>
        ))}
      </div>

      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" aria-hidden />
        <input value={recherche} onChange={(e) => chercher(e.target.value)} placeholder="Nom, adresse, objet…" aria-label="Rechercher dans la boîte" className={cn(CLASSE_SAISIE, "pl-9")} />
      </label>

      {aide ? <p className="text-[12.5px] text-[#8B919C]">{aide}</p> : null}

      {liste.lignes.length === 0 ? (
        <EtatVide
          titre={vue === "A_TRAITER" ? "Rien à traiter" : vue === "RANGES" ? "Rien de rangé" : "Aucun mail ici"}
          texte={vue === "A_TRAITER" ? "Tout ce qui attendait une réponse est traité. Les nouveaux mails arrivent ici dans la minute." : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {liste.lignes.map((ligne) => (
            <LigneConversation key={ligne.fil} ligne={ligne} occupe={occupe === ligne.messageId} onOuvrir={() => setOuvert(ligne.messageId)} onGeste={(action) => void geste(ligne, action)} />
          ))}
        </ul>
      )}

      {/* Le rangé, replié : accessible, jamais sous les yeux. */}
      <button type="button" onClick={() => changerVue(vue === "RANGES" ? "A_TRAITER" : "RANGES")} className={cn("flex w-full items-center justify-center gap-1.5 rounded-[10px] border-[0.5px] border-dashed border-[#2A2D34] py-3 text-[13px] text-[#8B919C] hover:text-[#D1D5DB]", TRANS)}>
        <ChevronDown size={14} className={cn(vue === "RANGES" && "rotate-180")} aria-hidden />
        {vue === "RANGES" ? "Revenir à « À traiter »" : `Rangés (${compteurs.RANGES})`}
      </button>

      <Modale
        ouverte={nettoyage}
        onFermer={() => setNettoyage(false)}
        titre="Tout nettoyer ?"
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setNettoyage(false)}>
              Annuler
            </Bouton>
            <Bouton variante="primaire" onClick={() => void toutNettoyer()}>
              Tout nettoyer
            </Bouton>
          </div>
        }
      >
        <p className="text-[14px] leading-relaxed text-[#D1D5DB]">Tout ce qui ne demande rien (déjà répondu, lu, informatif) sort de la boîte de réception et est marqué lu, dans Gmail aussi. Ce qui est « À traiter » ne bouge pas. Rien n&apos;est supprimé : tout reste dans Clients, Administratif et dans Gmail.</p>
      </Modale>

      <PanneauMail
        messageId={ouvert}
        nouveauPour={nouveauPour}
        consigneInitiale={nouveauPour === contactInitial ? consigneInitiale : null}
        onFermer={() => {
          setOuvert(null);
          setNouveauPour(null);
          void charger(vue, recherche);
          rafraichirCompteurs();
        }}
        onChange={() => void charger(vue, recherche)}
      />
    </div>
  );
}
