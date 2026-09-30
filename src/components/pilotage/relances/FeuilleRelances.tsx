"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Mail, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/evenements";
import { ModaleCorrection } from "@/components/pilotage/Propositions";
import { EcranSms, type DemandeEcranSms } from "@/components/pilotage/sms/EcranSms";
import { Bouton, CARTE, EtatVide, Modale, TRANS } from "@/components/pilotage/ui";
import { euros, pluriel } from "@/lib/commun/format";
import type { RelancePhotos } from "@/lib/relances/photos";
import type { RelancesProposables } from "@/lib/relances/proposables";
import type { DevisARelancer } from "@/lib/relances/service";
import type { PropositionSms } from "@/lib/sms/catalogue";
import type { PropositionVue } from "@/lib/validation/types";
import { cn } from "@/lib/utils";

/**
 * Mission 14 (29/09/2026), partie 6 — où Lucas voit et fait les relances. Une
 * ligne par relance proposable (`GET /api/relances`, la source unique) : un devis
 * resté sans réponse (« SMS » ouvre l'écran SMS avec le texte et la relance à
 * compter ; « Relire le mail » ouvre la relecture existante de la proposition de
 * mail, s'il y en a une), ou un espace ouvert sans photo ni simulation (« SMS »
 * avec le lien). Tout est proposé, rien n'est envoyé : copier le SMS vaut
 * relance, la ligne disparaît au rechargement.
 *
 * L'écran SMS et la relecture du mail s'ouvrent DANS la feuille (ou la fiche du
 * dossier) : des fenêtres imbriquées, qui ne ferment pas celle d'où elles
 * viennent. Un client qui a répondu STOP n'a pas de bouton « SMS ».
 */

type OuvertureSms = { proposition?: PropositionSms; demande?: DemandeEcranSms };

/** Les relances proposables (d'un dossier, ou toutes), relues à la demande — et quand `cle` change (le dossier a bougé). */
function useRelances(dossierId: string | null, cle = "") {
  const [donnees, setDonnees] = useState<RelancesProposables | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let actif = true;
    appelApi<RelancesProposables>(`/api/relances${dossierId ? `?dossierId=${encodeURIComponent(dossierId)}` : ""}`)
      .then((lues) => {
        if (actif) setDonnees(lues);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [dossierId, cle, version]);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  return { donnees, recharger };
}

const smsDuDevis = (d: DevisARelancer): OuvertureSms =>
  d.sms ? { proposition: d.sms } : { demande: { action: "RELANCE_DEVIS", dossierId: d.dossierId, relance: { documentId: d.documentId, rang: d.rang } } };
const smsDesPhotos = (p: RelancePhotos): OuvertureSms => (p.sms ? { proposition: p.sms } : { demande: { action: "RELANCE_PHOTOS", dossierId: p.dossierId, relance: { type: "PHOTOS", rang: p.rang } } });

/**
 * Les fenêtres ouvertes depuis une ligne : l'écran SMS, la relecture du mail. Rechargent la liste après un geste ;
 * `apresCopie` remplace ce rechargement après une copie (la fiche du dossier se relit, et la rubrique avec elle).
 * Les compteurs de navigation, eux, suivent toute écriture (`appelApi`).
 */
function useGestes(recharger: () => void, apresCopie?: () => void) {
  const [sms, setSms] = useState<OuvertureSms | null>(null);
  const [mail, setMail] = useState<{ propositionId: string; dossierId: string } | null>(null);
  const finMail = useCallback(
    (fait: boolean) => {
      setMail(null);
      if (fait) recharger();
    },
    [recharger]
  );
  const fenetres = (
    <>
      {sms ? (
        <EcranSms
          proposition={sms.proposition}
          demande={sms.demande}
          onFini={(fin) => {
            setSms(null);
            if (fin.copie) (apresCopie ?? recharger)();
          }}
        />
      ) : null}
      {mail ? <RelectureMail propositionId={mail.propositionId} dossierId={mail.dossierId} onFini={finMail} /> : null}
    </>
  );
  return { ouvrirSms: setSms, ouvrirMail: setMail, fenetres };
}

/** La relecture existante d'une proposition de mail (celle de « À valider ») : corriger puis valider. Mission 17 (partie A) : exportée pour l'écran Tâches (relance par mail). */
export function RelectureMail({ propositionId, dossierId, onFini }: { propositionId: string; dossierId: string; onFini: (fait: boolean) => void }) {
  const [proposition, setProposition] = useState<PropositionVue | null>(null);
  useEffect(() => {
    let actif = true;
    appelApi<{ propositions: PropositionVue[] }>(`/api/validation?statut=EN_ATTENTE&type=ENVOI_MAIL&dossierId=${encodeURIComponent(dossierId)}`)
      .then(({ propositions }) => {
        if (!actif) return;
        const trouvee = propositions.find((p) => p.id === propositionId);
        if (trouvee) setProposition(trouvee);
        else {
          toast.error("Ce mail n'attend plus de validation", { description: "Il a été validé, rejeté ou annulé entre-temps." });
          // Rien n'a été écrit ici : les compteurs se relisent à la main (validé ailleurs).
          rafraichirCompteurs();
          onFini(true);
        }
      })
      .catch((erreur: unknown) => {
        if (!actif) return;
        toast.error("Mail introuvable", { description: messageErreur(erreur) });
        onFini(false);
      });
    return () => {
      actif = false;
    };
  }, [propositionId, dossierId, onFini]);

  if (!proposition) return null;
  return (
    <ModaleCorrection
      proposition={proposition}
      onFermer={() => onFini(false)}
      onValider={async (corrections) => {
        try {
          await envoyerJson(`/api/validation/${proposition.id}/valider`, "POST", { corrections });
          toast.success("Mail validé : il part", { description: proposition.titre });
          onFini(true);
        } catch (erreur) {
          toast.error("Validation impossible", { description: messageErreur(erreur) });
        }
      }}
    />
  );
}

const CLASSE_LIGNE = "flex flex-col gap-2.5 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between";

function BoutonsRelance({ onSms, onMail }: { onSms?: () => void; onMail?: () => void }) {
  if (!onSms && !onMail) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {onSms ? (
        <Bouton variante="primaire" icone={<MessageSquare size={15} aria-hidden />} onClick={onSms}>
          SMS
        </Bouton>
      ) : null}
      {onMail ? (
        <Bouton icone={<Mail size={15} aria-hidden />} onClick={onMail}>
          Relire le mail
        </Bouton>
      ) : null}
    </div>
  );
}

