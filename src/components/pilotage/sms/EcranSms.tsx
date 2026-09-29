"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Copy, MessageSquare, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { useRetourFerme } from "@/components/pilotage/fermeture-mobile";
import { Bouton, CLASSE_SAISIE } from "@/components/pilotage/ui";
import { LONGUEUR_VISEE, type ActionSms, type PropositionSms, type RelanceSms } from "@/lib/sms/catalogue";
import { mesurerSms } from "@/lib/sms/texte";
import { cn } from "@/lib/utils";

/**
 * Mission 14 (29/09/2026), partie 5 — l'écran SMS : un message prérempli (le
 * catalogue, selon l'action et la source du lead), modifiable, un compteur, et
 * deux boutons. « Copier » met le texte TEL QU'IL EST dans le presse-papiers et
 * l'écrit dans l'historique (copier vaut envoi : `POST /api/sms/copie`) ;
 * « Passer » n'enregistre rien. « Ouvrir Messages » n'enregistre rien non plus.
 *
 * Plein écran sur téléphone, fenêtre centrée sur ordinateur, au-dessus de tout
 * (fin d'appel, mode appels). S'ouvre de n'importe où par `ouvrirEcranSms` (un
 * événement fenêtre, reçu par `HoteEcranSms` monté dans le gabarit), ou se rend
 * directement avec `EcranSms`.
 */

export type DemandeEcranSms = { action: ActionSms; leadId?: string | null; dossierId?: string | null; rappelLe?: string | null; relance?: RelanceSms | null };
export type FinEcranSms = { copie: boolean };
export type OuvertureEcranSms = { proposition?: PropositionSms; demande?: DemandeEcranSms; onFini?: (fin: FinEcranSms) => void };

const EVENEMENT_OUVRIR = "sms:ouvrir";

/** Ouvre l'écran SMS avec un SMS déjà proposé, ou le demande au serveur (action + cible). */
export function ouvrirEcranSms(ouverture: OuvertureEcranSms): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<OuvertureEcranSms>(EVENEMENT_OUVRIR, { detail: ouverture }));
}

/** Monté une fois dans le gabarit du pilotage : reçoit `ouvrirEcranSms`. */
export function HoteEcranSms() {
  const [ouverture, setOuverture] = useState<(OuvertureEcranSms & { cle: number }) | null>(null);
  useEffect(() => {
    let compteur = 0;
    const ouvrir = (evenement: Event) => {
      const detail = (evenement as CustomEvent<OuvertureEcranSms>).detail;
      if (detail) setOuverture({ ...detail, cle: ++compteur });
    };
    window.addEventListener(EVENEMENT_OUVRIR, ouvrir);
    return () => window.removeEventListener(EVENEMENT_OUVRIR, ouvrir);
  }, []);
  if (!ouverture) return null;
  return (
    <EcranSms
      key={ouverture.cle}
      proposition={ouverture.proposition}
      demande={ouverture.demande}
      onFini={(fin) => {
        setOuverture(null);
        ouverture.onFini?.(fin);
      }}
    />
  );
}

