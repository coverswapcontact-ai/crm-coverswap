"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, BellOff, ChevronDown, Mail, MailOpen, Paperclip, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, CLASSE_SAISIE, EnTetePage, EtatVide, Modale, TRANS } from "@/components/pilotage/ui";
import type { ListeMail, LigneMail, VueMail } from "@/lib/mail/vues";
import { LIBELLES_SOURCE_MESSAGE } from "@/lib/espace/messages-constantes";
import { cn } from "@/lib/utils";
import { PanneauMail } from "./PanneauMail";
import { pluriel, quand } from "@/lib/commun/format";

/**
 * L'onglet Mail (mission 7), pensé pour le pouce : trois vues — À traiter,
 * Clients, Administratif —, le rangé replié en bas. Chaque ligne se lit d'un
 * coup d'œil (qui, pourquoi elle est là) et se traite sans l'ouvrir : lu,
 * archiver, ne plus voir cet expéditeur.
 */

type Liste = ListeMail;

const VUES: { vue: Exclude<VueMail, "RANGES">; libelle: string; aide: string }[] = [
  { vue: "A_TRAITER", libelle: "À traiter", aide: "Ce qui attend une réponse ou une action de votre part, par valeur : réclamations, devis en attente, dossiers, leads, échéances. Un mail remis à plus tard revient en tête, marqué « Revenu »." },
  { vue: "CLIENTS", libelle: "Clients", aide: "Tous les échanges avec un client, un lead ou un prospect connu." },
  { vue: "ADMINISTRATIF", libelle: "Administratif", aide: "URSSAF, impôts, banque, assurance, fournisseurs, partenaires." },
];

function Mention({ ligne }: { ligne: LigneMail }) {
  if (!ligne.mention) return null;
  const ton = ligne.mention.startsWith("Sans réponse") ? "border-attention/40 bg-attention/10 text-attention-texte" : ligne.mention === "Nouvelle demande" || ligne.mention === "Revenu" ? "border-action/40 bg-action-fond text-action-clair" : "border-trait bg-surface text-texte-2";
  return <span className={cn("inline-flex items-center rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", ton)}>{ligne.mention}</span>;
}

const PILL = "inline-flex items-center rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";
const LIBELLE_INTENTION: Record<string, string> = { REPONSE: "Réponse attendue", ACTION: "Action", INFORMATION: "Info" };

