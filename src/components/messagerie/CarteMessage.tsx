"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Copy, Mail, MessageSquareText, Pencil, Send, X } from "lucide-react";
import { toast } from "sonner";
import { lienMail, lienSms, plateformeDe } from "@/lib/messagerie/texte";
import type { MessageVue } from "@/lib/messagerie/vues";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/evenements";
import { TRANS } from "@/components/pilotage/ui";

/**
 * Mission 25 — un message prêt (cahier, § Ton quotidien) : « Ouvrir Messages » (numéro et texte remplis), puis, au
 * retour, un seul gros bouton « ✅ Envoyé ». Autour : ✏️ Modifier (le texte vraiment envoyé), ⏰ Plus tard (1 h, 3 h,
 * demain 9 h 30), 🚫 Ne pas envoyer (raison en un appui), 📋 Copier en secours. Une image à joindre (client « SMS
 * d'abord ») : appui long pour l'enregistrer. Une proposition (démarrage en douceur) se valide d'abord ; un message
 * programmé se fait « Maintenant » ou s'annule. Rien ne part d'ici : Lucas envoie depuis son téléphone.
 */

export const BOUTON_PRINCIPAL = cn("flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[12px] bg-action px-4 text-[16px] font-semibold text-action-texte hover:bg-action-clair", TRANS);
export const BOUTON_SECONDAIRE_M = cn("flex min-h-[44px] items-center justify-center gap-1.5 rounded-[10px] border-[0.5px] border-trait px-3 text-[14px] text-texte-2 hover:border-trait-2 hover:text-texte", TRANS);

const PLUS_TARD = [
  { valeur: "1H", libelle: "Dans 1 h" },
  { valeur: "3H", libelle: "Dans 3 h" },
  { valeur: "DEMAIN", libelle: "Demain 9 h 30" },
] as const;
const RAISONS = [
  { valeur: "DEJA_FAIT_TELEPHONE", libelle: "Déjà fait par téléphone" },
  { valeur: "PLUS_PERTINENT", libelle: "Plus pertinent" },
  { valeur: "AUTRE", libelle: "Autre" },
] as const;

export const heureLisible = (iso: string) => {
  const date = new Date(iso);
  const aujourdhui = new Date();
  const demain = new Date(aujourdhui.getTime() + 86_400_000);
  const jour = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  const heure = date.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "2-digit" }).replace(":", " h ").replace(/ h 00$/, " h");
  if (jour(date) === jour(aujourdhui)) return `aujourd'hui ${heure}`;
  if (jour(date) === jour(demain)) return `demain ${heure}`;
  return `${date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "numeric" })} ${heure}`;
};

type Etape = "PRET" | "MODIFIER" | "PLUS_TARD" | "NON";

