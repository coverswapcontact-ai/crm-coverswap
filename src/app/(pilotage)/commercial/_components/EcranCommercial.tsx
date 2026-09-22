"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CircleCheckBig, FolderKanban, Phone, PhoneCall, Receipt, RefreshCw, StickyNote, UserRound, WifiOff, Mail } from "lucide-react";
import { toast } from "sonner";
import { GROUPES_A_MOI, GROUPES_CLIENT, LIBELLES_GROUPE, type Affaire, type GroupeAffaire, type PilotageCommercial } from "@/lib/commercial/types";
import { LIBELLES_PRIORITE, type Priorite } from "@/lib/prospects/priorite";
import { ErreurApi, appelApi, messageErreur } from "@/components/pilotage/client";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import { Bouton, EnTetePage, TRANS } from "@/components/pilotage/ui";
import { FeuilleAppel, FeuilleNote } from "@/components/sms/FilConversation";
import { LienParMail, type CibleLienMail } from "@/components/pilotage/espace/LienParMail";
import { cn } from "@/lib/utils";

const euros = (montant: number) => `${montant.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;

function ilYA(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 60 * 24) return `il y a ${Math.round(minutes / 60)} h`;
  const jours = Math.round(minutes / 1440);
  return jours === 1 ? "hier" : `il y a ${jours} j`;
}

const TON_PRIORITE: Record<string, string> = {
  PRIORITAIRE: "bg-[#EF4444]/15 text-[#F87171]",
  STANDARD: "bg-[#1D9E75]/15 text-[#5DCAA5]",
  SECONDAIRE: "bg-[#22262D] text-[#9CA3AF]",
  A_ECARTER: "bg-[#EF9F27]/15 text-[#F5B454]",
};

const LIBELLES_DERNIER: Record<string, string> = { APPEL: "Appel", SMS: "SMS", EMAIL: "E-mail", NOTE: "Note", SMS_RECU: "SMS reçu", SMS_ENVOYE: "SMS envoyé", NOTE_AJOUTEE: "Note", ESPACE_PHOTOS: "Photos", ESPACE_SIMULATION_CHOISIE: "Choix", ESPACE_COMMENTAIRE: "Commentaire", ESPACE_DEVIS_ACCEPTE: "Accord", DEVIS_GENERE: "Devis", DEVIS_ENVOYE: "Devis", MAIL_ENVOYE: "Mail", MAIL_RECU: "Mail reçu" };

function Carte({ affaire, onFinAppel, onNote }: { affaire: Affaire; onFinAppel: () => void; onNote: () => void }) {
  const lienFiche = affaire.dossierId ? `/dossiers?dossier=${affaire.dossierId}` : `/leads?lead=${affaire.leadId}`;
  // Mission 7 : on écrit par mail (le SMS n'est plus dans la navigation).
  const lienMail = affaire.dossierId ? `/mail?dossier=${affaire.dossierId}` : `/mail?lead=${affaire.leadId}`;
  const aMoi = affaire.main === "MOI";
  return (
    <li className={cn("rounded-[14px] border-[0.5px] bg-[#1C1F25] p-3.5", aMoi ? "border-[#1D9E75]/35" : "border-[#2A2D34]", affaire.enRetard && "border-[#EF4444]/50")}>
      <div className="flex items-start gap-3">
        <Link href={lienFiche} className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[15px] font-medium text-[#F2F3F5]">{affaire.nom}</span>
            {affaire.priorite && affaire.groupe === "RAPPELER" ? (
              <span title={affaire.prioriteMotif ?? undefined} className={cn("rounded-full px-2 py-[1px] text-[10.5px] font-medium", TON_PRIORITE[affaire.priorite] ?? TON_PRIORITE.SECONDAIRE)}>
                {LIBELLES_PRIORITE[affaire.priorite as Priorite] ?? affaire.priorite}
              </span>
            ) : null}
            {affaire.nonLus > 0 ? <span className="rounded-full bg-[#1D9E75] px-1.5 text-[10.5px] leading-[17px] font-semibold text-[#06140F]">{affaire.nonLus} SMS</span> : null}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[#8B919C]">
            {[affaire.etape, affaire.ville, affaire.montant ? euros(affaire.montant) : null].filter(Boolean).join(" · ")}
          </p>
          <p className={cn("mt-1.5 text-[13.5px] leading-snug", aMoi ? "text-[#E5E7EB]" : "text-[#9CA3AF]")}>
            {affaire.action}
            {!aMoi && affaire.depuisJours > 0 ? <span className={cn("tabular-nums", affaire.depuisJours >= 4 ? "text-[#F5B454]" : "text-[#6B7280]")}> · depuis {affaire.depuisJours} j</span> : null}
            {affaire.enRetard ? <span className="text-[#F87171]"> · en retard</span> : null}
          </p>
          {affaire.dernier ? (
            <p className="mt-1 truncate text-[12px] text-[#6B7280]">
              {LIBELLES_DERNIER[affaire.dernier.type] ?? affaire.dernier.type} {ilYA(affaire.dernier.le)} : {affaire.dernier.texte}
            </p>
          ) : null}
        </Link>
      </div>
      {/* Gros boutons, au pouce : appeler, puis noter l'appel ; écrire ; ouvrir. */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {affaire.telephone ? (
          <a href={`tel:${affaire.telephone}`} className={cn("col-span-2 flex h-12 items-center justify-center gap-2 rounded-[12px] text-[14.5px] font-semibold", aMoi ? "bg-[#1D9E75] text-[#06140F] active:bg-[#5DCAA5]" : "bg-[#22262D] text-[#E5E7EB]", TRANS)}>
            <Phone size={17} aria-hidden /> Appeler
          </a>
        ) : (
          <span className="col-span-2 flex h-12 items-center justify-center rounded-[12px] bg-[#22262D] text-[12.5px] text-[#6B7280]">Numéro illisible</span>
        )}
        <button type="button" onClick={onFinAppel} aria-label={`Noter l'appel avec ${affaire.nom}`} className={cn("flex h-12 items-center justify-center rounded-[12px] border-[0.5px] border-[#2A2D34] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}>
          <PhoneCall size={17} aria-hidden />
        </button>
        <Link href={lienMail} aria-label={`Écrire un mail à ${affaire.nom}`} className={cn("flex h-12 items-center justify-center rounded-[12px] border-[0.5px] border-[#2A2D34] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}>
          <Mail size={17} aria-hidden />
        </Link>
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px]">
        <button type="button" onClick={onNote} className="inline-flex items-center gap-1 text-[#8B919C] hover:text-[#F2F3F5]">
          <StickyNote size={12} aria-hidden /> Note
        </button>
        <Link href={lienFiche} className="inline-flex items-center gap-1 text-[#5DCAA5] hover:underline">
          {affaire.genre === "DOSSIER" ? <FolderKanban size={12} aria-hidden /> : <UserRound size={12} aria-hidden />} {affaire.genre === "DOSSIER" ? "Ouvrir le dossier" : "Ouvrir la fiche"}
        </Link>
      </div>
    </li>
  );
}

