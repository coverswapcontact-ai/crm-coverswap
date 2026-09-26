"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Eye, FilePlus2, FileText, FileUp, Link2, Lock, Mail, Pencil, RefreshCw, RotateCcw, ShieldOff, Undo2, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail } from "@/lib/dossiers/types";
import type { GesteEspace, VueEspaceCrm } from "@/lib/espace/vue-crm";
import { famille, famillesDe, libelleTaille, resumerSelection, type TaillesProjet } from "@/lib/prestations/prestations";
import { NouveauLien } from "@/components/pilotage/espace/NouveauLien";
import { LienParMail, type CibleLienMail } from "@/components/pilotage/espace/LienParMail";
import { LIBELLES_MOYEN, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Pastille } from "@/components/pilotage/ui";
import { Visionneuse } from "@/components/pilotage/Visionneuse";
import { Bouton, Modale, TitreSection, TRANS, ZoneTexte } from "./ui";

const jour = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);
const jourHeure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const euros = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
const moyen = (m: string | null) => (m && m in LIBELLES_MOYEN ? LIBELLES_MOYEN[m as MoyenPaiement].toLowerCase() : null);

const LIBELLES_SOURCE: Record<string, string> = { SITE: "Faite sur le site", CLIENT: "Créée par le client", API: "Préparée par moi", CHATGPT: "Préparée par moi", MANUEL: "Déposée par moi" };

