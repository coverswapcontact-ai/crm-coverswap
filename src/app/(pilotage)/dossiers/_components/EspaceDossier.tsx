"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Eye, Link2, Lock, Mail, MessageSquare, Pencil, RefreshCw, RotateCcw, ShieldOff, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail } from "@/lib/dossiers/types";
import type { GesteEspace, VueEspaceCrm } from "@/lib/espace/vue-crm";
import { famille, famillesDe, libelleTaille, resumerSelection, type TaillesProjet } from "@/lib/prestations/prestations";
import { NouveauLien } from "@/components/pilotage/espace/NouveauLien";
import { LienParMail, type CibleLienMail } from "@/components/pilotage/espace/LienParMail";
import { ouvrirEcranSms } from "@/components/pilotage/sms/EcranSms";
import { LIBELLES_MOYEN, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { cn } from "@/lib/utils";
import { Pastille, Bouton, Modale, TitreSection, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { euros, jour, jourHeure } from "@/lib/commun/format";
import { Rubrique, type ConfirmationEspace } from "./RubriqueEspace";
import { RubriquePhotosEspace } from "./RubriquePhotosEspace";
import { RubriqueSimulationsEspace } from "./RubriqueSimulationsEspace";
import { RubriqueDevisEspace } from "./RubriqueDevisEspace";

const moyen = (m: string | null) => (m && m in LIBELLES_MOYEN ? LIBELLES_MOYEN[m as MoyenPaiement].toLowerCase() : null);

/**
 * L'espace client vu — et piloté — depuis le dossier : où en est le client,
 * ce qu'il a fait, ÉCRIT (en entier) et validé, ce qu'il lui reste à faire ; et
 * les gestes que je peux faire à sa place : valider ou dévalider son projet,
 * le modifier, valider ou dévalider une simulation, retirer une demande ou un
 * accord, accorder des simulations, remettre une photo, réinitialiser une
 * étape. Chaque geste est écrit dans l'historique du dossier (« par Lucas »).
 * Montants, accord et paiements sont lus là où l'espace du client les lit.
 */
export function EspaceDossier({
  detail,
  onRecharger,
  onFaireDevis,
  onAjouterDevis,
  onDeposerPdf,
  sansTitre = false,
}: {
  detail: DossierDetail;
  onRecharger: () => Promise<void>;
  onFaireDevis?: () => void;
  /** Mission 11 : un devis de plus (lignes + libellé) ; un devis PDF déjà fait (numéro + libellé). */
  onAjouterDevis?: () => void;
  onDeposerPdf?: () => void;
  /** Mission 13 (lot 4) : le panneau porte déjà le titre (section repliable). */
  sansTitre?: boolean;
}) {
  const [espace, setEspace] = useState<VueEspaceCrm | null | undefined>(undefined);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [edition, setEdition] = useState<{ tailles: TaillesProjet; precisions: string } | null>(null);
  const [destinataire, setDestinataire] = useState<{ email: string | null } | null>(null);
  const [lienMail, setLienMail] = useState<CibleLienMail | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationEspace | null>(null);
  const [gestesOuverts, setGestesOuverts] = useState(false);
  const [reponse, setReponse] = useState("");
  // Mission 12 : ses photos s'ouvrent dans la visionneuse (déposées, puis retirées), plus dans un nouvel onglet.
  const [photoOuverte, setPhotoOuverte] = useState<number | null>(null);
  // Mission 13 (lot 5) : ses simulations aussi, plus de nouvel onglet.
  const [simulationOuverte, setSimulationOuverte] = useState<number | null>(null);

  const charger = useCallback(async () => {
    try {
      setEspace((await appelApi<{ espace: VueEspaceCrm | null }>(`/api/dossiers/${detail.id}/espace`)).espace);
    } catch {
      setEspace(null);
    }
    if (detail.client) {
      appelApi<{ email: string | null }>(`/api/clients/${detail.client.id}/espace`)
        .then((r) => setDestinataire({ email: r.email }))
        .catch(() => undefined);
    }
  }, [detail.id, detail.client]);

  useEffect(() => {
    const premier = window.setTimeout(() => void charger(), 0);
    return () => window.clearTimeout(premier);
    // Mission 13 (lot 5, B7) : à chaque rechargement du panneau (30 s, retour sur l'onglet), la rubrique suit.
  }, [charger, detail]);

  async function envoyer(corps: Record<string, unknown>, cle: string, succes: string): Promise<boolean> {
    setOccupe(cle);
    try {
      setEspace((await envoyerJson<{ espace: VueEspaceCrm }>(`/api/dossiers/${detail.id}/espace`, "POST", corps)).espace);
      toast.success(succes);
      await onRecharger();
      return true;
    } catch (erreur) {
      toast.error(messageErreur(erreur));
      return false;
    } finally {
      setOccupe(null);
    }
  }
  const lien = (action: "ouvrir" | "revoquer" | "renouveler", succes: string) => envoyer({ action }, action, succes);
  const geste = (g: GesteEspace, succes: string) => envoyer(g, g.geste + ("simulationId" in g ? g.simulationId : "photoId" in g ? g.photoId : ""), succes);

  async function simulation(id: string, action: "masquer" | "afficher") {
    setOccupe(action + id);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/simulations/${id}`, "PATCH", { action });
      toast.success(action === "masquer" ? "Simulation masquée : le client ne la voit plus" : "Simulation publiée : le client la voit");
      await charger();
      await onRecharger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  /** Mission 11 : chaque devis proposé a son interrupteur « visible dans l'espace client ». */
  async function visibilite(documentId: string, visibleEspace: boolean) {
    // Mission 18 (relecture) : rendre visible un devis du CRM pas encore parti l'envoie — le mail « Devis disponible »
    // part (automatisme existant, interrupteur dans Paramètres) : l'écran le demande avant, comme l'aperçu de l'outil.
    const devis = espace?.devisProposes.find((d) => d.id === documentId);
    if (visibleEspace && devis && !devis.repris && devis.statut === "GENERE") {
      const adresse = detail.clientEmail ? ` à ${detail.clientEmail}` : "";
      const texte = `Rendre le devis ${devis.numero} visible, c'est l'envoyer : le mail « Devis disponible » partira au client${adresse} si son espace est ouvert et son adresse valide (une fois par devis ; interrupteur dans Paramètres). Sans cela, il sera visible mais pas envoyé. Continuer ?`;
      if (!window.confirm(texte)) return;
    }
    setOccupe("visible" + documentId);
    try {
      const reponse = await envoyerJson<{ annonce: { mail: boolean; raison: string | null } | null; avertissements: string[] }>(`/api/dossiers/${detail.id}/documents/${documentId}`, "PATCH", { visibleEspace });
      // Mission 18 (B5) : mis en ligne, il est annoncé par le mail « Devis disponible », sinon l'écran dit pourquoi.
      // Mission 18 (B6) : masqué sans autre devis en attente, le dossier revient avant « Devis envoyé » : l'écran le dit.
      if (!visibleEspace) toast.success(["Devis masqué dans son espace.", ...(reponse.avertissements ?? [])].join(" "));
      else if (reponse.annonce?.mail) toast.success("Devis en ligne : le client est prévenu par mail");
      else toast.success(["Devis visible dans son espace.", ...(reponse.avertissements ?? [])].join(" "));
      await charger();
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

  if (espace === undefined) {
    return (
      <section>
        {sansTitre ? null : <TitreSection>Espace client</TitreSection>}
        <p className="text-[13px] text-texte-3">Chargement…</p>
      </section>
    );
  }
  if (espace === null) {
    return (
      <section>
        {sansTitre ? null : <TitreSection>Espace client</TitreSection>}
        <div className="rounded-[12px] border-[0.5px] border-dashed border-trait p-4">
          <p className="text-[13px] text-texte-3">Pas encore d&apos;espace pour ce dossier. Le client y déposera ses photos, validera son projet, créera ses simulations et donnera son bon pour accord, sans compte ni mot de passe.</p>
          <Bouton className="mt-3" variante="primaire" icone={<Link2 size={14} aria-hidden />} chargement={occupe === "ouvrir"} onClick={() => void lien("ouvrir", "Espace client ouvert")}>
            Ouvrir l&apos;espace client
          </Bouton>
        </div>
      </section>
    );
  }

  const p = espace.paiement;

  return (
    <section>
      {sansTitre ? null : <TitreSection>Espace client</TitreSection>}
      <LienParMail cible={lienMail} onFermer={() => setLienMail(null)} onEnvoye={() => void charger()} />
      <div className="space-y-3 rounded-[12px] border-[0.5px] border-trait bg-surface p-4">
        {/* Où il en est : les cinq onglets de son espace, tels qu'il les voit. */}
        <div>
          <ol className="grid grid-cols-5 gap-1">
            {espace.etapes.map((e) => (
              <li key={e.cle} title={e.raison ?? undefined} className={cn("rounded-[8px] border-[0.5px] px-1.5 py-1.5 text-center", e.courante ? "border-action/60 bg-action/10" : "border-trait bg-fond")}>
                <span className={cn("mx-auto mb-1 flex h-4 w-4 items-center justify-center rounded-full", e.fait ? "bg-action text-action-texte" : e.verrouillee ? "text-texte-3" : "border-[0.5px] border-trait-2")}>
                  {e.fait ? <Check size={11} strokeWidth={3} aria-hidden /> : e.verrouillee ? <Lock size={11} aria-hidden /> : null}
                </span>
                <span className={cn("block truncate text-[10.5px] font-medium", e.courante ? "text-action-clair" : e.fait ? "text-texte-2" : "text-texte-3")}>{e.libelle}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[13px] text-texte">
            {espace.etapeLibelle}
            <span className="text-texte-3"> — il lui reste : {espace.resteAFaire.charAt(0).toLowerCase() + espace.resteAFaire.slice(1)}</span>
          </p>
        </div>

        {/* Le lien et les visites : ceux du CLIENT (son espace permanent, tous ses projets). */}
        <div className="flex flex-wrap items-center gap-1.5">
          {espace.revoqueLe ? <Pastille ton="rouge">Lien désactivé</Pastille> : <Pastille ton="vert">Lien du client actif · sans expiration</Pastille>}
          {espace.permanent?.dernierAccesLe ? (
            <Pastille>
              {espace.permanent.nbAcces} visite{espace.permanent.nbAcces > 1 ? "s" : ""} de son espace · dernière le {jour(espace.permanent.dernierAccesLe)}
            </Pastille>
          ) : espace.dernierAccesLe ? (
            <Pastille>
              {espace.nbAcces} visite{espace.nbAcces > 1 ? "s" : ""} · dernière le {jour(espace.dernierAccesLe)}
            </Pastille>
          ) : (
            <Pastille ton="ambre">Pas encore ouvert par le client</Pastille>
          )}
          {espace.permanent?.confirmationRequise ? <Pastille titre="Plus de 90 jours sans visite : à la prochaine, il confirme les 4 derniers chiffres de son téléphone.">Téléphone à confirmer à sa prochaine visite</Pastille> : null}
        </div>
        {espace.autresProjets.length ? (
          <p className="text-[12.5px] text-texte-3">
            Ses autres projets :{" "}
            {espace.autresProjets.map((a, i) => (
              <span key={a.dossierId}>
                {i ? " · " : ""}
                <Link href={`/dossiers?dossier=${a.dossierId}`} className="text-texte-2 underline decoration-trait-2 underline-offset-2 hover:text-texte">
                  {a.nom}
                </Link>
                {a.fige ? <span className="text-texte-3"> ({a.fige.toLowerCase()})</span> : null}
              </span>
            ))}
          </p>
        ) : null}
        {espace.lien ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[8px] bg-fond px-2.5 py-2 text-[12px] text-texte-2">{espace.lien}</code>
            <Bouton taille="sm" icone={copie ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copier()}>
              {copie ? "Copié" : "Copier"}
            </Bouton>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {espace.apercu ? (
            <a href={espace.apercu} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-trait bg-surface px-2.5 text-[12px] font-medium text-texte hover:border-trait-2 sm:h-7">
              <Eye size={13} aria-hidden /> Voir comme le client
            </a>
          ) : null}
          {espace.lien ? (
            // Mission 7 : le mail prend le relais du SMS (texte relu, rien ne part sans votre clic).
            <button
              type="button"
              onClick={() => setLienMail({ dossierId: detail.id, code: espace.projet || espace.simulations.length || espace.devis || espace.accord ? "LIEN_ESPACE_RAPPEL" : "LIEN_ESPACE" })}
              className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-trait bg-surface px-2.5 text-[12px] font-medium text-texte hover:border-trait-2 sm:h-7"
            >
              <Mail size={13} aria-hidden /> Envoyer le lien par mail
            </button>
          ) : null}
          {espace.lien ? (
            // Mission 14 (partie 5) : le lien par SMS (premier lien s'il n'en a jamais reçu, sinon « à nouveau »), copié = envoyé.
            <button
              type="button"
              onClick={() =>
                ouvrirEcranSms({
                  demande: { action: "ENVOYER_LIEN", dossierId: detail.id },
                  onFini: ({ copie }) => {
                    if (copie) void Promise.all([charger(), onRecharger()]);
                  },
                })
              }
              className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-trait bg-surface px-2.5 text-[12px] font-medium text-texte hover:border-trait-2 sm:h-7"
            >
              <MessageSquare size={13} aria-hidden /> SMS avec le lien
            </button>
          ) : null}
          {espace.revoqueLe ? null : (
            <Bouton taille="sm" variante="fantome" icone={<ShieldOff size={13} aria-hidden />} chargement={occupe === "revoquer"} onClick={() => void lien("revoquer", "Lien désactivé (tous ses projets)")}>
              Désactiver le lien
            </Bouton>
          )}
          {espace.permanent && destinataire ? (
            <NouveauLien permanentId={espace.permanent.id} email={destinataire.email} onFait={async () => { await charger(); await onRecharger(); }} />
          ) : (
            <Bouton taille="sm" variante="fantome" icone={<RefreshCw size={13} aria-hidden />} chargement={occupe === "renouveler"} onClick={() => void lien("renouveler", "Nouveau lien émis : l'ancien ne fonctionne plus")}>
              Nouveau lien
            </Bouton>
          )}
        </div>

        {/* Photos */}
        <RubriquePhotosEspace espace={espace} occupe={occupe} geste={geste} photoOuverte={photoOuverte} setPhotoOuverte={setPhotoOuverte} />

        {/* Projet */}
        <Rubrique
          titre="Son projet"
          etat={
            espace.projetValide ? (
              <Pastille ton="vert">
                <Check size={11} strokeWidth={3} aria-hidden /> Validé le {jour(espace.projetValide.le)}
                {espace.projetValide.par === "LUCAS" ? " par moi" : ""}
              </Pastille>
            ) : espace.accord ? (
              // Signé ou établi, le devis fait foi : l'onglet Projet du client est en lecture, il n'a plus rien à valider.
              <Pastille ton="vert">
                <Check size={11} strokeWidth={3} aria-hidden /> Devis signé : il fait foi
              </Pastille>
            ) : espace.devis ? (
              <Pastille ton="neutre">Devis établi : il fait foi</Pastille>
            ) : (
              <Pastille ton={espace.projet ? "ambre" : "neutre"}>{espace.projet ? "Pas encore validé" : "Rien de saisi"}</Pastille>
            )
          }
        >
          {espace.projet ? (
            <>
              <p className="text-[13px] text-texte-2">{resumerSelection(espace.projet.familles) || "Aucune famille cochée"}</p>
              {famillesDe(espace.projet.familles).some((f) => libelleTaille(f, espace.projet?.tailles[f])) ? (
                <p className="mt-0.5 text-[12.5px] text-texte-3">
                  Taille :{" "}
                  {famillesDe(espace.projet.familles)
                    .map((f) => (libelleTaille(f, espace.projet?.tailles[f]) ? `${famille(f).libelle.toLowerCase()} ${libelleTaille(f, espace.projet?.tailles[f])}` : null))
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
              {espace.projet.precisions ? <blockquote className="mt-1.5 border-l-2 border-trait-2 pl-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-texte">« {espace.projet.precisions} »</blockquote> : null}
            </>
          ) : (
            <p className="text-[12.5px] text-texte-3">Il n&apos;a encore rien dit de son projet.</p>
          )}
          {!espace.projetValide && !espace.devis && !espace.accord && espace.projetManque && espace.projet ? <p className="mt-1 text-[11.5px] text-attention-texte">Pour valider, il manque : {espace.projetManque.charAt(0).toLowerCase() + espace.projetManque.slice(1)}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {espace.projetValide ? (
              <Bouton taille="sm" variante="fantome" icone={<Undo2 size={13} aria-hidden />} chargement={occupe === "devalider-projet"} onClick={() => void geste({ geste: "devalider-projet" }, "Projet dévalidé : le client peut le modifier")}>
                Dévalider
              </Bouton>
            ) : espace.devis || espace.accord ? null : (
              <Bouton taille="sm" icone={<Check size={13} aria-hidden />} disabled={Boolean(espace.projetManque)} chargement={occupe === "valider-projet"} onClick={() => void geste({ geste: "valider-projet" }, "Projet validé à sa place")}>
                Valider à sa place
              </Bouton>
            )}
            <Bouton taille="sm" variante="fantome" icone={<Pencil size={13} aria-hidden />} onClick={() => setEdition({ tailles: { ...(espace.projet?.tailles ?? {}) }, precisions: espace.projet?.precisions ?? "" })}>
              Modifier taille et note
            </Bouton>
            {espace.projet ? (
              <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={13} aria-hidden />} onClick={() => setConfirmation({ titre: "Réinitialiser l'étape « Projet » ?", texte: "Son projet est effacé de son espace (ce qu'il avait saisi reste dans l'historique du dossier) : il le refait depuis le début.", bouton: "Réinitialiser", geste: { geste: "reinitialiser", etape: "PROJET" }, succes: "Étape « Projet » réinitialisée" })}>
                Réinitialiser
              </Bouton>
            ) : null}
          </div>
        </Rubrique>

        {/* Simulations */}
        <RubriqueSimulationsEspace espace={espace} occupe={occupe} geste={geste} simulation={simulation} simulationOuverte={simulationOuverte} setSimulationOuverte={setSimulationOuverte} setConfirmation={setConfirmation} />

        {/* Devis et accord */}
        <RubriqueDevisEspace detail={detail} espace={espace} occupe={occupe} visibilite={visibilite} setConfirmation={setConfirmation} onFaireDevis={onFaireDevis} onAjouterDevis={onAjouterDevis} onDeposerPdf={onDeposerPdf} />

        {/* Paiement : ce que lit le client, à partir des encaissements du dossier. */}
        {p ? (
          <Rubrique titre="Paiement (ce qu'il voit)" etat={p.regle ? <Pastille ton="vert">Réglé</Pastille> : <Pastille ton="ambre">Reste {euros(p.reste)}</Pastille>}>
            <ul className="space-y-0.5 text-[13px] text-texte-2">
              {p.acompte ? (
                <li>
                  Acompte {p.acompte.pct ? `(${p.acompte.pct} %) ` : ""}: {euros(p.acompte.montant)} —{" "}
                  {p.acompte.statut === "PAYE" ? <span className="text-action-clair">payé le {jour(p.acompte.payeLe)}{moyen(p.acompte.moyen) ? ` par ${moyen(p.acompte.moyen)}` : ""}</span> : p.acompte.statut === "PARTIEL" ? <span className="text-attention-texte">{euros(p.acompte.recu)} reçus</span> : <span className="text-attention-texte">à régler</span>}
                </li>
              ) : null}
              <li>
                Solde : {euros(p.solde.montant)} —{" "}
                {p.solde.statut === "PAYE" ? <span className="text-action-clair">payé le {jour(p.solde.payeLe)}{moyen(p.solde.moyen) ? ` par ${moyen(p.solde.moyen)}` : ""}</span> : p.solde.statut === "PARTIEL" ? <span className="text-attention-texte">{euros(p.solde.recu)} reçus</span> : <span className="text-texte-3">dû à la fin des travaux</span>}
              </li>
            </ul>
          </Rubrique>
        ) : null}

        {espace.avis ? (
          <Rubrique titre="Son avis" etat={<Pastille ton="vert">{espace.avis.note}/5</Pastille>}>
            <p className="text-[13px] whitespace-pre-wrap text-texte">{espace.avis.texte ? `« ${espace.avis.texte} »` : "Note sans commentaire."}</p>
            {espace.avis.publication ? <p className="mt-0.5 text-[11.5px] text-texte-3">Il accepte la publication sur le site.</p> : null}
          </Rubrique>
        ) : null}

        {/* Mission 10 : ses messages, et ma réponse dans son espace (onglet Contact du client, notification par mail). */}
        <Rubrique id="rubrique-messages" titre="Messages" etat={espace.messagesNonLus ? <Pastille ton="ambre">{espace.messagesNonLus} non lu{espace.messagesNonLus > 1 ? "s" : ""}</Pastille> : espace.messages.length ? <Pastille ton="neutre">{espace.messages.length}</Pastille> : undefined}>
          {espace.messages.length ? (
            <ul className="space-y-1.5">
              {espace.messages.slice(0, 12).map((m) => (
                <li key={m.id} className={cn("rounded-[8px] border-[0.5px] px-2.5 py-1.5 text-[12.5px] leading-snug", m.auteur === "LUCAS" ? "border-action/40 bg-action-fond text-texte-2" : "border-trait bg-fond text-texte")}>
                  <span className="text-[11px] text-texte-3">
                    {jourHeure(m.le)} · {m.auteur === "LUCAS" ? `moi${m.par?.startsWith("ASSISTANT") ? " (via Claude)" : ""}${m.luLe ? ", vue par le client" : ", pas encore vue"}` : `lui${m.source === "COMMENTAIRE" ? " (commentaire)" : m.source === "PROPOSITION" ? " (autre proposition)" : ""}${m.luLe ? "" : " · non lu"}`}
                  </span>
                  <p className="mt-0.5 whitespace-pre-line">{m.texte}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-texte-3">Aucun message échangé dans son espace.</p>
          )}
          {espace.lien ? (
            <div className="mt-2">
              <ZoneTexte id="reponse-espace" libelle="" value={reponse} onChange={(e) => setReponse(e.target.value)} rows={2} placeholder="Lui répondre dans son espace (il est prévenu par mail)…" maxLength={2000} />
              <div className="mt-1.5 flex justify-end">
                <Bouton taille="sm" variante="primaire" disabled={reponse.trim().length < 2 || occupe !== null} chargement={occupe === "repondre"} onClick={() => void geste({ geste: "repondre", texte: reponse.trim() }, "Réponse envoyée dans son espace").then((ok) => ok && setReponse(""))}>
                  Répondre dans son espace
                </Bouton>
              </div>
            </div>
          ) : null}
        </Rubrique>

        {/* Ce qu'il a fait, geste par geste. */}
        {espace.gestes.length ? (
          <div className="border-t-[0.5px] border-trait pt-2">
            <button type="button" onClick={() => setGestesOuverts((v) => !v)} className={cn("flex w-full items-center justify-between text-[11px] font-medium tracking-[0.06em] text-texte-3 uppercase hover:text-texte-2", TRANS)} aria-expanded={gestesOuverts}>
              Ses derniers gestes ({espace.gestes.length})
              <ChevronDown size={14} aria-hidden className={cn("transition-transform", gestesOuverts && "rotate-180")} />
            </button>
            {gestesOuverts ? (
              <ul className="mt-2 space-y-1.5">
                {espace.gestes.map((g, i) => (
                  <li key={`${g.le}-${i}`} className="text-[12.5px] leading-snug text-texte-2">
                    <span className="text-texte-3">{jourHeure(g.le)} · {g.auteur === "LUCAS" ? "moi" : "lui"} — </span>
                    {g.contenu}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Modifier son projet à sa place. */}
      <Modale
        ouverte={edition !== null}
        onFermer={() => setEdition(null)}
        titre="Modifier le projet du client"
        description="Ce que tu changes ici se voit aussitôt dans son espace, et s'écrit dans l'historique du dossier."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setEdition(null)}>Annuler</Bouton>
            <Bouton
              variante="primaire"
              chargement={occupe === "modifier-projet"}
              onClick={async () => {
                if (edition && (await geste({ geste: "modifier-projet", projet: { tailles: edition.tailles, precisions: edition.precisions } }, "Projet modifié"))) setEdition(null);
              }}
            >
              Enregistrer
            </Bouton>
          </div>
        }
      >
        {edition ? (
          <div className="space-y-4">
            <p className="text-[12.5px] text-texte-3">Les familles et sous-parties se cochent dans « Familles du projet », plus haut.</p>
            {famillesDe(espace.projet?.familles ?? {}).map((f) => {
              const q = famille(f).taille;
              const t = edition.tailles[f] ?? { repere: null, valeur: null };
              const poser = (suite: { repere: string | null; valeur: number | null }) => setEdition({ ...edition, tailles: { ...edition.tailles, [f]: suite } });
              return (
                <div key={f}>
                  <p className="mb-1.5 text-[12px] font-medium text-texte-2">{q.titre}</p>
                  {q.reperes.length ? (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {q.reperes.map((r) => (
                        <button key={r.id} type="button" aria-pressed={t.repere === r.id} onClick={() => poser(t.repere === r.id ? { repere: null, valeur: null } : { repere: r.id, valeur: r.valeur })} className={cn("h-11 rounded-[8px] border-[0.5px] px-3 text-[13px] font-medium sm:h-8 sm:text-[12px]", TRANS, t.repere === r.id ? "border-action bg-action/15 text-action-clair" : "border-trait text-texte-2 hover:border-trait-2")}>
                          {r.libelle}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-[12.5px] text-texte-3">
                    <input type="number" inputMode="decimal" min={q.min} max={q.max} step={q.pas} value={t.valeur ?? ""} onChange={(e) => poser({ repere: t.repere, valeur: e.target.value === "" ? null : Number(e.target.value) })} className="h-11 sm:h-9 w-24 rounded-[8px] border-[0.5px] border-trait bg-fond px-2 text-[13px] text-texte" />
                    {q.unite === "portes" ? "portes" : "mètres, à peu près"}
                  </label>
                </div>
              );
            })}
            <ZoneTexte libelle="Sa note" value={edition.precisions} onChange={(e) => setEdition({ ...edition, precisions: e.target.value })} rows={3} maxLength={1000} />
          </div>
        ) : null}
      </Modale>

      {/* Confirmation courte des gestes qui défont quelque chose. */}
      <Modale
        ouverte={confirmation !== null}
        onFermer={() => setConfirmation(null)}
        titre={confirmation?.titre ?? ""}
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setConfirmation(null)}>Annuler</Bouton>
            <Bouton
              variante="danger"
              chargement={occupe !== null}
              onClick={async () => {
                if (confirmation && (await geste(confirmation.geste, confirmation.succes))) setConfirmation(null);
              }}
            >
              {confirmation?.bouton}
            </Bouton>
          </div>
        }
      >
        <p className="text-[13px] leading-relaxed text-texte-2">{confirmation?.texte}</p>
      </Modale>
    </section>
  );
}