/** Le presse-papiers ; à défaut (ancien navigateur, contexte refusé), la sélection de la zone et « copier ». */
async function copierTexte(texte: string, zone: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    if (!zone) return false;
    zone.focus();
    zone.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

const numeroComposable = (telephone: string) => telephone.replace(/[^\d+]/g, "");

export function EcranSms({ proposition, demande, onFini }: { proposition?: PropositionSms; demande?: DemandeEcranSms; onFini: (fin: FinEcranSms) => void }) {
  const [charge, setCharge] = useState<PropositionSms | null>(proposition ?? null);
  const [texte, setTexte] = useState(proposition?.texte ?? "");
  const [erreur, setErreur] = useState<string | null>(proposition || demande ? null : "Aucun SMS à proposer.");
  const [envoi, setEnvoi] = useState(false);
  // Le presse-papiers a refusé : Lucas copie à la main, puis dit « J'ai copié le texte » (la copie vaut toujours envoi).
  const [copieManuelle, setCopieManuelle] = useState(false);
  const zone = useRef<HTMLTextAreaElement>(null);
  const passer = () => onFini({ copie: false });
  // Le geste retour (bord gauche sur iPhone) vaut « Passer ».
  useRetourFerme(true, passer);

  useEffect(() => {
    if (proposition || !demande) return;
    let actif = true;
    envoyerJson<{ proposition: PropositionSms }>("/api/sms/proposition", "POST", demande)
      .then(({ proposition: recue }) => {
        if (!actif) return;
        setCharge(recue);
        setTexte(recue.texte);
      })
      .catch((probleme: unknown) => {
        if (actif) setErreur(messageErreur(probleme));
      });
    return () => {
      actif = false;
    };
  }, [proposition, demande]);

  const mesure = mesurerSms(texte);
  const avecLien = /https?:\/\//.test(texte);

  async function copier() {
    const valeur = texte.trim();
    if (!charge || !valeur || envoi) return;
    // D'abord le presse-papiers, dans le geste de Lucas (Safari l'exige), puis la trace.
    if (!copieManuelle && !(await copierTexte(valeur, zone.current))) {
      setCopieManuelle(true);
      toast.error("Copie impossible", { description: "Sélectionne le texte, copie-le, puis touche « J'ai copié le texte »." });
      return;
    }
    setEnvoi(true);
    try {
      await envoyerJson("/api/sms/copie", "POST", { code: charge.code, texte: valeur, leadId: charge.leadId, dossierId: charge.dossierId, relance: charge.relance ?? null });
      toast.success("SMS copié : colle-le dans Messages");
      onFini({ copie: true });
    } catch (probleme) {
      toast.error("SMS copié, mais pas enregistré", { description: `${messageErreur(probleme)} Touche « Copier » à nouveau pour l'enregistrer.` });
    } finally {
      setEnvoi(false);
    }
  }

  const telephone = charge?.telephone ? numeroComposable(charge.telephone) : null;

  return (
    <Dialog open onOpenChange={(ouvert) => (ouvert ? undefined : passer())}>
      <DialogPortal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[80] bg-black/60 supports-backdrop-filter:backdrop-blur-xs" />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-0 z-[80] flex flex-col bg-[#1C1F25] text-[#F2F3F5] outline-none",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[14px] sm:border-[0.5px] sm:border-[#2A2D34] sm:pt-0 sm:pb-0 sm:shadow-lg sm:shadow-black/50"
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="flex items-center gap-2 truncate text-[16px] font-medium text-[#F2F3F5]">
                <MessageSquare size={16} aria-hidden className="shrink-0 text-[#5DCAA5]" />
                {charge ? `SMS à ${charge.nom}` : "SMS"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-[13px] text-[#9CA3AF]">
                {charge ? (
                  telephone ? (
                    <a href={`tel:${telephone}`} className="inline-flex min-h-[44px] items-center gap-1.5 text-[#D1D5DB] underline decoration-[#3A3E47] underline-offset-2 sm:min-h-[32px]">
                      <Phone size={13} aria-hidden /> {charge.telephone}
                    </a>
                  ) : (
                    <span className="text-[#F5B454]">Pas de numéro connu : copie le texte et envoie-le autrement.</span>
                  )
                ) : erreur ? (
                  "SMS indisponible."
                ) : (
                  "Préparation du SMS…"
                )}
              </DialogPrimitive.Description>
            </div>
            <Bouton variante="fantome" taille="icone" onClick={passer} aria-label="Passer" className="-mr-2">
              <X size={16} />
            </Bouton>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
            {erreur ? (
              <p className="text-[13.5px] text-[#F87171]">{erreur}</p>
            ) : (
              <>
                <textarea
                  ref={zone}
                  value={texte}
                  disabled={!charge}
                  onChange={(evenement) => setTexte(evenement.target.value)}
                  aria-label="Texte du SMS"
                  placeholder={charge ? undefined : "Préparation…"}
                  className={cn(CLASSE_SAISIE, "min-h-[180px] flex-1 resize-none py-2.5 leading-relaxed sm:min-h-[200px] sm:flex-none sm:text-[14px]")}
                />
                <p className="mt-2 text-[12.5px] text-[#9CA3AF]">
                  {mesure.longueur} caractères · {mesure.segments} SMS
                  {!avecLien && mesure.longueur > LONGUEUR_VISEE ? <span className="text-[#F5B454]"> · Vise {LONGUEUR_VISEE} caractères</span> : null}
                </p>
              </>
            )}
          </div>

          <div className="border-t-[0.5px] border-[#2A2D34] px-4 pt-3 pb-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Bouton variante="primaire" className="h-12 text-[15px] sm:h-11" icone={<Copy size={16} aria-hidden />} disabled={!charge || !texte.trim() || Boolean(erreur)} chargement={envoi} onClick={() => void copier()}>
                {copieManuelle ? "J'ai copié le texte" : "Copier"}
              </Bouton>
              <Bouton className="h-12 px-5 text-[15px] sm:h-11" onClick={passer}>
                Passer
              </Bouton>
            </div>
            {telephone ? (
              <a href={`sms:${telephone}`} className="mt-1 flex min-h-[44px] items-center justify-center text-[13px] text-[#9CA3AF] underline decoration-[#3A3E47] underline-offset-2 hover:text-[#F2F3F5] sm:min-h-[36px]">
                Ouvrir Messages
              </a>
            ) : null}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