/** Mission 9 : la priorité (CRM), l'intention (Claude), les cartes et le brouillon prêts. */
function MarquesV2({ ligne, vue }: { ligne: LigneMail; vue: VueMail }) {
  const priorite = vue === "A_TRAITER" && ligne.priorite.rang >= 1 && ligne.priorite.rang <= 5;
  return (
    <>
      {priorite ? (
        <span className={cn(PILL, ligne.priorite.rang === 1 ? "border-retard/40 bg-retard/10 text-retard-texte" : "border-trait bg-surface text-texte-2")}>
          {ligne.priorite.libelle}
          {ligne.priorite.montant !== null ? ` · ${Math.round(ligne.priorite.montant).toLocaleString("fr-FR")} €` : ""}
        </span>
      ) : null}
      {ligne.intention ? <span className={cn(PILL, ligne.intention === "REPONSE" ? "border-attention/40 bg-attention/10 text-attention-texte" : ligne.intention === "ACTION" ? "border-info/40 bg-info/10 text-info-texte" : "border-trait bg-surface text-texte-3")}>{LIBELLE_INTENTION[ligne.intention] ?? ligne.intention}</span> : null}
      {ligne.propositionsEnAttente > 0 ? <span className={cn(PILL, "border-info/40 bg-info/10 text-info-texte")}>{ligne.propositionsEnAttente} carte{ligne.propositionsEnAttente > 1 ? "s" : ""} à valider</span> : null}
      {ligne.brouillonPret ? <span className={cn(PILL, "border-action/40 bg-action-fond text-action-clair")}>Brouillon prêt</span> : null}
      {ligne.snoozeJusqua && !ligne.revenu ? <span className={cn(PILL, "border-trait bg-surface text-texte-3")}>Remis au {new Date(ligne.snoozeJusqua).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span> : null}
    </>
  );
}

function LigneConversation({ ligne, vue, occupe, onOuvrir, onGeste }: { ligne: LigneMail; vue: VueMail; occupe: boolean; onOuvrir: () => void; onGeste: (geste: "LU" | "NON_LU" | "ARCHIVER" | "DESARCHIVER" | "REMONTER" | "NE_PLUS_MONTRER") => void }) {
  const [plus, setPlus] = useState(false);
  const nom = ligne.correspondant.nom || ligne.correspondant.adresse;
  return (
    <li className={cn("rounded-[12px] border-[0.5px] bg-surface", ligne.nonLu ? "border-trait-2" : "border-trait")}>
      <button type="button" onClick={onOuvrir} className={cn("block w-full rounded-t-[12px] px-3.5 pt-3 pb-2 text-left hover:bg-surface focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS)}>
        <span className="flex items-center gap-2">
          {ligne.nonLu ? <span aria-label="Non lu" className="h-2 w-2 shrink-0 rounded-full bg-action" /> : null}
          <span className={cn("min-w-0 flex-1 truncate text-[14.5px]", ligne.nonLu ? "font-semibold text-texte" : "font-medium text-texte-2")}>
            {ligne.sens === "SORTANT" && !ligne.automatique ? <span className="font-normal text-texte-3">À : </span> : null}
            {nom}
          </span>
          {ligne.nombre > 1 ? <span className="text-[11.5px] text-texte-3 tabular-nums">{ligne.nombre}</span> : null}
          {ligne.pieces > 0 ? <Paperclip size={13} className="text-texte-3" aria-label="Pièces jointes" /> : null}
          <span className="shrink-0 text-[12px] text-texte-3 tabular-nums">{quand(ligne.recuLe)}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Mention ligne={ligne} />
          <MarquesV2 ligne={ligne} vue={vue} />
          {ligne.contact ? <span className="rounded-full border-[0.5px] border-trait px-2 py-0.5 text-[11px] text-texte-3">{ligne.contact.type === "CLIENT" ? "Client" : "Lead"} · {ligne.contact.nom}</span> : null}
          {ligne.automatique ? <span className="rounded-full border-[0.5px] border-trait px-2 py-0.5 text-[11px] text-texte-3">Automatique</span> : null}
        </span>
        <span className={cn("mt-1.5 block truncate text-[13.5px]", ligne.nonLu ? "text-texte" : "text-texte-2")}>{ligne.objet || "(sans objet)"}</span>
        {ligne.attendu ? <span className="mt-0.5 block text-[12.5px] leading-snug text-texte-2">→ {ligne.attendu}</span> : null}
        {ligne.extrait && !ligne.attendu ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-texte-3">{ligne.extrait}</span> : null}
        {ligne.range && ligne.motif ? <span className="mt-1 block text-[12px] text-texte-3">Rangé : {ligne.motif}</span> : null}
      </button>
      {/* Les gestes, au pouce : sans ouvrir le mail. */}
      <div className="flex items-center gap-1 border-t-[0.5px] border-trait px-1.5 py-1">
        {ligne.range ? (
          <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste("REMONTER")} icone={<ArchiveRestore size={14} aria-hidden />} className="h-11 sm:h-8">
            Remonter
          </Bouton>
        ) : (
          <>
            <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste(ligne.nonLu ? "LU" : "NON_LU")} icone={ligne.nonLu ? <MailOpen size={14} aria-hidden /> : <Mail size={14} aria-hidden />} className="h-11 sm:h-8" aria-label={ligne.nonLu ? "Marquer comme lu" : "Marquer comme non lu"}>
              {ligne.nonLu ? "Lu" : "Non lu"}
            </Bouton>
            <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste(ligne.traite ? "DESARCHIVER" : "ARCHIVER")} icone={ligne.traite ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />} className="h-11 sm:h-8">
              {ligne.traite ? "Désarchiver" : "Archiver"}
            </Bouton>
            {ligne.sens === "ENTRANT" && ligne.contact?.type !== "CLIENT" ? (
              plus ? (
                <Bouton taille="sm" variante="fantome" disabled={occupe} onClick={() => onGeste("NE_PLUS_MONTRER")} icone={<BellOff size={14} aria-hidden />} className="ml-auto h-11 text-attention-texte sm:h-8">
                  Ne plus me montrer cet expéditeur
                </Bouton>
              ) : (
                <Bouton taille="sm" variante="fantome" onClick={() => setPlus(true)} className="ml-auto h-11 sm:h-8" aria-label="Plus de gestes">
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
      if (action === "NE_PLUS_MONTRER") toast.success("Expéditeur masqué pour toujours", { description: `${pluriel(resultat.ranges ?? 0, "mail rangé", "mails rangés")}, dans Gmail aussi. Réversible depuis Rangés ou Paramètres.` });
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
      toast.success(archives ? `${pluriel(archives, "conversation rangée", "conversations rangées")}` : "Rien à nettoyer", { description: archives ? "Archivées et marquées lues, dans Gmail aussi. Rien n'est supprimé ; ce qui est à traiter n'a pas bougé." : undefined });
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
            <Bouton taille="md" variante="secondaire" onClick={() => setNettoyage(true)} icone={<Sparkles size={14} aria-hidden />}>
              Tout nettoyer
            </Bouton>
          </>
        }
      />

      <div role="tablist" aria-label="Vues de la boîte" className="grid grid-cols-3 gap-1 rounded-[10px] bg-fond p-1">
        {VUES.map((v) => (
          <button
            key={v.vue}
            type="button"
            role="tab"
            aria-selected={vue === v.vue}
            onClick={() => changerVue(v.vue)}
            className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-[8px] px-1 text-[13.5px] font-medium sm:min-h-9", vue === v.vue ? "bg-surface-2 text-texte" : "text-texte-3 hover:text-texte-2", TRANS)}
          >
            {v.libelle}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", v.vue === "A_TRAITER" && compteurs.A_TRAITER > 0 ? "bg-action font-semibold text-action-texte" : "text-texte-3")}>{compteurs[v.vue]}</span>
          </button>
        ))}
      </div>

      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-texte-3" aria-hidden />
        <input value={recherche} onChange={(e) => chercher(e.target.value)} placeholder="Nom, adresse, objet…" aria-label="Rechercher dans la boîte" className={cn(CLASSE_SAISIE, "h-11 pl-9 sm:h-9")} />
      </label>

      {aide ? <p className="text-[12.5px] text-texte-3">{aide}</p> : null}

      {/* Mission 13 (lot 4) : une seule boîte — les messages écrits dans l'espace client sont ici aussi, à traiter. */}
      {vue === "A_TRAITER" && liste.messagesEspace?.length ? (
        <section className="rounded-[12px] border-[0.5px] border-action/40 bg-action-fond/50 p-3.5">
          <h2 className="text-[12px] font-medium tracking-wide text-action-clair uppercase">
            Messages de l&apos;espace client · {liste.messagesEspace.length}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {liste.messagesEspace.map((m) => (
              <li key={m.id}>
                <Link href={`/dossiers?dossier=${m.dossierId}&rubrique=messages`} className={cn("block min-h-[44px] rounded-[10px] border-[0.5px] border-trait bg-surface px-3 py-2 hover:border-trait-2", TRANS)}>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-texte">{m.clientNom}</span>
                    <span className="shrink-0 text-[12px] text-texte-3">{quand(m.le)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-texte-2">
                    {m.source !== "MESSAGE" ? <span className="text-texte-3">{LIBELLES_SOURCE_MESSAGE[m.source]} · </span> : null}
                    {m.texte}
                  </span>
                  <span className="mt-1 block text-[12px] text-action-clair">Répondre dans son dossier →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {liste.lignes.length === 0 && !(vue === "A_TRAITER" && liste.messagesEspace?.length) ? (
        <EtatVide
          titre={vue === "A_TRAITER" ? "Rien à traiter" : vue === "RANGES" ? "Rien de rangé" : "Aucun mail ici"}
          texte={vue === "A_TRAITER" ? "Tout ce qui attendait une réponse est traité. Les nouveaux mails arrivent ici dans la minute." : undefined}
        />
      ) : liste.lignes.length === 0 ? null : (
        <ul className="space-y-2">
          {liste.lignes.map((ligne) => (
            <LigneConversation key={ligne.fil} ligne={ligne} vue={vue} occupe={occupe === ligne.messageId} onOuvrir={() => setOuvert(ligne.messageId)} onGeste={(action) => void geste(ligne, action)} />
          ))}
        </ul>
      )}

      {/* Le rangé, replié : accessible, jamais sous les yeux. */}
      <button type="button" onClick={() => changerVue(vue === "RANGES" ? "A_TRAITER" : "RANGES")} className={cn("flex w-full items-center justify-center gap-1.5 rounded-[10px] border-[0.5px] border-dashed border-trait py-3 text-[13px] text-texte-3 hover:text-texte-2", TRANS)}>
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
        <p className="text-[14px] leading-relaxed text-texte-2">Tout ce qui ne demande rien (déjà répondu, lu, informatif) sort de la boîte de réception et est marqué lu, dans Gmail aussi. Ce qui est « À traiter » ne bouge pas. Rien n&apos;est supprimé : tout reste dans Clients, Administratif et dans Gmail.</p>
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
