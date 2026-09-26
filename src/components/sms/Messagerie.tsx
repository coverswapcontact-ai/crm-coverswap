"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRetourFerme } from "@/components/pilotage/fermeture-mobile";
import { MessageSquare, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import type { ConversationResume, ElementFil, FiltreConversations } from "@/lib/sms/conversations";
import type { ContexteConversation } from "@/lib/sms/contexte";
import type { EtatFournisseur } from "@/lib/sms/fournisseurs";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import { Bouton, Champ, Modale, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import { ContexteDossier } from "./ContexteDossier";
import { FilConversation, type DemandeEnvoi, type ElementAffiche } from "./FilConversation";
import { ListeConversations } from "./ListeConversations";
import { chargerSmsProposes, type SmsPropose } from "./RelancesProposees";
import { ecrireBrouillonLocal, enAttente, lireBrouillonLocal, mettreEnAttente, nouvelleCleEnvoi, retirerDeLAttente, type EnvoiEnAttente } from "./fileAttente";

type Liste = { conversations: ConversationResume[]; compteurs: { nonLues: number; aRepondre: number; aRattacher: number }; fournisseur: EtatFournisseur };
type Fil = { conversation: ConversationResume; elements: ElementFil[]; contexte: ContexteConversation };
type Trouvee = { genre: "lead" | "client"; id: string; nom: string; detail: string; telephone: string | null };

/** Fusionne le fil du serveur et ce que l'écran a envoyé sans réponse du serveur encore. */
function avecEnvoisLocaux(elements: ElementFil[], locaux: EnvoiEnAttente[], enCours: ReadonlySet<string>): ElementAffiche[] {
  const connues = new Set(elements.map((e) => (e.genre === "SMS" ? e.cleEnvoi : null)).filter(Boolean));
  const ajoutes = locaux
    .filter((l) => !connues.has(l.cleEnvoi))
    .map(
      (l): ElementAffiche => ({
        genre: "SMS",
        id: `local-${l.cleEnvoi}`,
        le: l.creeLe,
        sens: "SORTANT",
        texte: l.texte,
        statut: "A_ENVOYER",
        erreur: null,
        origine: "MANUEL",
        cleEnvoi: l.cleEnvoi,
        segments: null,
        local: enCours.has(l.cleEnvoi) ? "EN_COURS" : "HORS_LIGNE",
      })
    );
  return [...elements, ...ajoutes];
}

/**
 * Messagerie SMS. Téléphone : la liste en plein écran, on tape, la conversation
 * s'ouvre en plein écran, le contexte du dossier glisse depuis la droite.
 * Ordinateur : trois colonnes — conversations, fil, contexte.
 *
 * Envoi optimiste : le message s'affiche tout de suite ; s'il n'atteint pas le
 * serveur (réseau coupé), il attend dans le navigateur et repart tout seul.
 * Temps réel : un flux d'événements du serveur, doublé d'une relève périodique
 * quand le flux est tombé.
 */
export function Messagerie({ initiale, application = "crm" }: { initiale: Liste; application?: "crm" | "messages" }) {
  const [liste, setListe] = useState(initiale);
  const [filtre, setFiltre] = useState<FiltreConversations>("TOUTES");
  const [recherche, setRecherche] = useState("");
  const [idOuvert, setIdOuvert] = useState<string | null>(null);
  const [fil, setFil] = useState<Fil | null>(null);
  const [chargementFil, setChargementFil] = useState(false);
  const [voletContexte, setVoletContexte] = useState(false);
  useRetourFerme(voletContexte, () => setVoletContexte(false));
  const [nouvelle, setNouvelle] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  const [versionLocale, setVersionLocale] = useState(0);
  const enCours = useRef(new Set<string>());
  const fluxActif = useRef(false);
  const idOuvertRef = useRef<string | null>(null);
  const filtres = useRef({ filtre, recherche });
  const minuterieBrouillon = useRef<number | null>(null);
  const [smsProposes, setSmsProposes] = useState<SmsPropose[]>([]);
  const [retourAppels, setRetourAppels] = useState(false);
  const [aProposer, setAProposer] = useState<{ conversationId: string; modele: "LIEN_ESPACE" | "INJOIGNABLE_LIEN" | "LIEN_ESPACE_RAPPEL" } | null>(null);

  /* ── Chargements ─────────────────────────────────────────────────── */

  const chargerListe = useCallback(async () => {
    const { filtre: f, recherche: q } = filtres.current;
    try {
      const reponse = await appelApi<Liste>(`/api/sms/conversations?filtre=${f}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
      setListe(reponse);
      setHorsLigne(vientDuCache());
      // Les messages que le CRM propose (relances) : signalés en tête de liste, relus dans la conversation.
      void chargerSmsProposes()
        .then(setSmsProposes)
        .catch(() => undefined);
      if ("setAppBadge" in navigator) {
        const total = reponse.compteurs.nonLues;
        void (total > 0 ? (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> }).setAppBadge(total) : (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge()).catch(() => undefined);
      }
    } catch (erreur) {
      if (!(erreur instanceof ErreurApi)) setHorsLigne(true);
    }
  }, []);

  const chargerFil = useCallback(async (id: string, options: { silencieux?: boolean } = {}) => {
    if (!options.silencieux) setChargementFil(true);
    try {
      // Une conversation n'est « lue » que si elle est réellement à l'écran.
      const visible = document.visibilityState === "visible";
      const reponse = await appelApi<Fil>(`/api/sms/conversations/${id}${visible ? "" : "?lu=0"}`);
      if (idOuvertRef.current === id) setFil(reponse);
      if (visible) rafraichirCompteurs();
    } catch (erreur) {
      if (erreur instanceof ErreurApi && !options.silencieux) toast.error(messageErreur(erreur));
    } finally {
      if (!options.silencieux) setChargementFil(false);
    }
  }, []);

  /* ── Ouverture d'une conversation, synchronisée avec l'adresse ────── */

  const ouvrir = useCallback(
    (id: string | null, options: { historique?: boolean } = {}) => {
      idOuvertRef.current = id;
      setIdOuvert(id);
      setVoletContexte(false);
      if (id) {
        setFil((actuel) => (actuel?.conversation.id === id ? actuel : null));
        void chargerFil(id).then(() => void chargerListe());
      } else setFil(null);
      if (options.historique !== false) {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set("c", id);
        else url.searchParams.delete("c");
        window.history.pushState({ conversation: id }, "", url);
      }
    },
    [chargerFil, chargerListe]
  );

  useEffect(() => {
    const depuisAdresse = () => new URL(window.location.href).searchParams.get("c");
    const initial = depuisAdresse();
    // Venu des appels à la suite (section Leads) : un bouton y ramène une fois le SMS envoyé.
    if (new URL(window.location.href).searchParams.get("retour") === "appels") window.setTimeout(() => setRetourAppels(true), 0);
    if (initial) ouvrir(initial, { historique: false });
    // ?lead=… ou ?dossier=… (lien « Envoyer par SMS » d'une fiche) : la conversation de cette personne s'ouvre, créée au besoin.
    const adresse = new URL(window.location.href);
    const cible = adresse.searchParams.get("lead") ? { leadId: adresse.searchParams.get("lead") } : adresse.searchParams.get("dossier") ? { dossierId: adresse.searchParams.get("dossier") } : null;
    if (!initial && cible) {
      envoyerJson<{ conversation: ConversationResume }>("/api/sms/conversations", "POST", cible)
        .then(({ conversation }) => {
          const modele = adresse.searchParams.get("proposer");
          if (modele === "LIEN_ESPACE" || modele === "INJOIGNABLE_LIEN" || modele === "LIEN_ESPACE_RAPPEL") setAProposer({ conversationId: conversation.id, modele });
          adresse.searchParams.delete("proposer");
          adresse.searchParams.delete("lead");
          adresse.searchParams.delete("dossier");
          window.history.replaceState(null, "", adresse);
          ouvrir(conversation.id);
        })
        .catch((erreur) => toast.error(messageErreur(erreur)));
    }
    // Le geste « retour » du téléphone referme la conversation au lieu de quitter l'écran.
    const surRetour = () => ouvrir(depuisAdresse(), { historique: false });
    window.addEventListener("popstate", surRetour);
    return () => window.removeEventListener("popstate", surRetour);
  }, [ouvrir]);

  /* ── Filtre et recherche ─────────────────────────────────────────── */

  useEffect(() => {
    filtres.current = { filtre, recherche };
    const minuterie = window.setTimeout(() => void chargerListe(), recherche ? 250 : 0);
    return () => window.clearTimeout(minuterie);
  }, [filtre, recherche, chargerListe]);

  /* ── File hors ligne : ce qui n'a pas atteint le serveur repart seul ─ */

  const tenter = useCallback(
    async (envoi: EnvoiEnAttente) => {
      if (enCours.current.has(envoi.cleEnvoi)) return;
      enCours.current.add(envoi.cleEnvoi);
      setVersionLocale((v) => v + 1);
      try {
        await envoyerJson(`/api/sms/conversations/${envoi.conversationId}/messages`, "POST", { texte: envoi.texte, cleEnvoi: envoi.cleEnvoi, modele: envoi.modele, textePropose: envoi.textePropose });
        retirerDeLAttente(envoi.cleEnvoi);
        setHorsLigne(false);
        if (idOuvertRef.current === envoi.conversationId) await chargerFil(envoi.conversationId, { silencieux: true });
        void chargerListe();
      } catch (erreur) {
        // Serveur en cours de redémarrage (502-504) ou session à renouveler (401) : le message reste en file, comme sans réseau.
        const passager = erreur instanceof ErreurApi && ([502, 503, 504].includes(erreur.status) || erreur.status === 401);
        if (erreur instanceof ErreurApi && !passager) {
          // Le serveur a répondu non (STOP, numéro fixe, message trop long) : inutile d'insister.
          retirerDeLAttente(envoi.cleEnvoi);
          toast.error("Message non envoyé", { description: erreur.message });
          if (idOuvertRef.current === envoi.conversationId) void chargerFil(envoi.conversationId, { silencieux: true });
        } else if (erreur instanceof ErreurApi && erreur.status === 401) {
          toast.error("Session expirée", { description: "Reconnectez-vous : le message est gardé et partira ensuite." });
        } else setHorsLigne(true);
      } finally {
        enCours.current.delete(envoi.cleEnvoi);
        setVersionLocale((v) => v + 1);
      }
    },
    [chargerFil, chargerListe]
  );

  const viderLaFile = useCallback(() => {
    for (const envoi of enAttente()) void tenter(envoi);
  }, [tenter]);

  function envoyer(demande: DemandeEnvoi) {
    if (!idOuvert) return;
    const envoi: EnvoiEnAttente = { cleEnvoi: nouvelleCleEnvoi(), conversationId: idOuvert, texte: demande.texte, modele: demande.modele, textePropose: demande.textePropose, creeLe: new Date().toISOString() };
    mettreEnAttente(envoi);
    ecrireBrouillonLocal(idOuvert, "");
    void tenter(envoi);
  }

  async function reessayer(element: ElementAffiche) {
    if (element.genre !== "SMS") return;
    if (element.local) {
      viderLaFile();
      return;
    }
    try {
      await envoyerJson(`/api/sms/messages/${element.id}/reessayer`, "POST");
      if (idOuvert) void chargerFil(idOuvert, { silencieux: true });
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }

  /* ── Brouillon : gardé dans le navigateur tout de suite, sur le serveur peu après ── */

  function brouillon(texte: string) {
    const id = idOuvert;
    if (!id) return;
    ecrireBrouillonLocal(id, texte);
    if (minuterieBrouillon.current) window.clearTimeout(minuterieBrouillon.current);
    minuterieBrouillon.current = window.setTimeout(() => {
      void envoyerJson(`/api/sms/conversations/${id}`, "PATCH", { brouillon: texte.trim() ? texte : null }).catch(() => undefined);
    }, 1500);
  }

  /* ── Temps réel : flux du serveur, relève de secours, retour de réseau ── */

  useEffect(() => {
    let source: EventSource | null = null;
    const rafraichir = (conversationId?: string) => {
      void chargerListe();
      const ouvert = idOuvertRef.current;
      if (ouvert && (!conversationId || conversationId === ouvert)) void chargerFil(ouvert, { silencieux: true });
    };
    const brancher = () => {
      source?.close();
      source = new EventSource("/api/sms/flux");
      source.onopen = () => {
        fluxActif.current = true;
      };
      source.onmessage = (evenement) => {
        try {
          rafraichir((JSON.parse(evenement.data) as { conversationId?: string }).conversationId);
        } catch {
          rafraichir();
        }
      };
      source.onerror = () => {
        fluxActif.current = false;
      };
    };
    brancher();
    // Relève de secours : toutes les dix secondes tant que le flux est tombé, toutes les minutes sinon.
    let tours = 0;
    const releve = window.setInterval(() => {
      tours++;
      if (document.visibilityState !== "visible") return;
      if (!fluxActif.current || tours % 6 === 0) rafraichir();
      if (enAttente().length > 0) viderLaFile();
    }, 10_000);
    const surRetour = () => {
      if (document.visibilityState !== "visible") return;
      if (!fluxActif.current) brancher();
      rafraichir();
      viderLaFile();
    };
    document.addEventListener("visibilitychange", surRetour);
    window.addEventListener("online", surRetour);
    window.addEventListener("focus", surRetour);
    const surCoupure = () => setHorsLigne(true);
    window.addEventListener("offline", surCoupure);
    const oublierLeCache = ecouterLeCache(surCoupure);
    viderLaFile();
    return () => {
      oublierLeCache();
      source?.close();
      window.clearInterval(releve);
      document.removeEventListener("visibilitychange", surRetour);
      window.removeEventListener("online", surRetour);
      window.removeEventListener("focus", surRetour);
      window.removeEventListener("offline", surCoupure);
    };
  }, [chargerFil, chargerListe, viderLaFile]);

  /* ── Rendu ───────────────────────────────────────────────────────── */

  const conversationOuverte = fil?.conversation ?? liste.conversations.find((c) => c.id === idOuvert) ?? null;
  // versionLocale force le recalcul quand la file du navigateur change.
  const elements = idOuvert && fil && versionLocale >= 0 ? avecEnvoisLocaux(fil.elements, enAttente(idOuvert), enCours.current) : [];
  const brouillonInitial = idOuvert ? (lireBrouillonLocal(idOuvert) ?? conversationOuverte?.brouillon ?? "") : "";
  const fournisseur = liste.fournisseur;
  const hauteur = application === "messages" ? "h-[100dvh]" : "h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.25rem)]";

  const bandeau = (
    <>
      <NotificationsAppareil application={application} compact />
      {smsProposes.length > 0 ? (
        <div className="border-b-[0.5px] border-[#1D9E75]/30 bg-[#1D9E75]/[0.07] px-3.5 py-2.5">
          <p className="text-[12px] font-medium text-[#5DCAA5]">
            {smsProposes.length} message{smsProposes.length > 1 ? "s" : ""} proposé{smsProposes.length > 1 ? "s" : ""} à relire
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {smsProposes.slice(0, 8).map((propose) => (
              <li key={propose.id}>
                <button type="button" onClick={() => ouvrir(propose.conversationId)} className="h-8 max-w-[15rem] truncate rounded-full border-[0.5px] border-[#1D9E75]/45 px-3 text-[12.5px] text-[#D1D5DB] hover:bg-[#1D9E75]/15">
                  {propose.titre}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {horsLigne ? (
        <p className="flex items-center gap-2 border-b-[0.5px] border-[#EF9F27]/30 bg-[#EF9F27]/10 px-3.5 py-2 text-[12.5px] text-[#F5B454]">
          <WifiOff size={13} aria-hidden /> Hors ligne : vos messages partiront au retour du réseau.
        </p>
      ) : null}
      {!fournisseur.nom || !fournisseur.bidirectionnel ? (
        <p className="border-b-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3.5 py-2 text-[12px] leading-snug text-[#9CA3AF]">
          {fournisseur.remarque}{" "}
          <a href="/parametres#sms" className="text-[#5DCAA5] underline-offset-2 hover:underline">
            Paramètres → Messagerie SMS
          </a>
        </p>
      ) : null}
    </>
  );

  return (
    <div className={cn("flex w-full overflow-hidden bg-[#16181D]", hauteur)}>
      {retourAppels ? (
        <a href="/leads?appels=1" className="fixed top-[calc(0.5rem+env(safe-area-inset-top))] left-1/2 z-[70] flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#1D9E75] px-4 text-[13.5px] font-semibold text-[#06140F] shadow-lg shadow-black/40 hover:bg-[#5DCAA5]">
          ← Reprendre les appels
        </a>
      ) : null}
      {/* Colonne 1 : conversations (plein écran sur téléphone) */}
      <aside className={cn("w-full shrink-0 border-r-[0.5px] border-[#2A2D34] lg:w-[340px]", idOuvert ? "hidden lg:block" : "block")}>
        <ListeConversations
          conversations={liste.conversations}
          compteurs={liste.compteurs}
          filtre={filtre}
          onFiltre={setFiltre}
          recherche={recherche}
          onRecherche={setRecherche}
          idOuvert={idOuvert}
          onOuvrir={(id) => ouvrir(id)}
          onNouvelle={() => setNouvelle(true)}
          bandeau={bandeau}
        />
      </aside>

      {/* Colonne 2 : le fil (plein écran par-dessus tout sur téléphone) */}
      <section className={cn("min-w-0 flex-1", idOuvert ? "fixed inset-0 z-[60] lg:static lg:z-auto" : "hidden lg:block")}>
        {idOuvert && conversationOuverte ? (
          <FilConversation
            conversation={conversationOuverte}
            elements={elements}
            contexte={fil?.contexte ?? null}
            chargement={chargementFil}
            fournisseurPret={Boolean(fournisseur.nom)}
            onRetour={() => window.history.back()}
            onContexte={() => setVoletContexte(true)}
            onEnvoyer={envoyer}
            onReessayer={(element) => void reessayer(element)}
            onBrouillon={brouillon}
            brouillonInitial={brouillonInitial}
            proposerAuChargement={aProposer?.conversationId === idOuvert ? aProposer.modele : null}
            onPropose={() => setAProposer(null)}
            onRafraichir={() => {
              if (idOuvert) void chargerFil(idOuvert, { silencieux: true });
              void chargerListe();
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[#6B7280]">
            <MessageSquare size={28} aria-hidden />
            <p className="text-[13px]">Choisissez une conversation.</p>
          </div>
        )}
      </section>

      {/* Colonne 3 : contexte du dossier (volet sur téléphone et tablette) */}
      {idOuvert && conversationOuverte ? (
        <>
          <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l-[0.5px] border-[#2A2D34] xl:block">
            <ContexteDossier conversation={conversationOuverte} contexte={fil?.contexte ?? null} onChange={() => void chargerFil(idOuvert, { silencieux: true }).then(() => void chargerListe())} />
          </aside>
          {voletContexte ? (
            <div className="fixed inset-0 z-[70] xl:hidden">
              <button type="button" aria-label="Fermer le contexte" onClick={() => setVoletContexte(false)} className="absolute inset-0 bg-black/60" />
              <aside className="absolute inset-y-0 right-0 flex w-[min(92vw,380px)] flex-col border-l-[0.5px] border-[#2A2D34] bg-[#16181D] pt-[env(safe-area-inset-top)] shadow-2xl">
                <div className="flex items-center justify-between border-b-[0.5px] border-[#2A2D34] px-3.5 py-2.5">
                  <p className="text-[14px] font-medium text-[#F2F3F5]">Contexte du dossier</p>
                  <button type="button" onClick={() => setVoletContexte(false)} aria-label="Fermer" className={cn("flex h-10 w-10 items-center justify-center rounded-[10px] text-[#D1D5DB] hover:bg-[#22262D]", TRANS)}>
                    <X size={18} aria-hidden />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                  <ContexteDossier conversation={conversationOuverte} contexte={fil?.contexte ?? null} onChange={() => void chargerFil(idOuvert, { silencieux: true }).then(() => void chargerListe())} />
                </div>
              </aside>
            </div>
          ) : null}
        </>
      ) : null}

      <NouvelleConversation
        ouverte={nouvelle}
        onFermer={() => setNouvelle(false)}
        onOuverte={(id) => {
          setNouvelle(false);
          ouvrir(id);
        }}
      />
    </div>
  );
}

function NouvelleConversation({ ouverte, onFermer, onOuverte }: { ouverte: boolean; onFermer: () => void; onOuverte: (id: string) => void }) {
  const [saisie, setSaisie] = useState("");
  const [trouvees, setTrouvees] = useState<Trouvee[]>([]);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouverte || saisie.trim().length < 2) return;
    const minuterie = window.setTimeout(() => {
      appelApi<{ personnes: Trouvee[] }>(`/api/sms/recherche?q=${encodeURIComponent(saisie)}`)
        .then((reponse) => setTrouvees(reponse.personnes))
        .catch(() => setTrouvees([]));
    }, 250);
    return () => window.clearTimeout(minuterie);
  }, [saisie, ouverte]);

  async function creer(donnees: { numero: string } | { leadId: string } | { clientId: string }) {
    setEnvoi(true);
    try {
      const { conversation } = await envoyerJson<{ conversation: ConversationResume }>("/api/sms/conversations", "POST", donnees);
      setSaisie("");
      setTrouvees([]);
      onOuverte(conversation.id);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  const estNumero = saisie.replace(/\D/g, "").length >= 9 && /^[\d\s.+()-]+$/.test(saisie.trim());
  return (
    <Modale ouverte={ouverte} onFermer={onFermer} titre="Nouvelle conversation" description="Un nom, une ville ou un numéro de mobile.">
      <div className="space-y-3">
        <Champ libelle="À qui écrire ?" placeholder="Martin, Lattes, 06 12 34 56 78…" value={saisie} onChange={(evenement) => setSaisie(evenement.target.value)} autoFocus inputMode="text" />
        {estNumero ? (
          <Bouton variante="primaire" className="h-12 w-full text-[15px] sm:h-9 sm:text-[13px]" chargement={envoi} onClick={() => void creer({ numero: saisie })}>
            Écrire au {saisie.trim()}
          </Bouton>
        ) : null}
        <ul className="space-y-1">
          {saisie.trim().length >= 2
            ? trouvees.map((p) => (
                <li key={`${p.genre}-${p.id}`}>
                  <button
                    type="button"
                    disabled={!p.telephone || envoi}
                    onClick={() => void creer(p.genre === "lead" ? { leadId: p.id } : { clientId: p.id })}
                    className={cn("flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-[#22262D] disabled:opacity-40", TRANS)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-[#F2F3F5]">{p.nom}</span>
                      <span className="block truncate text-[12px] text-[#8B919C]">{p.detail}</span>
                    </span>
                    <span className="shrink-0 text-[12.5px] text-[#9CA3AF] tabular-nums">{p.telephone ?? "sans numéro"}</span>
                  </button>
                </li>
              ))
            : null}
        </ul>
      </div>
    </Modale>
  );
}