/** Une rubrique du bloc : titre, pastille d'état à droite, contenu. */
function Rubrique({ titre, etat, id, children }: { titre: string; etat?: React.ReactNode; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="border-t-[0.5px] border-[#2A2D34] pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-medium tracking-[0.06em] text-[#8B919C] uppercase">{titre}</h4>
        {etat}
      </div>
      {children}
    </div>
  );
}

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
  const [confirmation, setConfirmation] = useState<{ titre: string; texte: string; bouton: string; geste: GesteEspace; succes: string } | null>(null);
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
    setOccupe("visible" + documentId);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/documents/${documentId}`, "PATCH", { visibleEspace });
      toast.success(visibleEspace ? "Devis visible dans son espace" : "Devis masqué dans son espace");
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
        <p className="text-[13px] text-[#6B7280]">Chargement…</p>
      </section>
    );
  }
  if (espace === null) {
    return (
      <section>
        {sansTitre ? null : <TitreSection>Espace client</TitreSection>}
        <div className="rounded-[12px] border-[0.5px] border-dashed border-[#2A2D34] p-4">
          <p className="text-[13px] text-[#9CA3AF]">Pas encore d&apos;espace pour ce dossier. Le client y déposera ses photos, validera son projet, créera ses simulations et donnera son bon pour accord, sans compte ni mot de passe.</p>
          <Bouton className="mt-3" variante="primaire" icone={<Link2 size={14} aria-hidden />} chargement={occupe === "ouvrir"} onClick={() => void lien("ouvrir", "Espace client ouvert")}>
            Ouvrir l&apos;espace client
          </Bouton>
        </div>
      </section>
    );
  }

  const aucunDevis = !detail.documents.some((d) => d.type === "DEVIS" && d.numero);
  const visibles = espace.devisProposes.filter((d) => d.visibleEspace || d.statut === "ACCEPTE");
  const p = espace.paiement;
  const imagesEspace = [
    ...espace.photos.map((photo) => ({ id: photo.id, url: photo.url, legende: "Photo déposée par le client" })),
    ...espace.photosRetirees.map((photo) => ({ id: photo.id, url: photo.url, legende: `Photo retirée par le client le ${jour(photo.le)}` })),
  ];

  return (
    <section>
      {sansTitre ? null : <TitreSection>Espace client</TitreSection>}
      <LienParMail cible={lienMail} onFermer={() => setLienMail(null)} onEnvoye={() => void charger()} />
      <div className="space-y-3 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
        {/* Où il en est : les cinq onglets de son espace, tels qu'il les voit. */}
        <div>
          <ol className="grid grid-cols-5 gap-1">
            {espace.etapes.map((e) => (
              <li key={e.cle} title={e.raison ?? undefined} className={cn("rounded-[8px] border-[0.5px] px-1.5 py-1.5 text-center", e.courante ? "border-[#1D9E75]/60 bg-[#1D9E75]/10" : "border-[#2A2D34] bg-[#16181D]")}>
                <span className={cn("mx-auto mb-1 flex h-4 w-4 items-center justify-center rounded-full", e.fait ? "bg-[#1D9E75] text-[#0B1612]" : e.verrouillee ? "text-[#6B7280]" : "border-[0.5px] border-[#3A3E47]")}>
                  {e.fait ? <Check size={11} strokeWidth={3} aria-hidden /> : e.verrouillee ? <Lock size={11} aria-hidden /> : null}
                </span>
                <span className={cn("block truncate text-[10.5px] font-medium", e.courante ? "text-[#5DCAA5]" : e.fait ? "text-[#D1D5DB]" : "text-[#8B919C]")}>{e.libelle}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[13px] text-[#F2F3F5]">
            {espace.etapeLibelle}
            <span className="text-[#9CA3AF]"> — il lui reste : {espace.resteAFaire.charAt(0).toLowerCase() + espace.resteAFaire.slice(1)}</span>
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
          <p className="text-[12.5px] text-[#9CA3AF]">
            Ses autres projets :{" "}
            {espace.autresProjets.map((a, i) => (
              <span key={a.dossierId}>
                {i ? " · " : ""}
                <Link href={`/dossiers?dossier=${a.dossierId}`} className="text-[#D1D5DB] underline decoration-[#3A3E47] underline-offset-2 hover:text-[#F2F3F5]">
                  {a.nom}
                </Link>
                {a.fige ? <span className="text-[#6B7280]"> ({a.fige.toLowerCase()})</span> : null}
              </span>
            ))}
          </p>
        ) : null}
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
            <a href={espace.apercu} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7">
              <Eye size={13} aria-hidden /> Voir comme le client
            </a>
          ) : null}
          {espace.lien ? (
            // Mission 7 : le mail prend le relais du SMS (texte relu, rien ne part sans votre clic).
            <button
              type="button"
              onClick={() => setLienMail({ dossierId: detail.id, code: espace.projet || espace.simulations.length || espace.devis || espace.accord ? "LIEN_ESPACE_RAPPEL" : "LIEN_ESPACE" })}
              className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7"
            >
              <Mail size={13} aria-hidden /> Envoyer le lien par mail
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
        {photoOuverte !== null && imagesEspace[photoOuverte] ? <Visionneuse images={imagesEspace} index={photoOuverte} onIndex={setPhotoOuverte} onFermer={() => setPhotoOuverte(null)} /> : null}
        <Rubrique titre="Ses photos" etat={<Pastille ton={espace.photos.length ? "vert" : "neutre"}>{espace.photos.length} déposée{espace.photos.length > 1 ? "s" : ""}</Pastille>}>
          {espace.photos.length ? (
            <div className="flex flex-wrap gap-1.5">
              {espace.photos.map((photo, i) => (
                <button key={photo.id} type="button" onClick={() => setPhotoOuverte(i)} className="block h-12 w-12 overflow-hidden rounded-[6px] border-[0.5px] border-[#2A2D34]" aria-label="Agrandir la photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="Photo du client" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-[#8B919C]">Aucune pour l&apos;instant.</p>
          )}
          {espace.photosRetirees.length ? (
            <div className="mt-2">
              <p className="mb-1 text-[11.5px] text-[#F5B454]">
                {espace.photosRetirees.length} photo{espace.photosRetirees.length > 1 ? "s" : ""} retirée{espace.photosRetirees.length > 1 ? "s" : ""} par le client (gardée{espace.photosRetirees.length > 1 ? "s" : ""}) :
              </p>
              <div className="flex flex-wrap gap-2">
                {espace.photosRetirees.map((photo, i) => (
                  <div key={photo.id} className="flex items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-1 pr-2">
                    <button type="button" onClick={() => setPhotoOuverte(espace.photos.length + i)} className="block h-11 sm:h-9 w-11 sm:w-9 overflow-hidden rounded-[5px]" aria-label="Agrandir la photo retirée">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt="Photo retirée" loading="lazy" className="h-full w-full object-cover opacity-70" />
                    </button>
                    <span className="text-[11px] text-[#8B919C]">le {jour(photo.le)}</span>
                    <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "remettre-photo", photoId: photo.id }, "Photo remise dans le dossier et dans son espace")} className={cn("text-[11.5px] font-medium text-[#5DCAA5] hover:underline disabled:opacity-50", TRANS)}>
                      Remettre
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Rubrique>

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
              <p className="text-[13px] text-[#D1D5DB]">{resumerSelection(espace.projet.familles) || "Aucune famille cochée"}</p>
              {famillesDe(espace.projet.familles).some((f) => libelleTaille(f, espace.projet?.tailles[f])) ? (
                <p className="mt-0.5 text-[12.5px] text-[#9CA3AF]">
                  Taille :{" "}
                  {famillesDe(espace.projet.familles)
                    .map((f) => (libelleTaille(f, espace.projet?.tailles[f]) ? `${famille(f).libelle.toLowerCase()} ${libelleTaille(f, espace.projet?.tailles[f])}` : null))
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
              {espace.projet.precisions ? <blockquote className="mt-1.5 border-l-2 border-[#3A3E47] pl-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-[#F2F3F5]">« {espace.projet.precisions} »</blockquote> : null}
            </>
          ) : (
            <p className="text-[12.5px] text-[#8B919C]">Il n&apos;a encore rien dit de son projet.</p>
          )}
          {!espace.projetValide && !espace.devis && !espace.accord && espace.projetManque && espace.projet ? <p className="mt-1 text-[11.5px] text-[#F5B454]">Pour valider, il manque : {espace.projetManque.charAt(0).toLowerCase() + espace.projetManque.slice(1)}</p> : null}
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
        <Rubrique
          titre="Ses simulations"
          etat={
            <Pastille ton={espace.creation.restantes === 0 ? "ambre" : "neutre"}>
              {espace.creation.faites} faite{espace.creation.faites > 1 ? "s" : ""} sur {espace.creation.offertes}
              {espace.creation.faitesSite ? ` (dont ${espace.creation.faitesSite} sur le site)` : ""} · {espace.creation.restantes} restante{espace.creation.restantes > 1 ? "s" : ""}
            </Pastille>
          }
        >
          {espace.proposition ? (
            <div className="mb-2 rounded-[8px] border-[0.5px] border-[#F5B454]/40 bg-[#F5B454]/10 p-2.5">
              <p className="text-[12px] font-medium text-[#F5B454]">Il demande une autre proposition — le {jourHeure(espace.proposition.le)}</p>
              {espace.proposition.message ? <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-[#F2F3F5]">« {espace.proposition.message} »</p> : <p className="mt-1 text-[12px] text-[#9CA3AF]">Sans message.</p>}
              <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "retirer-demande" }, "Demande retirée")} className={cn("mt-1.5 text-[11.5px] font-medium text-[#D1D5DB] underline-offset-2 hover:underline disabled:opacity-50", TRANS)}>
                Retirer sa demande (traitée autrement)
              </button>
            </div>
          ) : null}
          {espace.creation.demandeesLe ? <p className="mb-2 text-[12.5px] text-[#F5B454]">Il demande d&apos;autres simulations depuis le {jour(espace.creation.demandeesLe)}.</p> : null}
          {simulationOuverte !== null && espace.simulations[simulationOuverte] ? <Visionneuse images={espace.simulations.map((s) => ({ id: s.id, url: s.url, legende: [s.titre, LIBELLES_SOURCE[s.source] ?? s.source, jour(s.le)].filter(Boolean).join(" · ") }))} index={simulationOuverte} onIndex={setSimulationOuverte} onFermer={() => setSimulationOuverte(null)} /> : null}
          {espace.simulations.length ? (
            <ul className="space-y-1.5">
              {espace.simulations.map((s, index) => (
                <li key={s.id} className={cn("flex gap-2.5 rounded-[8px] border-[0.5px] p-1.5", s.choisie ? "border-[#1D9E75]/60 bg-[#1D9E75]/10" : "border-[#2A2D34] bg-[#16181D]")}>
                  <button type="button" onClick={() => setSimulationOuverte(index)} aria-label={`Agrandir ${s.titre ?? "la simulation"}`} className="block h-14 w-20 shrink-0 overflow-hidden rounded-[6px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={s.titre ?? "Simulation"} loading="lazy" className={cn("h-full w-full object-cover", s.statut !== "PUBLIEE" && "opacity-50")} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-[#8B919C]">{LIBELLES_SOURCE[s.source] ?? s.source} · {jour(s.le)}</span>
                      {s.choisie ? <Pastille ton="vert">Validée</Pastille> : null}
                      {s.statut === "BROUILLON" ? <Pastille ton="ambre">Brouillon</Pastille> : s.statut === "MASQUEE" ? <Pastille>Masquée</Pastille> : null}
                    </div>
                    <p className="line-clamp-2 text-[12.5px] text-[#D1D5DB]">{s.zones.map((z) => `${z.libelle || z.zone} : ${z.nom || z.ref}`).join(" · ") || s.titre || "Simulation"}</p>
                    {s.commentaire ? <p className="text-[12px] whitespace-pre-wrap text-[#F2F3F5]">« {s.commentaire} »</p> : null}
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] font-medium">
                      {s.statut === "PUBLIEE" && !s.choisie ? (
                        <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "valider-simulation", simulationId: s.id }, "Simulation validée à sa place : le devis est à préparer")} className={cn("text-[#5DCAA5] hover:underline disabled:opacity-50", TRANS)}>
                          Valider à sa place
                        </button>
                      ) : null}
                      {s.choisie ? (
                        <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "devalider-simulation" }, "Simulation dévalidée")} className={cn("text-[#D1D5DB] hover:underline disabled:opacity-50", TRANS)}>
                          Dévalider
                        </button>
                      ) : null}
                      {s.statut === "PUBLIEE" ? (
                        <button type="button" disabled={occupe !== null} onClick={() => void simulation(s.id, "masquer")} className={cn("text-[#8B919C] hover:text-[#D1D5DB] hover:underline disabled:opacity-50", TRANS)}>
                          Masquer
                        </button>
                      ) : (
                        <button type="button" disabled={occupe !== null} onClick={() => void simulation(s.id, "afficher")} className={cn("text-[#5DCAA5] hover:underline disabled:opacity-50", TRANS)}>
                          {s.statut === "BROUILLON" ? "Publier" : "Republier"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-[#8B919C]">Aucune simulation pour l&apos;instant.</p>
          )}
          {espace.choix?.mode === "COMPOSITE" ? <p className="mt-1.5 text-[12.5px] text-[#5DCAA5]">Son mélange validé : {espace.choix.zones.map((z) => `${z.libelle || z.zone} — ${z.nom || z.ref}`).join(" · ")}</p> : null}
          {espace.choix?.commentaire ? <p className="mt-1 text-[12.5px] text-[#F2F3F5]">Son mot en validant : « {espace.choix.commentaire} »</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Bouton taille="sm" variante={espace.creation.demandeesLe ? "primaire" : "secondaire"} icone={<WandSparkles size={13} aria-hidden />} chargement={occupe === "accorder"} onClick={() => void geste({ geste: "accorder", nombre: 3 }, "3 simulations accordées : le client peut en refaire")}>
              Accorder 3 simulations
            </Bouton>
            {espace.choix || espace.proposition ? (
              <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={13} aria-hidden />} onClick={() => setConfirmation({ titre: "Réinitialiser l'étape « Simulations » ?", texte: "Plus aucune simulation n'est validée et sa demande en attente est retirée. Ses simulations restent dans sa galerie.", bouton: "Réinitialiser", geste: { geste: "reinitialiser", etape: "SIMULATIONS" }, succes: "Étape « Simulations » réinitialisée" })}>
                Réinitialiser
              </Bouton>
            ) : null}
          </div>
          {espace.favoris.length ? <p className="mt-1.5 text-[11.5px] text-[#8B919C]">Ses teintes favorites : {espace.favoris.join(", ")}</p> : null}
        </Rubrique>

        {/* Devis et accord */}
        <Rubrique
          titre="Devis et accord"
          etat={
            espace.accord ? (
              <Pastille ton="vert"><Check size={11} strokeWidth={3} aria-hidden /> Signé le {jour(espace.accord.le)}</Pastille>
            ) : visibles.length > 1 ? (
              <Pastille ton="ambre">{visibles.length} devis proposés : il en choisit un</Pastille>
            ) : espace.devis && visibles.length === 0 ? (
              <Pastille ton="ambre">Devis masqué : il ne voit rien</Pastille>
            ) : espace.devis ? (
              <Pastille ton="ambre">En attente de son accord</Pastille>
            ) : (
              <Pastille>Pas de devis émis</Pastille>
            )
          }
        >
          {espace.devisProposes.length ? (
            <ul className="space-y-1">
              {espace.devisProposes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-[#D1D5DB]">
                  <span>
                    Devis {d.numero}
                    {d.libelle ? <span className="text-[#8B919C]"> « {d.libelle} »</span> : null} — {euros(d.total)}
                    {d.repris ? <span className="text-[#8B919C]"> (repris)</span> : null}
                    {d.statut === "ACCEPTE" ? <span className="text-[#5DCAA5]"> · signé</span> : d.statut === "NON_RETENU" ? <span className="text-[#8B919C]"> · non retenu</span> : null}
                  </span>
                  {espace.devisProposes.length > 1 ? (
                    // Mission 13 (lot 5, B6) : chaque devis compte ses propres lectures.
                    <span className={cn("text-[12px]", d.consultations >= 3 && !espace.accord ? "text-[#F87171]" : "text-[#8B919C]")}>
                      {d.consultations > 0 ? `lu ${d.consultations} fois${d.consulteLe ? ` · dernière le ${jour(d.consulteLe)}` : ""}` : "pas encore ouvert"}
                    </span>
                  ) : null}
                  {espace.accord ? null : (
                    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-[12px]", d.visibleEspace ? "text-[#8B919C]" : "text-[#F5B454]")}>
                      <input type="checkbox" className="accent-[#1D9E75]" checked={d.visibleEspace} disabled={occupe !== null} onChange={(evenement) => void visibilite(d.id, evenement.target.checked)} />
                      {d.visibleEspace ? "visible dans son espace" : "masqué dans son espace"}
                    </label>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-[#8B919C]">{espace.choix ? "Il a validé une simulation : le devis est à faire." : "L'onglet Devis de son espace est verrouillé tant qu'il n'a pas validé de simulation."}</p>
          )}
          {espace.devis && espace.devisProposes.length <= 1 ? (
            <p className="mt-1 text-[12px] text-[#8B919C]">
              {espace.devis.consultations > 0 ? (
                <span className={espace.devis.consultations >= 3 && !espace.accord ? "text-[#F87171]" : undefined}>
                  Devis ouvert {espace.devis.consultations} fois dans son espace (dernière le {jour(espace.devis.consulteLe)})
                </span>
              ) : (
                "Pas encore ouvert dans son espace"
              )}
            </p>
          ) : null}
          {espace.accord ? (
            <p className="mt-1 text-[13px] text-[#D1D5DB]">
              {espace.accord.source === "ESPACE" ? `Bon pour accord donné dans son espace par ${espace.accord.nom}${espace.accord.signature ? ", signé au doigt" : ""}.` : "Devis noté « accepté » dans le CRM (signé hors de l'espace) : son espace le montre signé."}
            </p>
          ) : null}
          {espace.accordsRetires.map((a) => (
            <p key={a.retireLe} className="mt-1 text-[12px] text-[#F5B454]">
              Accord du {jour(a.le)} retiré le {jour(a.retireLe)} {a.par === "CLIENT" ? "par le client" : "par moi"}
              {a.motif ? ` : « ${a.motif} »` : ""} (preuve gardée).
            </p>
          ))}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {onFaireDevis && (espace.choix || espace.projet) && aucunDevis ? (
              <Bouton taille="sm" variante={espace.choix ? "primaire" : "secondaire"} icone={<FileText size={13} aria-hidden />} onClick={onFaireDevis}>
                {espace.choix ? "Faire le devis depuis son choix" : "Faire le devis depuis son projet"}
              </Bouton>
            ) : null}
            {onAjouterDevis && !aucunDevis && !espace.accord ? (
              <Bouton taille="sm" variante="secondaire" icone={<FilePlus2 size={13} aria-hidden />} onClick={onAjouterDevis}>
                Ajouter un devis
              </Bouton>
            ) : null}
            {onDeposerPdf && (espace.choix || espace.projet || !aucunDevis) && !espace.accord ? (
              <Bouton taille="sm" variante="fantome" icone={<FileUp size={13} aria-hidden />} onClick={onDeposerPdf}>
                Déposer un devis PDF
              </Bouton>
            ) : null}
            {espace.accord?.source === "ESPACE" ? (
              <Bouton taille="sm" variante="fantome" icone={<Undo2 size={13} aria-hidden />} onClick={() => setConfirmation({ titre: "Retirer son bon pour accord ?", texte: "L'accord ne vaut plus (sa preuve reste gardée). Si le dossier est en « Signé », il revient à « Devis envoyé », le devis redevient un devis émis et les autres devis proposés redeviennent au choix.", bouton: "Retirer l'accord", geste: { geste: "retirer-accord", motif: "" }, succes: "Accord retiré" })}>
                Retirer son accord
              </Bouton>
            ) : null}
          </div>
        </Rubrique>

        {/* Paiement : ce que lit le client, à partir des encaissements du dossier. */}
        {p ? (
          <Rubrique titre="Paiement (ce qu'il voit)" etat={p.regle ? <Pastille ton="vert">Réglé</Pastille> : <Pastille ton="ambre">Reste {euros(p.reste)}</Pastille>}>
            <ul className="space-y-0.5 text-[13px] text-[#D1D5DB]">
              {p.acompte ? (
                <li>
                  Acompte {p.acompte.pct ? `(${p.acompte.pct} %) ` : ""}: {euros(p.acompte.montant)} —{" "}
                  {p.acompte.statut === "PAYE" ? <span className="text-[#5DCAA5]">payé le {jour(p.acompte.payeLe)}{moyen(p.acompte.moyen) ? ` par ${moyen(p.acompte.moyen)}` : ""}</span> : p.acompte.statut === "PARTIEL" ? <span className="text-[#F5B454]">{euros(p.acompte.recu)} reçus</span> : <span className="text-[#F5B454]">à régler</span>}
                </li>
              ) : null}
              <li>
                Solde : {euros(p.solde.montant)} —{" "}
                {p.solde.statut === "PAYE" ? <span className="text-[#5DCAA5]">payé le {jour(p.solde.payeLe)}{moyen(p.solde.moyen) ? ` par ${moyen(p.solde.moyen)}` : ""}</span> : p.solde.statut === "PARTIEL" ? <span className="text-[#F5B454]">{euros(p.solde.recu)} reçus</span> : <span className="text-[#8B919C]">dû à la fin des travaux</span>}
              </li>
            </ul>
          </Rubrique>
        ) : null}

        {espace.avis ? (
          <Rubrique titre="Son avis" etat={<Pastille ton="vert">{espace.avis.note}/5</Pastille>}>
            <p className="text-[13px] whitespace-pre-wrap text-[#F2F3F5]">{espace.avis.texte ? `« ${espace.avis.texte} »` : "Note sans commentaire."}</p>
            {espace.avis.publication ? <p className="mt-0.5 text-[11.5px] text-[#8B919C]">Il accepte la publication sur le site.</p> : null}
          </Rubrique>
        ) : null}

        {/* Mission 10 : ses messages, et ma réponse dans son espace (onglet Contact du client, notification par mail). */}
        <Rubrique id="rubrique-messages" titre="Messages" etat={espace.messagesNonLus ? <Pastille ton="ambre">{espace.messagesNonLus} non lu{espace.messagesNonLus > 1 ? "s" : ""}</Pastille> : espace.messages.length ? <Pastille ton="neutre">{espace.messages.length}</Pastille> : undefined}>
          {espace.messages.length ? (
            <ul className="space-y-1.5">
              {espace.messages.slice(0, 12).map((m) => (
                <li key={m.id} className={cn("rounded-[8px] border-[0.5px] px-2.5 py-1.5 text-[12.5px] leading-snug", m.auteur === "LUCAS" ? "border-[#2F3B36] bg-[#15201C] text-[#D1D5DB]" : "border-[#2A2D34] bg-[#16181D] text-[#E5E7EB]")}>
                  <span className="text-[11px] text-[#8B919C]">
                    {jourHeure(m.le)} · {m.auteur === "LUCAS" ? `moi${m.par?.startsWith("ASSISTANT") ? " (via Claude)" : ""}${m.luLe ? ", vue par le client" : ", pas encore vue"}` : `lui${m.source === "COMMENTAIRE" ? " (commentaire)" : m.source === "PROPOSITION" ? " (autre proposition)" : ""}${m.luLe ? "" : " · non lu"}`}
                  </span>
                  <p className="mt-0.5 whitespace-pre-line">{m.texte}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-[#8B919C]">Aucun message échangé dans son espace.</p>
          )}
          {espace.lien ? (
            <div className="mt-2">
              <ZoneTexte libelle="" value={reponse} onChange={(e) => setReponse(e.target.value)} rows={2} placeholder="Lui répondre dans son espace (il est prévenu par mail)…" maxLength={2000} />
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
          <div className="border-t-[0.5px] border-[#2A2D34] pt-2">
            <button type="button" onClick={() => setGestesOuverts((v) => !v)} className={cn("flex w-full items-center justify-between text-[11px] font-medium tracking-[0.06em] text-[#8B919C] uppercase hover:text-[#D1D5DB]", TRANS)} aria-expanded={gestesOuverts}>
              Ses derniers gestes ({espace.gestes.length})
              <ChevronDown size={14} aria-hidden className={cn("transition-transform", gestesOuverts && "rotate-180")} />
            </button>
            {gestesOuverts ? (
              <ul className="mt-2 space-y-1.5">
                {espace.gestes.map((g, i) => (
                  <li key={`${g.le}-${i}`} className="text-[12.5px] leading-snug text-[#D1D5DB]">
                    <span className="text-[#8B919C]">{jourHeure(g.le)} · {g.auteur === "LUCAS" ? "moi" : "lui"} — </span>
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
            <p className="text-[12.5px] text-[#9CA3AF]">Les familles et sous-parties se cochent dans « Familles du projet », plus haut.</p>
            {famillesDe(espace.projet?.familles ?? {}).map((f) => {
              const q = famille(f).taille;
              const t = edition.tailles[f] ?? { repere: null, valeur: null };
              const poser = (suite: { repere: string | null; valeur: number | null }) => setEdition({ ...edition, tailles: { ...edition.tailles, [f]: suite } });
              return (
                <div key={f}>
                  <p className="mb-1.5 text-[12px] font-medium text-[#D1D5DB]">{q.titre}</p>
                  {q.reperes.length ? (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {q.reperes.map((r) => (
                        <button key={r.id} type="button" aria-pressed={t.repere === r.id} onClick={() => poser(t.repere === r.id ? { repere: null, valeur: null } : { repere: r.id, valeur: r.valeur })} className={cn("h-11 rounded-[8px] border-[0.5px] px-3 text-[13px] font-medium sm:h-8 sm:text-[12px]", TRANS, t.repere === r.id ? "border-[#1D9E75] bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#D1D5DB] hover:border-[#3A3E47]")}>
                          {r.libelle}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-[12.5px] text-[#9CA3AF]">
                    <input type="number" inputMode="decimal" min={q.min} max={q.max} step={q.pas} value={t.valeur ?? ""} onChange={(e) => poser({ repere: t.repere, valeur: e.target.value === "" ? null : Number(e.target.value) })} className="h-11 sm:h-9 w-24 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-2 text-[13px] text-[#F2F3F5]" />
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
        <p className="text-[13px] leading-relaxed text-[#D1D5DB]">{confirmation?.texte}</p>
      </Modale>
    </section>
  );
}
