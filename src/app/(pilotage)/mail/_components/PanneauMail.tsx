"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, BellOff, ExternalLink, Mail, MailOpen, Paperclip, Search, Send, Sparkles, UserPlus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { useGlisserPourFermer, useRetourFerme } from "@/components/pilotage/fermeture-mobile";
import { Bouton, CLASSE_SAISIE, TRANS } from "@/components/pilotage/ui";
import type { ContexteClient as Contexte } from "@/lib/mail/contexte";
import type { DetailMail } from "@/lib/mail/detail";
import { cn } from "@/lib/utils";
import { ContexteClient } from "./ContexteClient";
import { BlocIntention, BlocResume, BoutonSnooze, BrouillonsDeposes, CartesPropositions, DatesExtraites, type BrouillonRepris } from "./MailV2";

const LIBELLES_CLASSE: Record<string, string> = { CLIENT: "Client", ADMINISTRATIF: "Administratif", HUMAIN: "À lire", BRUIT: "Rangé" };

function dateHeure(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* ── Rédiger : à la main, ou avec l'IA quand Lucas le demande ─────────── */

type Brouillon = { id: string; a: string | null; objet: string; texte: string; manques: string[]; corrections: string[]; coutEuros: number; enReponseA: string | null; dossierId: string | null };

function Redaction({
  destinataire,
  objetInitial,
  enReponseA,
  cible,
  ia,
  consigneInitiale = null,
  brouillonInitial = null,
  onEnvoye,
}: {
  destinataire: string;
  objetInitial: string;
  enReponseA: string | null;
  cible: { messageId?: string | null; clientId?: string | null; leadId?: string | null };
  ia: { active: boolean; raison: string | null };
  /** Consigne proposée par l'écran d'origine (appel sans réponse…) : l'IA n'écrit qu'au clic. */
  consigneInitiale?: string | null;
  /** Mission 9 : un brouillon déposé par Claude, repris dans la réponse (envoyé avec son identifiant). */
  brouillonInitial?: BrouillonRepris | null;
  onEnvoye: () => void;
}) {
  const [a, setA] = useState(brouillonInitial?.a || destinataire);
  const [objet, setObjet] = useState(brouillonInitial?.objet || objetInitial);
  const [texte, setTexte] = useState(brouillonInitial?.texte ?? "");
  const [consigne, setConsigne] = useState(consigneInitiale ?? "");
  const [avecIa, setAvecIa] = useState(Boolean(consigneInitiale) && ia.active);
  const [redaction, setRedaction] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(brouillonInitial ? { id: brouillonInitial.id, a: brouillonInitial.a, objet: brouillonInitial.objet, texte: brouillonInitial.texte, manques: [], corrections: [], coutEuros: 0, enReponseA, dossierId: null } : null);
  // IA du CRM en pause (IA_CRM_ACTIVE) : c'est Claude, par le MCP, qui rédige et dépose.
  const viaAssistant = !ia.active && Boolean(ia.raison?.startsWith("via l'assistant"));
  const aCompleter = texte.includes("[à compléter]");

  async function rediger() {
    setRedaction(true);
    try {
      const b = await envoyerJson<Brouillon>("/api/mail/brouillon", "POST", { ...cible, consigne: consigne.trim() || null });
      setBrouillon(b);
      setTexte(b.texte);
      if (!enReponseA) setObjet(b.objet);
      if (b.a && !a) setA(b.a);
      toast.success("Brouillon rédigé", { description: `Relisez-le : rien ne part sans votre clic. Coût ≈ ${b.coutEuros.toFixed(3).replace(".", ",")} €.` });
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setRedaction(false);
    }
  }

  async function envoyer() {
    setEnvoi(true);
    try {
      await envoyerJson("/api/mail/envoyer", "POST", { a, objet, texte, enReponseA, brouillonId: brouillon?.id ?? null, clientId: cible.clientId ?? null, leadId: cible.leadId ?? null, dossierId: brouillon?.dossierId ?? null });
      toast.success("Envoi en cours", { description: "Il part de votre boîte Gmail, dans la conversation. Il apparaîtra dans le dossier du client." });
      setTexte("");
      setBrouillon(null);
      setConsigne("");
      setAvecIa(false);
      onEnvoye();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section aria-label="Répondre" className="space-y-2.5 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
        <input value={a} onChange={(e) => setA(e.target.value)} className={CLASSE_SAISIE} aria-label="Destinataire" placeholder="Destinataire" type="email" inputMode="email" autoCapitalize="none" />
        <input value={objet} onChange={(e) => setObjet(e.target.value)} className={CLASSE_SAISIE} aria-label="Objet" placeholder="Objet" disabled={Boolean(enReponseA)} />
      </div>

      {avecIa ? (
        <div className="space-y-2 rounded-[10px] border-[0.5px] border-[#1D9E75]/30 bg-[#112B22]/40 p-2.5">
          <label className="block text-[12.5px] text-[#9CA3AF]" htmlFor="consigne-ia">
            Une consigne ? (facultatif) — « dis-lui que je passe jeudi », « relance-le gentiment sur le devis »
          </label>
          <input id="consigne-ia" value={consigne} onChange={(e) => setConsigne(e.target.value)} maxLength={500} className={CLASSE_SAISIE} placeholder="Votre consigne, en quelques mots" />
          <div className="flex flex-wrap items-center gap-2">
            <Bouton variante="primaire" onClick={() => void rediger()} chargement={redaction} icone={<Sparkles size={14} aria-hidden />}>
              {brouillon ? "Réécrire" : "Rédiger"}
            </Bouton>
            <Bouton variante="fantome" onClick={() => setAvecIa(false)}>
              Écrire moi-même
            </Bouton>
            <span className="text-[11.5px] text-[#8B919C]">L&apos;IA n&apos;utilise que ce que sait le CRM ; ce qui manque devient « [à compléter] ».</span>
          </div>
        </div>
      ) : (
        <Bouton variante="secondaire" onClick={() => setAvecIa(true)} disabled={!ia.active} title={ia.raison ?? undefined} icone={<Sparkles size={14} aria-hidden />}>
          {viaAssistant ? "Rédiger : via l'assistant Claude" : "Rédiger avec l'IA"}
        </Bouton>
      )}
      {viaAssistant ? <p className="text-[12px] text-[#8B919C]">Dites-le à Claude (« réponds à … que … ») : il dépose le brouillon ici, vous l&apos;envoyez.</p> : !ia.active && ia.raison ? <p className="text-[12px] text-[#8B919C]">IA indisponible : {ia.raison}</p> : null}

      <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={10} className={cn(CLASSE_SAISIE, "min-h-[220px] resize-y py-2.5 leading-relaxed")} aria-label="Votre message" placeholder="Votre message…" />

      {brouillon && (brouillon.manques.length || brouillon.corrections.length) ? (
        <div className="rounded-[10px] border-[0.5px] border-[#EF9F27]/35 bg-[#EF9F27]/[0.07] p-2.5 text-[12.5px] text-[#FCD9A0]">
          <p className="font-medium text-[#F5B454]">À compléter avant d&apos;envoyer</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {[...new Set([...brouillon.manques.filter((m) => !brouillon.corrections.some((c) => c.startsWith(m))), ...brouillon.corrections])].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] text-[#8B919C]">{aCompleter ? "Remplacez chaque « [à compléter] » pour pouvoir envoyer." : "Envoyé depuis votre boîte Gmail, dans la conversation."}</span>
        <Bouton variante="primaire" onClick={() => void envoyer()} chargement={envoi} disabled={!texte.trim() || !a.trim() || !objet.trim() || aCompleter} icone={<Send size={14} aria-hidden />}>
          Envoyer
        </Bouton>
      </div>
    </section>
  );
}

/* ── Rattacher un inconnu, en deux gestes ─────────────────────────────── */

type ClientTrouve = { id: string; nom: string; ville: string | null; emails?: string[] };

function Rattacher({ messageId, onFait }: { messageId: string; onFait: () => void }) {
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<ClientTrouve[]>([]);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    if (recherche.trim().length < 2) {
      setResultats([]);
      return;
    }
    const minuterie = window.setTimeout(() => {
      void appelApi<{ clients: ClientTrouve[] }>(`/api/clients?recherche=${encodeURIComponent(recherche.trim())}&limite=6`)
        .then((r) => setResultats(r.clients ?? []))
        .catch(() => setResultats([]));
    }, 250);
    return () => window.clearTimeout(minuterie);
  }, [recherche]);

  async function rattacher(client: ClientTrouve) {
    setOccupe(true);
    try {
      await envoyerJson(`/api/mail/${messageId}/rattacher`, "POST", { clientId: client.id });
      toast.success(`Rattaché à ${client.nom}`, { description: "L'adresse est ajoutée à sa fiche : ses prochains mails seront reconnus seuls." });
      onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  async function creerLead() {
    setOccupe(true);
    try {
      const { cree } = await envoyerJson<{ leadId: string; cree: boolean }>(`/api/mail/${messageId}/lead`, "POST");
      toast.success(cree ? "Lead créé (source : mail)" : "Ce contact avait déjà un lead : mail rattaché");
      onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section aria-label="Qui est-ce ?" className="space-y-2 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-3">
      <p className="text-[13px] font-medium text-[#F2F3F5]">Qui est-ce ? Rattachez-le à un client</p>
      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" aria-hidden />
        <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Nom, ville, téléphone…" aria-label="Chercher un client" className={cn(CLASSE_SAISIE, "pl-9")} />
      </label>
      {resultats.length ? (
        <ul className="divide-y-[0.5px] divide-[#2A2D34] rounded-[10px] border-[0.5px] border-[#2A2D34]">
          {resultats.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={occupe} onClick={() => void rattacher(c)} className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left text-[13.5px] text-[#E5E7EB] hover:bg-[#20232A] disabled:opacity-50", TRANS)}>
                <span className="min-w-0 truncate">{c.nom}</span>
                <span className="shrink-0 text-[12px] text-[#8B919C]">{c.ville ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Bouton variante="fantome" onClick={() => void creerLead()} disabled={occupe} icone={<UserPlus size={14} aria-hidden />}>
        C&apos;est une nouvelle demande : créer un lead
      </Bouton>
    </section>
  );
}

/* ── Le panneau ──────────────────────────────────────────────────────── */

export function PanneauMail({
  messageId,
  nouveauPour,
  consigneInitiale = null,
  onFermer,
  onChange,
}: {
  messageId: string | null;
  /** « client:<id> », « lead:<id> » ou « dossier:<id> » : un nouveau mail pour ce contact. */
  nouveauPour: string | null;
  consigneInitiale?: string | null;
  onFermer: () => void;
  onChange: () => void;
}) {
  const ouvert = Boolean(messageId || nouveauPour);
  const [detail, setDetail] = useState<DetailMail | null>(null);
  const [contexteNouveau, setContexteNouveau] = useState<Contexte | null>(null);
  const [volet, setVolet] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [reprise, setReprise] = useState<BrouillonRepris | null>(null);
  useRetourFerme(ouvert, onFermer);
  // Le volet du client (téléphone) se ferme seul au geste retour, avant le mail.
  useRetourFerme(ouvert && volet, () => setVolet(false));
  const glisser = useGlisserPourFermer(onFermer, "droite");

  const charger = useCallback(async () => {
    if (!messageId) return;
    try {
      const d = await appelApi<DetailMail>(`/api/mail/${messageId}`);
      setDetail(d);
      // Ouvrir, c'est lire (dans Gmail aussi).
      if (d.nonLu) {
        await envoyerJson(`/api/mail/${messageId}/action`, "POST", { action: "LU" }).catch(() => undefined);
        rafraichirCompteurs();
        onChange();
      }
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }, [messageId, onChange]);

  useEffect(() => {
    setDetail(null);
    setVolet(false);
    setReprise(null);
    void charger();
  }, [charger]);

  useEffect(() => {
    if (!nouveauPour) {
      setContexteNouveau(null);
      return;
    }
    const [type, id] = nouveauPour.split(":");
    void appelApi<{ contexte: Contexte | null }>(`/api/mail/contexte?${type === "lead" || type === "dossier" ? type : "client"}=${encodeURIComponent(id ?? "")}`)
      .then((r) => {
        if (!r.contexte) toast.error("Contact introuvable.");
        setContexteNouveau(r.contexte);
      })
      .catch((erreur) => toast.error(messageErreur(erreur)));
  }, [nouveauPour]);

  async function geste(action: "LU" | "NON_LU" | "ARCHIVER" | "DESARCHIVER" | "REMONTER" | "NE_PLUS_MONTRER" | "RANGER" | "DERANGER") {
    if (!detail) return;
    setOccupe(true);
    try {
      await envoyerJson(`/api/mail/${detail.messageId}/action`, "POST", { action });
      if (action === "RANGER") toast.success("Rangé", { description: "Lu, sous le libellé CoverSwap/Rangé. Réversible : « Ranger » se défait ici." });
      if (action === "ARCHIVER" || action === "NE_PLUS_MONTRER") {
        toast.success(action === "ARCHIVER" ? "Archivé" : "Expéditeur masqué pour toujours");
        onFermer();
        return;
      }
      await charger();
      onChange();
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  const contexte = detail?.contexte ?? contexteNouveau;
  const iaNouveau = { active: true, raison: null };

  return (
    <Sheet open={ouvert} onOpenChange={(o) => (o ? undefined : volet ? setVolet(false) : onFermer())}>
      <SheetContent side="right" showCloseButton={false} style={glisser.style} className="gap-0 border-[#2A2D34] bg-[#16181D] p-0 text-[#F2F3F5] data-[side=right]:w-full data-[side=right]:sm:max-w-[1080px]">
        <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]">
          <header {...glisser.gestionnaires} className="flex items-start justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-4 py-3">
            <div className="min-w-0">
              <SheetTitle className="truncate text-[15.5px] font-medium text-[#F2F3F5]">{detail ? detail.objet : nouveauPour ? "Nouveau mail" : "Chargement…"}</SheetTitle>
              <SheetDescription className="mt-0.5 truncate text-[12.5px] text-[#9CA3AF]">
                {detail ? `${detail.correspondant.nom ? `${detail.correspondant.nom} · ` : ""}${detail.correspondant.adresse}` : (contexte?.contact.nom ?? "")}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {contexte ? (
                <Bouton variante="fantome" taille="sm" className="h-10 lg:hidden" onClick={() => setVolet(true)} icone={<UserRound size={14} aria-hidden />}>
                  Client
                </Bouton>
              ) : null}
              <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer">
                <X size={16} />
              </Bouton>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_340px]">
            <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
              {detail ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    {detail.classe ? <span className="rounded-full border-[0.5px] border-[#2A2D34] px-2 py-0.5 text-[#B4BAC4]">{LIBELLES_CLASSE[detail.classe] ?? detail.classe}</span> : null}
                    {detail.motif ? <span className="text-[#8B919C]">Pourquoi ici : {detail.motif}</span> : null}
                  </div>
                  <BlocIntention
                    key={`${detail.messageId}:${detail.intentionLe ?? ""}`}
                    detail={detail}
                    onChange={() => {
                      void charger();
                      onChange();
                    }}
                  />
                  {detail.resume ? <BlocResume resume={detail.resume} /> : null}
                  <CartesPropositions
                    propositions={detail.propositions}
                    onChange={() => {
                      void charger();
                      onChange();
                    }}
                  />
                  <DatesExtraites messageId={detail.messageId} dates={detail.datesExtraites} onChange={() => void charger()} />
                  <div className="flex flex-wrap gap-1">
                    {detail.range ? (
                      <Bouton taille="sm" variante="secondaire" className="h-10 sm:h-8" disabled={occupe} onClick={() => void geste("REMONTER")} icone={<ArchiveRestore size={14} aria-hidden />}>
                        Remonter (ne plus jamais ranger cet expéditeur)
                      </Bouton>
                    ) : (
                      <>
                        <Bouton taille="sm" variante="secondaire" className="h-10 sm:h-8" disabled={occupe} onClick={() => void geste(detail.traite ? "DESARCHIVER" : "ARCHIVER")} icone={detail.traite ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}>
                          {detail.traite ? "Désarchiver" : "Archiver"}
                        </Bouton>
                        <Bouton taille="sm" variante="secondaire" className="h-10 sm:h-8" disabled={occupe} onClick={() => void geste(detail.nonLu ? "LU" : "NON_LU")} icone={detail.nonLu ? <MailOpen size={14} aria-hidden /> : <Mail size={14} aria-hidden />}>
                          {detail.nonLu ? "Lu" : "Non lu"}
                        </Bouton>
                        <BoutonSnooze
                          messageId={detail.messageId}
                          snoozeJusqua={detail.snoozeJusqua}
                          onChange={() => {
                            void charger();
                            onChange();
                          }}
                        />
                        {detail.fil.some((m) => m.sens === "ENTRANT") ? (
                          <Bouton taille="sm" variante="fantome" className="h-10 sm:h-8" disabled={occupe} onClick={() => void geste("RANGER")} icone={<Archive size={14} aria-hidden />}>
                            Ranger
                          </Bouton>
                        ) : null}
                        {detail.contexte?.contact.type !== "CLIENT" && detail.fil.some((m) => m.sens === "ENTRANT") ? (
                          <Bouton taille="sm" variante="fantome" className="h-10 sm:h-8" disabled={occupe} onClick={() => void geste("NE_PLUS_MONTRER")} icone={<BellOff size={14} aria-hidden />}>
                            Ne plus me montrer cet expéditeur
                          </Bouton>
                        ) : null}
                      </>
                    )}
                    {detail.lienGmail ? (
                      <a href={detail.lienGmail} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5] sm:h-8">
                        <ExternalLink size={13} aria-hidden /> Gmail
                      </a>
                    ) : null}
                  </div>

                  {!detail.contexte && detail.fil.some((m) => m.sens === "ENTRANT") ? (
                    <Rattacher
                      messageId={detail.messageId}
                      onFait={() => {
                        void charger();
                        onChange();
                      }}
                    />
                  ) : null}

                  <ol className="space-y-2.5">
                    {detail.fil.map((m) => (
                      <li key={m.id} className={cn("rounded-[12px] border-[0.5px] p-3", m.sens === "SORTANT" ? "border-[#1D9E75]/25 bg-[#112B22]/30" : "border-[#2A2D34] bg-[#1C1F25]")}>
                        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12.5px]">
                          <span className="font-medium text-[#E5E7EB]">{m.sens === "SORTANT" ? (m.automatique ? "CoverSwap (automatique)" : "Vous") : (m.deNom ?? m.de)}</span>
                          <span className="text-[#8B919C] tabular-nums">{dateHeure(m.recuLe)}</span>
                        </p>
                        <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-wrap text-[#E5E7EB]">{m.texte || "(message vide)"}</p>
                        {m.pieces.length ? (
                          <ul className="mt-2.5 flex flex-wrap gap-2">
                            {m.pieces.map((p) =>
                              p.url && p.estImage ? (
                                <li key={p.id}>
                                  <a href={p.url} target="_blank" rel="noopener" title={p.nom}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={p.url} alt={p.nom} className="h-24 w-24 rounded-[8px] border-[0.5px] border-[#2A2D34] object-cover" loading="lazy" />
                                  </a>
                                </li>
                              ) : (
                                <li key={p.id}>
                                  <a href={p.url ?? detail.lienGmail ?? "#"} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12.5px] text-[#D1D5DB] hover:border-[#3A3E47]">
                                    <Paperclip size={13} aria-hidden /> {p.nom}
                                  </a>
                                </li>
                              )
                            )}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ol>

                  {detail.envois.length ? (
                    <ul className="space-y-1 text-[12px] text-[#9CA3AF]">
                      {detail.envois.map((e) => (
                        <li key={e.id}>
                          {e.statut === "ENVOYE" ? `Envoyé à ${e.a} ${e.envoyeLe ? `le ${dateHeure(e.envoyeLe)}` : ""}` : e.statut === "ECHEC" ? `Échec de l'envoi : ${e.erreur ?? "inconnu"}` : `En cours d'envoi à ${e.a} (il attend Gmail si la connexion est coupée)`}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <BrouillonsDeposes brouillons={detail.brouillons} onReprendre={(b) => setReprise(b)} />

                  <Redaction
                    key={`${detail.messageId}:${reprise?.id ?? ""}`}
                    destinataire={detail.fil.some((m) => m.sens === "ENTRANT") ? detail.correspondant.adresse : (detail.fil.at(-1)?.a[0] ?? "")}
                    objetInitial={`Re: ${detail.objet}`}
                    enReponseA={detail.enReponseA}
                    cible={{ messageId: detail.messageId }}
                    ia={detail.ia}
                    brouillonInitial={reprise}
                    onEnvoye={() => {
                      void charger();
                      onChange();
                    }}
                  />
                </>
              ) : nouveauPour ? (
                contexteNouveau ? (
                  <>
                    {contexteNouveau.contact.emails.length === 0 ? <p className="text-[12.5px] text-[#F5B454]">Aucune adresse e-mail connue pour ce contact : saisissez-la ci-dessous (elle ne sera pas ajoutée à sa fiche).</p> : null}
                    <Redaction
                      key={nouveauPour}
                      destinataire={contexteNouveau.contact.emails[0] ?? ""}
                      objetInitial=""
                      enReponseA={null}
                      cible={{ clientId: contexteNouveau.contact.clientId, leadId: contexteNouveau.contact.leadId }}
                      ia={iaNouveau}
                      consigneInitiale={consigneInitiale}
                      onEnvoye={onFermer}
                    />
                  </>
                ) : (
                  <p className="text-[13px] text-[#8B919C]">Chargement du contact…</p>
                )
              ) : (
                <p className="text-[13px] text-[#8B919C]">Chargement…</p>
              )}
            </div>

            {/* Le client : une colonne sur ordinateur. */}
            {contexte ? (
              <aside className="hidden min-h-0 overflow-y-auto border-l-[0.5px] border-[#2A2D34] px-4 py-4 lg:block">
                <ContexteClient contexte={contexte} />
              </aside>
            ) : null}
          </div>
        </div>

        {/* …et un volet sur téléphone. */}
        <Sheet open={volet} onOpenChange={setVolet}>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto border-[#2A2D34] bg-[#16181D] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-[#F2F3F5]">
            <SheetTitle className="sr-only">Le client</SheetTitle>
            <SheetDescription className="sr-only">Fiche, projets, dernière note d&apos;appel</SheetDescription>
            {contexte ? <ContexteClient contexte={contexte} /> : null}
          </SheetContent>
        </Sheet>
      </SheetContent>
    </Sheet>
  );
}