/** « {nom} — devis {numéro} de {montant}, relance {rang}/2, envoyé il y a N jours ». */
export function texteRelanceDevis(d: DevisARelancer): string {
  return `devis ${d.numero} de ${euros(d.totalHt)}, relance ${d.rang}/2, envoyé il y a ${pluriel(d.joursDepuisEmission, "jour")}`;
}

/** Ce qui manque à une relance de devis, dit sous la ligne : STOP, pas de mail, mail en échec. */
export function noteRelanceDevis(d: DevisARelancer): string | null {
  if (d.mail) return d.stop ? "A répondu STOP : pas de SMS, le mail seul." : null;
  if (d.mailTraite?.statut === "ECHEC") return d.stop ? "A répondu STOP, et le mail de relance n'est pas parti (échec) : le réessayer dans « À valider »." : "Le mail de relance n'est pas parti (échec) : copier le SMS l'annule.";
  if (d.stop) return "A répondu STOP : pas de SMS.";
  if (d.refusMail) return "A refusé les mails : le SMS seul.";
  if (!d.adresse) return "Pas d'adresse e-mail : le SMS seul.";
  if (d.mailTraite) return "Mail de ce rang déjà écarté : le SMS seul.";
  return null;
}

/** Les gestes d'une relance de devis : « SMS » (jamais vers un numéro en STOP), « Relire le mail » s'il attend. */
const gestesDuDevis = (d: DevisARelancer, ouvrirSms: (o: OuvertureSms) => void, ouvrirMail: (m: { propositionId: string; dossierId: string }) => void) => ({
  onSms: d.stop ? undefined : () => ouvrirSms(smsDuDevis(d)),
  onMail: d.mail ? () => ouvrirMail({ propositionId: d.mail!.propositionId, dossierId: d.dossierId }) : undefined,
});

/** « {nom} — espace ouvert il y a N jours, ni photo ni simulation ». */
export function texteRelancePhotos(p: RelancePhotos): string {
  return `espace ouvert il y a ${pluriel(p.joursDepuisOuverture, "jour")}, ni photo ni simulation`;
}

/** La feuille « Relances » : toutes les relances proposables, une ligne chacune. */
export function FeuilleRelances({ donnees, onRecharger, onFermer }: { donnees: RelancesProposables | null; onRecharger: () => void; onFermer: () => void }) {
  const { ouvrirSms, ouvrirMail, fenetres } = useGestes(onRecharger);
  const total = donnees?.total ?? 0;
  return (
    <Modale ouverte onFermer={onFermer} titre={total > 0 ? `Relances proposables · ${total}` : "Relances"} description="Copier le SMS vaut relance (deux au plus). Rien ne part tout seul.">
      {!donnees ? (
        <p className="text-[13px] text-[#9CA3AF]">Lecture des relances…</p>
      ) : total === 0 ? (
        <EtatVide titre="Plus aucune relance à faire" texte="Un devis sans réponse ou un espace sans photo reviendra ici une fois le délai passé." />
      ) : (
        <ul className={cn(CARTE, "divide-y-[0.5px] divide-[#2A2D34] overflow-hidden")}>
          {donnees.devis.map((d) => {
            const note = noteRelanceDevis(d);
            return (
              <li key={`devis:${d.documentId}`} className={CLASSE_LIGNE}>
                <p className="min-w-0 text-[13.5px] leading-snug text-[#D1D5DB]">
                  <span className="font-medium text-[#F2F3F5]">{d.clientNom}</span> — {texteRelanceDevis(d)}
                  {note ? <span className="block text-[12px] text-[#8B919C]">{note}</span> : null}
                </p>
                <BoutonsRelance {...gestesDuDevis(d, ouvrirSms, ouvrirMail)} />
              </li>
            );
          })}
          {donnees.photos.map((p) => (
            <li key={`photos:${p.espaceId}`} className={CLASSE_LIGNE}>
              <p className="min-w-0 text-[13.5px] leading-snug text-[#D1D5DB]">
                <span className="font-medium text-[#F2F3F5]">{p.clientNom}</span> — {texteRelancePhotos(p)}
                {p.rang > 1 ? <span className="block text-[12px] text-[#8B919C]">Relance photos {p.rang}/2</span> : null}
              </p>
              <BoutonsRelance onSms={() => ouvrirSms(smsDesPhotos(p))} />
            </li>
          ))}
        </ul>
      )}
      {fenetres}
    </Modale>
  );
}

