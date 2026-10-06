"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, BellOff, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { TRANS } from "./ui";
import { cn } from "@/lib/utils";

/**
 * Notifications de l'application installée, sur CET appareil.
 *
 * Le service worker est enregistré dès l'ouverture (il sert aussi au hors-ligne).
 * L'abonnement aux notifications, lui, exige un geste : sur iPhone il n'est
 * possible que depuis l'application ajoutée à l'écran d'accueil. Le bandeau dit
 * donc où on en est, et ne propose que ce qui est réellement possible.
 *
 * ntfy reste en parallèle : iOS peut retarder un push web pour économiser la
 * batterie, les deux canaux sonnent toujours ensemble.
 */
type Etat = "inconnu" | "non-supporte" | "a-installer" | "a-activer" | "refuse" | "actif";

const CLE_MASQUE = "coverswap:notifications:masque";

function versOctets(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const brut = window.atob(base64);
  const octets = new Uint8Array(new ArrayBuffer(brut.length));
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
}

const estInstallee = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const estIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function NotificationsAppareil({ application = "crm", compact = false }: { application?: "crm"; compact?: boolean }) {
  const [etat, setEtat] = useState<Etat>("inconnu");
  const [occupe, setOccupe] = useState(false);
  const [masque, setMasque] = useState(false);

  const evaluer = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return setEtat("non-supporte");
    const enregistrement = await navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
    if (!enregistrement) return setEtat("non-supporte");
    if (!("PushManager" in window) || !("Notification" in window)) return setEtat(estIos() && !estInstallee() ? "a-installer" : "non-supporte");
    if (Notification.permission === "denied") return setEtat("refuse");
    const abonnement = await enregistrement.pushManager.getSubscription().catch(() => null);
    if (abonnement && Notification.permission === "granted") {
      // L'abonnement est rappelé au serveur à chaque ouverture : s'il l'avait archivé (appareil resté éteint), il renaît.
      void envoyerJson("/api/push/abonnement", "POST", { application, abonnement: abonnement.toJSON() }).catch(() => undefined);
      return setEtat("actif");
    }
    setEtat("a-activer");
  }, [application]);

  useEffect(() => {
    const minuterie = window.setTimeout(() => {
      try {
        setMasque(window.localStorage.getItem(CLE_MASQUE) === "1");
      } catch {
        setMasque(false);
      }
      void evaluer();
    }, 0);
    return () => window.clearTimeout(minuterie);
  }, [evaluer]);

  async function activer() {
    setOccupe(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setEtat(permission === "denied" ? "refuse" : "a-activer");
        return;
      }
      const enregistrement = await navigator.serviceWorker.ready;
      const { clePublique } = await appelApi<{ clePublique: string }>("/api/push/cle");
      const abonnement = (await enregistrement.pushManager.getSubscription()) ?? (await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(clePublique) }));
      await envoyerJson("/api/push/abonnement", "POST", { application, abonnement: abonnement.toJSON() });
      setEtat("actif");
      await envoyerJson(`/api/push/essai?application=${application}`, "POST");
      toast.success("Notifications activées sur cet appareil", { description: "Une notification d'essai vient de partir." });
    } catch (erreur) {
      toast.error("Activation impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(false);
    }
  }

  function masquer() {
    setMasque(true);
    try {
      window.localStorage.setItem(CLE_MASQUE, "1");
    } catch {
      // Sans stockage local, le bandeau reviendra : sans gravité.
    }
  }

  if (etat === "inconnu" || etat === "actif" || etat === "non-supporte") return null;
  if (masque && etat !== "a-activer") return null;

  const contenu =
    etat === "a-installer"
      ? { icone: <Smartphone size={16} aria-hidden />, texte: "Pour recevoir les notifications sur l'iPhone : bouton Partager de Safari, puis « Sur l'écran d'accueil ». Ouvrez ensuite l'application depuis son icône.", bouton: null }
      : etat === "refuse"
        ? { icone: <BellOff size={16} aria-hidden />, texte: `Les notifications sont refusées pour cette application. Réglages → Notifications → CoverSwap pour les autoriser.`, bouton: null }
        : { icone: <BellRing size={16} aria-hidden />, texte: compact ? "Recevoir les SMS des clients sur ce téléphone" : "Recevoir sur ce téléphone les nouveaux leads, les SMS des clients et leurs gestes dans leur espace.", bouton: "Activer" };

  return (
    <div className={cn("flex items-center gap-3 border-b-[0.5px] border-action/30 bg-action/10 px-3.5 py-2.5 text-[12.5px] leading-snug text-texte-2", !compact && "mb-4 rounded-[12px] border-[0.5px]")}>
      <span className="shrink-0 text-action-clair">{contenu.icone}</span>
      <p className="min-w-0 flex-1">{contenu.texte}</p>
      {contenu.bouton ? (
        <button type="button" disabled={occupe} onClick={() => void activer()} className={cn("h-11 sm:h-10 shrink-0 rounded-[10px] bg-action px-3.5 text-[13px] font-semibold text-action-texte hover:bg-action-clair disabled:opacity-60", TRANS)}>
          {occupe ? "…" : contenu.bouton}
        </button>
      ) : (
        <button type="button" onClick={masquer} aria-label="Masquer" className="flex h-11 sm:h-9 w-11 sm:w-9 shrink-0 items-center justify-center rounded-[8px] text-texte-3 hover:bg-surface-2">
          <X size={15} aria-hidden />
        </button>
      )}
    </div>
  );
}