export function CarteMessage({
  message,
  nom,
  onChange,
  compacte = false,
}: {
  message: MessageVue;
  nom?: string;
  /** Après un geste : le message relu (null s'il n'est plus à faire). */
  onChange?: (message: MessageVue | null) => void;
  compacte?: boolean;
}) {
  const [texte, setTexte] = useState(message.texte);
  const [ouvert, setOuvert] = useState(message.ouvert);
  const [etape, setEtape] = useState<Etape>("PRET");
  const [occupe, setOccupe] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [raison, setRaison] = useState<(typeof RAISONS)[number]["valeur"] | null>(null);
  const [plateforme, setPlateforme] = useState<"IOS" | "ANDROID" | "AUTRE">("AUTRE");

  useEffect(() => {
    const id = window.setTimeout(() => setPlateforme(plateformeDe(navigator.userAgent)), 0);
    return () => window.clearTimeout(id);
  }, []);

  const modifie = texte.trim() !== message.texte.trim();
  const lien = useMemo(() => {
    if (message.canal === "SMS" && message.destinataire) return lienSms(message.destinataire, texte, plateforme);
    if (message.canal === "MAIL" && message.destinataire) return lienMail(message.destinataire, message.objet ?? "CoverSwap", texte);
    return null;
  }, [message.canal, message.destinataire, message.objet, texte, plateforme]);

  async function agir(corps: Record<string, unknown>, succes: string) {
    setOccupe(true);
    try {
      const { message: relu } = await envoyerJson<{ message: MessageVue | null }>(`/api/messagerie/messages/${message.id}`, "POST", corps);
      toast.success(succes);
      rafraichirCompteurs();
      onChange?.(relu && ["A_ENVOYER", "A_VALIDER", "PREVU"].includes(relu.statut) ? relu : null);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  function ouvrirMessages() {
    setOuvert(true);
    void envoyerJson(`/api/messagerie/messages/${message.id}`, "POST", { action: "ouvert" }).catch(() => undefined);
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(texte);
      toast.success("Copié ✅ : colle-le dans Messages");
    } catch {
      toast.error("Copie refusée : sélectionne le texte à la main");
    }
  }

  const envoye = () => agir({ action: "envoye", ...(modifie ? { texte } : {}) }, modifie ? "Envoyé (modifié) ✅" : "Envoyé ✅");

  // ── Programmé : « Prévu demain 9 h 40 » ─────────────────────────────────────
  if (message.statut === "PREVU") {
    return (
      <div className="rounded-[14px] border-[0.5px] border-dashed border-trait-2 bg-surface/60 p-3">
        <p className="flex items-center gap-1.5 text-[13px] text-texte-3">
          <Clock size={14} aria-hidden /> Prévu {heureLisible(message.prevuLe)} · {message.libelle}
        </p>
        <p className="mt-1.5 text-[15px] leading-snug whitespace-pre-wrap text-texte-2">{message.texte}</p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button type="button" disabled={occupe} onClick={() => agir({ action: "plus-tard", quand: "MAINTENANT" }, "À envoyer maintenant")} className={BOUTON_SECONDAIRE_M}>
            Maintenant
          </button>
          <button type="button" disabled={occupe} onClick={() => agir({ action: "annuler" }, "Annulé")} className={BOUTON_SECONDAIRE_M}>
            Annuler
          </button>
        </div>
      </div>
    );
  }

  const proposition = message.statut === "A_VALIDER";
  return (
    <div className={cn("rounded-[14px] border-[1.5px] border-dashed border-action/60 bg-surface p-3", compacte && "p-2.5")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-action-clair">
          {proposition ? "Proposition · " : message.nonConfirme ? "Pas confirmé hier · " : ""}
          {message.libelle}
          {message.canal !== "SMS" ? ` · par ${message.canal === "MAIL" ? "mail" : "l'espace"}` : ""}
        </p>
        <button type="button" onClick={copier} aria-label="Copier le texte" className={cn("-mt-1 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-texte-3 hover:text-texte", TRANS)}>
          <Copy size={17} aria-hidden />
        </button>
      </div>
      {message.raison ? <p className="text-[12.5px] text-texte-3">{message.raison}</p> : null}

      {etape === "MODIFIER" ? (
        <textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          rows={5}
          aria-label="Texte du message"
          className="mt-2 w-full rounded-[10px] border-[0.5px] border-trait bg-fond p-2.5 text-[16px] leading-snug text-texte focus:border-action focus:outline-none"
        />
      ) : (
        <p className="mt-2 text-[16px] leading-snug whitespace-pre-wrap text-texte select-text">{texte}</p>
      )}
      <p className="mt-1 text-right text-[12px] text-texte-3 tabular-nums">{texte.length} caractères</p>

      {message.image ? (
        <figure className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- image privée servie par le CRM, à enregistrer d'un appui long */}
          <img src={message.image} alt="Simulation à joindre" className="max-h-64 w-full rounded-[10px] object-cover" />
          <figcaption className="mt-1 text-[12.5px] text-texte-3">Appui long sur l&apos;image pour l&apos;enregistrer, puis joins-la dans Messages.</figcaption>
        </figure>
      ) : null}

      {etape === "PLUS_TARD" ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {PLUS_TARD.map((p) => (
            <button key={p.valeur} type="button" disabled={occupe} onClick={() => agir({ action: "plus-tard", quand: p.valeur }, `Reporté : ${p.libelle.toLowerCase()}`)} className={BOUTON_SECONDAIRE_M}>
              {p.libelle}
            </button>
          ))}
          <button type="button" onClick={() => setEtape("PRET")} className={cn(BOUTON_SECONDAIRE_M, "col-span-3")}>
            Retour
          </button>
        </div>
      ) : etape === "NON" ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {RAISONS.map((r) => (
              <button key={r.valeur} type="button" onClick={() => setRaison(r.valeur)} className={cn(BOUTON_SECONDAIRE_M, raison === r.valeur && "border-action text-texte")}>
                {r.libelle}
              </button>
            ))}
          </div>
          {raison === "AUTRE" ? (
            <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Pourquoi, en quelques mots" aria-label="Pourquoi" className="w-full rounded-[10px] border-[0.5px] border-trait bg-fond px-3 py-2.5 text-[16px] text-texte focus:border-action focus:outline-none" />
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setEtape("PRET")} className={BOUTON_SECONDAIRE_M}>
              Retour
            </button>
            <button type="button" disabled={!raison || occupe || (raison === "AUTRE" && !commentaire.trim())} onClick={() => agir({ action: "non-envoye", raison, ...(commentaire.trim() ? { commentaire } : {}) }, "Noté : pas envoyé")} className={cn(BOUTON_SECONDAIRE_M, "border-retard/60 text-retard-texte")}>
              Ne pas envoyer
            </button>
          </div>
        </div>
      ) : proposition ? (
        <div className="mt-3 space-y-2">
          <button type="button" disabled={occupe} onClick={() => agir({ action: "valider" }, "Validé : à envoyer")} className={BOUTON_PRINCIPAL}>
            <Check size={18} aria-hidden /> Valider
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setEtape("MODIFIER")} className={BOUTON_SECONDAIRE_M}>
              <Pencil size={15} aria-hidden /> Modifier
            </button>
            <button type="button" onClick={() => setEtape("NON")} className={BOUTON_SECONDAIRE_M}>
              <X size={15} aria-hidden /> Ne pas envoyer
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {message.nonConfirme && !ouvert ? (
            <button type="button" disabled={occupe} onClick={envoye} className={BOUTON_PRINCIPAL}>
              <Check size={18} aria-hidden /> Je l&apos;avais envoyé
            </button>
          ) : null}
          {message.canal === "ESPACE" ? (
            <button type="button" disabled={occupe} onClick={() => agir({ action: "envoyer-espace", ...(modifie ? { texte } : {}) }, "Envoyé dans son espace ✅")} className={BOUTON_PRINCIPAL}>
              <Send size={18} aria-hidden /> Envoyer dans son espace
            </button>
          ) : ouvert ? (
            <button type="button" disabled={occupe} onClick={envoye} className={BOUTON_PRINCIPAL}>
              <Check size={18} aria-hidden /> Envoyé
            </button>
          ) : lien ? (
            <a href={lien} onClick={ouvrirMessages} className={BOUTON_PRINCIPAL}>
              {message.canal === "MAIL" ? <Mail size={18} aria-hidden /> : <MessageSquareText size={18} aria-hidden />}
              {message.canal === "MAIL" ? "Ouvrir le mail" : "Ouvrir Messages"}
            </a>
          ) : (
            <p className="rounded-[10px] bg-surface-2 p-2.5 text-[13px] text-attention-texte">Pas de numéro joignable : copie le texte.</p>
          )}
          <div className={cn("grid gap-2", ouvert ? "grid-cols-3" : "grid-cols-3")}>
            {ouvert && message.canal !== "ESPACE" ? (
              <a href={lien ?? "#"} onClick={ouvrirMessages} className={BOUTON_SECONDAIRE_M}>
                Rouvrir
              </a>
            ) : (
              <button type="button" onClick={() => setEtape(etape === "MODIFIER" ? "PRET" : "MODIFIER")} className={cn(BOUTON_SECONDAIRE_M, "px-1.5 text-[13.5px]")}>
                {etape === "MODIFIER" ? "Fini" : "Modifier"}
              </button>
            )}
            <button type="button" onClick={() => setEtape("PLUS_TARD")} className={cn(BOUTON_SECONDAIRE_M, "px-1.5 text-[13.5px]")}>
              Plus tard
            </button>
            <button type="button" onClick={() => setEtape("NON")} className={cn(BOUTON_SECONDAIRE_M, "px-1.5 text-[13.5px]")}>
              Pas envoyer
            </button>
          </div>
          {ouvert && etape !== "MODIFIER" ? (
            <button type="button" onClick={() => setEtape("MODIFIER")} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
              <Pencil size={15} aria-hidden /> Modifié : colle ce que tu as vraiment envoyé
            </button>
          ) : null}
        </div>
      )}
      {nom ? <span className="sr-only">Message pour {nom}</span> : null}
    </div>
  );
}