const CLASSE_MORCEAU = "inline-flex h-11 items-center rounded-[8px] px-1.5 hover:text-[#F2F3F5] sm:h-8";

/**
 * Écran Leads, sous les puces (mission 14, partie 7) : « N rappels aujourd'hui · N en retard · N relances proposables ».
 * Chaque morceau se touche : les rappels ouvrent la liste « À rappeler » (`onRappels`), les relances la feuille
 * Relances. Les rappels sont les comptes de la liste (servis avec elle) ; les relances, la lecture de `/api/relances`
 * faite à l'ouverture de l'écran (pas une requête de plus).
 */
export function LigneDuJour({ aujourdhui, enRetard, onRappels }: { aujourdhui: number; enRetard: number; onRappels: () => void }) {
  const { donnees, recharger } = useRelances(null);
  const [ouverte, setOuverte] = useState(false);
  const total = donnees?.total ?? 0;
  return (
    <>
      <p className="mt-3 flex flex-wrap items-center gap-x-0.5 text-[13.5px] text-[#9CA3AF]">
        <BellRing size={15} aria-hidden className="mr-1 shrink-0" />
        <button type="button" onClick={onRappels} className={cn(CLASSE_MORCEAU, TRANS)}>
          {pluriel(aujourdhui, "rappel")} aujourd&apos;hui
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={onRappels} className={cn(CLASSE_MORCEAU, enRetard > 0 && "font-medium text-[#F87171]", TRANS)}>
          {enRetard} en retard
        </button>
        {donnees ? (
          <>
            <span aria-hidden>·</span>
            <button type="button" onClick={() => setOuverte(true)} className={cn(CLASSE_MORCEAU, total > 0 && "text-[#F5B454]", TRANS)}>
              {pluriel(total, "relance proposable", "relances proposables")}
            </button>
          </>
        ) : null}
      </p>
      {ouverte ? (
        <FeuilleRelances
          donnees={donnees}
          onRecharger={recharger}
          onFermer={() => {
            setOuverte(false);
            recharger();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Fiche du dossier, dans « ce qui attend » : « Relance proposable : devis {numéro} ({rang}/2) », avec « SMS » et
 * « Relire le mail ». `cle` change quand le dossier bouge sous elle (étape, nouvel événement : relecture du panneau) :
 * la rubrique se relit. Après une copie, `onCopie` relit le panneau (étape « Relance », historique), et elle avec.
 */
export function RelancesDuDossier({ dossierId, cle, onCopie }: { dossierId: string; cle: string; onCopie?: () => void }) {
  const { donnees, recharger } = useRelances(dossierId, cle);
  const { ouvrirSms, ouvrirMail, fenetres } = useGestes(recharger, onCopie);
  if (!donnees || donnees.total === 0) return fenetres;
  return (
    <section id="rubrique-relances" className="rounded-[11px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/5">
      <ul className="divide-y-[0.5px] divide-[#2A2D34]">
        {donnees.devis.map((d) => {
          const note = noteRelanceDevis(d);
          return (
            <li key={d.documentId} className={CLASSE_LIGNE}>
              <p className="text-[13px] text-[#F5B454]">
                Relance proposable : devis {d.numero} ({d.rang}/2)
                {note ? <span className="block text-[12px] text-[#8B919C]">{note}</span> : null}
              </p>
              <BoutonsRelance {...gestesDuDevis(d, ouvrirSms, ouvrirMail)} />
            </li>
          );
        })}
        {donnees.photos.map((p) => (
          <li key={p.espaceId} className={CLASSE_LIGNE}>
            <p className="text-[13px] text-[#F5B454]">
              Relance proposable : {texteRelancePhotos(p)} ({p.rang}/2)
            </p>
            <BoutonsRelance onSms={() => ouvrirSms(smsDesPhotos(p))} />
          </li>
        ))}
      </ul>
      {fenetres}
    </section>
  );
}