/**
 * Pilotage commercial : le matin, j'ouvre, je vois les cinq personnes à
 * rappeler et les trois devis à faire. À gauche (en premier sur téléphone) ce
 * qui attend une action de moi ; à droite ce qui attend le client.
 */
export default function EcranCommercial({ initial }: { initial: PilotageCommercial }) {
  const [lienMail, setLienMail] = useState<CibleLienMail | null>(null);
  const [donnees, setDonnees] = useState(initial);
  const [charge, setCharge] = useState(false);
  const [onglet, setOnglet] = useState<"MOI" | "CLIENT">("MOI");
  const [feuille, setFeuille] = useState<{ genre: "appel" | "note"; affaire: Affaire } | null>(null);
  const [replies, setReplies] = useState<Set<GroupeAffaire>>(new Set(["PLUS_TARD", "ECARTER"]));

  const [horsLigne, setHorsLigne] = useState(false);

  const rafraichir = useCallback(async () => {
    setCharge(true);
    try {
      setDonnees(await appelApi<PilotageCommercial>("/api/commercial/pilotage"));
      setHorsLigne(vientDuCache());
    } catch (erreur) {
      // Sans réseau, la dernière version connue reste à l'écran : un bandeau le dit, pas une erreur à chaque essai.
      if (erreur instanceof ErreurApi) toast.error(messageErreur(erreur));
      else setHorsLigne(true);
    } finally {
      setCharge(false);
    }
  }, []);

  useEffect(() => {
    const surRetour = () => document.visibilityState === "visible" && void rafraichir();
    // À l'ouverture aussi : sur réseau médiocre, l'application installée affiche d'abord l'écran gardé en mémoire.
    const premiere = window.setTimeout(surRetour, 0);
    const oublierLeCache = ecouterLeCache(() => setHorsLigne(true));
    document.addEventListener("visibilitychange", surRetour);
    window.addEventListener("online", surRetour);
    const minuterie = window.setInterval(surRetour, 120_000);
    return () => {
      window.clearTimeout(premiere);
      oublierLeCache();
      document.removeEventListener("visibilitychange", surRetour);
      window.removeEventListener("online", surRetour);
      window.clearInterval(minuterie);
    };
  }, [rafraichir]);

  const { compteurs, affaires } = donnees;
  const colonne = (groupes: GroupeAffaire[]) =>
    groupes.map((groupe) => {
      const lignes = affaires.filter((a) => a.groupe === groupe);
      if (lignes.length === 0) return null;
      const replie = replies.has(groupe);
      return (
        <section key={groupe}>
          <button
            type="button"
            onClick={() => setReplies((actuels) => { const suite = new Set(actuels); if (suite.has(groupe)) suite.delete(groupe); else suite.add(groupe); return suite; })}
            aria-expanded={!replie}
            className="mb-2 flex w-full items-center justify-between text-left"
          >
            <h2 className="text-[11.5px] font-medium tracking-wide text-[#8B919C] uppercase">
              {LIBELLES_GROUPE[groupe]} <span className="ml-1 rounded-full bg-[#22262D] px-1.5 py-[1px] text-[#D1D5DB] tabular-nums">{lignes.length}</span>
            </h2>
            <span className="text-[11.5px] text-[#6B7280]">{replie ? "Afficher" : "Replier"}</span>
          </button>
          {replie ? null : (
            <ul className="space-y-2.5">
              {lignes.map((affaire) => (
                <Carte key={affaire.cle} affaire={affaire} onFinAppel={() => setFeuille({ genre: "appel", affaire })} onNote={() => setFeuille({ genre: "note", affaire })} />
              ))}
            </ul>
          )}
        </section>
      );
    });

  const vide = (texte: string) => <p className="rounded-[14px] border-[0.5px] border-dashed border-[#2A2D34] px-4 py-8 text-center text-[13px] text-[#6B7280]">{texte}</p>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8">
      <EnTetePage
        titre="Commercial"
        sousTitre="Toutes les affaires vivantes : ce qui attend une action de vous, ce qui attend le client."
        actions={
          <>
            {/* Trois gestes pour une dépense : ce bouton, le montant, enregistrer (photo du justificatif depuis l'appareil). */}
            <Link href="/depenses/nouvelle" className={cn("inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3.5 text-[13px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-8", TRANS)}>
              <Receipt size={15} aria-hidden /> Dépense
            </Link>
            <Bouton icone={<RefreshCw size={15} aria-hidden />} chargement={charge} onClick={() => void rafraichir()}>
              Rafraîchir
            </Bouton>
          </>
        }
      />

      <NotificationsAppareil application="crm" />
      {horsLigne ? (
        <p className="mb-4 flex items-center gap-2 rounded-[12px] border-[0.5px] border-[#EF9F27]/30 bg-[#EF9F27]/10 px-3.5 py-2.5 text-[12.5px] text-[#F5B454]">
          <WifiOff size={14} aria-hidden /> Hors ligne : voici la dernière version connue. Appeler reste possible.
        </p>
      ) : null}

      {/* Le résumé du matin */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["À rappeler", compteurs.rappeler, "MOI"],
            ["À répondre", compteurs.repondre, "MOI"],
            ["Simulations", compteurs.simulations, "MOI"],
            ["Devis à faire", compteurs.devis, "MOI"],
            ["À planifier", compteurs.planifier, "MOI"],
          ] as const
        ).map(([libelle, nombre]) => (
          <button key={libelle} type="button" onClick={() => setOnglet("MOI")} className={cn("rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2.5 text-left", nombre > 0 && "border-[#1D9E75]/40")}>
            <span className={cn("block text-[22px] leading-none font-semibold tabular-nums", nombre > 0 ? "text-[#F2F3F5]" : "text-[#4B5563]")}>{nombre}</span>
            <span className="mt-1 block text-[11.5px] text-[#8B919C]">{libelle}</span>
          </button>
        ))}
        <Link href="/validation" className={cn("rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2.5", compteurs.relancesAValider > 0 && "border-[#EF9F27]/50")}>
          <span className={cn("flex items-center gap-1.5 text-[22px] leading-none font-semibold tabular-nums", compteurs.relancesAValider > 0 ? "text-[#F5B454]" : "text-[#4B5563]")}>
            {compteurs.relancesAValider} <CircleCheckBig size={15} aria-hidden />
          </span>
          <span className="mt-1 block text-[11.5px] text-[#8B919C]">À valider</span>
        </Link>
      </div>

      {/* Téléphone : deux onglets. Ordinateur : deux colonnes. */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-[12px] bg-[#1C1F25] p-1 lg:hidden">
        {(
          [
            ["MOI", `À moi · ${compteurs.aMoi}`],
            ["CLIENT", `Chez le client · ${compteurs.chezLeClient}`],
          ] as const
        ).map(([cle, libelle]) => (
          <button key={cle} type="button" aria-pressed={onglet === cle} onClick={() => setOnglet(cle)} className={cn("h-11 rounded-[9px] text-[13.5px] font-medium", TRANS, onglet === cle ? "bg-[#1D9E75] text-[#06140F]" : "text-[#9CA3AF]")}>
            {libelle}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={cn("space-y-6", onglet === "MOI" ? "block" : "hidden lg:block")}>
          <h2 className="hidden items-center gap-2 text-[14px] font-medium text-[#5DCAA5] lg:flex">
            <span className="h-2 w-2 rounded-full bg-[#1D9E75]" /> Attend une action de moi · {compteurs.aMoi}
          </h2>
          {compteurs.aMoi === 0 ? vide("Rien n'attend d'action de votre part. Tout est chez les clients.") : colonne(GROUPES_A_MOI)}
        </div>
        <div className={cn("space-y-6", onglet === "CLIENT" ? "block" : "hidden lg:block")}>
          <h2 className="hidden items-center gap-2 text-[14px] font-medium text-[#9CA3AF] lg:flex">
            <span className="h-2 w-2 rounded-full bg-[#6B7280]" /> Attend le client · {compteurs.chezLeClient}
          </h2>
          {compteurs.chezLeClient === 0 ? vide("Aucune affaire en attente d'un client.") : colonne(GROUPES_CLIENT)}
        </div>
      </div>

      {feuille?.genre === "appel" ? (
        <FeuilleAppel
          ouverte
          leadId={feuille.affaire.leadId}
          dossierId={feuille.affaire.dossierId}
          onFermer={() => setFeuille(null)}
          onFait={(suite) => {
            void rafraichir();
            // Intéressé ou pas de réponse : le mail suivant est proposé (lien de son espace), à relire avant d'envoyer.
            if (suite.messagePropose) setLienMail({ dossierId: suite.dossierId, leadId: suite.dossierId ? null : suite.leadId, code: suite.messagePropose });
          }}
        />
      ) : null}
      <LienParMail cible={lienMail} onFermer={() => setLienMail(null)} onEnvoye={() => void rafraichir()} />
      {feuille?.genre === "note" ? <FeuilleNote ouverte leadId={feuille.affaire.leadId} dossierId={feuille.affaire.dossierId} onFermer={() => setFeuille(null)} onFait={() => void rafraichir()} /> : null}
    </div>
  );
}
